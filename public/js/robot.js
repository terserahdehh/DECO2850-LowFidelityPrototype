// Person 5's original PNGs. Decorative motion is defined in robot.css.
const ROBOT_ASSETS = {
  idle: "/assets/char_movements/default.png",
  happy: "/assets/char_emotions/happy.png",
  confused: "/assets/char_emotions/sad.png",
  eating: "/assets/char_emotions/happyeat.png",
  sitting: "/assets/char_emotions/happysit.png",
  looking: "/assets/char_emotions/happylook.png",
  playing: "/assets/char_emotions/happy.png", // Legacy reaction; no current mission uses it.
};

const SPEECH_LANGUAGES = {
  indonesian: "id-ID",
  chinese: "zh-CN",
};

const socket = io();
const robotPet = document.getElementById("robot-pet");
const robotInstruction = document.getElementById("robot-instruction");
const robotResponse = document.getElementById("robot-response");
const speechStatus = document.getElementById("robot-speech-status");
const enableSoundButton = document.getElementById("robot-enable-sound");

const SPEECH_START_TIMEOUT_MS = 5000;
const VOICE_WAIT_MS = 500;
const SUCCESS_PREFIXES = {
  eating: "Yay! Thank you for feeding me",
  sitting: "Yay! Now I can sit on",
  looking: "Yay! You found",
};
let currentActivity = null;
let speechPhase = "idle"; // idle, waiting, colouring, incorrect, or complete
let missionTimer = null;
let speechRequestId = 0;
let soundEnabled = false;
let pendingSpeech = null;
let speechStartTimer = null;
let voiceTimer = null;
let voicesReady = null;
// Keep a reference while speaking, including on mobile browsers.
let activeUtterance = null;

// Short original cues, in hertz. No audio files or background music are needed.
const FEEDBACK_NOTES = {
  correct: [523.25, 659.25],
  incorrect: [293.66, 246.94],
  complete: [523.25, 659.25, 783.99],
};
let feedbackAudioContext = null;
let feedbackSoundId = 0;
const activeFeedbackNotes = [];

function getFeedbackAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (typeof AudioContext !== "function") return null;
  if (!feedbackAudioContext || feedbackAudioContext.state === "closed") {
    feedbackAudioContext = new AudioContext();
  }
  return feedbackAudioContext;
}

function disconnectFeedbackNote(note) {
  if (note.oscillator) note.oscillator.onended = null;
  for (const node of [note.oscillator, note.gain]) {
    try {
      node?.disconnect();
    } catch (error) {
      // Also safe when a browser failed partway through creating a note.
    }
  }
  const index = activeFeedbackNotes.indexOf(note);
  if (index !== -1) activeFeedbackNotes.splice(index, 1);
}

function stopFeedbackSound() {
  // Invalidate a pending resume so an old cue cannot play after a reset.
  feedbackSoundId += 1;
  for (const note of [...activeFeedbackNotes]) {
    try {
      note.oscillator?.stop();
    } catch (error) {
      // A note might already have finished or not have started.
    }
    disconnectFeedbackNote(note);
  }
}

async function playFeedbackSound(type) {
  stopFeedbackSound();
  if (!Object.prototype.hasOwnProperty.call(FEEDBACK_NOTES, type)) return false;
  const requestId = feedbackSoundId;

  try {
    const context = getFeedbackAudioContext();
    if (!context) return false;
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running" || requestId !== feedbackSoundId) return false;

    const start = context.currentTime + 0.01;
    FEEDBACK_NOTES[type].forEach((frequency, index) => {
      // Register first so the catch below can clean up even a partial note.
      const note = { oscillator: null, gain: null };
      activeFeedbackNotes.push(note);
      note.oscillator = context.createOscillator();
      note.gain = context.createGain();
      const noteStart = start + index * 0.16;
      const noteEnd = noteStart + 0.14;

      note.oscillator.type = "sine";
      note.oscillator.frequency.value = frequency;
      // A quiet attack/release envelope avoids sudden clicks and harsh sounds.
      note.gain.gain.setValueAtTime(0, noteStart);
      note.gain.gain.linearRampToValueAtTime(0.045, noteStart + 0.025);
      note.gain.gain.linearRampToValueAtTime(0, noteEnd);
      note.oscillator.connect(note.gain);
      note.gain.connect(context.destination);
      note.oscillator.onended = () => disconnectFeedbackNote(note);
      note.oscillator.start(noteStart);
      note.oscillator.stop(noteEnd + 0.01);
    });
    return true;
  } catch (error) {
    if (requestId === feedbackSoundId) stopFeedbackSound();
    // Audio is optional. Neither visual feedback nor vocabulary waits for it.
    return false;
  }
}

// A tap anywhere on the robot screen can unlock audio on an iPad. No tone is
// produced by the tap itself. Speech is enabled through the explicit button.
document.addEventListener("pointerdown", () => {
  try {
    const context = getFeedbackAudioContext();
    if (context?.state === "suspended") context.resume().catch(() => {});
  } catch (error) {
    // Unsupported or blocked audio never prevents using the screen.
  }
});

