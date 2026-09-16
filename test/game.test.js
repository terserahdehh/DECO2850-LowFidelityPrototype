const assert = require("node:assert/strict");
const path = require("node:path");
const { after, afterEach, before, beforeEach, test } = require("node:test");
const activities = require("../data/activities");
const { server, io, gameState, resetGame } = require("../server");

// Socket.IO already ships this client. Node 22+ provides its WebSocket transport,
// so these integration tests do not need another dependency.
const { io: createSocket } = require(
  path.join(path.dirname(require.resolve("socket.io")), "../client-dist/socket.io.js")
);

const clients = new Set();
let baseUrl;

// Expected prototype content and the supplied Person 5 object groups.
const missionItems = [
  ["carrot", "chicken", "rice"],
  ["chair", "book", "table"],
  ["butterfly", "tree", "bird"],
];
const objectFolders = ["eat_objects", "sit_objects", "see_objects"];
const missionReactions = ["eating", "sitting", "looking"];
const translatedLabels = {
  indonesian: [["wortel", "ayam", "nasi"], ["kursi", "buku", "meja"], ["kupu-kupu", "pohon", "burung"]],
  chinese: [["胡萝卜", "鸡肉", "米饭"], ["椅子", "书", "桌子"], ["蝴蝶", "树", "鸟"]],
};

// A test-only acknowledgement gives assertions a reliable round-trip barrier.
// It is registered here, never in the application's event contract.
io.on("connection", (socket) => {
  socket.on("test-sync", (acknowledge) => acknowledge());
});

