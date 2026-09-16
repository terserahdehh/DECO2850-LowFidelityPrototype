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
function createRobot({ speechSupported = true, audio = null, webkitAudio = false } = {}) {
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
  const documentListeners = {};
  const speechCalls = [];
  const window = {};
  if (audio) window[webkitAudio ? "webkitAudioContext" : "AudioContext"] = audio.AudioContext;
  if (speechSupported) {
    window.speechSynthesis = {
      cancel() { speechCalls.push({ type: "cancel" }); },
      speak(utterance) { speechCalls.push({ type: "speak", utterance }); },
    };
    window.SpeechSynthesisUtterance = function (word) { this.text = word; };
  }

  const context = vm.createContext({
    window,
    document: {
      getElementById: (id) => elements[id],
      addEventListener(event, listener) { documentListeners[event] = listener; },
    },
    io: () => ({ on: (event, listener) => { socketListeners[event] = listener; } }),
  });
  vm.runInContext(robotScript, context, { filename: "robot.js" });

  return {
    elements,
    speechCalls,
    window,
    context,
    receive(event, payload) { return socketListeners[event](payload); },
    tap() { return documentListeners.pointerdown(); },
    lastSpeech() { return speechCalls.filter((call) => call.type === "speak").at(-1)?.utterance; },
  };
}

const missionExamples = [
  {
    id: "hungry-carrot",
    instruction: "I'm hungry! Find the carrot.",
    itemIds: ["carrot", "chicken", "rice"],
    indonesian: ["wortel", "ayam", "nasi"],
    chinese: ["胡萝卜", "鸡肉", "米饭"],
  },
  {
    id: "sit-chair",
    instruction: "I want to sit! Find the chair.",
    itemIds: ["chair", "book", "table"],
    indonesian: ["kursi", "buku", "meja"],
    chinese: ["椅子", "书", "桌子"],
  },
  {
    id: "look-butterfly",
    instruction: "Look around! Find the butterfly.",
    itemIds: ["butterfly", "tree", "bird"],
    indonesian: ["kupu-kupu", "pohon", "burung"],
    chinese: ["蝴蝶", "树", "鸟"],
  },
];

const expectedAssets = {
  idle: "/assets/char_movements/default.png",
  happy: "/assets/char_emotions/happy.png",
  confused: "/assets/char_emotions/sad.png",
  eating: "/assets/char_emotions/happyeat.png",
  sitting: "/assets/char_emotions/happysit.png",
  looking: "/assets/char_emotions/happylook.png",
  playing: "/assets/char_emotions/happy.png",
};

function mission(language = "indonesian", activityIndex = 0) {
  const example = missionExamples[activityIndex];
  return {
    id: example.id,
    instruction: example.instruction,
    options: example.itemIds.map((itemId, index) => ({ itemId, label: example[language][index] })),
    language,
    activityIndex,
  };
}

function vocabulary(language = "indonesian", activityIndex = 0) {
  const example = missionExamples[activityIndex];
  return {
    itemId: example.itemIds[0],
    word: example[language][0],
    meaning: example.itemIds[0],
    language,
  };
}

// Record scheduled notes without playing sound or depending on browser packages.
function createAudio({ state = "running", failure = "", resume = null } = {}) {
  const audio = { contexts: [], oscillators: [], gains: [], failure, resumeCalls: 0 };
  function fail(operation) {
    if (audio.failure === operation) throw new Error(`${operation} unavailable`);
  }
  function parameter() {
    return {
      value: 0,
      changes: [],
      setValueAtTime(value, time) { this.changes.push({ value, time }); },
      linearRampToValueAtTime(value, time) { this.changes.push({ value, time }); },
    };
  }
  function node() {
    return {
      connections: [],
      disconnected: false,
      connect(destination) { fail("connect"); this.connections.push(destination); },
      disconnect() { this.disconnected = true; fail("disconnect"); },
    };
  }
  audio.AudioContext = class {
    constructor() {
      fail("constructor");
      this.state = state;
      this.currentTime = 1;
      this.destination = {};
      audio.contexts.push(this);
    }
    async resume() {
      audio.resumeCalls += 1;
      fail("resume");
      if (resume) await resume(this);
      else this.state = "running";
    }
    createOscillator() {
      fail("createOscillator");
      const oscillator = Object.assign(node(), {
        frequency: parameter(),
        starts: [],
        stops: [],
        start(time) { fail("start"); this.starts.push(time); },
        stop(time) { this.stops.push(time); fail("stop"); },
      });
      audio.oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      fail("createGain");
      const gain = Object.assign(node(), { gain: parameter() });
      audio.gains.push(gain);
      return gain;
    }
  };
  return audio;
}

