(() => {
"use strict";

const socket = window.mobileSocket;
if (!socket || !window.Room || !window.LanguageSystem || !window.GlossarySystem) return;
const demoMode = new URLSearchParams(window.location.search).get("roomDemo") === "1";
if (demoMode) return;

// Only map IDs that have an exact matching Person 5 object asset. Items without
// an asset keep an empty image URL so room.js uses its existing fallback art.
const ROOM_ITEM_ASSETS = Object.freeze({
  carrot: "/assets/eat_objects/carrot.png",
  chicken: "/assets/eat_objects/chicken.png",
  rice: "/assets/eat_objects/rice.png",
  chair: "/assets/sit_objects/chair.png",
  book: "/assets/sit_objects/book.png",
  table: "/assets/sit_objects/table.png",
  butterfly: "/assets/see_objects/butterfly.png",
  tree: "/assets/see_objects/tree.png",
  bird: "/assets/see_objects/bird.png",
});

LanguageSystem.init({ onStartGame(language) {
  socket.emit("start-game", { language });
} });
GlossarySystem.init({
  onExitGame() { socket.emit("exit-game"); },
  onOpen() { Room.lock("glossary"); },
  onClose() { Room.unlock("glossary"); },
});
LanguageSystem.show();
socket.on("word-learned", (data) => GlossarySystem.addWord({
  ...data,
  image: window.getCompletedArtwork?.(data.itemId) || ROOM_ITEM_ASSETS[data.itemId],
}));
socket.on("game-reset", () => {
  GlossarySystem.reset();
  LanguageSystem.reset();
  Room.hide();
});

function adaptActivityForRoom(activity) {
  if (!activity || !Array.isArray(activity.options)) return null;

  return {
    activityId: activity.id,
    items: activity.options.map((option) => ({
      itemId: option?.itemId,
      name: typeof option?.label === "string" ? option.label : option?.itemId,
      image: ROOM_ITEM_ASSETS[option?.itemId] || "",
      icon: option?.itemId,
    })),
  };
}

socket.on("current-activity", (activity) => {
  const roomActivity = adaptActivityForRoom(activity);
  if (!roomActivity) return;

  LanguageSystem.hide();
  GlossarySystem.setLanguage(activity.language);

  try {
    Room.loadActivity(roomActivity);
    Room.show();
  } catch (error) {
    console.error("Could not load the current activity into the room.", error);
  }
});

socket.connect();
})();