function synchronize(socket) {
  return new Promise((resolve, reject) => {
    socket.timeout(2000).emit("test-sync", (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function connectClient() {
  const socket = createSocket(baseUrl, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
    timeout: 2000,
  });
  const client = { socket, events: [] };
  clients.add(client);
  socket.onAny((event, ...args) => client.events.push({ event, args }));
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    socket.connect();
  });
  await synchronize(socket);
  return client;
}

async function send(client, event, ...args) {
  client.socket.emit(event, ...args);
  await synchronize(client.socket);
  // Other screens must also have received broadcasts before we inspect them.
  await Promise.all(
    [...clients].filter(({ socket }) => socket.connected).map(({ socket }) => synchronize(socket))
  );
}

function takeEvents(client) {
  return client.events.splice(0);
}

function expectedEvent(event, ...args) {
  return { event, args };
}

function publicActivity(language, activityIndex) {
  const { id, instruction, options } = activities[language][activityIndex];
  return { id, instruction, options, language, activityIndex };
}

function assertResetState() {
  assert.equal(gameState.language, null);
  assert.equal(gameState.currentActivityIndex, 0);
  assert.equal(gameState.isPlaying, false);
  assert.equal(gameState.currentActivityCompleted, false);
}

before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => resetGame());

afterEach(() => {
  for (const { socket } of clients) socket.disconnect();
  clients.clear();
  io.disconnectSockets(true);
});

after(async () => {
  await new Promise((resolve) => io.close(resolve));
});

test("exactly three equivalent mixed-language missions use the supplied object IDs and heritage labels", () => {
  assert.deepEqual(Object.keys(activities).sort(), ["chinese", "indonesian"]);
  assert.equal(activities.indonesian.length, 3);
  assert.equal(activities.chinese.length, activities.indonesian.length);

  for (const language of ["indonesian", "chinese"]) {
    assert.deepEqual(activities[language].map(({ instruction }) => instruction), [
      `I'm hungry! Find ${translatedLabels[language][0][0]}.`,
      `I want to sit! Find ${translatedLabels[language][1][0]}.`,
      `Look around! Find ${translatedLabels[language][2][0]}.`,
    ]);
    assert.deepEqual(activities[language].map(({ correctItemId }) => correctItemId), ["carrot", "chair", "butterfly"]);
    assert.deepEqual(activities[language].map(({ successReaction }) => successReaction), missionReactions);
    const seenIds = new Set();
    for (const [index, activity] of activities[language].entries()) {
      assert.ok(activity.id && !seenIds.has(activity.id));
      seenIds.add(activity.id);
      assert.equal(activity.options.length, 3);
      assert.equal(new Set(activity.options.map(({ itemId }) => itemId)).size, 3);
      assert.deepEqual(activity.options.map(({ itemId }) => itemId), missionItems[index]);
      assert.deepEqual(activity.options.map(({ label }) => label), translatedLabels[language][index]);
      assert.match(activity.instruction, /[A-Za-z]/);
      if (language === "chinese") assert.match(activity.instruction, /\p{Script=Han}/u);

      for (const option of activity.options) {
        assert.deepEqual(Object.keys(option).sort(), ["itemId", "label"]);
        assert.match(option.itemId, /^[a-z][a-z0-9-]*$/);
        assert.ok(typeof option.label === "string" && option.label.trim());
        if (language === "chinese") assert.match(option.label, /\p{Script=Han}/u);
      }

      const correctOption = activity.options.find(({ itemId }) => itemId === activity.correctItemId);
      assert.ok(correctOption, "the correct answer must be one of the three options");
      assert.deepEqual(Object.keys(activity.vocabulary).sort(), ["itemId", "language", "meaning", "word"]);
      assert.equal(activity.vocabulary.itemId, activity.correctItemId);
      assert.equal(activity.vocabulary.word, correctOption.label);
      assert.equal(activity.vocabulary.language, language);
      assert.equal(activity.vocabulary.meaning, missionItems[index][0]);
      assert.equal(activity.successReaction, missionReactions[index]);

      const equivalent = activities.indonesian[index];
      assert.equal(activity.id, equivalent.id);
      assert.equal(activity.instruction.split("Find ")[0], equivalent.instruction.split("Find ")[0]);
      assert.equal(activity.correctItemId, equivalent.correctItemId);
      assert.equal(activity.vocabulary.meaning, equivalent.vocabulary.meaning);
      assert.deepEqual(activity.options.map(({ itemId }) => itemId), equivalent.options.map(({ itemId }) => itemId));
    }
  }
});

for (const language of ["indonesian", "chinese"]) {
  test(`${language}: wrong answer, retry, single reward, controlled progression, completion`, async () => {
    const robot = await connectClient();
    const mobile = await connectClient();
    assert.deepEqual(takeEvents(robot), [expectedEvent("game-reset")]);
    assert.deepEqual(takeEvents(mobile), [expectedEvent("game-reset")]);

    await send(mobile, "start-game", { language });
    for (const client of [robot, mobile]) {
      assert.deepEqual(takeEvents(client), [expectedEvent("current-activity", publicActivity(language, 0))]);
    }
    assert.equal(gameState.language, language);
    assert.equal(gameState.isPlaying, true);

    for (const [index, activity] of activities[language].entries()) {
      assert.equal(gameState.currentActivityIndex, index);
      assert.equal(gameState.currentActivityCompleted, false);

      await send(mobile, "next-activity");
      const wrongItem = activity.options.find(({ itemId }) => itemId !== activity.correctItemId);
      await send(mobile, "submit-item", { itemId: wrongItem.itemId });
      for (const client of [robot, mobile]) {
        assert.deepEqual(takeEvents(client), [expectedEvent("answer-result", { correct: false, reaction: "confused" })]);
      }
      assert.equal(gameState.currentActivityIndex, index);
      assert.equal(gameState.currentActivityCompleted, false);

      await send(mobile, "submit-item", { itemId: activity.correctItemId });
      for (const client of [robot, mobile]) {
        assert.deepEqual(takeEvents(client), [
          expectedEvent("answer-result", { correct: true, reaction: missionReactions[index] }),
          expectedEvent("word-learned", activity.vocabulary),
        ]);
      }
      assert.equal(gameState.currentActivityIndex, index, "a correct answer must wait for Next Mission");
      assert.equal(gameState.currentActivityCompleted, true);

      const completedState = structuredClone(gameState);
      await send(mobile, "submit-item", { itemId: activity.correctItemId });
      await send(robot, "submit-item", { itemId: wrongItem.itemId });
      assert.deepEqual(gameState, completedState, "completed missions must ignore further submissions");
      for (const client of [robot, mobile]) assert.deepEqual(takeEvents(client), []);

      await send(mobile, "next-activity");
      const expected = index + 1 < activities[language].length
        ? expectedEvent("current-activity", publicActivity(language, index + 1))
        : expectedEvent("adventure-complete", { language, completedActivities: activities[language].length });
      for (const client of [robot, mobile]) assert.deepEqual(takeEvents(client), [expected]);
    }

    assert.equal(gameState.isPlaying, false);
    const finishedState = structuredClone(gameState);
    await send(mobile, "next-activity");
    await send(mobile, "submit-item", { itemId: activities[language][0].correctItemId });
    assert.deepEqual(gameState, finishedState);
    for (const client of [robot, mobile]) assert.deepEqual(takeEvents(client), []);

    const returningRobot = await connectClient();
    assert.deepEqual(takeEvents(returningRobot), [expectedEvent("adventure-complete", {
      language,
      completedActivities: activities[language].length,
    })]);
  });
}

test("invalid language and item payloads are ignored without changing shared state", async () => {
  const client = await connectClient();
  takeEvents(client);
  const invalidLanguages = [undefined, null, "indonesian", [], {}, { language: "english" }, { language: "toString" }, { language: "__proto__" }, { language: 1 }];

  for (const payload of invalidLanguages) await send(client, "start-game", payload);
  await send(client, "submit-item", { itemId: "carrot" });
  await send(client, "next-activity");
  assertResetState();
  assert.deepEqual(takeEvents(client), []);

  await send(client, "start-game", { language: "indonesian" });
  takeEvents(client);
  const originalState = structuredClone(gameState);
  for (const payload of invalidLanguages) await send(client, "start-game", payload);
  for (const payload of [undefined, null, "carrot", [], {}, { itemId: "" }, { itemId: 123 }, { itemId: "not-an-option" }, { itemId: {} }]) {
    await send(client, "submit-item", payload);
  }
  assert.deepEqual(gameState, originalState);
  assert.deepEqual(takeEvents(client), []);
});

test("late connections and reconnections restore the shared mission without awarding a word twice", async () => {
  const mobile = await connectClient();
  takeEvents(mobile);
  await send(mobile, "start-game", { language: "chinese" });
  takeEvents(mobile);

  const robot = await connectClient();
  assert.deepEqual(takeEvents(robot), [expectedEvent("current-activity", publicActivity("chinese", 0))]);
  assert.deepEqual(takeEvents(mobile), [], "connecting a screen must not restart other screens");

  const activity = activities.chinese[0];
  await send(mobile, "submit-item", { itemId: activity.correctItemId });
  takeEvents(mobile);
  takeEvents(robot);
  robot.socket.disconnect();
  clients.delete(robot);

  const returningRobot = await connectClient();
  assert.deepEqual(takeEvents(returningRobot), [
    expectedEvent("current-activity", publicActivity("chinese", 0)),
    expectedEvent("answer-result", { correct: true, reaction: activity.successReaction }),
  ]);
  assert.deepEqual(takeEvents(mobile), []);

  await send(returningRobot, "next-activity");
  for (const client of [mobile, returningRobot]) {
    assert.deepEqual(takeEvents(client), [expectedEvent("current-activity", publicActivity("chinese", 1))]);
  }
  await send(mobile, "next-activity");
  assert.equal(gameState.currentActivityIndex, 1, "repeated Next Mission must not skip an incomplete mission");
  for (const client of [mobile, returningRobot]) assert.deepEqual(takeEvents(client), []);
});

test("exit resets every screen and a restart begins at the first mission", async () => {
  const robot = await connectClient();
  const mobile = await connectClient();
  takeEvents(robot);
  takeEvents(mobile);
  await send(mobile, "start-game", { language: "indonesian" });
  await send(mobile, "submit-item", { itemId: activities.indonesian[0].correctItemId });
  await send(mobile, "next-activity");
  takeEvents(robot);
  takeEvents(mobile);

  await send(mobile, "exit-game");
  assertResetState();
  for (const client of [robot, mobile]) assert.deepEqual(takeEvents(client), [expectedEvent("game-reset")]);

  const lateScreen = await connectClient();
  assert.deepEqual(takeEvents(lateScreen), [expectedEvent("game-reset")]);
  await send(mobile, "start-game", { language: "chinese" });
  for (const client of [robot, mobile, lateScreen]) {
    assert.deepEqual(takeEvents(client), [expectedEvent("current-activity", publicActivity("chinese", 0))]);
  }
  assert.equal(gameState.currentActivityIndex, 0);
  assert.equal(gameState.currentActivityCompleted, false);
  assert.equal(gameState.isPlaying, true);

  await send(mobile, "submit-item", { itemId: activities.chinese[0].correctItemId });
  for (const client of [robot, mobile, lateScreen]) {
    const learnedWords = takeEvents(client).filter(({ event }) => event === "word-learned");
    assert.deepEqual(learnedWords, [expectedEvent("word-learned", activities.chinese[0].vocabulary)]);
  }

  await send(mobile, "start-game", { language: "indonesian" });
  for (const client of [robot, mobile, lateScreen]) {
    assert.deepEqual(takeEvents(client), [expectedEvent("current-activity", publicActivity("indonesian", 0))]);
  }
  assert.equal(gameState.currentActivityCompleted, false);
});

test("the HTTP server serves robot assets and keeps answer data outside the public directory", async () => {
  for (const asset of ["/pet.html", "/js/robot.js", "/js/events.js", "/socket.io/socket.io.js"]) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, `${asset} should load`);
    const content = await response.text();
    // events.js is an existing shared placeholder; it only needs to be served.
    if (asset !== "/js/events.js") assert.ok(content.length > 0, `${asset} should contain code or markup`);
  }
  for (const privatePath of ["/data/activities.js", "/server.js"]) {
    const response = await fetch(`${baseUrl}${privatePath}`);
    assert.equal(response.status, 404, `${privatePath} must not expose server-only answers`);
    await response.text();
  }
});