function flushAudio() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

for (const language of ["indonesian", "chinese"]) {
  test(`${language} missions keep the instruction in English and the robot idle`, () => {
    const robot = createRobot();
    for (const index of [0, 1, 2]) {
      robot.receive("current-activity", mission(language, index));
      assert.equal(robot.elements["robot-instruction"].textContent, missionExamples[index].instruction);
      assert.equal(robot.elements["robot-pet"].dataset.reaction, "idle");
      assert.equal(robot.elements["robot-pet"].src, expectedAssets.idle);
      assert.equal(robot.elements["robot-pet"].hidden, false);
      assert.equal(robot.elements["robot-response"].hidden, true);
      assert.equal(robot.lastSpeech(), undefined, "mission text is not pronounced as heritage vocabulary");
    }
  });

  test(`${language} learned vocabulary uses the matching speech locale`, () => {
    const robot = createRobot();
    for (const index of [0, 1, 2]) {
      const word = vocabulary(language, index);
      robot.receive("current-activity", mission(language, index));
      robot.receive("word-learned", word);

      assert.equal(robot.lastSpeech().text, word.word);
      assert.equal(robot.lastSpeech().lang, language === "indonesian" ? "id-ID" : "zh-CN");
      assert.equal(robot.elements["robot-pronunciation"].hidden, false);
      assert.equal(robot.elements["robot-pronunciation"].textContent, `Hear ${word.word}`);
      assert.equal(robot.elements["robot-instruction"].textContent, mission(language, index).instruction);
    }
  });
}