function markSoundEnabled() {
  soundEnabled = true;
  enableSoundButton.hidden = true;
  showSpeechStatus("");
}

enableSoundButton.addEventListener("click", () => {
  if (soundEnabled) return;
  try {
    const context = getFeedbackAudioContext();
    if (context?.state === "suspended") context.resume().catch(() => {});
  } catch (error) { /* Feedback audio is optional. */ }
  // Call speak synchronously inside this robot's gesture, without awaiting
  // AudioContext.resume() or voiceschanged. A remote mobile tap cannot do this.
  if (pendingSpeech) pendingSpeech(true);
  else if (!activeUtterance) speakSequence("Sound enabled.", () => {}, true);
});

window.speechSynthesis?.addEventListener?.("voiceschanged", () => voicesReady?.());
// Prime the device's asynchronously loaded voice list before a mission arrives.
try { window.speechSynthesis?.getVoices?.(); } catch (error) { /* Optional. */ }

function setRobotReaction(reaction) {
  const state = Object.prototype.hasOwnProperty.call(ROBOT_ASSETS, reaction)
    ? reaction
    : "idle";

  // Restart a short reaction even when two attempts have the same result.
  delete robotPet.dataset.reaction;
  void robotPet.offsetWidth;
  robotPet.dataset.reaction = state;
  const assetPath = ROBOT_ASSETS[state];
  robotPet.hidden = !assetPath;

  if (assetPath) {
    robotPet.src = assetPath;
  } else {
    robotPet.removeAttribute("src");
  }
}

// Missing or renamed assets must not leave a broken-image icon on the screen.
robotPet.addEventListener("error", () => {
  robotPet.hidden = true;
});

function showSpeechStatus(message) {
  speechStatus.textContent = message;
  speechStatus.hidden = !message;
}

function cancelRobotSpeech() {
  // Invalidate callbacks before cancel(): some browsers report cancellation late.
  speechRequestId += 1;
  clearTimeout(missionTimer);
  missionTimer = null;
  activeUtterance = null;
  pendingSpeech = null;
  clearTimeout(speechStartTimer);
  clearTimeout(voiceTimer);
  speechStartTimer = null;
  voiceTimer = null;
  voicesReady = null;
  showSpeechStatus("");
  try {
    window.speechSynthesis?.cancel();
  } catch (error) {
    // Text and reactions remain usable without speech.
  }
}

function missionWord() {
  // This only splits the displayed sentence for pronunciation. Correctness is
  // still decided by the server; no correctItemId is sent to the robot.
  return currentActivity?.options.find(({ label }) =>
    currentActivity.instruction.endsWith(`${label}.`)
  )?.label || "";
}

function speechParts(text) {
  const word = missionWord();
  if (!word || !text.includes(word)) return [{ text, lang: "en-US" }];
  // Feedback can mention the target more than once; pronounce every occurrence
  // in the chosen language, with English voices for the surrounding sentence.
  return text.split(word).flatMap((segment, index) => [
    ...(index ? [{ text: word, lang: SPEECH_LANGUAGES[currentActivity.language] }] : []),
    { text: segment.trim(), lang: "en-US" },
  ]).filter((part) => /[\p{L}\p{N}]/u.test(part.text));
}

function incorrectFeedback() {
  const word = missionWord();
  if (!word) return "Try again!";
  const action = currentActivity.id?.startsWith("hungry-") ? "feed"
    : currentActivity.id?.startsWith("look-") ? "show" : "give";
  return `That's not ${word}, please ${action} me ${word} instead.`;
}

