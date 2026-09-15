# DECO2850-LowFidelityPrototype

Person 1 implementation: activity data, one shared server-side adventure, and the
robot screen. The existing Node.js / Express / Socket.IO / vanilla JavaScript
stack is unchanged. Mobile UI and artwork remain with Persons 2–5.

## Run locally

Use Node.js 22 or newer (the tests use Node's built-in WebSocket).

```sh
npm ci
npm start
```

- Robot: <http://localhost:3000/pet.html>
- Mobile scaffold: <http://localhost:3000/mobile.html>
- For a phone/iPad on the same Wi-Fi, replace `localhost` with the computer's LAN IP.
- Optional: `PORT=3001 npm start` to change the port.
- Run automated checks with `npm test`.

The mobile page is intentionally still a scaffold: its owners will add language
selection, movement, colouring, progression controls and glossary UI.

## Person 1 files

| File | Purpose |
| --- | --- |
| `data/activities.js` | Separate Indonesian and Chinese arrays, each with apple, ball and book missions. Instructions remain English; labels and vocabulary are translated. |
| `server.js` | Validates incoming events, owns shared game state and answer checks, broadcasts updates, resets, and restores state to connecting screens. |
| `public/js/robot.js` | English robot text, reaction/asset mapping, pronunciation, and reset/completion/disconnection handling. |
| `public/pet.html` | Existing robot elements, with accessible status text and a vocabulary replay button. |
| `public/css/robot.css` | Simple readable robot layout and touch-sized replay button. |
| `package.json` | `npm start`, `npm test`, and the correct server entry point; no added dependencies. |
| `test/game.test.js` | Real Socket.IO integration checks and activity-data validation. |
| `test/robot.test.js` | Robot DOM/event behavior and simulated browser speech/asset failures. |

## Socket.IO contract

All screens connect to the same server using `io()` from the existing
`/socket.io/socket.io.js` script. Teammates should share one socket in their mobile
code. There is one shared adventure, so a valid start or exit affects every device.

In the shapes below, `Language` means `"indonesian" | "chinese"`. Activity indices
are **zero-based**. Events marked “no payload” are emitted with no second argument.

| Event | Sender → receiver | Exact payload shape |
| --- | --- | --- |
| `start-game` | Person 4 → server | `{ language: Language }` |
| `submit-item` | Person 3 → server | `{ itemId: string }` |
| `next-activity` | Person 3 → server | No payload |
| `exit-game` | Person 4 → server | No payload |
| `current-activity` | Server → robot and mobile clients | `{ id: string, instruction: string, options: Array<{ itemId: string, label: string }>, language: Language, activityIndex: number }` |
| `answer-result` | Server → robot and mobile clients (especially Person 3) | `{ correct: boolean, reaction: "confused" | "eating" | "playing" | "happy" }` |
| `word-learned` | Server → robot and mobile clients (especially Person 4) | `{ itemId: string, word: string, meaning: string, language: Language }` |
| `adventure-complete` | Server → robot and mobile clients | `{ language: Language, completedActivities: number }` |
| `game-reset` | Server → robot and mobile clients | No payload |

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
stable IDs for this prototype are `apple`, `ball`, and `book` in both languages.
Reset your room/pet positions for each new activity and pass the selected `itemId`
to Person 3. Handle `game-reset` and `adventure-complete` in your room state.
Movement, collision, selection and room artwork are not implemented here.

### Person 3: colouring and result controls

After your colouring/sliding interaction, send:

```js
socket.emit("submit-item", { itemId });
```

Listen for `answer-result`. On `correct: false`, close/reset colouring and return
to the room. On `correct: true`, show your Mission Complete / Next Mission controls.
Your Next button sends `socket.emit("next-activity")` with no payload. Wait for
`current-activity` or `adventure-complete`; do not advance locally. A reconnect can
also deliver `answer-result` to restore a completed mission, so make that UI update
safe to repeat. Listen for `game-reset` to clear your interaction.

The server determines correctness. The robot owns the English correct/incorrect
feedback. Person 4 owns glossary updates.

### Person 4: language selection and glossary

Use exactly these values (not locale codes):

```js
socket.emit("start-game", { language: "indonesian" }); // or "chinese"
socket.emit("exit-game");
```

Listen for `word-learned` and add the matching vocabulary card, deduplicating by
`language` + `itemId`. `meaning` is English; `word` is the heritage-language label.
Use `current-activity.language` for the shared selected language. On a new start,
clear your previous adventure's cards as part of your start flow. Preserve local
cards on reconnect: an index of `0` can also be a replay of the first mission and
does not by itself identify a fresh start.
Handle `game-reset` by returning to language selection and clearing local activity
state. Handle `adventure-complete` using your chosen simple completion behavior.

Learned-word history is not stored/replayed by the server. A page reload or a
disconnection during a reward can lose local glossary cards; persistence/history
recovery is outside this prototype. Person 4's optional glossary pronunciation
button remains theirs to implement.

## Robot pronunciation and Person 5 assets

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

Person 5 TODOs:

- Supply final robot assets for `idle`, `happy`, `confused`, `eating`, and `playing`.
- Replace the five `null` entries in the single `ROBOT_ASSETS` mapping in
  `public/js/robot.js` with final public URLs, e.g. `/assets/pet/idle.gif`.
- Agree final filenames/formats/dimensions with the team. Animated image formats
  can run directly in the existing `<img>`; sprite sheets would need a later
  rendering change once Person 5 supplies their format.

No replacement artwork has been created. Unconfigured or failed images are hidden
and the English instruction/feedback remain usable.

## Assumptions and scope

- Three small equivalent missions per language, using simplified Chinese labels
  and Mandarin pronunciation: apple/eating, ball/playing, book/happy.
- One in-memory game, no database/login/device roles. Any connected client can
  send the integration events. A valid `start-game` restarts from mission 1.
- Exiting or restarting the server discards the adventure. Disconnecting one
  screen does not reset the shared game.
- Teammate-owned files are deliberately untouched: `public/mobile.html`,
  `public/js/{room,colouring,glossary,mobile,events}.js`, and
  `public/css/{room,colouring,glossary,shared}.css`.

## Check the flow without implementing mobile UI

Open the robot page and the mobile scaffold in separate tabs. In the mobile tab's
browser console, create a test socket and inspect the public events:

```js
const testSocket = io();
testSocket.onAny((event, payload) => console.log(event, payload));
testSocket.emit("start-game", { language: "indonesian" });
```

Send each command separately after observing its result:

```js
testSocket.emit("next-activity"); // ignored before a correct answer
testSocket.emit("submit-item", { itemId: "ball" }); // Try again!
testSocket.emit("submit-item", { itemId: "apple" }); // Great job! + apel / id-ID
testSocket.emit("submit-item", { itemId: "apple" }); // no repeated reward
testSocket.emit("next-activity"); // ball mission
testSocket.emit("submit-item", { itemId: "ball" });
testSocket.emit("next-activity"); // book mission
testSocket.emit("submit-item", { itemId: "book" });
testSocket.emit("next-activity"); // adventure-complete
testSocket.emit("exit-game"); // waiting / reset
testSocket.emit("start-game", { language: "chinese" }); // restart at mission 1
```

Repeat the three submissions/Next steps for Chinese and check `苹果`, `球`, `书`
with `zh-CN` speech. Tap the robot's Hear button if automatic speech is blocked.
