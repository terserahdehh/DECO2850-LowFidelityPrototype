// Mission instructions stay in English. Only option labels and vocabulary change.
// Item IDs also name the objects Person 2 and Person 5 use for room assets.
const indonesian = [
  {
    id: "hungry-apple",
    instruction: "I'm hungry! Find an apple.",
    options: [
      { itemId: "apple", label: "apel" },
      { itemId: "ball", label: "bola" },
      { itemId: "book", label: "buku" },
    ],
    correctItemId: "apple",
    vocabulary: {
      itemId: "apple",
      word: "apel",
      meaning: "apple",
      language: "indonesian",
    },
    successReaction: "eating",
  },
  {
    id: "play-ball",
    instruction: "Let's play! Find a ball.",
    options: [
      { itemId: "book", label: "buku" },
      { itemId: "apple", label: "apel" },
      { itemId: "ball", label: "bola" },
    ],
    correctItemId: "ball",
    vocabulary: {
      itemId: "ball",
      word: "bola",
      meaning: "ball",
      language: "indonesian",
    },
    successReaction: "playing",
  },
  {
    id: "read-book",
    instruction: "Let's read! Find a book.",
    options: [
      { itemId: "ball", label: "bola" },
      { itemId: "book", label: "buku" },
      { itemId: "apple", label: "apel" },
    ],
    correctItemId: "book",
    vocabulary: {
      itemId: "book",
      word: "buku",
      meaning: "book",
      language: "indonesian",
    },
    successReaction: "happy",
  },
];

const chinese = [
  {
    id: "hungry-apple",
    instruction: "I'm hungry! Find an apple.",
    options: [
      { itemId: "apple", label: "苹果" },
      { itemId: "ball", label: "球" },
      { itemId: "book", label: "书" },
    ],
    correctItemId: "apple",
    vocabulary: {
      itemId: "apple",
      word: "苹果",
      meaning: "apple",
      language: "chinese",
    },
    successReaction: "eating",
  },
  {
    id: "play-ball",
    instruction: "Let's play! Find a ball.",
    options: [
      { itemId: "book", label: "书" },
      { itemId: "apple", label: "苹果" },
      { itemId: "ball", label: "球" },
    ],
    correctItemId: "ball",
    vocabulary: {
      itemId: "ball",
      word: "球",
      meaning: "ball",
      language: "chinese",
    },
    successReaction: "playing",
  },
  {
    id: "read-book",
    instruction: "Let's read! Find a book.",
    options: [
      { itemId: "ball", label: "球" },
      { itemId: "book", label: "书" },
      { itemId: "apple", label: "苹果" },
    ],
    correctItemId: "book",
    vocabulary: {
      itemId: "book",
      word: "书",
      meaning: "book",
      language: "chinese",
    },
    successReaction: "happy",
  },
];

module.exports = { indonesian, chinese };
