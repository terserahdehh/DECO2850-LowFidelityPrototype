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
const pronunciationButton = document.getElementById("robot-pronunciation");
const speechStatus = document.getElementById("robot-speech-status");

let learnedVocabulary = null;
let speechRequestId = 0;
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
// produced by the tap itself; only answer/completion events request sounds.
document.addEventListener("pointerdown", () => {
  try {
    const context = getFeedbackAudioContext();
    if (context?.state === "suspended") context.resume().catch(() => {});
  } catch (error) {
    // Unsupported or blocked audio never prevents using the screen.
  }
});

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

function supportsVocabularySpeech() {
  return Boolean(
    window.speechSynthesis &&
    typeof window.speechSynthesis.speak === "function" &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

function cancelVocabularySpeech() {
  // Ignore callbacks from speech cancelled by a newer word, mission or reset.
  speechRequestId += 1;
  activeUtterance = null;
  showSpeechStatus("");

  if (window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch (error) {
      // Speech is optional; the on-screen game can still continue.
    }
  }
}

// Only pronounce learned vocabulary; mission instructions remain English.
function speakVocabulary(word, language) {
  cancelVocabularySpeech();

  if (!SPEECH_LANGUAGES[language] || typeof word !== "string" || !word.trim()) {
    return false;
  }

  if (!supportsVocabularySpeech()) {
    showSpeechStatus("Pronunciation is not available in this browser.");
    return false;
  }

  const requestId = speechRequestId;

  try {
    const utterance = new window.SpeechSynthesisUtterance(word);
    utterance.lang = SPEECH_LANGUAGES[language];
    utterance.onend = () => {
      if (requestId === speechRequestId) activeUtterance = null;
    };
    utterance.onerror = () => {
      if (requestId !== speechRequestId) return;
      activeUtterance = null;
      showSpeechStatus("Tap the Hear button to try the pronunciation again.");
    };
    activeUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch (error) {
    activeUtterance = null;
    showSpeechStatus("Pronunciation is unavailable. You can try again.");
    return false;
  }
}

function clearVocabulary() {
  cancelVocabularySpeech();
  learnedVocabulary = null;
  pronunciationButton.hidden = true;
  pronunciationButton.disabled = false;
  pronunciationButton.textContent = "Hear word";
}

function resetRobot(message = "Waiting for the activity to begin...") {
  stopFeedbackSound();
  clearVocabulary();
  robotInstruction.textContent = message;
  robotResponse.textContent = "";
  robotResponse.hidden = true;
  setRobotReaction("idle");
}

// The server sends the same state events when this screen reconnects.
socket.on("current-activity", (activity) => {
  if (!activity || typeof activity.instruction !== "string") return;
  resetRobot(activity.instruction);
});

socket.on("answer-result", (result) => {
  if (!result || typeof result.correct !== "boolean") return;
  robotResponse.textContent = result.correct ? "Great job!" : "Try again!";
  robotResponse.hidden = false;
  setRobotReaction(result.correct ? result.reaction || "happy" : "confused");
  playFeedbackSound(result.correct ? "correct" : "incorrect");
});

socket.on("word-learned", (vocabulary) => {
  if (
    !vocabulary ||
    typeof vocabulary.word !== "string" ||
    !vocabulary.word.trim() ||
    !SPEECH_LANGUAGES[vocabulary.language]
  ) return;

  learnedVocabulary = { word: vocabulary.word, language: vocabulary.language };
  pronunciationButton.textContent = `Hear ${vocabulary.word}`;
  pronunciationButton.hidden = false;
  pronunciationButton.disabled = !supportsVocabularySpeech();
  speakVocabulary(vocabulary.word, vocabulary.language);
});

// A direct tap allows replay if an iPad/browser blocks automatic speech.
pronunciationButton.addEventListener("click", () => {
  if (learnedVocabulary) {
    speakVocabulary(learnedVocabulary.word, learnedVocabulary.language);
  }
});

socket.on("adventure-complete", () => {
  clearVocabulary();
  robotInstruction.textContent = "Adventure complete!";
  robotResponse.textContent = "Great work!";
  robotResponse.hidden = false;
  setRobotReaction("happy");
  playFeedbackSound("complete");
});

socket.on("game-reset", () => resetRobot());
socket.on("disconnect", () => resetRobot("Connecting to the adventure..."));
socket.on("connect_error", () => resetRobot("Connecting to the adventure..."));

resetRobot();
