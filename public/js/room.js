(() => {
"use strict";

/**
 * Person 2 room interface (temporary contract; no Socket.IO dependency).
 *
 * Room.loadActivity({ activityId, items: [{ itemId, name?, image?, icon? }, ...] })
 *   accepts exactly three options. IDs are preserved, never derived from labels.
 * Room.show() / hide() control only #room-screen; the host manages other screens.
 * Room.lock("glossary") / unlock("glossary") support independent lock reasons.
 * Room.finishSelection() returns to the room after colouring/cancellation.
 *   It releases only the selection lock, not glossary or other external locks.
 * Room.reset() resets the current activity; loadActivity() resets for a new one.
 * Room.setAssets({ roomBackground: "/assets/...", mascot: "/assets/...", ... })
 * Room.getState() returns a detached snapshot; Room.destroy() releases resources.
 *
 * Listen on #room-screen or document for bubbling "room:item-selected":
 *   event.detail = { activityId, itemId }
 * Selection locks movement and further selection before emitting the event.
 * Person 3/host later calls finishSelection(), or Person 1 loads a new activity.
 * Nothing here judges correctness, submits colouring, or controls other screens.
 *
 * Development only: mobile.html?roomDemo=1 loads MOCK_ACTIVITY and automatically
 * finishes selection after the 1.35s visual. Normal startup stays hidden/empty.
 */
const root = document.getElementById("room-screen");
if (!root) return;
const canvas = root.querySelector("#room-canvas");
const context = canvas.getContext("2d");
const focusNote = root.querySelector(".focus-note");
const status = root.querySelector(".room-status");
const dPad = root.querySelector(".d-pad");
const dPadButtons = dPad.querySelectorAll("[data-direction]");
const disposers = [];
let destroyed = false;

// Switch off after desktop D-pad placement testing.
const SHOW_DPAD_ON_DESKTOP = true;
// Rendering-only scene switch. Legacy art and its obstacles are enabled together.
const USE_LEGACY_KITCHEN = false;
const loadedAssets = Object.create(null);
const PERSON5_ASSETS = {
  roomBackground: "/assets/background.png",
  mascot: "/assets/char_movements/default.png",
  mascotLeft: "/assets/char_movements/leftmove.png",
  mascotRight: "/assets/char_movements/rightmove.png",
  mascotLeftUp: "/assets/char_movements/leftupmove.png",
  mascotRightUp: "/assets/char_movements/rightupmove.png",
  mascotLeftDown: "/assets/char_movements/leftdownmove.png",
  mascotRightDown: "/assets/char_movements/rightdownmove.png",
};
const PET_VISUAL_HEIGHT = 78;
let lastHorizontalFacing = 1; // Rendering state only; deterministic right fallback.
const WORLD = {
  width: 960,
  height: 620,
  playableBounds: { left: 54, right: 906, top: USE_LEGACY_KITCHEN ? 126 : 72, bottom: 568 },
  wallDepth: 34,
};

const palette = {
  outline: "#514653",
  wall: "#f7dcb6",
  wallHighlight: "#ffedcf",
  floor: "#d9ead7",
  floorLine: "#caddc8",
  wood: "#ad735b",
  woodDark: "#7c504b",
  coral: "#ef8c79",
  coralDark: "#c76762",
  cream: "#fff3d5",
  green: "#6fad81",
  greenDark: "#4f8064",
  blue: "#75a9bb",
};

const player = {
  x: 490,
  y: 400,
  radius: 19,
  speed: 220,
  facingX: 0,
  facingY: 1,
  moving: false,
};

// Collision boxes describe only each object's footprint on the floor.
// Their visual drawings may extend above the footprint for a 2.5D effect.
const legacyKitchenFurniture = [
  { id: "refrigerator", x: 88, y: 337, width: 205, height: 96, draw: drawRefrigerator },
  { id: "stove-counter", x: 68, y: 143, width: 222, height: 64, draw: drawStoveCounter },
  { id: "sink-counter", x: 694, y: 153, width: 188, height: 72, draw: drawSinkCounter },
  { id: "herb-cabinet", x: 767, y: 424, width: 82, height: 68, draw: drawHerbCabinet },
  { id: "kitchen-island", x: 402, y: 201, width: 151, height: 78, draw: drawKitchenIsland },
];

// The active collision/render list is empty in the furniture-free asset scene.
const furniture = USE_LEGACY_KITCHEN ? legacyKitchenFurniture : [];

const SPAWN = Object.freeze({ x: 490, y: 400 });
const ITEM_SLOTS = [
  { x: 343, y: 296 },
  { x: 628, y: 344 },
  { x: 655, y: 493 },
];
// Mock content is separate from layout and item logic. It is loaded only in demo.
const MOCK_ACTIVITY = {
  activityId: "room-demo",
  items: [
    { itemId: "chicken", name: "Chicken", icon: "chicken", image: "/assets/eat_objects/chicken.png" },
    { itemId: "carrot", name: "Carrot", icon: "carrot", image: "/assets/eat_objects/carrot.png" },
    { itemId: "rice", name: "Rice", icon: "rice", image: "/assets/eat_objects/rice.png" },
  ],
};
const PICKUP_DURATION = 1.35;
const ITEM_FADE_DURATION = 0.22;
let activity = null;
let roomItems = [];
let selectedItem = null;
let activePickup = null;
const locks = new Set();
const keysDown = new Set();
const touchPointers = new Map();
const gameKeys = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "KeyW", "KeyA", "KeyS", "KeyD",
]);
let lastFrameTime = performance.now();
let walkTime = 0;
let frameId = null;
const demoMode = new URLSearchParams(window.location.search).get("roomDemo") === "1";

