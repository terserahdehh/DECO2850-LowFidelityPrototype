# DECO2850-LowFidelityPrototype

Low-fidelity prototype for a language-learning adventure game for children learning Indonesian or Chinese heritage vocabulary.

The prototype includes a mobile adventure interface and a separate robot screen. Children receive simple English missions, explore a room to find objects, and learn the corresponding heritage-language vocabulary.

## Run Locally

Install dependencies and start the server:

```sh
npm install
npm start
```

Open:

- Robot: <http://localhost:3000/pet.html>
- Mobile: <http://localhost:3000/mobile.html>

Run automated tests with:

```sh
npm test
```

## Current Prototype

The prototype currently includes:

- Indonesian and Chinese language selection
- English mission instructions
- Heritage-language object labels
- Room exploration and pet movement
- Item selection
- Robot reactions and feedback
- Indonesian and Chinese vocabulary pronunciation
- Learned-word glossary
- Exit and game reset

The colouring and swipe-to-robot interaction is still being integrated.

## Activities

There are currently three activities.

| Mission | Instruction | Correct Item | Robot Reaction |
| --- | --- | --- | --- |
| 1 | I'm hungry! Find the carrot. | `carrot` | Eating |
| 2 | I want to sit! Find the chair. | `chair` | Sitting |
| 3 | Look around! Find the butterfly. | `butterfly` | Looking |

### Indonesian Vocabulary

| Item | Indonesian |
| --- | --- |
| Carrot | wortel |
| Chicken | ayam |
| Rice | nasi |
| Chair | kursi |
| Book | buku |
| Table | meja |
| Butterfly | kupu-kupu |
| Tree | pohon |
| Bird | burung |

### Chinese Vocabulary

| Item | Chinese |
| --- | --- |
| Carrot | 胡萝卜 |
| Chicken | 鸡肉 |
| Rice | 米饭 |
| Chair | 椅子 |
| Book | 书 |
| Table | 桌子 |
| Butterfly | 蝴蝶 |
| Tree | 树 |
| Bird | 鸟 |

## Game Flow

The intended interaction flow is:

1. Choose Indonesian or Chinese.
2. Receive a mission from the robot.
3. Explore the room and find an item.
4. Select the item.
5. Colour the selected object.
6. Swipe the completed object to the robot.
7. Receive correct or incorrect feedback.
8. Add the vocabulary to the glossary after a correct answer.
9. Continue to the next mission.

Currently, the implemented flow reaches item selection. The colouring and swipe interaction will connect item selection to answer submission.

## Socket.IO Events

The prototype uses Socket.IO to keep the robot and mobile interfaces connected.

Main events include:

| Event | Purpose |
| --- | --- |
| `start-game` | Starts an adventure using the selected language |
| `current-activity` | Sends the current mission and item options |
| `submit-item` | Submits an item for answer checking |
| `answer-result` | Sends correct or incorrect feedback |
| `word-learned` | Adds a correctly learned word to the glossary |
| `next-activity` | Moves to the next mission |
| `adventure-complete` | Signals that all missions are complete |
| `exit-game` | Exits and resets the activity |
| `game-reset` | Resets connected screens |

Correctness is checked on the server. The correct item is not included in the `current-activity` data sent to clients.

## Robot

The robot screen displays the current mission and reacts to submitted answers using the provided character assets.

Robot states include:

- Idle
- Confused
- Eating
- Sitting
- Looking
- Happy

The robot also provides simple feedback sounds and pronounces learned vocabulary using:

- `id-ID` for Indonesian
- `zh-CN` for Chinese

## Assets

Visual assets are stored in:

```text
public/assets/
```

These include:

- Character reactions
- Character movement
- Eating objects
- Sitting objects
- Looking objects
- Interface icons and backgrounds

## Technology

- Node.js
- Express
- Socket.IO
- HTML
- CSS
- JavaScript

## Testing

Automated tests can be run with:

```sh
npm test
```

The tests cover the main game logic, activity progression, answer checking, language data, robot reactions, vocabulary pronunciation, reset behaviour, and Socket.IO communication.