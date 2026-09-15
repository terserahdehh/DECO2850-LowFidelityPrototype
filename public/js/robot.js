// TODO Person 5: replace null with each final animation URL, such as
// "/assets/pet/idle.gif". Until then, the instruction and feedback work alone.
const ROBOT_ASSETS = {
  idle: null,
  happy: null,
  confused: null,
  eating: null,
  playing: null,
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

function setRobotReaction(reaction) {
  const state = Object.prototype.hasOwnProperty.call(ROBOT_ASSETS, reaction)
    ? reaction
    : "idle";

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
});

socket.on("game-reset", () => resetRobot());
socket.on("disconnect", () => resetRobot("Connecting to the adventure..."));
socket.on("connect_error", () => resetRobot("Connecting to the adventure..."));

resetRobot();