function listen(target, name, handler) {
  target.addEventListener(name, handler);
  disposers.push(() => target.removeEventListener(name, handler));
}
function visible() {
  return !destroyed && !root.hidden && !document.hidden && root.getClientRects().length > 0;
}
function canInteract() {
  return visible() && activity !== null && locks.size === 0 && selectedItem === null;
}
function clearInput() {
  keysDown.clear();
  touchPointers.clear();
  player.moving = false;
  dPadButtons.forEach((button) => button.classList.remove("is-pressed"));
}
function syncControls() {
  const disabled = !canInteract();
  dPadButtons.forEach((button) => { button.disabled = disabled; });
  dPad.setAttribute("aria-disabled", String(disabled));
}
function lock(reason = "external") {
  if (typeof reason !== "string" || !reason) throw new TypeError("Lock reason must be a nonempty string.");
  locks.add(reason);
  clearInput();
  syncControls();
}
function unlock(reason = "external") {
  locks.delete(reason);
  clearInput();
  syncControls();
}
function loadImage(source) {
  if (!source) return null;
  const image = new Image();
  image.src = source;
  return image;
}
function setAssets(sources) {
  for (const [key, source] of Object.entries(sources)) loadedAssets[key] = loadImage(source);
}
// Keep schema adaptation at this boundary. Never use a translated name as an ID.
function loadActivity(next) {
  if (!next || typeof next.activityId !== "string" || !next.activityId.trim()
      || !Array.isArray(next.items) || next.items.length !== ITEM_SLOTS.length) {
    throw new TypeError("Expected an activityId and exactly three item options.");
  }
  const ids = new Set();
  const items = next.items.map((item) => {
    if (!item || typeof item.itemId !== "string" || !item.itemId.trim() || ids.has(item.itemId)) {
      throw new TypeError("Each option must have a unique nonempty string itemId.");
    }
    if (item.image != null && typeof item.image !== "string") {
      throw new TypeError("Item image must be a URL string.");
    }
    ids.add(item.itemId);
    return {
      itemId: item.itemId,
      name: typeof item.name === "string" ? item.name : item.itemId,
      image: item.image || "",
      icon: typeof item.icon === "string" ? item.icon : "",
    };
  });
  activity = { activityId: next.activityId, items };
  reset();
}
function reset() {
  clearInput();
  Object.assign(player, SPAWN, { facingX: 0, facingY: 1, moving: false });
  lastHorizontalFacing = 1;
  walkTime = 0;
  selectedItem = null;
  activePickup = null;
  roomItems = activity ? activity.items.map((item, index) => ({
    ...item,
    ...ITEM_SLOTS[index],
    image: loadImage(item.image),
    pickupRadius: 42,
    selected: false,
    fadeElapsed: 0,
    armed: true,
  })) : [];
  // External locks survive reset: a new activity must not unlock an open glossary.
  status.textContent = "";
  syncControls();
  draw();
}
function finishSelection() {
  if (!selectedItem) return;
  selectedItem.selected = false;
  selectedItem.fadeElapsed = 0;
  // Must leave this item's interaction area before it can trigger again.
  selectedItem.armed = false;
  selectedItem = null;
  activePickup = null;
  clearInput();
  syncControls();
}
function show() {
  if (!activity) throw new Error("Load an activity before showing the room.");
  if (destroyed) throw new Error("Room has been destroyed.");
  root.hidden = false;
  syncVisibility();
}
function hide() {
  root.hidden = true;
  syncVisibility();
}
function syncVisibility() {
  clearInput();
  syncControls();
  if (visible()) {
    if (frameId === null) {
      lastFrameTime = performance.now();
      frameId = requestAnimationFrame(gameLoop);
    }
  } else if (frameId !== null) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
}
function getState() {
  return {
    activityId: activity?.activityId ?? null,
    player: { ...player },
    items: roomItems.map(({ itemId, x, y, selected, armed }) => ({ itemId, x, y, selected, armed })),
    selectedItemId: selectedItem?.itemId ?? null,
    locks: [...locks],
    interactionEnabled: canInteract(),
  };
}
function destroy() {
  if (destroyed) return;
  destroyed = true;
  clearInput();
  syncControls();
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  disposers.forEach((dispose) => dispose());
}

