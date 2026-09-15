# DECO2850-LowFidelityPrototype

Person 1 implementation: activity data, one shared server-side adventure, and the
robot screen. The existing Node.js / Express / Socket.IO / vanilla JavaScript
stack is unchanged. The robot uses Person 5's existing PNG artwork. Room,
colouring, language selection and glossary implementation remain with their
teammate owners.

## Run locally

Use Node.js 22 or newer (the tests use Node's built-in WebSocket).

```sh
npm ci
npm start
```

- Robot: <http://localhost:3000/pet.html>
- Mobile: <http://localhost:3000/mobile.html>
- For a phone/iPad on the same Wi-Fi, replace `localhost` with the computer's LAN IP.
- Optional: `PORT=3001 npm start` to change the port.
- Run automated checks with `npm test`.

The current mobile page includes the team's language selection, room/movement,
glossary and Exit Activity UI. Colouring/submission/progression integration is
still pending. The console checks below exercise Person 1's full server/robot
flow while that work continues.

## Person 1 files

| File | Purpose |
| --- | --- |
| `data/activities.js` | Separate Indonesian and Chinese arrays, each with carrot, chair and butterfly missions. Instructions remain English; labels and vocabulary are translated. |
| `server.js` | Validates incoming events, owns shared game state and answer checks, broadcasts updates, resets, and restores state to connecting screens. |
| `public/js/robot.js` | English robot text, Person 5 reaction/asset mapping, vocabulary pronunciation, gentle feedback sounds, and reset/completion/disconnection handling. |
| `public/pet.html` | Existing robot elements, with accessible status text and a vocabulary replay button. |
| `public/css/robot.css` | Readable robot layout, consistent pixel-art image size, subtle reaction animations, reduced-motion support and touch-sized replay button. |
| `package.json` | `npm start`, `npm test`, and the correct server entry point; no added dependencies. |
| `test/game.test.js` | Real Socket.IO integration checks and activity-data validation. |
| `test/robot.test.js` | Robot DOM/event behavior, real asset paths, and simulated browser speech/audio/asset failures. |

## Three missions in both languages

The English instruction, item IDs and success reaction are the same in both
activity sets. Only the option labels and vocabulary words change.

| Mission | English instruction | Correct item ID | Success reaction |
| --- | --- | --- | --- |
| 1 — eating | I'm hungry! Find the carrot. | `carrot` | `eating` |
| 2 — sitting | I want to sit! Find the chair. | `chair` | `sitting` |
| 3 — looking | Look around! Find the butterfly. | `butterfly` | `looking` |

Indonesian:

| Mission | Three options: item ID → label | Vocabulary reward: word → English meaning |
| --- | --- | --- |
| 1 | `carrot` → wortel; `chicken` → ayam; `rice` → nasi | wortel → carrot |
| 2 | `chair` → kursi; `book` → buku; `table` → meja | kursi → chair |
| 3 | `butterfly` → kupu-kupu; `tree` → pohon; `bird` → burung | kupu-kupu → butterfly |

Chinese (simplified characters, Mandarin pronunciation):

| Mission | Three options: item ID → label | Vocabulary reward: word → English meaning |
| --- | --- | --- |
| 1 | `carrot` → 胡萝卜; `chicken` → 鸡肉; `rice` → 米饭 | 胡萝卜 → carrot |
| 2 | `chair` → 椅子; `book` → 书; `table` → 桌子 | 椅子 → chair |
| 3 | `butterfly` → 蝴蝶; `tree` → 树; `bird` → 鸟 | 蝴蝶 → butterfly |

## Socket.IO contract

All screens connect to the same server using the existing
`/socket.io/socket.io.js` script. The robot uses `io()`; mobile modules share
`window.mobileSocket`, created in `events.js` and connected in `mobile.js`.
There is one shared adventure, so a valid start or exit affects every device.

In the shapes below, `Language` means `"indonesian" | "chinese"`. Activity indices
are **zero-based**. Events marked “no payload” are emitted with no second argument.

| Event | Sender → receiver | Exact payload shape |
| --- | --- | --- |
| `start-game` | Person 4 → server | `{ language: Language }` |
| `submit-item` | Person 3 → server | `{ itemId: string }` |
| `next-activity` | Person 3 → server | No payload |
| `exit-game` | Person 4 → server | No payload |
| `current-activity` | Server → robot and mobile clients | `{ id: string, instruction: string, options: Array<{ itemId: string, label: string }>, language: Language, activityIndex: number }` |
| `answer-result` | Server → robot and mobile clients (especially Person 3) | `{ correct: boolean, reaction: "confused" \| "eating" \| "sitting" \| "looking" \| "happy" }` |
| `word-learned` | Server → robot and mobile clients (especially Person 4) | `{ itemId: string, word: string, meaning: string, language: Language }` |
| `adventure-complete` | Server → robot and mobile clients | `{ language: Language, completedActivities: number }` |
| `game-reset` | Server → robot and mobile clients | No payload |

Event names and payload fields are unchanged. The three current missions emit
`eating`, `sitting` and `looking` on success; `happy` remains supported by the robot
and is used for completion. Person 3 only needs `result.correct` to handle results.

`current-activity.options` always has three entries. It contains **no
`correctItemId`, vocabulary reward, or success reaction**. Only the server imports
the activity data. The `data` directory is not publicly served.

A wrong option emits only `{ correct: false, reaction: "confused" }`; the child can
retry. A correct option marks the activity complete, emits `answer-result`, then
`word-learned`. All further submissions for that completed activity are ignored.
Only `next-activity` advances, and only after a correct answer. After the last
mission's Next request, `adventure-complete` is emitted once and the game becomes
inactive. `completedActivities` is currently `3`.

Invalid languages/payloads, item IDs outside the current options, submissions
while inactive, and premature/repeated Next requests are silently ignored. They
do not change state or emit feedback. No acknowledgement or custom error event is
required by this small interface.

On connection/reconnection, **only the connecting socket** receives:

- `game-reset` if no game has started or the child exited;
- `current-activity` during an active game, followed by a successful
  `answer-result` if that mission was already completed;
- `adventure-complete` if the adventure has ended.

Connecting does not start a game, reward words again, or disturb other screens.
An explicit `exit-game` resets language to `null`, activity index to `0`, and both
playing/completed flags to `false`, then broadcasts `game-reset`.

## Teammate integration

### Person 2: room and movement

Listen for `current-activity`. Use `activity.options` to place the three objects,
look up Person 5's assets by `itemId`, and display each translated `label`. The
stable IDs are `carrot`, `chicken`, `rice`, `chair`, `book`, `table`, `butterfly`,
`tree`, and `bird` in both languages.
Reset your room/pet positions for each new activity and pass the selected `itemId`
to Person 3. Handle `game-reset` and `adventure-complete` in your room state.

The existing mobile adapter already loads `activity.options` into `Room`.
Its `ROOM_ITEM_ASSETS` mapping currently contains only `book`. Person 2/mobile
integration still needs to map the remaining IDs to the supplied object images
in `eat_objects`, `sit_objects` and `see_objects`. This Person 1 update does not
change object placement, movement, collisions, selection or that mapping.

### Person 3: colouring and result controls

The existing room emits a bubbling DOM event named `room:item-selected` with
`event.detail = { activityId, itemId }`. Person 3 should listen on `document` or
`#room-screen`, open colouring for that `itemId`, and send only after the child
finishes colouring and swipes the completed object:

```js
window.mobileSocket.emit("submit-item", { itemId });
```

Reaching/selecting a room item does not submit it or check correctness.

Listen for `answer-result`. On `correct: false`, close/reset colouring and return
to the room with `Room.finishSelection()` (no arguments). It clears the selected
item without clearing an independent glossary lock; it also supports cancelling
colouring. On `correct: true`, show your Mission Complete / Next Mission controls.
Keep selection stopped until the next activity loads. Your Next button sends
`window.mobileSocket.emit("next-activity")` with no payload. Wait for
`current-activity` or `adventure-complete`; do not advance locally. A reconnect can
also deliver `answer-result` to restore a completed mission, so make that UI update
safe to repeat. Listen for `game-reset` to clear your interaction.

The server determines correctness. The robot owns the English correct/incorrect
feedback. Person 4 owns glossary updates. `colouring.js` is currently empty and
there is no mobile selection/result/progression handler yet, so normal room
selection currently stays stopped pending this Person 3 integration.

### Person 4: language selection and glossary

Use exactly these values (not locale codes):

```js
window.mobileSocket.emit("start-game", { language: "indonesian" }); // or "chinese"
window.mobileSocket.emit("exit-game");
```

Listen for `word-learned` and add the matching vocabulary card, deduplicating by
`language` + `itemId`. `meaning` is English; `word` is the heritage-language label.
Use `current-activity.language` for the shared selected language. The existing
mobile/glossary code already receives rewards, deduplicates them and returns to
language selection on `game-reset`. Its vocabulary collections remain in memory
across exits, separated by language. An activity index of `0` can also be a replay
of the first mission on reconnect and does not by itself identify a fresh start.
Mobile handling of `adventure-complete` still needs to be agreed and connected by
the mobile UI owners; Person 1 provides the event and the robot's completion state.

Learned-word history is not stored/replayed by the server. A page reload or a
disconnection during a reward can lose local glossary cards; persistence/history
recovery is outside this prototype. Person 4's optional glossary pronunciation
button already exists and remains unchanged by this update.

## Robot assets and motion

The single `ROBOT_ASSETS` mapping in `public/js/robot.js` uses these existing
Person 5 files. These are static PNG poses; CSS supplies the small movements.

| Robot state | Public asset URL | Decorative motion |
| --- | --- | --- |
| `idle` | `/assets/char_movements/default.png` | Gentle breathing/float |
| `confused` | `/assets/char_emotions/sad.png` | Brief side-to-side shake |
| `eating` | `/assets/char_emotions/happyeat.png` | Small happy bounce |
| `sitting` | `/assets/char_emotions/happysit.png` | Small settle/pop |
| `looking` | `/assets/char_emotions/happylook.png` | Gentle tilt |
| `happy` | `/assets/char_emotions/happy.png` | Celebratory bounce |

The legacy `playing` robot key also maps to the generic happy image; none of the
three current missions uses it. The image has a consistent responsive box and
pixelated rendering so different source dimensions do not move the instruction.
`prefers-reduced-motion: reduce` disables decorative animation; the reaction
image and English feedback remain visible. Repeated reactions restart their
short animation.

No replacement artwork was created. Missing or failed images are hidden while
the English instruction/feedback remain usable. There are no audio assets in
the current repository, and none are required for feedback sounds.

## Robot pronunciation and feedback sounds

`speakVocabulary(word, language)` uses the browser Web Speech API with `id-ID`
for Indonesian and `zh-CN` for Mandarin. `word-learned` triggers pronunciation.
Previous speech is cancelled before a new word and on a new mission, completion,
reset or disconnection. Mission sentences remain English text and are not spoken
in the heritage language.

The robot's **Hear word** button replays the latest reward through a direct tap.
Unsupported/failed speech shows a short status message while the game continues.
Available voices and automatic speech permission depend on the browser/device;
check audible pronunciation on the team's target iPad. Automated speech checks
verify locale selection and handling, not the sound of installed voices.

`playFeedbackSound(type)` uses the Web Audio API to create short, quiet sine-wave
tones with a smooth gain envelope: two ascending notes for `correct`, two lower
descending notes for `incorrect`, and three ascending notes for `complete`.
Oscillator/gain nodes are cleaned up after playback. There are no audio downloads,
audio libraries, new dependencies or background music.

A suspended AudioContext is resumed when possible during feedback or a tap/click
gesture on the robot page. Audio/browser errors are caught, so blocked or
unsupported sound never prevents text and visual feedback. Vocabulary speech
still starts on `word-learned`; the brief tones use a separate API at low volume
and do not delay or cancel speech. Actual sound and voice availability should be
checked on the target iPad after interacting with the robot page.

## Assumptions and scope

- Exactly three equivalent missions per language: carrot/eating, chair/sitting,
  and butterfly/looking. All nine option IDs have existing Person 5 object assets.
- One in-memory game, no database/login/device roles. Any connected client can
  send the integration events. A valid `start-game` restarts from mission 1.
- Exiting or restarting the server discards the adventure. Disconnecting one
  screen does not reset the shared game.
- Teammate-owned files are deliberately untouched: `public/mobile.html`,
  `public/js/{room,colouring,glossary,language,mobile,events}.js`,
  `public/css/{room,colouring,glossary,language,shared}.css`, and Person 5 artwork.

## Check the Person 1 flow while colouring integration is pending

Open the robot and mobile pages in separate tabs. In the mobile tab's browser
console, reuse its existing socket and inspect the public events:

```js
window.mobileSocket.onAny((event, payload) => console.log(event, payload));
window.mobileSocket.emit("start-game", { language: "indonesian" });
```

The robot should show the default character and "I'm hungry! Find the carrot."
These console submissions simulate Person 3's future completed colouring/swipe;
they are developer checks, not changes to the child-facing flow. Send each command
separately after observing its result:

```js
window.mobileSocket.emit("next-activity"); // ignored before a correct answer
window.mobileSocket.emit("submit-item", { itemId: "chicken" }); // Try again! + sad.png
window.mobileSocket.emit("submit-item", { itemId: "carrot" }); // Great job! + happyeat.png + wortel / id-ID
window.mobileSocket.emit("submit-item", { itemId: "carrot" }); // no repeated reward
window.mobileSocket.emit("next-activity"); // chair mission
window.mobileSocket.emit("submit-item", { itemId: "chair" }); // happysit.png + kursi
window.mobileSocket.emit("next-activity"); // butterfly mission
window.mobileSocket.emit("submit-item", { itemId: "butterfly" }); // happylook.png + kupu-kupu
window.mobileSocket.emit("next-activity"); // adventure-complete + happy.png
window.mobileSocket.emit("exit-game"); // waiting / reset + default.png
window.mobileSocket.emit("start-game", { language: "chinese" }); // restart at mission 1
```

Repeat the three submissions/Next steps for Chinese and check `胡萝卜`, `椅子`, `蝴蝶`
with `zh-CN` speech. Tap the robot's Hear button if automatic speech is blocked.
Check the gentle incorrect/correct/completion cues after interacting with the
robot page. Enable reduced motion in the browser/OS and confirm the static poses
still change while movement stops. Reload the robot during an active mission to
check state restoration; pronunciation rewards are not replayed by reconnect.
