const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const robotScript = fs.readFileSync(
  path.join(__dirname, "../public/js/robot.js"),
  "utf8"
);

// Small browser substitutes keep these checks dependency-free. Real browser
// testing is still needed for installed voices and automatic-speech permissions.
function createRobot({ speechSupported = true } = {}) {
  const elements = {};
  for (const id of [
    "robot-pet",
    "robot-instruction",
    "robot-response",
    "robot-pronunciation",
    "robot-speech-status",
  ]) {
    const listeners = {};
    elements[id] = {
      textContent: "",
      hidden: false,
      disabled: false,
      dataset: {},
      addEventListener(event, listener) { listeners[event] = listener; },
      dispatch(event) { listeners[event](); },
      removeAttribute(attribute) { delete this[attribute]; },
    };
  }

  const socketListeners = {};
  const speechCalls = [];
  const window = {};
  if (speechSupported) {
    window.speechSynthesis = {
      cancel() { speechCalls.push({ type: "cancel" }); },
      speak(utterance) { speechCalls.push({ type: "speak", utterance }); },
    };
    window.SpeechSynthesisUtterance = function (word) { this.text = word; };
  }

  const context = vm.createContext({
    window,
    document: { getElementById: (id) => elements[id] },
    io: () => ({ on: (event, listener) => { socketListeners[event] = listener; } }),
  });
  vm.runInContext(robotScript, context, { filename: "robot.js" });

  return {
    elements,
    speechCalls,
    window,
    context,
    receive(event, payload) { socketListeners[event](payload); },
    lastSpeech() { return speechCalls.filter((call) => call.type === "speak").at(-1)?.utterance; },
  };
}

function mission(language = "indonesian") {
  return {
    id: "hungry-apple",
    instruction: "I'm hungry! Find an apple.",
    options: [
      { itemId: "apple", label: language === "indonesian" ? "apel" : "苹果" },
      { itemId: "ball", label: language === "indonesian" ? "bola" : "球" },
      { itemId: "book", label: language === "indonesian" ? "buku" : "书" },
    ],
    language,
    activityIndex: 0,
  };
}

function vocabulary(language = "indonesian") {
  return {
    itemId: "apple",
    word: language === "indonesian" ? "apel" : "苹果",
    meaning: "apple",
    language,
  };
}

for (const language of ["indonesian", "chinese"]) {
  test(`${language} missions keep the instruction in English and the robot idle`, () => {
    const robot = createRobot();
    robot.receive("current-activity", mission(language));

    assert.equal(robot.elements["robot-instruction"].textContent, "I'm hungry! Find an apple.");
    assert.equal(robot.elements["robot-pet"].dataset.reaction, "idle");
    assert.equal(robot.elements["robot-response"].hidden, true);
    assert.equal(robot.lastSpeech(), undefined, "mission text is not pronounced as heritage vocabulary");
  });

  test(`${language} learned vocabulary uses the matching speech locale`, () => {
    const robot = createRobot();
    const word = vocabulary(language);
    robot.receive("current-activity", mission(language));
    robot.receive("word-learned", word);

    assert.equal(robot.lastSpeech().text, word.word);
    assert.equal(robot.lastSpeech().lang, language === "indonesian" ? "id-ID" : "zh-CN");
    assert.equal(robot.elements["robot-pronunciation"].hidden, false);
    assert.equal(robot.elements["robot-pronunciation"].textContent, `Hear ${word.word}`);
    assert.equal(robot.elements["robot-instruction"].textContent, mission(language).instruction);
  });
}

test("wrong and correct answers show short English feedback and the server's reaction", () => {
  const robot = createRobot();
  robot.receive("current-activity", mission());
  robot.receive("answer-result", { correct: false, reaction: "confused" });
  assert.equal(robot.elements["robot-response"].textContent, "Try again!");
  assert.equal(robot.elements["robot-response"].hidden, false);
  assert.equal(robot.elements["robot-pet"].dataset.reaction, "confused");

  for (const reaction of ["eating", "playing", "happy"]) {
    robot.receive("answer-result", { correct: true, reaction });
    assert.equal(robot.elements["robot-response"].textContent, "Great job!");
    assert.equal(robot.elements["robot-pet"].dataset.reaction, reaction);
  }
  assert.equal(robot.elements["robot-instruction"].textContent, mission().instruction);
});

test("automatic pronunciation and the replay button cancel any previous speech", () => {
  const robot = createRobot();
  robot.speechCalls.length = 0;
  robot.receive("word-learned", vocabulary());
  robot.elements["robot-pronunciation"].dispatch("click");
  robot.receive("word-learned", vocabulary("chinese"));

  assert.deepEqual(robot.speechCalls.map((call) => call.type), [
    "cancel", "speak", "cancel", "speak", "cancel", "speak",
  ]);
  const utterances = robot.speechCalls.filter((call) => call.type === "speak");
  assert.deepEqual(utterances.map((call) => call.utterance.text), ["apel", "apel", "苹果"]);
});

