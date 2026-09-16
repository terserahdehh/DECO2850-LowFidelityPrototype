const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const robotScript = fs.readFileSync(path.join(__dirname, "../public/js/robot.js"), "utf8");

// A deterministic clock tests minutes of looping without waiting or using audio.
function createClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, {callback, at: now + delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      const end = now + milliseconds;
      let runs = 0;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        assert.ok(++runs < 100, "speech must not enter a rapid timer loop");
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
  };
}

function createRobot({speechSupported = true, audio = null, webkitAudio = false, speechFailure = ""} = {}) {
  const clock = createClock();
  const elements = {};
  for (const id of ["robot-pet", "robot-instruction", "robot-response", "robot-speech-status"]) {
    const listeners = {};
    elements[id] = {
      textContent: "", hidden: false, dataset: {},
      addEventListener(event, listener) { listeners[event] = listener; },
      dispatch(event) { listeners[event]?.(); },
      removeAttribute(attribute) { delete this[attribute]; },
    };
  }
  const socketListeners = {};
  const documentListeners = {};
  const utterances = [];
  const speechCalls = [];
  const voices = [{lang:"en-US"}, {lang:"id-ID"}, {lang:"zh-CN"}];
  let speaking = null;
  let overlaps = 0;
  const window = {};
  if (audio) window[webkitAudio ? "webkitAudioContext" : "AudioContext"] = audio.AudioContext;
  if (speechSupported) {
    window.speechSynthesis = {
      cancel() { speaking = null; speechCalls.push("cancel"); if (speechFailure === "cancel") throw Error("cancel failed"); },
      getVoices() { if (speechFailure === "getVoices") throw Error("voices unavailable"); return voices; },
      speak(utterance) {
        if (speechFailure === "speak") throw Error("speech blocked");
        if (speaking) overlaps += 1;
        speaking = utterance; utterances.push(utterance); speechCalls.push("speak");
      },
    };
    window.SpeechSynthesisUtterance = function(text) {
      if (speechFailure === "constructor") throw Error("utterance unavailable");
      this.text = text;
    };
  }
  const context = vm.createContext({
    window, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    document: {getElementById: id => elements[id], addEventListener(event, listener) { documentListeners[event] = listener; }},
    io: () => ({on(event, listener) { socketListeners[event] = listener; }}),
  });
  vm.runInContext(robotScript, context, {filename:"robot.js"});
  return {
    clock, elements, utterances, speechCalls, voices, window, context,
    receive(event, payload) { socketListeners[event]?.(payload); },
    tap() { documentListeners.pointerdown(); },
    lastSpeech() { return utterances.at(-1); },
    end() { const utterance = speaking; assert.ok(utterance, "there should be an active utterance"); speaking = null; utterance.onend(); },
    error() { const utterance = speaking; speaking = null; utterance.onerror({error:"not-allowed"}); },
    get overlaps() { return overlaps; },
  };
}