function speakSequence(text, onFinished = () => {}, fromGesture = false) {
  const requestId = speechRequestId;
  const parts = speechParts(text);
  let index = 0;
  function fail() {
    if (requestId !== speechRequestId) return;
    activeUtterance = null;
    clearTimeout(speechStartTimer);
    speechStartTimer = null;
    showSpeechStatus(soundEnabled
      ? "Speech is unavailable. Check this device’s speech voices and sound settings."
      : "Tap to enable sound on this robot device.");
    // No automatic retries after a speech error: avoid a rapid failure loop.
  }
  function speakNext(gesture = false) {
    if (requestId !== speechRequestId) return;
    clearTimeout(voiceTimer);
    voiceTimer = null;
    voicesReady = null;
    // A retry replaces a silently rejected utterance; it cannot leave it queued.
    if (gesture && activeUtterance) {
      activeUtterance = null;
      clearTimeout(speechStartTimer);
      try { window.speechSynthesis?.cancel(); } catch (error) { /* Optional. */ }
    }
    if (index === parts.length) {
      activeUtterance = null;
      pendingSpeech = null;
      onFinished(true);
      return;
    }
    try {
      if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== "function") {
        enableSoundButton.hidden = true;
        fail();
        showSpeechStatus("Speech is not supported on this browser.");
        return;
      }
      const voices = window.speechSynthesis.getVoices?.() || [];
      if (!gesture && !voices.length && !voiceWaited) {
        voiceWaited = true;
        voicesReady = speakNext;
        voiceTimer = setTimeout(speakNext, VOICE_WAIT_MS);
        return;
      }
      const part = parts[index];
      const utterance = new window.SpeechSynthesisUtterance(part.text);
      utterance.lang = part.lang;
      const locale = part.lang.toLowerCase();
      const voice = voices.find((voice) => voice.lang.toLowerCase() === locale) ||
        voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === locale.split("-")[0]);
      if (voice) utterance.voice = voice;
      // Keep the correct lang even when the device has no matching voice yet.
      activeUtterance = utterance;
      utterance.onstart = () => {
        if (requestId !== speechRequestId || activeUtterance !== utterance) return;
        clearTimeout(speechStartTimer);
        speechStartTimer = null;
        markSoundEnabled();
        pendingSpeech = null;
      };
      utterance.onend = () => {
        if (requestId !== speechRequestId || activeUtterance !== utterance) return;
        activeUtterance = null;
        clearTimeout(speechStartTimer);
        speechStartTimer = null;
        markSoundEnabled();
        index += 1;
        pendingSpeech = speakNext;
        speakNext();
      };
      utterance.onerror = () => {
        if (requestId === speechRequestId && activeUtterance === utterance) fail();
      };
      pendingSpeech = speakNext;
      speechStartTimer = setTimeout(() => {
        if (requestId !== speechRequestId || activeUtterance !== utterance) return;
        fail();
        try { window.speechSynthesis.cancel(); } catch (error) { /* Optional. */ }
      }, SPEECH_START_TIMEOUT_MS);
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      fail();
    }
  }
  let voiceWaited = false;
  pendingSpeech = speakNext;
  speakNext(fromGesture);
}

function scheduleMissionSpeech(delay = 0) {
  clearTimeout(missionTimer);
  missionTimer = setTimeout(() => {
    missionTimer = null;
    startMissionSpeech();
  }, delay);
}

function startMissionSpeech() {
  if (!currentActivity || speechPhase !== "waiting") return;
  cancelRobotSpeech();
  robotResponse.textContent = "";
  robotResponse.hidden = true;
  setRobotReaction("idle");
  speakSequence(currentActivity.instruction);
}

function resetRobot(message = "Waiting for the activity to begin...") {
  cancelRobotSpeech();
  stopFeedbackSound();
  currentActivity = null;
  speechPhase = "idle";
  robotInstruction.textContent = message;
  robotInstruction.hidden = false;
  robotResponse.textContent = "";
  robotResponse.hidden = true;
  setRobotReaction("idle");
}

socket.on("current-activity", (activity) => {
  if (!activity || typeof activity.instruction !== "string" ||
      !Array.isArray(activity.options) || !SPEECH_LANGUAGES[activity.language]) return;
  if (speechPhase !== "complete" && currentActivity && currentActivity.id === activity.id &&
      currentActivity.language === activity.language &&
      currentActivity.activityIndex === activity.activityIndex &&
      currentActivity.instruction === activity.instruction) return;
  resetRobot(activity.instruction);
  currentActivity = activity;
  speechPhase = "waiting";
  // Deferring one tick lets a reconnect's following completed answer cancel this
  // before it speaks. Identical snapshots above do not replay the instruction.
  scheduleMissionSpeech(0);
});

socket.on("colouring-started", (payload) => {
  if (!currentActivity || speechPhase === "complete" ||
      !currentActivity.options.some(({ itemId }) => itemId === payload?.itemId)) return;
  cancelRobotSpeech();
  speechPhase = "colouring";
});

socket.on("answer-result", (result) => {
  if (!currentActivity || !result || typeof result.correct !== "boolean" ||
      speechPhase === "complete") return;
  // The server checks submit-item synchronously and immediately sends this event.
  cancelRobotSpeech();
  speechPhase = result.correct ? "complete" : "incorrect";
  robotInstruction.hidden = result.correct;
  const prefix = SUCCESS_PREFIXES[result.reaction];
  const feedback = result.correct
    ? (prefix && missionWord() ? `${prefix} ${missionWord()}!` : "Great job!")
    : incorrectFeedback();
  robotResponse.textContent = feedback;
  robotResponse.hidden = false;
  setRobotReaction(result.correct ? result.reaction || "happy" : "confused");
  playFeedbackSound(result.correct ? "correct" : "incorrect");
  speakSequence(feedback, () => {
    if (speechPhase !== "incorrect") return;
    speechPhase = "waiting";
  });
});

// word-learned is for Person 4's glossary. The robot does not speak that event
// or offer isolated-word replay; it already speaks the contextual feedback.
socket.on("adventure-complete", () => {
  if (!currentActivity && speechPhase === "complete") return;
  resetRobot("Adventure complete!");
  speechPhase = "complete";
  robotResponse.textContent = "Great work!";
  robotResponse.hidden = false;
  setRobotReaction("happy");
  playFeedbackSound("complete");
  speakSequence("Adventure complete! Great work!");
});

socket.on("game-reset", () => resetRobot());
socket.on("disconnect", () => resetRobot("Connecting to the adventure..."));
socket.on("connect_error", () => resetRobot("Connecting to the adventure..."));

resetRobot();