test("wrong and correct answers show short English feedback and the server's reaction", () => {
  const robot = createRobot();
  robot.receive("current-activity", mission());
  robot.receive("answer-result", { correct: false, reaction: "confused" });
  assert.equal(robot.elements["robot-response"].textContent, "Try again!");
  assert.equal(robot.elements["robot-response"].hidden, false);
  assert.equal(robot.elements["robot-pet"].dataset.reaction, "confused");
  assert.equal(robot.elements["robot-pet"].src, expectedAssets.confused);

  for (const reaction of ["eating", "sitting", "looking", "happy", "playing"]) {
    robot.receive("answer-result", { correct: true, reaction });
    assert.equal(robot.elements["robot-response"].textContent, "Great job!");
    assert.equal(robot.elements["robot-pet"].dataset.reaction, reaction);
    assert.equal(robot.elements["robot-pet"].src, expectedAssets[reaction]);
    assert.equal(robot.elements["robot-pet"].hidden, false);
    assert.ok(fs.existsSync(path.join(__dirname, "../public", expectedAssets[reaction])));
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
  assert.deepEqual(utterances.map((call) => call.utterance.text), ["wortel", "wortel", "胡萝卜"]);
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
  assert.equal(robot.elements["robot-pet"].src, expectedAssets.happy);
  assert.equal(robot.elements["robot-pronunciation"].hidden, true);
  assert.equal(robot.speechCalls.at(-1).type, "cancel");
});

test("the supplied default character is visible while waiting", () => {
  const robot = createRobot();
  assert.equal(robot.elements["robot-pet"].hidden, false);
  assert.equal(robot.elements["robot-pet"].src, expectedAssets.idle);
  assert.match(robot.elements["robot-instruction"].textContent, /Waiting/);
  for (const asset of Object.values(expectedAssets)) {
    assert.ok(fs.existsSync(path.join(__dirname, "../public", asset)), `${asset} must exist`);
  }
});

test("absent and failed reaction images leave useful text and recover on the next state", () => {
  const robot = createRobot();
  vm.runInContext('ROBOT_ASSETS.happy = "/assets/char_emotions/missing-happy.png";', robot.context);
  robot.receive("answer-result", { correct: true, reaction: "happy" });
  robot.elements["robot-pet"].dispatch("error");
  assert.equal(robot.elements["robot-pet"].hidden, true);
  assert.equal(robot.elements["robot-response"].textContent, "Great job!");

  robot.receive("answer-result", { correct: true, reaction: "unknown" });
  assert.equal(robot.elements["robot-pet"].dataset.reaction, "idle");
  assert.equal(robot.elements["robot-pet"].src, expectedAssets.idle);
  assert.equal(robot.elements["robot-pet"].hidden, false);

  vm.runInContext('ROBOT_ASSETS.eating = null;', robot.context);
  robot.receive("answer-result", { correct: true, reaction: "eating" });
  assert.equal(robot.elements["robot-pet"].hidden, true);
  assert.equal(robot.elements["robot-pet"].src, undefined);
  assert.equal(robot.elements["robot-response"].textContent, "Great job!");
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
  assert.equal(robot.lastSpeech().text, "wortel");
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

for (const [name, event, payload, noteCount, ascending] of [
  ["correct", "answer-result", { correct: true, reaction: "eating" }, 2, true],
  ["incorrect", "answer-result", { correct: false, reaction: "confused" }, 2, false],
  ["completion", "adventure-complete", { language: "indonesian", completedActivities: 3 }, 3, true],
]) {
  test(`${name} feedback schedules a short, quiet chime and disconnects finished notes`, async () => {
    const audio = createAudio();
    const robot = createRobot({ audio });
    robot.receive("current-activity", mission());
    assert.equal(audio.contexts.length, 0, "waiting and new missions do not create background audio");
    robot.receive(event, payload);
    await flushAudio();

    assert.equal(audio.contexts.length, 1);
    assert.equal(audio.oscillators.length, noteCount);
    assert.equal(audio.gains.length, noteCount);
    for (const [index, oscillator] of audio.oscillators.entries()) {
      const gain = audio.gains[index];
      assert.equal(oscillator.type, "sine");
      assert.equal(oscillator.starts.length, 1);
      assert.equal(oscillator.stops.length, 1);
      assert.ok(oscillator.stops[0] > oscillator.starts[0]);
      assert.ok(oscillator.stops[0] - oscillator.starts[0] < 0.5);
      assert.deepEqual(oscillator.connections, [gain]);
      assert.deepEqual(gain.connections, [audio.contexts[0].destination]);
      assert.equal(gain.gain.changes[0].value, 0, "the envelope starts softly");
      assert.equal(gain.gain.changes.at(-1).value, 0, "the note fades to silence");
      assert.ok(gain.gain.changes.some(({ value }) => value > 0));
      assert.ok(gain.gain.changes.every(({ value }) => value >= 0 && value <= 0.05));
      if (index > 0) {
        const previous = audio.oscillators[index - 1];
        assert.equal(oscillator.frequency.value > previous.frequency.value, ascending);
        assert.ok(oscillator.starts[0] >= previous.stops[0], "notes form a short sequence");
      }
      oscillator.onended();
      assert.equal(oscillator.disconnected, true);
      assert.equal(gain.disconnected, true);
      assert.equal(oscillator.onended, null);
    }
    assert.ok(audio.oscillators.at(-1).stops[0] - audio.contexts[0].currentTime < 1);
  });
}

test("sound is optional: unsupported Web Audio preserves visual feedback and TTS", async () => {
  const robot = createRobot();
  robot.receive("answer-result", { correct: true, reaction: "eating" });
  robot.receive("word-learned", vocabulary());
  await flushAudio();
  assert.equal(robot.elements["robot-response"].textContent, "Great job!");
  assert.equal(robot.elements["robot-pet"].src, expectedAssets.eating);
  assert.equal(robot.lastSpeech().text, "wortel");
  assert.equal(robot.lastSpeech().lang, "id-ID");
  assert.equal(await vm.runInContext('playFeedbackSound("correct")', robot.context), false);
  assert.doesNotThrow(() => robot.tap());
});

test("feedback and pronunciation remain independent, including the Hear replay", async () => {
  const audio = createAudio();
  const robot = createRobot({ audio });
  robot.receive("answer-result", { correct: true, reaction: "sitting" });
  const soundNotes = [...audio.oscillators];
  robot.receive("word-learned", vocabulary("chinese", 1));
  assert.equal(robot.lastSpeech().text, "椅子");
  assert.equal(robot.lastSpeech().lang, "zh-CN");
  assert.ok(soundNotes.every((note) => !note.disconnected), "vocabulary must not stop the feedback cue");

  robot.elements["robot-pronunciation"].dispatch("click");
  assert.equal(audio.oscillators.length, 2, "Hear replays only the word, not the chime");
  const speechCalls = robot.speechCalls.length;
  robot.receive("answer-result", { correct: false, reaction: "confused" });
  await flushAudio();
  assert.equal(robot.speechCalls.length, speechCalls, "feedback must not cancel or replace speech");
  assert.ok(soundNotes.every((note) => note.disconnected), "the next cue cleans up the previous sound");
  assert.equal(audio.contexts.length, 1, "one AudioContext is reused");
});

for (const [event, payload] of [
  ["current-activity", mission("indonesian", 1)],
  ["game-reset", undefined],
  ["disconnect", undefined],
  ["connect_error", undefined],
]) {
  test(`${event} stops and disconnects active feedback notes`, async () => {
    const audio = createAudio();
    const robot = createRobot({ audio });
    robot.receive("answer-result", { correct: true, reaction: "eating" });
    assert.equal(audio.oscillators.length, 2);
    robot.receive(event, payload);
    await flushAudio();
    assert.ok(audio.oscillators.every((node) => node.disconnected && node.stops.length === 2));
    assert.ok(audio.gains.every((node) => node.disconnected));
    assert.equal(audio.oscillators.length, 2, "resetting a screen must not start another tone");
  });
}

test("suspended audio resumes before notes play, with the Safari constructor fallback", async () => {
  const audio = createAudio({ state: "suspended" });
  const robot = createRobot({ audio, webkitAudio: true });
  robot.receive("answer-result", { correct: true, reaction: "eating" });
  assert.equal(audio.oscillators.length, 0);
  await flushAudio();
  assert.equal(audio.resumeCalls, 1);
  assert.equal(audio.oscillators.length, 2);
});

test("a page tap unlocks audio without creating a sound or interrupting pronunciation", async () => {
  const audio = createAudio({ state: "suspended" });
  const robot = createRobot({ audio });
  robot.receive("word-learned", vocabulary());
  const speechCalls = robot.speechCalls.length;
  robot.tap();
  await flushAudio();
  assert.equal(audio.resumeCalls, 1);
  assert.equal(audio.contexts[0].state, "running");
  assert.equal(audio.oscillators.length, 0);
  assert.equal(robot.speechCalls.length, speechCalls);
});

test("audio that remains blocked never queues notes or delays heritage pronunciation", async () => {
  const audio = createAudio({ state: "suspended", resume() {} });
  const robot = createRobot({ audio });
  robot.receive("answer-result", { correct: true, reaction: "eating" });
  robot.receive("word-learned", vocabulary());
  assert.equal(robot.lastSpeech().text, "wortel");
  await flushAudio();
  assert.equal(audio.oscillators.length, 0);
  assert.equal(await vm.runInContext('playFeedbackSound("correct")', robot.context), false);
  assert.equal(robot.elements["robot-response"].textContent, "Great job!");
});

for (const failure of ["constructor", "resume", "createOscillator", "createGain", "connect", "start", "stop"]) {
  test(`${failure} failures are contained and partially created audio nodes are cleaned up`, async () => {
    const audio = createAudio({ state: failure === "resume" ? "suspended" : "running", failure });
    const robot = createRobot({ audio });
    robot.receive("answer-result", { correct: true, reaction: "eating" });
    robot.receive("word-learned", vocabulary());
    await flushAudio();
    assert.equal(robot.elements["robot-response"].textContent, "Great job!");
    assert.equal(robot.lastSpeech().text, "wortel");
    assert.equal(await vm.runInContext('playFeedbackSound("correct")', robot.context), false);
    assert.ok([...audio.oscillators, ...audio.gains].every((node) => node.disconnected));
    assert.doesNotThrow(() => robot.tap());
    assert.doesNotThrow(() => robot.receive("game-reset"));
    await flushAudio();
  });
}

test("reset invalidates a pending audio resume so no stale feedback plays afterward", async () => {
  const pending = deferred();
  const audio = createAudio({
    state: "suspended",
    async resume(context) { await pending.promise; context.state = "running"; },
  });
  const robot = createRobot({ audio });
  const playback = vm.runInContext('playFeedbackSound("correct")', robot.context);
  robot.receive("game-reset");
  pending.resolve();
  assert.equal(await playback, false);
  assert.equal(audio.oscillators.length, 0);
  assert.match(robot.elements["robot-instruction"].textContent, /Waiting/);
});

test("only the latest feedback cue plays when multiple requests await audio permission", async () => {
  const pending = deferred();
  const audio = createAudio({
    state: "suspended",
    async resume(context) { await pending.promise; context.state = "running"; },
  });
  const robot = createRobot({ audio });
  const stale = vm.runInContext('playFeedbackSound("incorrect")', robot.context);
  const latest = vm.runInContext('playFeedbackSound("complete")', robot.context);
  pending.resolve();
  assert.equal(await stale, false);
  assert.equal(await latest, true);
  assert.equal(audio.oscillators.length, 3);
  assert.ok(audio.oscillators[2].frequency.value > audio.oscillators[0].frequency.value);
});