const examples = [
  {id:"hungry-carrot", prefix:"I'm hungry! Find", items:["carrot","chicken","rice"], indonesian:["wortel","ayam","nasi"], chinese:["胡萝卜","鸡肉","米饭"], reaction:"eating", success:"Yay! Thank you for feeding me"},
  {id:"sit-chair", prefix:"I want to sit! Find", items:["chair","book","table"], indonesian:["kursi","buku","meja"], chinese:["椅子","书","桌子"], reaction:"sitting", success:"Yay! Now I can sit on"},
  {id:"look-butterfly", prefix:"Look around! Find", items:["butterfly","tree","bird"], indonesian:["kupu-kupu","pohon","burung"], chinese:["蝴蝶","树","鸟"], reaction:"looking", success:"Yay! You found"},
];
const expectedAssets = {
  idle:"/assets/char_movements/default.png", happy:"/assets/char_emotions/happy.png",
  confused:"/assets/char_emotions/sad.png", eating:"/assets/char_emotions/happyeat.png",
  sitting:"/assets/char_emotions/happysit.png", looking:"/assets/char_emotions/happylook.png",
  playing:"/assets/char_emotions/happy.png",
};
function mission(language = "indonesian", index = 0) {
  const e = examples[index];
  return {id:e.id, instruction:`${e.prefix} ${e[language][0]}.`, language, activityIndex:index, options:e.items.map((itemId, i) => ({itemId, label:e[language][i]}))};
}
function vocabulary(language = "indonesian", index = 0) {
  const e = examples[index];
  return {itemId:e.items[0],word:e[language][0],meaning:e.items[0],language};
}

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
  const locale = language === "indonesian" ? "id-ID" : "zh-CN";
  for (const [index, example] of examples.entries()) {
    test(`${language} mission ${index + 1}: mixed display, sequential voices, four-second loop without overlap`, () => {
      const robot = createRobot();
      robot.receive("current-activity", mission(language, index));
      assert.equal(robot.elements["robot-instruction"].textContent, `${example.prefix} ${example[language][0]}.`);
      robot.clock.advance(0);
      assert.equal(robot.lastSpeech().text, example.prefix);
      assert.equal(robot.lastSpeech().lang, "en-US");
      assert.equal(robot.lastSpeech().voice.lang, "en-US");
      robot.clock.advance(60000);
      assert.equal(robot.utterances.length, 1, "wait for English to finish before the target");
      robot.end();
      assert.equal(robot.lastSpeech().text, example[language][0]);
      assert.equal(robot.lastSpeech().lang, locale);
      assert.equal(robot.lastSpeech().voice.lang, locale);
      robot.clock.advance(60000);
      assert.equal(robot.utterances.length, 2, "a slow target utterance must not overlap the next loop");
      robot.end();
      assert.equal(robot.clock.timers.size, 1);
      robot.clock.advance(3999);
      assert.equal(robot.utterances.length, 2);
      robot.clock.advance(1);
      assert.equal(robot.lastSpeech().text, example.prefix);
      assert.equal(robot.utterances.length, 3);
      assert.equal(robot.overlaps, 0);
    });

    for (const phase of ["speaking", "pause"]) {
      test(`${language} mission ${index + 1}: colouring cancels ${phase} and stays silent`, () => {
        const robot = createRobot();
        robot.receive("current-activity", mission(language, index));
        robot.clock.advance(0);
        const cancelled = robot.lastSpeech();
        if (phase === "pause") { robot.end(); robot.end(); }
        const count = robot.utterances.length;
        robot.receive("colouring-started", {itemId:example.items[0]});
        robot.receive("colouring-started", {itemId:example.items[0]});
        cancelled.onend(); cancelled.onerror();
        robot.tap();
        robot.clock.advance(120000);
        assert.equal(robot.utterances.length, count);
        assert.equal(robot.clock.timers.size, 0);
        assert.equal(robot.elements["robot-instruction"].hidden, false);
        assert.equal(robot.overlaps, 0);
      });
    }

    test(`${language} mission ${index + 1}: contextual success once, then silence until the next activity`, () => {
      const robot = createRobot();
      robot.receive("current-activity", mission(language, index)); robot.clock.advance(0);
      const oldUtterance = robot.lastSpeech();
      robot.receive("colouring-started", {itemId:example.items[0]});
      robot.receive("answer-result", {correct:true,reaction:example.reaction});
      assert.equal(robot.elements["robot-instruction"].hidden, true);
      assert.equal(robot.elements["robot-response"].textContent, `${example.success} ${example[language][0]}!`);
      assert.equal(robot.elements["robot-pet"].src, expectedAssets[example.reaction]);
      assert.equal(robot.lastSpeech().text, example.success);
      assert.equal(robot.lastSpeech().lang, "en-US");
      oldUtterance.onend(); oldUtterance.onerror();
      assert.equal(robot.lastSpeech().text, example.success, "cancelled callbacks cannot resume the mission");
      robot.end();
      assert.equal(robot.lastSpeech().text, example[language][0]);
      assert.equal(robot.lastSpeech().lang, locale);
      robot.end();
      const count = robot.utterances.length;
      robot.receive("word-learned", vocabulary(language,index));
      robot.receive("answer-result", {correct:true,reaction:example.reaction});
      robot.clock.advance(120000);
      assert.equal(robot.utterances.length, count, "success and word rewards must not trigger a loop/replay");
      assert.equal(robot.clock.timers.size, 0);
      robot.receive("current-activity", mission(language,(index+1)%3)); robot.clock.advance(0);
      assert.equal(robot.lastSpeech().text, examples[(index+1)%3].prefix);
      assert.equal(robot.elements["robot-response"].hidden,true);
      assert.equal(robot.elements["robot-instruction"].hidden,false);
      assert.equal(robot.elements["robot-pet"].src,expectedAssets.idle);
      assert.equal(robot.overlaps,0);
    });
  }
  test(`${language}: incorrect feedback speaks once, then resumes the same mission`, () => {
    const robot = createRobot();
    robot.receive("current-activity", mission(language)); robot.clock.advance(0);
    robot.receive("colouring-started", {itemId:"chicken"});
    robot.receive("answer-result", {correct:false,reaction:"confused"});
    assert.equal(robot.elements["robot-instruction"].hidden, false);
    assert.equal(robot.elements["robot-response"].textContent,"Try again!");
    assert.equal(robot.elements["robot-pet"].src,expectedAssets.confused);
    assert.equal(robot.lastSpeech().text,"Try again!");
    assert.equal(robot.lastSpeech().lang,"en-US");
    robot.clock.advance(60000);
    assert.equal(robot.clock.timers.size,0,"do not resume until the feedback ends");
    robot.end(); robot.clock.advance(3999);
    assert.equal(robot.lastSpeech().text,"Try again!");
    robot.clock.advance(1);
    assert.equal(robot.lastSpeech().text,examples[0].prefix);
    robot.end(); assert.equal(robot.lastSpeech().lang,locale);
    robot.end(); robot.clock.advance(4000);
    assert.equal(robot.utterances.filter(u=>u.text==="Try again!").length,1);
    assert.equal(robot.overlaps,0);
  });
}