for (const [event, payload, expectedInstruction] of [
  ["current-activity", mission("chinese"), mission().instruction],
  ["game-reset", undefined, "Waiting for the activity to begin..."],
  ["disconnect", undefined, "Connecting to the adventure..."],
  ["connect_error", undefined, "Connecting to the adventure..."],
]) {
  test(`${event} clears old feedback, replay and speech`, () => {
    const robot = createRobot();
    robot.receive("current-activity", mission());
    robot.receive("answer-result", { correct: true, reaction: "eating" });
    robot.receive("word-learned", vocabulary());
    const oldUtterance = robot.lastSpeech();

    robot.receive(event, payload);
    assert.equal(robot.speechCalls.at(-1).type, "cancel");
    assert.equal(robot.elements["robot-instruction"].textContent, expectedInstruction);
    assert.equal(robot.elements["robot-response"].hidden, true);
    assert.equal(robot.elements["robot-response"].textContent, "");
    assert.equal(robot.elements["robot-pet"].dataset.reaction, "idle");
    assert.equal(robot.elements["robot-pronunciation"].hidden, true);

    oldUtterance.onerror({ error: "interrupted" });
    assert.equal(robot.elements["robot-speech-status"].hidden, true, "cancelled speech cannot display a stale error");
    const callsBeforeClick = robot.speechCalls.length;
    robot.elements["robot-pronunciation"].dispatch("click");
    assert.equal(robot.speechCalls.length, callsBeforeClick, "the previous word is no longer replayable");
  });
}

test("reconnected completed mission restores feedback without replaying learned vocabulary", () => {
  const robot = createRobot();
  robot.receive("current-activity", mission());
  robot.receive("answer-result", { correct: true, reaction: "eating" });

  assert.equal(robot.elements["robot-response"].textContent, "Great job!");
  assert.equal(robot.elements["robot-pet"].dataset.reaction, "eating");
  assert.equal(robot.elements["robot-pronunciation"].hidden, true);
  assert.equal(robot.lastSpeech(), undefined);
});

test("adventure completion shows happy English feedback and cancels pronunciation", () => {
  const robot = createRobot();
  robot.receive("word-learned", vocabulary());
  robot.receive("adventure-complete", { language: "indonesian", completedActivities: 3 });

  assert.equal(robot.elements["robot-instruction"].textContent, "Adventure complete!");
  assert.equal(robot.elements["robot-response"].textContent, "Great work!");
  assert.equal(robot.elements["robot-pet"].dataset.reaction, "happy");
  assert.equal(robot.elements["robot-pronunciation"].hidden, true);
  assert.equal(robot.speechCalls.at(-1).type, "cancel");
});

test("absent and failed animation assets leave useful on-screen text", () => {
  const robot = createRobot();
  assert.equal(robot.elements["robot-pet"].hidden, true);
  assert.equal(robot.elements["robot-pet"].src, undefined);
  assert.match(robot.elements["robot-instruction"].textContent, /Waiting/);

  // Simulate the future Person 5 configuration, then a browser image-load error.
  vm.runInContext('ROBOT_ASSETS.happy = "/assets/pet/missing-happy.gif";', robot.context);
  robot.receive("answer-result", { correct: true, reaction: "happy" });
  robot.elements["robot-pet"].dispatch("error");
  assert.equal(robot.elements["robot-pet"].hidden, true);
  assert.equal(robot.elements["robot-response"].textContent, "Great job!");

  robot.receive("answer-result", { correct: true, reaction: "unknown" });
  assert.equal(robot.elements["robot-pet"].dataset.reaction, "idle");
  assert.equal(robot.elements["robot-pet"].src, undefined);
});

test("unsupported speech does not interrupt the game", () => {
  const robot = createRobot({ speechSupported: false });
  robot.receive("current-activity", mission());
  robot.receive("answer-result", { correct: true, reaction: "eating" });
  assert.doesNotThrow(() => robot.receive("word-learned", vocabulary()));

  assert.equal(robot.elements["robot-response"].textContent, "Great job!");
  assert.equal(robot.elements["robot-pronunciation"].disabled, true);
  assert.equal(robot.elements["robot-speech-status"].hidden, false);
  assert.match(robot.elements["robot-speech-status"].textContent, /not available/);
  assert.doesNotThrow(() => robot.receive("game-reset"));
});

test("blocked speech offers a replay and clears the error when replay begins", () => {
  const robot = createRobot();
  robot.receive("word-learned", vocabulary());
  robot.lastSpeech().onerror({ error: "not-allowed" });
  assert.equal(robot.elements["robot-speech-status"].hidden, false);
  assert.match(robot.elements["robot-speech-status"].textContent, /Hear button/);

  robot.elements["robot-pronunciation"].dispatch("click");
  assert.equal(robot.elements["robot-speech-status"].hidden, true);
  assert.equal(robot.lastSpeech().text, "apel");
});

test("speech API exceptions are contained and reset still works", () => {
  const robot = createRobot();
  robot.window.speechSynthesis.speak = () => { throw new Error("Speech unavailable"); };
  assert.doesNotThrow(() => robot.receive("word-learned", vocabulary()));
  assert.equal(robot.elements["robot-speech-status"].hidden, false);

  robot.window.speechSynthesis.cancel = () => { throw new Error("Cancellation unavailable"); };
  assert.doesNotThrow(() => robot.receive("game-reset"));
  assert.equal(robot.elements["robot-speech-status"].hidden, true);
  assert.equal(robot.elements["robot-pronunciation"].hidden, true);
  assert.match(robot.elements["robot-instruction"].textContent, /Waiting/);
});