listen(window, "keydown", (event) => {
  if (!canInteract() || !gameKeys.has(event.code)) return;
  if (event.target instanceof Element &&
      event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
  event.preventDefault();
  keysDown.add(event.code);
  hideFocusNote();
});
listen(window, "keyup", (event) => keysDown.delete(event.code));
listen(window, "blur", clearInput);
listen(document, "visibilitychange", syncVisibility);
listen(canvas, "pointerdown", () => {
  if (!canInteract()) return;
  canvas.focus({ preventScroll: true });
  hideFocusNote();
});
listen(canvas, "focus", hideFocusNote);
dPadButtons.forEach((button) => {
  listen(button, "pointerdown", (event) => {
    if (!canInteract() || event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touchPointers.set(event.pointerId, button.dataset.direction);
    button.classList.add("is-pressed");
    hideFocusNote();
  });
  const releaseDirection = (event) => {
    touchPointers.delete(event.pointerId);
    button.classList.toggle("is-pressed", [...touchPointers.values()].includes(button.dataset.direction));
  };
  listen(button, "pointerup", releaseDirection);
  listen(button, "pointercancel", releaseDirection);
  listen(button, "lostpointercapture", releaseDirection);
});
listen(dPad, "contextmenu", (event) => event.preventDefault());
const coarsePointerQuery = window.matchMedia("(any-pointer: coarse)");
function syncTouchControlVisibility() {
  const hasTouchInput = coarsePointerQuery.matches || navigator.maxTouchPoints > 0;
  const showDPad = SHOW_DPAD_ON_DESKTOP || hasTouchInput;
  root.classList.toggle("touch-controls-enabled", showDPad);
  dPad.setAttribute("aria-hidden", String(!showDPad));
  focusNote.textContent = hasTouchInput ? "Use the D-pad to explore" : "Use the D-pad or keyboard to explore";
}
if (typeof coarsePointerQuery.addEventListener === "function") {
  listen(coarsePointerQuery, "change", syncTouchControlVisibility);
} else {
  coarsePointerQuery.addListener(syncTouchControlVisibility);
  disposers.push(() => coarsePointerQuery.removeListener(syncTouchControlVisibility));
}
const visibilityObserver = new MutationObserver(syncVisibility);
visibilityObserver.observe(root, { attributes: true, attributeFilter: ["hidden"] });
disposers.push(() => visibilityObserver.disconnect());
syncTouchControlVisibility();

function hideFocusNote() {
  focusNote.classList.add("is-hidden");
}
function readMovementInput() {
  const touchDirections = new Set(touchPointers.values());
  const horizontal =
    Number(keysDown.has("ArrowRight") || keysDown.has("KeyD") || touchDirections.has("right")) -
    Number(keysDown.has("ArrowLeft") || keysDown.has("KeyA") || touchDirections.has("left"));
  const vertical =
    Number(keysDown.has("ArrowDown") || keysDown.has("KeyS") || touchDirections.has("down")) -
    Number(keysDown.has("ArrowUp") || keysDown.has("KeyW") || touchDirections.has("up"));

  if (horizontal === 0 && vertical === 0) return { x: 0, y: 0 };

  const length = Math.hypot(horizontal, vertical);
  return { x: horizontal / length, y: vertical / length };
}


function update(deltaSeconds) {
  const input = canInteract() ? readMovementInput() : { x: 0, y: 0 };
  player.moving = input.x !== 0 || input.y !== 0;
  if (player.moving) {
    if (input.x !== 0) lastHorizontalFacing = Math.sign(input.x);
    player.facingX = input.x;
    player.facingY = input.y;
    walkTime += deltaSeconds * 11;
    const distance = player.speed * deltaSeconds;
    movePlayer(input.x * distance, 0);
    movePlayer(0, input.y * distance);
  }
  updateItems(deltaSeconds);
}
function updateItems(deltaSeconds) {
  if (activePickup) {
    activePickup.elapsed += deltaSeconds;
    activePickup.item.fadeElapsed += deltaSeconds;
    if (activePickup.elapsed >= PICKUP_DURATION) {
      activePickup = null;
      // Explicit demo-only return; the real host calls finishSelection().
      if (demoMode) finishSelection();
    }
  }
  if (!canInteract()) return;
  for (const item of roomItems) {
    if (!item.armed) {
      // Same body/food geometry, with extra separation to prevent immediate re-entry.
      if (!bodyTouchesItem(item, 12)) item.armed = true;
      continue;
    }
    if (bodyTouchesItem(item, 4)) {
      selectItem(item);
      break;
    }
  }
}
// Interaction follows the visible body, independently of the wall-collision circle.
// Use stable (unbobbed) shapes; the small tolerance covers the decorative bob/float.
function bodyTouchesItem(item, tolerance) {
  const sprite = loadedAssets[petSpriteKey()];
  const hasSprite = sprite && sprite.complete && sprite.naturalWidth > 0;
  const height = hasSprite ? PET_VISUAL_HEIGHT : 64;
  const width = hasSprite ? height * sprite.naturalWidth / sprite.naturalHeight : 54;
  const groundOffset = hasSprite ? 19 : 27; // Matches supplied sprite / Canvas fallback.
  const bodyY = player.y + groundOffset - height / 2;

  const image = item.image;
  const hasImage = image && image.complete && image.naturalWidth > 0;
  const scale = hasImage ? 42 / Math.max(image.naturalWidth, image.naturalHeight) : 1;
  const itemWidth = hasImage ? image.naturalWidth * scale : 42;
  const itemHeight = hasImage ? image.naturalHeight * scale : 42;

  // Closest point on the padded item rectangle to the ellipse's centre.
  // Normalising by the ellipse radii avoids triggering at empty sprite-box corners.
  const dx = Math.max(0, Math.abs(player.x - item.x) - itemWidth / 2 - tolerance);
  const dy = Math.max(0, Math.abs(bodyY - (item.y - 6)) - itemHeight / 2 - tolerance);
  return (dx / (width / 2)) ** 2 + (dy / (height / 2)) ** 2 <= 1;
}


function selectItem(item) {
  if (!canInteract()) return;
  item.selected = true;
  item.armed = false;
  item.fadeElapsed = 0;
  selectedItem = item;
  activePickup = { item, elapsed: 0 };
  clearInput();
  syncControls();
  status.textContent = item.name + " selected";
  root.dispatchEvent(new CustomEvent("room:item-selected", {
    bubbles: true,
    detail: { activityId: activity.activityId, itemId: item.itemId },
  }));
}
function movePlayer(deltaX, deltaY) {
  const next = { x: player.x + deltaX, y: player.y + deltaY };
  const bounds = WORLD.playableBounds;

  next.x = clamp(next.x, bounds.left + player.radius, bounds.right - player.radius);
  next.y = clamp(next.y, bounds.top + player.radius, bounds.bottom - player.radius);

  if (!furniture.some((item) => circleIntersectsBox(next, player.radius, item))) {
    player.x = next.x;
    player.y = next.y;
  }
}

function circleIntersectsBox(point, radius, box) {
  const closestX = clamp(point.x, box.x, box.x + box.width);
  const closestY = clamp(point.y, box.y, box.y + box.height);
  const offsetX = point.x - closestX;
  const offsetY = point.y - closestY;
  return offsetX * offsetX + offsetY * offsetY < radius * radius;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}


// Kitchen placeholder art uses integer rectangles and stepped circles.
// New Room.setAssets keys: stoveCounter, refrigerator, sinkCounter,
// kitchenIsland, plant. Legacy furniture keys are accepted as fallbacks.
const kitchen = {
  ink: "#594437",
  darkWood: "#805039",
  wood: "#b9784b",
  woodLight: "#d9a36c",
  cream: "#fff0cd",
  counter: "#eddbb4",
  counterEdge: "#c7af86",
  sage: "#8ca889",
  sageLight: "#bfd0a9",
  steel: "#789496",
  steelLight: "#c1d4cd",
  terracotta: "#bc6850",
  leaf: "#59794f",
  leafLight: "#91ad65",
};

function kitchenRect(x, y, width, height, color) {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function kitchenPanel(x, y, width, height, color, border = 3) {
  kitchenRect(x, y, width, height, kitchen.ink);
  kitchenRect(x + border, y + border, width - border * 2, height - border * 2, color);
}

// Rasterised circles keep burners, crockery and leaves in the same pixel style.
function kitchenDisc(x, y, radius, color) {
  const step = 3;
  for (let row = -radius; row < radius; row += step) {
    const half = Math.floor(Math.sqrt(Math.max(0, radius * radius - (row + step / 2) ** 2)) / step) * step;
    if (half > 0) kitchenRect(x - half, y + row, half * 2, step, color);
  }
}

function drawRoom() {
  if (USE_LEGACY_KITCHEN) {
    drawLegacyKitchenRoom();
    return;
  }
  // The supplied PNG is mostly transparent; the same base fills the side margins.
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, WORLD.width, WORLD.height);
  const image = loadedAssets.roomBackground;
  if (image && image.complete && image.naturalWidth > 0) {
    const scale = Math.min(WORLD.width / image.naturalWidth, WORLD.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (WORLD.width - width) / 2, (WORLD.height - height) / 2, width, height);
  }
  // A missing background leaves the pale base; no invisible kitchen is introduced.
  context.restore();
}

function drawLegacyKitchenRoom() {
  context.clearRect(0, 0, WORLD.width, WORLD.height);
  if (drawAsset("roomBackground", 0, 0, WORLD.width, WORLD.height)) return;

  context.save();
  kitchenRect(0, 0, 960, 620, "#ead6ac");
  kitchenRect(54, 126, 852, 442, "#dfc59a");

  // Subtle, staggered wood grain: a continuous floor, not a gameplay grid.
  for (let row = 0; row < 7; row += 1) {
    const y = 126 + row * 64;
    kitchenRect(54, y, 852, 2, "#d3b88d");
    for (let board = 0; board < 4; board += 1) {
      const x = 75 + board * 228 + (row % 2) * 55;
      if (x + 88 < 904) {
        kitchenRect(x, y + 22, 65, 2, "#d8be94");
        kitchenRect(x + 28, y + 28, 45, 2, "#e7cfa5");
      }
    }
  }
  // Dark trim, bright inner lip and shallow wall shadows, all viewed head-on.
  kitchenRect(20, 16, 920, 110, kitchen.darkWood);
  kitchenRect(28, 24, 904, 94, "#f3e3be");
  kitchenRect(28, 108, 904, 10, "#d0b38b");
  kitchenRect(54, 126, 852, 8, "#c8aa82");
  kitchenRect(20, 118, 34, 478, kitchen.ink);
  kitchenRect(906, 118, 34, 478, kitchen.ink);
  kitchenRect(20, 568, 920, 28, kitchen.ink);
  kitchenRect(26, 118, 20, 460, kitchen.woodLight);
  kitchenRect(914, 118, 20, 460, kitchen.woodLight);
  kitchenRect(28, 576, 904, 12, kitchen.woodLight);
  kitchenRect(44, 126, 6, 442, kitchen.cream);
  kitchenRect(910, 126, 6, 442, kitchen.cream);
  kitchenRect(54, 570, 852, 4, kitchen.cream);

  drawKitchenWindow();
  drawKitchenWallStorage();

  // A flat woven mat below the sink: decoration only, no extra obstacle.
  kitchenRect(700, 242, 176, 34, "#c8aa82");
  kitchenRect(697, 239, 176, 32, kitchen.terracotta);
  kitchenRect(703, 244, 164, 3, "#e9b48a");
  kitchenRect(703, 263, 164, 3, "#e9b48a");
  for (let x = 701; x < 871; x += 10) {
    kitchenRect(x, 235, 3, 4, "#d9ad82");
    kitchenRect(x, 271, 3, 4, "#d9ad82");
  }
  context.restore();
}

function drawKitchenWindow() {
  kitchenPanel(363, 28, 216, 78, kitchen.woodLight, 4);
  kitchenRect(372, 36, 198, 58, "#accbc4");
  kitchenRect(372, 73, 198, 21, "#89a777");
  kitchenRect(390, 64, 38, 30, "#89a777");
  kitchenRect(430, 80, 66, 14, "#638565");
  kitchenDisc(539, 51, 10, "#f5d687");
  kitchenRect(466, 36, 6, 58, kitchen.cream);
  kitchenRect(372, 60, 198, 4, kitchen.cream);
  kitchenRect(356, 98, 230, 8, kitchen.darkWood);
  kitchenRect(356, 98, 230, 3, kitchen.woodLight);
  // Short curtains hug the frame without hiding the view.
  kitchenRect(370, 35, 19, 25, "#e0a077");
  kitchenRect(551, 35, 19, 25, "#e0a077");
  kitchenRect(375, 35, 3, 20, "#edbb90");
  kitchenRect(561, 35, 3, 20, "#edbb90");
}

function drawKitchenWallStorage() {
  // Closed cabinets over the cooking counter.
  kitchenPanel(72, 32, 214, 67, kitchen.darkWood);
  for (let i = 0; i < 3; i += 1) {
    const x = 79 + i * 68;
    kitchenPanel(x, 38, 62, 54, kitchen.wood);
    kitchenRect(x + 7, 44, 48, 3, kitchen.woodLight);
    kitchenRect(x + 8, 49, 3, 29, "#c88c56");
    kitchenRect(x + 46, 64, 5, 12, kitchen.ink);
    kitchenRect(x + 47, 65, 2, 8, kitchen.cream);
  }
  // Open shelves above the sink, with plates and small jars.
  kitchenPanel(695, 31, 184, 70, kitchen.darkWood, 4);
  kitchenRect(704, 38, 166, 22, "#9c6b49");
  kitchenRect(704, 67, 166, 24, "#9c6b49");
  kitchenRect(700, 60, 174, 5, kitchen.woodLight);
  for (let i = 0; i < 4; i += 1) {
    kitchenRect(713 + i * 9, 70, 6, 19, kitchen.cream);
    kitchenRect(714 + i * 9, 73, 2, 13, kitchen.counterEdge);
  }
  [0, 1, 2].forEach((index) => {
    const x = 711 + index * 33;
    kitchenPanel(x, 43, 21, 16, [kitchen.sage, "#cda06d", kitchen.terracotta][index], 2);
    kitchenRect(x - 1, 40, 23, 4, kitchen.cream);
  });
  kitchenPanel(801, 72, 20, 17, kitchen.steelLight, 2);
  kitchenPanel(825, 72, 20, 17, kitchen.sageLight, 2);
  // A small utensil rail in the remaining wall space.
  kitchenRect(605, 43, 55, 4, kitchen.darkWood);
  for (let i = 0; i < 3; i += 1) {
    const x = 615 + i * 17;
    kitchenRect(x, 47, 3, 21, kitchen.darkWood);
    kitchenDisc(x + 1, 75, 7, i === 1 ? kitchen.steel : kitchen.wood);
    kitchenRect(x, 69, 3, 9, kitchen.woodLight);
  }
}

// A 14px front fascia gives depth without an isometric/slanted footprint.
// Tops occupy the same bounds as the former furniture, lifted only visually.
function drawKitchenCounterBase(item, topColor) {
  const top = item.y - 14;
  kitchenRect(item.x + 5, item.y + 7, item.width, item.height, "rgba(81, 57, 39, .16)");
  kitchenPanel(item.x, top, item.width, item.height + 14, kitchen.darkWood);
  kitchenRect(item.x + 4, item.y + item.height - 13, item.width - 8, 10, kitchen.wood);
  for (let x = item.x + 14; x < item.x + item.width - 12; x += 56) {
    kitchenRect(x, item.y + item.height - 10, 20, 3, kitchen.ink);
    kitchenRect(x, item.y + item.height - 11, 20, 1, kitchen.woodLight);
  }
  kitchenPanel(item.x, top, item.width, item.height, topColor);
  kitchenRect(item.x + 4, top + 4, item.width - 8, 3, kitchen.cream);
}

function drawStoveCounter(item) {
  if (drawAsset("stoveCounter", item.x, item.y - 14, item.width, item.height + 14) ||
      drawAsset("bookcase", item.x, item.y - 14, item.width, item.height + 14)) return;
  context.save();
  drawKitchenCounterBase(item, kitchen.counter);
  const x = item.x;
  const y = item.y - 14;
  // Dark hob seen from directly above, with four cast-iron burners.
  kitchenPanel(x + 6, y + 7, 91, 50, "#a9b2a3", 3);
  for (const [dx, dy] of [[26, 20], [73, 20], [26, 44], [73, 44]]) {
    kitchenDisc(x + dx, y + dy, 10, kitchen.ink);
    kitchenDisc(x + dx, y + dy, 5, "#8f9285");
    kitchenRect(x + dx - 12, y + dy - 1, 24, 2, kitchen.ink);
  }
  // A lidded terracotta pot and a handle sit on the rear burner.
  kitchenDisc(x + 26, y + 20, 12, kitchen.terracotta);
  kitchenDisc(x + 26, y + 20, 8, "#d69164");
  kitchenRect(x + 23, y + 17, 6, 4, kitchen.ink);
  kitchenRect(x + 37, y + 18, 10, 4, kitchen.ink);
  // Oven face is the shallow front edge, not a tall front-facing appliance.
  kitchenPanel(x + 8, y + item.height + 1, 84, 10, "#403e37", 2);
  kitchenRect(x + 19, y + item.height + 3, 60, 2, kitchen.steelLight);
  // Worktop cutting board, folded cloth, and small canister.
  kitchenPanel(x + 118, y + 13, 51, 36, kitchen.woodLight, 2);
  kitchenRect(x + 124, y + 19, 3, 23, "#c38e58");
  kitchenRect(x + 134, y + 20, 24, 3, "#edc28a");
  kitchenRect(x + 173, y + 33, 33, 21, kitchen.sageLight);
  kitchenRect(x + 180, y + 33, 3, 21, kitchen.sage);
  kitchenDisc(x + 191, y + 18, 10, kitchen.ink);
  kitchenDisc(x + 191, y + 18, 7, kitchen.cream);
  context.restore();
}

function drawRefrigerator(item) {
  if (drawAsset("refrigerator", item.x, item.y - 14, item.width, item.height + 14) ||
      drawAsset("sofa", item.x, item.y - 14, item.width, item.height + 14)) return;
  context.save();
  const x = item.x, y = item.y - 14;
  drawKitchenCounterBase(item, kitchen.woodLight);
  // Refrigerator top and shallow door edge alongside a compact pantry counter.
  kitchenPanel(x, y, 85, item.height + 14, kitchen.sage, 3);
  kitchenPanel(x + 4, y + 4, 77, item.height - 4, kitchen.sageLight, 3);
  kitchenRect(x + 10, y + 10, 63, 4, "#e4e8c7");
  kitchenRect(x + 12, y + 16, 4, 56, "#d1deba");
  kitchenRect(x + 6, y + item.height - 2, 73, 3, kitchen.ink);
  kitchenRect(x + 15, y + item.height + 3, 44, 4, kitchen.cream);
  kitchenRect(x + 66, y + 25, 5, 24, kitchen.darkWood);
  // Pantry's open top holds a bread bin and a small crock.
  kitchenPanel(x + 103, y + 14, 77, 42, kitchen.cream, 3);
  kitchenRect(x + 108, y + 19, 67, 4, kitchen.counterEdge);
  for (let row = 0; row < 4; row += 1) {
    kitchenRect(x + 109, y + 27 + row * 6, 64, 2, kitchen.counterEdge);
  }
  kitchenRect(x + 128, y + 42, 22, 4, kitchen.darkWood);
  kitchenDisc(x + 121, y + 76, 13, kitchen.ink);
  kitchenDisc(x + 121, y + 76, 9, kitchen.terracotta);
  kitchenDisc(x + 121, y + 76, 5, "#d99b6d");
  kitchenRect(x + 145, y + 66, 36, 22, kitchen.cream);
  kitchenRect(x + 152, y + 66, 3, 22, kitchen.terracotta);
  context.restore();
}

function drawSinkCounter(item) {
  if (drawAsset("sinkCounter", item.x, item.y - 14, item.width, item.height + 14) ||
      drawAsset("desk", item.x, item.y - 14, item.width, item.height + 14)) return;
  context.save();
  drawKitchenCounterBase(item, kitchen.counter);
  const x = item.x, y = item.y - 14;
  kitchenPanel(x + 19, y + 14, 94, 49, kitchen.steelLight, 3);
  kitchenPanel(x + 26, y + 21, 80, 35, kitchen.steel, 3);
  kitchenRect(x + 31, y + 25, 70, 5, "#93b6b0");
  kitchenRect(x + 31, y + 46, 70, 5, "#698581");
  kitchenDisc(x + 64, y + 40, 6, kitchen.ink);
  kitchenDisc(x + 64, y + 40, 3, kitchen.steelLight);
  // Square swan-neck tap.
  kitchenRect(x + 58, y + 4, 7, 24, kitchen.ink);
  kitchenRect(x + 60, y + 4, 21, 6, kitchen.steelLight);
  kitchenRect(x + 76, y + 7, 6, 14, kitchen.ink);
  kitchenRect(x + 77, y + 7, 3, 11, kitchen.steelLight);
  kitchenRect(x + 47, y + 8, 7, 5, kitchen.steel);
  kitchenRect(x + 88, y + 8, 7, 5, kitchen.steel);
  // Drain rack and stacked dishes on the other side.
  kitchenPanel(x + 125, y + 19, 48, 43, kitchen.sageLight, 2);
  for (let i = 0; i < 4; i += 1) {
    kitchenRect(x + 130 + i * 10, y + 23, 2, 35, kitchen.sage);
  }
  kitchenDisc(x + 149, y + 40, 15, kitchen.ink);
  kitchenDisc(x + 149, y + 40, 12, kitchen.cream);
  kitchenDisc(x + 149, y + 40, 8, kitchen.counterEdge);
  kitchenDisc(x + 149, y + 40, 6, kitchen.cream);
  context.restore();
}

function drawKitchenIsland(item) {
  if (drawAsset("kitchenIsland", item.x, item.y - 14, item.width, item.height + 14) ||
      drawAsset("roundTable", item.x, item.y - 14, item.width, item.height + 14)) return;
  context.save();
  drawKitchenCounterBase(item, kitchen.woodLight);
  const x = item.x, y = item.y - 14;
  kitchenRect(x + 10, y + 12, item.width - 20, 3, "#eac18b");
  kitchenRect(x + 10, y + 64, item.width - 20, 2, "#c88e57");
  // Small prep board with a rolling pin, bowl, and folded tea towel.
  kitchenPanel(x + 13, y + 20, 69, 41, kitchen.counter, 2);
  kitchenRect(x + 23, y + 24, 3, 30, "#e2c89d");
  kitchenRect(x + 20, y + 37, 58, 5, kitchen.darkWood);
  kitchenPanel(x + 29, y + 31, 38, 16, kitchen.woodLight, 2);
  kitchenRect(x + 33, y + 34, 30, 3, kitchen.cream);
  kitchenDisc(x + 113, y + 35, 20, kitchen.ink);
  kitchenDisc(x + 113, y + 35, 17, kitchen.cream);
  kitchenDisc(x + 113, y + 35, 12, kitchen.counterEdge);
  kitchenDisc(x + 113, y + 35, 9, "#efdfbc");
  kitchenRect(x + 96, y + 58, 33, 13, kitchen.sageLight);
  kitchenRect(x + 102, y + 58, 3, 13, kitchen.sage);
  context.restore();
}

function drawHerbCabinet(item) {
  if (drawAsset("plant", item.x, item.y - 14, item.width, item.height + 14)) return;
  context.save();
  drawKitchenCounterBase(item, kitchen.woodLight);
  const x = item.x, y = item.y - 14;
  // Overhead terracotta herb pot: stepped leaves keep it distinctly decorative.
  kitchenDisc(x + 39, y + 37, 28, kitchen.darkWood);
  kitchenDisc(x + 39, y + 37, 24, kitchen.terracotta);
  kitchenDisc(x + 39, y + 37, 19, "#67513a");
  for (const [dx, dy, r] of [[-13, -9, 13], [6, -17, 13], [17, 1, 13], [3, 13, 13], [-12, 10, 11]]) {
    kitchenDisc(x + 39 + dx, y + 37 + dy, r, kitchen.leaf);
    kitchenDisc(x + 37 + dx, y + 34 + dy, r - 5, kitchen.leafLight);
  }
  kitchenRect(x + 34, y + 35, 9, 5, kitchen.leafLight);
  context.restore();
}

function drawCollectible(item) {
  const opacity = item.selected
    ? 1 - clamp(item.fadeElapsed / ITEM_FADE_DURATION, 0, 1)
    : 1;

  if (opacity <= 0) return;

  const floatOffset = Math.sin(performance.now() / 360 + item.x) * 2;
  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = "rgba(68, 58, 60, .14)";
  context.beginPath();
  context.ellipse(item.x, item.y + 9, 17, 7, 0, 0, Math.PI * 2);
  context.fill();
  drawCollectibleIcon(item, item.x, item.y - 6 + floatOffset, 42);
  context.restore();
}

function drawCollectibleIcon(item, centerX, centerY, size) {
  if (drawItemImage(item.image, centerX, centerY, size)) return;

  const placeholderDrawings = {
    chicken: drawChickenIcon,
    carrot: drawCarrotIcon,
    rice: drawRiceIcon,
  };
  const drawPlaceholder = placeholderDrawings[item.icon];
  if (drawPlaceholder) drawPlaceholder(centerX, centerY, size);
  else drawStar(centerX, centerY, 5, size / 2, size / 4, palette.coral);
}

// Vector placeholders share a monochrome ink/paper style at both display sizes.
// drawCollectibleIcon() still prefers Person 5's item.image when available.
function drawChickenIcon(centerX, centerY, size) {
  const scale = size / 64;
  context.save();
  context.translate(centerX, centerY);
  context.rotate(-0.42);
  context.scale(scale, scale);

  context.strokeStyle = "#292929";
  context.fillStyle = "#ffffff";
  context.lineWidth = 3.5;
  context.lineCap = "round";
  context.lineJoin = "round";

  // One continuous bone outline with two rounded ends.
  context.beginPath();
  context.moveTo(2, -7);
  context.lineTo(19, 2);
  context.bezierCurveTo(27, -2, 32, 4, 28, 10);
  context.bezierCurveTo(37, 15, 30, 25, 23, 20);
  context.quadraticCurveTo(20, 18, 20, 14);
  context.lineTo(3, 5);
  context.closePath();
  context.fill();
  context.stroke();

  // Slightly uneven drumstick silhouette, like a colouring-book drawing.
  context.beginPath();
  context.moveTo(10, -18);
  context.bezierCurveTo(4, -30, -11, -32, -18, -25);
  context.bezierCurveTo(-29, -27, -35, -15, -29, -9);
  context.bezierCurveTo(-32, 1, -20, 8, -12, 4);
  context.quadraticCurveTo(-3, 9, 6, 1);
  context.quadraticCurveTo(17, -4, 10, -18);
  context.closePath();
  context.fill();
  context.stroke();

  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(-20, -13);
  context.quadraticCurveTo(-22, -9, -19, -6);
  context.moveTo(-10, -22);
  context.quadraticCurveTo(-6, -22, -4, -19);
  context.moveTo(-1, -8);
  context.quadraticCurveTo(0, -4, -4, -3);
  context.stroke();
  context.restore();
}

function drawCarrotIcon(centerX, centerY, size) {
  const scale = size / 64;
  context.save();
  context.translate(centerX, centerY);
  context.rotate(0.58);
  context.scale(scale, scale);

  context.strokeStyle = "#292929";
  context.fillStyle = "#ffffff";
  context.lineWidth = 3.5;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(-11, -20);
  context.quadraticCurveTo(14, -18, 13, -5);
  context.quadraticCurveTo(3, 17, -5, 30);
  context.quadraticCurveTo(-8, 10, -15, -9);
  context.closePath();
  context.fill();
  context.stroke();

  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(-7, -6);
  context.quadraticCurveTo(-2, -6, 3, -3);
  context.moveTo(-4, 5);
  context.quadraticCurveTo(0, 5, 4, 7);
  context.stroke();

  // Closed, uncoloured leaves retain the carrot's recognisable leafy top.
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(-4, -20);
  context.quadraticCurveTo(-18, -21, -19, -35);
  context.quadraticCurveTo(-6, -32, -4, -20);
  context.closePath();
  context.moveTo(1, -20);
  context.quadraticCurveTo(-4, -34, 9, -39);
  context.quadraticCurveTo(14, -26, 1, -20);
  context.closePath();
  context.moveTo(6, -18);
  context.quadraticCurveTo(9, -32, 22, -27);
  context.quadraticCurveTo(19, -16, 6, -18);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function drawRiceIcon(centerX, centerY, size) {
  const scale = size / 64;
  context.save();
  context.translate(centerX, centerY);
  context.scale(scale, scale);

  context.fillStyle = "#ffffff";
  context.strokeStyle = "#292929";
  context.lineWidth = 3.5;
  context.lineJoin = "round";
  context.lineCap = "round";

  // A single scalloped rice mound avoids overlapping outlines between grains.
  context.beginPath();
  context.moveTo(-30, -5);
  context.quadraticCurveTo(-33, -17, -22, -18);
  context.quadraticCurveTo(-18, -28, -8, -23);
  context.quadraticCurveTo(1, -30, 9, -22);
  context.quadraticCurveTo(20, -25, 24, -16);
  context.quadraticCurveTo(33, -15, 30, -5);
  context.closePath();
  context.fill();
  context.stroke();

  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-18, -12);
  context.quadraticCurveTo(-16, -15, -13, -15);
  context.moveTo(-3, -21);
  context.quadraticCurveTo(-1, -19, -1, -17);
  context.moveTo(11, -13);
  context.quadraticCurveTo(14, -16, 17, -15);
  context.stroke();

  context.lineWidth = 3.5;
  context.beginPath();
  context.moveTo(-31, -5);
  context.quadraticCurveTo(-26, 26, 0, 29);
  context.quadraticCurveTo(26, 26, 31, -5);
  context.closePath();
  context.fill();
  context.stroke();
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(0, 1, 18, 0.2, Math.PI - 0.2);
  context.stroke();
  context.restore();
}

function drawPickupOverlay() {
  if (!activePickup) return;

  const progress = clamp(activePickup.elapsed / PICKUP_DURATION, 0, 1);
  const fadeIn = clamp(progress / 0.12, 0, 1);
  const fadeOut = clamp((1 - progress) / 0.22, 0, 1);
  const opacity = Math.min(fadeIn, fadeOut);
  const entrance = easeOutBack(clamp(progress / 0.28, 0, 1));
  const scale = 0.64 + entrance * 0.36;
  const floatOffset = -Math.sin(progress * Math.PI) * 10;
  const centerX = WORLD.width / 2;
  const centerY = WORLD.height / 2 - 14 + floatOffset;

  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = "rgba(48, 42, 48, .14)";
  context.fillRect(0, 0, WORLD.width, WORLD.height);

  context.translate(centerX, centerY);
  context.scale(scale, scale);
  context.translate(-centerX, -centerY);
  context.shadowColor = "rgba(255, 244, 185, .95)";
  context.shadowBlur = 34;
  context.fillStyle = "rgba(255, 249, 215, .82)";
  context.beginPath();
  context.arc(centerX, centerY, 76, 0, Math.PI * 2);
  context.fill();
  context.shadowColor = "rgba(70, 50, 45, .34)";
  context.shadowBlur = 15;
  context.shadowOffsetY = 8;
  drawCollectibleIcon(activePickup.item, centerX, centerY - 4, 126);
  context.restore();

  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = "#fffdf7";
  context.strokeStyle = "rgba(81, 70, 83, .18)";
  context.lineWidth = 2;
  context.font = '700 19px Inter, ui-rounded, "Avenir Next", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  const labelWidth = context.measureText(activePickup.item.name).width + 36;
  roundedRect(centerX - labelWidth / 2, centerY + 88, labelWidth, 38, 19);
  context.fill();
  context.stroke();
  context.fillStyle = palette.outline;
  context.fillText(activePickup.item.name, centerX, centerY + 107);
  context.restore();
}

function easeOutBack(value) {
  const overshoot = 1.70158;
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

// These are single directional poses, not an animation-frame sequence.
function petSpriteKey() {
  if (!player.moving) return "mascot";
  const side = lastHorizontalFacing < 0 ? "Left" : "Right";
  if (player.facingY < 0) return "mascot" + side + "Up";
  if (player.facingY > 0) return "mascot" + side + "Down";
  return "mascot" + side;
}

function drawPetSprite(groundY) {
  const image = loadedAssets[petSpriteKey()];
  if (!image || !image.complete || image.naturalWidth === 0) return false;
  const width = PET_VISUAL_HEIGHT * image.naturalWidth / image.naturalHeight;
  context.drawImage(image, -width / 2, groundY - PET_VISUAL_HEIGHT, width, PET_VISUAL_HEIGHT);
  return true;
}

function drawPlayer() {
  const bob = player.moving ? Math.sin(walkTime) * 2 : Math.sin(performance.now() / 420) * 1.2;
  const step = player.moving ? Math.sin(walkTime) * 3 : 0;

  context.save();
  context.translate(player.x, player.y);

  // Ground shadow / collision footprint.
  context.fillStyle = "rgba(61, 65, 59, .18)";
  context.beginPath();
  context.ellipse(0, 16, 24, 10, 0, 0, Math.PI * 2);
  context.fill();

  // Same ground anchor and visual height for every pose; collision stays independent.
  if (drawPetSprite(19 + bob)) {
    context.restore();
    return;
  }

  // Original Canvas pet remains the loading/error fallback.
  context.translate(0, bob - 17);
  context.fillStyle = "#9f7259";
  roundedRect(-18, 31 + Math.max(0, step), 13, 10, 5);
  context.fill();
  roundedRect(5, 31 + Math.max(0, -step), 13, 10, 5);
  context.fill();

  // Rounded mascot body.
  context.fillStyle = "#f5a35f";
  context.strokeStyle = palette.outline;
  context.lineWidth = 4;
  roundedRect(-27, -2, 54, 41, 19);
  context.fill();
  context.stroke();

  // Ears.
  context.beginPath();
  context.moveTo(-21, 2);
  context.lineTo(-18, -18);
  context.lineTo(-4, -5);
  context.moveTo(21, 2);
  context.lineTo(18, -18);
  context.lineTo(4, -5);
  context.fill();
  context.stroke();

  context.fillStyle = "#f8c38a";
  context.beginPath();
  context.moveTo(-17, -4);
  context.lineTo(-16, -11);
  context.lineTo(-10, -5);
  context.moveTo(17, -4);
  context.lineTo(16, -11);
  context.lineTo(10, -5);
  context.fill();

  // Face follows the movement direction a little.
  const lookX = player.facingX * 2;
  const lookY = player.facingY * 1.3;
  context.fillStyle = palette.outline;
  context.beginPath();
  context.arc(-9 + lookX, 10 + lookY, 2.6, 0, Math.PI * 2);
  context.arc(9 + lookX, 10 + lookY, 2.6, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = palette.outline;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-3 + lookX, 18 + lookY);
  context.quadraticCurveTo(0 + lookX, 21 + lookY, 3 + lookX, 18 + lookY);
  context.stroke();

  // Neckerchief adds a mascot-like silhouette.
  context.fillStyle = "#78aaa4";
  context.beginPath();
  context.moveTo(-20, 29);
  context.quadraticCurveTo(0, 38, 20, 29);
  context.lineTo(16, 39);
  context.quadraticCurveTo(0, 44, -16, 39);
  context.closePath();
  context.fill();

  context.restore();
}

function drawShadow(x, y, width, height, radius) {
  context.fillStyle = "rgba(63, 57, 59, .14)";
  roundedRect(x + 4, y + 7, width, height, radius);
  context.fill();
}

function drawAsset(name, x, y, width, height) {
  const image = loadedAssets[name];
  if (!image || !image.complete || image.naturalWidth === 0) return false;
  context.drawImage(image, x, y, width, height);
  return true;
}

function drawCenteredAsset(name, centerX, centerY, size) {
  return drawAsset(name, centerX - size / 2, centerY - size / 2, size, size);
}

function roundedRect(x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
}

function drawStar(centerX, centerY, points, outerRadius, innerRadius, color) {
  context.fillStyle = color;
  context.beginPath();
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
}

function draw() {
  drawRoom();

  // Basic depth sorting lets the mascot pass visually in front of or behind furniture.
  const drawableObjects = furniture.map((item) => ({
    depth: item.y + item.height,
    render: () => item.draw(item),
  }));
  roomItems.forEach((item) => {
    const stillVisible = !item.selected || item.fadeElapsed < ITEM_FADE_DURATION;
    if (stillVisible) drawableObjects.push({ depth: item.y, render: () => drawCollectible(item) });
  });
  drawableObjects.push({ depth: player.y + player.radius, render: drawPlayer });
  drawableObjects.sort((a, b) => a.depth - b.depth);
  drawableObjects.forEach((object) => object.render());
  drawPickupOverlay();
}


function drawItemImage(image, centerX, centerY, size) {
  if (!image || !image.complete || image.naturalWidth === 0) return false;
  const scale = size / Math.max(image.naturalWidth, image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, centerX - width / 2, centerY - height / 2, width, height);
  return true;
}
function gameLoop(currentTime) {
  frameId = null;
  if (!visible()) {
    clearInput();
    syncControls();
    return;
  }
  const deltaSeconds = Math.min((currentTime - lastFrameTime) / 1000, 0.05);
  lastFrameTime = currentTime;
  update(deltaSeconds);
  draw();
  // Host event listeners may hide or destroy the room during selection.
  if (visible() && frameId === null) frameId = requestAnimationFrame(gameLoop);
}
window.Room = Object.freeze({
  loadActivity, show, hide, lock, unlock, finishSelection, reset, setAssets, getState, destroy,
});
if (!USE_LEGACY_KITCHEN) setAssets(PERSON5_ASSETS);
syncControls();
if (demoMode) {
  loadActivity(MOCK_ACTIVITY);
  show();
}
})();