test("repeated current-activity snapshots keep only one instruction loop", () => {
  const robot=createRobot();
  for(let i=0;i<5;i++) robot.receive("current-activity",mission());
  assert.equal(robot.clock.timers.size,1);
  robot.clock.advance(0);
  assert.equal(robot.utterances.length,1);
  const stale=robot.lastSpeech();
  robot.receive("current-activity",mission());
  stale.onend(); robot.clock.advance(0);
  robot.end(); robot.end();
  assert.equal(robot.clock.timers.size,1);
  robot.clock.advance(4000);
  assert.equal(robot.utterances.length,4);
  assert.equal(robot.overlaps,0);
});

test("a completed reconnect snapshot cancels the queued mission before speaking success", () => {
  const robot=createRobot();
  robot.receive("current-activity",mission());
  robot.receive("answer-result",{correct:true,reaction:"eating"});
  robot.clock.advance(0);
  assert.deepEqual(robot.utterances.map(u=>u.text),[examples[0].success]);
  robot.end(); robot.end(); robot.clock.advance(60000);
  assert.equal(robot.utterances.length,2);
});

for (const event of ["game-reset","disconnect","connect_error","adventure-complete"]) {
  for(const phase of ["speaking","pause","incorrect","colouring"]) {
    test(`${event} cancels ${phase} speech and pending loops`, () => {
      const robot=createRobot();
      robot.receive("current-activity",mission()); robot.clock.advance(0);
      if(phase==="pause") {robot.end();robot.end();}
      if(phase==="colouring") robot.receive("colouring-started",{itemId:"carrot"});
      if(phase==="incorrect") robot.receive("answer-result",{correct:false,reaction:"confused"});
      const stale=robot.lastSpeech();
      robot.receive(event);
      const count=robot.utterances.length;
      stale.onend();stale.onerror();robot.clock.advance(60000);
      assert.equal(robot.utterances.length,count);
      assert.equal(robot.clock.timers.size,0);
      assert.equal(robot.elements["robot-speech-status"].hidden,true);
      assert.equal(robot.elements["robot-pet"].src, event==="adventure-complete"?expectedAssets.happy:expectedAssets.idle);
    });
  }
}

test("unsupported speech and speech failures keep visual feedback usable without retry loops", () => {
  for(const settings of [{speechSupported:false},...['constructor','getVoices','speak'].map(speechFailure=>({speechFailure}))]) {
    const robot=createRobot(settings);
    robot.receive("current-activity",mission()); robot.clock.advance(0);
    assert.equal(robot.clock.timers.size,0);
    assert.equal(robot.elements["robot-speech-status"].hidden,false);
    assert.doesNotThrow(()=>robot.receive("answer-result",{correct:true,reaction:"eating"}));
    assert.equal(robot.elements["robot-response"].textContent,"Yay! Thank you for feeding me wortel!");
    robot.clock.advance(60000);
    assert.equal(robot.clock.timers.size,0);
    assert.doesNotThrow(()=>robot.receive("game-reset"));
  }
});