test("all nine mission object PNGs supplied by Person 5 exist and load", async () => {
  for (const [index, itemIds] of missionItems.entries()) {
    for (const itemId of itemIds) {
      const asset = `/assets/${objectFolders[index]}/${itemId}.png`;
      const response = await fetch(`${baseUrl}${asset}`);
      assert.equal(response.status, 200, `${asset} should load`);
      assert.match(response.headers.get("content-type"), /^image\/png/);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${asset} must be a PNG`);
    }
  }
});


test("colouring notification crosses devices, survives reconnect, and never submits an answer", async () => {
  const mobile = await connectClient();
  const robot = await connectClient();
  await send(mobile, "colouring-started", {itemId:"carrot"});
  assert.equal(gameState.colouringItemId, null);
  for (const language of ["indonesian", "chinese"]) {
    await send(mobile, "start-game", {language});
    for (let index = 0; index < 3; index++) {
      takeEvents(robot);
      for (const payload of [null, {}, {itemId:"unknown"}]) {
        await send(mobile, "colouring-started", payload);
      }
      assert.deepEqual(takeEvents(robot), []);
      const [correct, wrong] = missionItems[index];
      await send(mobile, "colouring-started", {itemId:wrong, ignored:"extra"});
      assert.deepEqual(takeEvents(robot), [expectedEvent("colouring-started", {itemId:wrong})]);
      assert.equal(gameState.currentActivityCompleted, false);
      const reconnect = await connectClient();
      assert.deepEqual(takeEvents(reconnect), [
        expectedEvent("current-activity", publicActivity(language, index)),
        expectedEvent("colouring-started", {itemId:wrong}),
      ]);
      reconnect.socket.disconnect();
      await send(mobile, "submit-item", {itemId:wrong});
      assert.equal(gameState.colouringItemId, null);
      assert.deepEqual(takeEvents(robot), [expectedEvent("answer-result", {correct:false,reaction:"confused"})]);
      await send(mobile, "colouring-started", {itemId:correct});
      await send(mobile, "submit-item", {itemId:correct});
      assert.equal(gameState.colouringItemId, null);
      takeEvents(robot);
      await send(mobile, "colouring-started", {itemId:correct});
      assert.deepEqual(takeEvents(robot), []);
      await send(mobile, "next-activity");
      assert.equal(gameState.colouringItemId, null);
    }
  }
  await send(mobile, "start-game", {language:"indonesian"});
  await send(mobile, "colouring-started", {itemId:"carrot"});
  await send(mobile, "exit-game");
  assert.equal(gameState.colouringItemId, null);
});
