# DECO2850-LowFidelityPrototype

Low-fidelity prototype for a language-learning adventure game for children learning Indonesian or Chinese heritage vocabulary.

The prototype includes a mobile adventure interface and a separate robot screen. Children receive simple mixed-language missions, explore a room, colour selected objects, and swipe them to the robot.

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
- Mixed-language mission instructions
- Room exploration and pet movement
- Item selection
- Colouring and swipe submission
- Robot reactions and spoken feedback
- Learned-word glossary
- Next Mission controls
- Exit and game reset

## Activities

There are currently three activities.

| Mission | Indonesian instruction | Chinese instruction | Correct Item |
| --- | --- | --- | --- |
| 1 | I'm hungry! Find wortel. | I'm hungry! Find 胡萝卜. | `carrot` |
| 2 | I want to sit! Find kursi. | I want to sit! Find 椅子. | `chair` |
| 3 | Look around! Find kupu-kupu. | Look around! Find 蝴蝶. | `butterfly` |

## Game Flow

1. Choose Indonesian or Chinese.
2. Receive a mission from the robot.
3. Explore the room and find an item.
4. Colour the selected object.
5. Swipe the completed object to the robot.
6. Receive correct or incorrect feedback.
7. Add the learned vocabulary to the glossary after a correct answer.
8. Continue to the next mission.
9. Complete the adventure after the final mission.

## Robot

The robot displays the current mission and reacts using the provided character assets.

- Mission instructions repeat while the child is searching in the room.
- Mission speech stops when colouring begins.
- Incorrect feedback is spoken once, then the mission repeats when the child returns to the room.
- Correct feedback is spoken once and waits for the next mission.
- Adventure completion displays and speaks: `Adventure complete! Great work!`
- Indonesian target words use `id-ID` pronunciation.
- Chinese target words use `zh-CN` pronunciation.

Vocabulary replay is available through the glossary rather than the robot screen.

## Assets

Visual assets are stored in:

```text
public/assets/
```

## Technology

- Node.js
- Express
- Socket.IO
- HTML
- CSS
- JavaScript

## Testing

Run automated tests with:

```sh
npm test
```