test("blocked mission speech can be enabled by a tap without a robot replay button", () => {
  const robot=createRobot(); robot.receive("current-activity",mission()); robot.clock.advance(0);
  robot.error();robot.clock.advance(60000);
  assert.equal(robot.utterances.length,1);
  robot.tap(); assert.equal(robot.utterances.length,2);
  robot.tap(); assert.equal(robot.utterances.length,2,"ordinary taps do not add overlapping speech");
  robot.end();robot.end(); assert.equal(robot.clock.timers.size,1);
});

test("failed feedback never repeats; incorrect returns to mission, correct stays stopped", () => {
  for(const correct of [false,true]) {
    const robot=createRobot();robot.receive("current-activity",mission());
    robot.receive("answer-result",{correct,reaction:correct?"eating":"confused"});
    robot.error();robot.clock.advance(60000);robot.tap();
    assert.equal(robot.utterances.filter(u=>u.text===(correct?examples[0].success:"Try again!")).length,1);
    assert.equal(robot.utterances.length,correct?1:2);
    if(!correct) assert.equal(robot.lastSpeech().text,examples[0].prefix);
  }
});

test("missing voices retain the correct locale and later-loaded voices are selected", () => {
  const robot=createRobot();robot.voices.length=0;
  robot.receive("current-activity",mission("chinese"));robot.clock.advance(0);
  assert.equal(robot.lastSpeech().lang,"en-US");assert.equal(robot.lastSpeech().voice,undefined);
  robot.voices.push({lang:"zh-CN"});robot.end();
  assert.equal(robot.lastSpeech().voice.lang,"zh-CN");
});

test("cancellation exceptions do not break reset or replacement speech", () => {
  const robot=createRobot({speechFailure:"cancel"});
  robot.receive("current-activity",mission());robot.clock.advance(0);
  assert.doesNotThrow(()=>robot.receive("game-reset"));
  robot.clock.advance(60000);assert.equal(robot.utterances.length,1);
});

test("robot has no Hear button and ignores isolated word-learned events", () => {
  const html=fs.readFileSync(path.join(__dirname,"../public/pet.html"),"utf8");
  assert.doesNotMatch(html,/robot-pronunciation|Hear word/);
  const robot=createRobot();robot.receive("word-learned",vocabulary());
  assert.equal(robot.utterances.length,0);
});

test("Person 5 mappings and broken-image recovery remain intact", () => {
  const robot=createRobot();
  for(const [reaction,url] of Object.entries(expectedAssets)) {
    vm.runInContext(`setRobotReaction(${JSON.stringify(reaction)})`,robot.context);
    assert.equal(robot.elements["robot-pet"].src,url);
    assert.equal(robot.elements["robot-pet"].hidden,false);
    assert.ok(fs.existsSync(path.join(__dirname,"../public",url)));
  }
  robot.elements["robot-pet"].dispatch("error");
  assert.equal(robot.elements["robot-pet"].hidden,true);
  robot.receive("current-activity",mission());
  assert.equal(robot.elements["robot-pet"].hidden,false);
  vm.runInContext('ROBOT_ASSETS.idle=null;setRobotReaction("unknown")',robot.context);
  assert.equal(robot.elements["robot-pet"].hidden,true);
  assert.equal(robot.elements["robot-pet"].src,undefined);
});

