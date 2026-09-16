const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const activitiesByLanguage = require("./data/activities");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Only public files are served; activity answers stay on the server.
app.use(express.static(path.join(__dirname, "public")));

// One shared, in-memory adventure for the robot and mobile devices.
const gameState = {};

function resetGame() {
  Object.assign(gameState, {
    language: null,
    currentActivityIndex: 0,
    isPlaying: false,
    currentActivityCompleted: false,
    colouringItemId: null,
  });
}

resetGame();

function getCurrentActivity() {
  const activities = activitiesByLanguage[gameState.language];
  return activities ? activities[gameState.currentActivityIndex] : null;
}

function emitCurrentActivity(target = io) {
  const activity = getCurrentActivity();
  if (!activity) return;

  // Explicitly select public fields. Never send correctItemId or vocabulary here.
  target.emit("current-activity", {
    id: activity.id,
    instruction: activity.instruction,
    options: activity.options.map(({ itemId, label }) => ({ itemId, label })),
    language: gameState.language,
    activityIndex: gameState.currentActivityIndex,
  });
}

function emitAdventureComplete(target = io) {
  target.emit("adventure-complete", {
    language: gameState.language,
    completedActivities: gameState.currentActivityIndex,
  });
}

io.on("connection", (socket) => {
  console.log("Device connected:", socket.id);

  // A late/reconnecting screen receives the shared state without restarting it.
  // Learned words are live rewards, so connecting never emits word-learned again.
  if (gameState.isPlaying) {
    emitCurrentActivity(socket);
    if (gameState.colouringItemId) {
      socket.emit("colouring-started", { itemId: gameState.colouringItemId });
    }
    if (gameState.currentActivityCompleted) {
      socket.emit("answer-result", {
        correct: true,
        reaction: getCurrentActivity().successReaction,
      });
    }
  } else if (gameState.language !== null) {
    emitAdventureComplete(socket);
  } else {
    socket.emit("game-reset");
  }

  // Person 4 sends { language: "indonesian" | "chinese" }.
  socket.on("start-game", (payload) => {
    if (
      !payload ||
      (payload.language !== "indonesian" && payload.language !== "chinese")
    ) return;

    resetGame();
    gameState.language = payload.language;
    gameState.isPlaying = true;
    emitCurrentActivity();
  });

  // A notification only: selection does not submit or determine correctness.
  socket.on("colouring-started", (payload) => {
    if (!gameState.isPlaying || gameState.currentActivityCompleted) return;
    if (!payload || !getCurrentActivity()?.options.some(({ itemId }) => itemId === payload.itemId)) return;
    gameState.colouringItemId = payload.itemId;
    io.emit("colouring-started", { itemId: payload.itemId });
  });

  // Person 3 sends only { itemId }. All correctness checks happen here.
  socket.on("submit-item", (payload) => {
    if (!gameState.isPlaying || gameState.currentActivityCompleted) return;
    if (!payload || typeof payload.itemId !== "string") return;

    const activity = getCurrentActivity();
    if (!activity) return;
    // Ignore malformed/unknown IDs; a wrong option from this mission is a retry.
    if (!activity.options.some((option) => option.itemId === payload.itemId)) return;

    gameState.colouringItemId = null;
    const correct = payload.itemId === activity.correctItemId;
    if (correct) gameState.currentActivityCompleted = true;

    io.emit("answer-result", {
      correct,
      reaction: correct ? activity.successReaction : "confused",
    });

    if (correct) {
      // The completed flag above prevents duplicate submissions unlocking twice.
      io.emit("word-learned", { ...activity.vocabulary });
    }
  });

  // Person 3's Next Mission button controls progression, including the last one.
  socket.on("next-activity", () => {
    if (!gameState.isPlaying || !gameState.currentActivityCompleted) return;

    gameState.colouringItemId = null;
    gameState.currentActivityIndex += 1;
    gameState.currentActivityCompleted = false;

    if (getCurrentActivity()) {
      emitCurrentActivity();
    } else {
      gameState.isPlaying = false;
      emitAdventureComplete();
    }
  });

  // Person 4 sends no payload. Both screens return to their waiting state.
  socket.on("exit-game", () => {
    resetGame();
    io.emit("game-reset");
  });

  socket.on("disconnect", () => {
    console.log("Device disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Robot: http://localhost:${PORT}/pet.html`);
    console.log(`Mobile: http://localhost:${PORT}/mobile.html`);
  });
}

// Tests can start the real server on an available port and inspect its state.
module.exports = { app, server, io, gameState, resetGame };