for(const [type, correct, count, ascending] of [["correct",true,2,true],["incorrect",false,2,false],["complete",null,3,true]]) {
  test(`${type}: existing gentle feedback tones still play and clean up`, async()=>{
    const audio=createAudio();const robot=createRobot({audio});robot.receive("current-activity",mission());
    if(type==="complete") robot.receive("adventure-complete");else robot.receive("answer-result",{correct,reaction:correct?"eating":"confused"});
    await flushAudio();assert.equal(audio.oscillators.length,count);
    for(const [i,osc] of audio.oscillators.entries()) {
      const gain=audio.gains[i];
      assert.equal(osc.type,"sine");assert.deepEqual(osc.connections,[gain]);
      assert.deepEqual(gain.connections,[audio.contexts[0].destination]);
      assert.ok(gain.gain.changes.every(c=>c.value>=0&&c.value<=0.05));
      assert.equal(gain.gain.changes[0].value,0);assert.equal(gain.gain.changes.at(-1).value,0);
      assert.ok(osc.stops[0]>osc.starts[0]&&osc.stops[0]-osc.starts[0]<0.5);
      if(i>0) assert.equal(osc.frequency.value>audio.oscillators[i-1].frequency.value,ascending);
      osc.onended();assert.ok(osc.disconnected&&gain.disconnected);
    }
  });
}

test("speech and audio are independent, with optional Web Audio", async()=>{
  for(const audio of [null,createAudio()]) {
    const robot=createRobot({audio});robot.receive("current-activity",mission());
    robot.receive("answer-result",{correct:true,reaction:"eating"});
    assert.equal(robot.lastSpeech().text,examples[0].success);
    robot.end();assert.equal(robot.lastSpeech().text,"wortel");
    const spoken=robot.utterances.length;
    await vm.runInContext('playFeedbackSound("incorrect")',robot.context);
    assert.equal(robot.utterances.length,spoken);
    if(audio) assert.equal(audio.contexts.length,1);
  }
});
for(const event of ["current-activity","game-reset","disconnect","connect_error"]) {
  test(`${event} still cleans active audio nodes`,async()=>{
    const audio=createAudio();const robot=createRobot({audio});robot.receive("current-activity",mission());
    robot.receive("answer-result",{correct:true,reaction:"eating"});
    robot.receive(event,event==="current-activity"?mission("chinese",1):undefined);
    await flushAudio();assert.ok([...audio.oscillators,...audio.gains].every(n=>n.disconnected));
  });
}
for(const failure of ["constructor","resume","createOscillator","createGain","connect","start","stop"]) {
  test(`${failure} audio failure cannot block contextual speech`,async()=>{
    const audio=createAudio({state:failure==="resume"?"suspended":"running",failure});
    const robot=createRobot({audio});robot.receive("current-activity",mission());
    robot.receive("answer-result",{correct:true,reaction:"eating"});await flushAudio();
    assert.equal(robot.lastSpeech().text,examples[0].success);
    assert.equal(await vm.runInContext('playFeedbackSound("correct")',robot.context),false);
    assert.ok([...audio.oscillators,...audio.gains].every(n=>n.disconnected));
    assert.doesNotThrow(()=>robot.tap());await flushAudio();
  });
}

test("suspended Safari audio resumes; tapping alone makes no tone",async()=>{
  const audio=createAudio({state:"suspended"});const robot=createRobot({audio,webkitAudio:true});
  robot.tap();await flushAudio();assert.equal(audio.oscillators.length,0);assert.equal(audio.resumeCalls,1);
  robot.receive("current-activity",mission());robot.receive("answer-result",{correct:false,reaction:"confused"});
  await flushAudio();assert.equal(audio.oscillators.length,2);
});

test("blocked audio and stale resumes do not interrupt speech or play after reset",async()=>{
  const blocked=createAudio({state:"suspended",resume(){}});const robot=createRobot({audio:blocked});
  robot.receive("current-activity",mission());robot.receive("answer-result",{correct:false,reaction:"confused"});
  await flushAudio();assert.equal(blocked.oscillators.length,0);assert.equal(robot.lastSpeech().text,"Try again!");
  const pending=deferred();const audio=createAudio({state:"suspended",async resume(context){await pending.promise;context.state="running";}});
  const waiting=createRobot({audio});
  const stale=vm.runInContext('playFeedbackSound("incorrect")',waiting.context);
  const latest=vm.runInContext('playFeedbackSound("complete")',waiting.context);
  pending.resolve();assert.equal(await stale,false);assert.equal(await latest,true);
  const pendingReset=deferred();audio.contexts[0].state="suspended";
  audio.contexts[0].resume=async()=>{await pendingReset.promise;audio.contexts[0].state="running";};
  const resetPlayback=vm.runInContext('playFeedbackSound("correct")',waiting.context);
  waiting.receive("game-reset");pendingReset.resolve();assert.equal(await resetPlayback,false);
});
