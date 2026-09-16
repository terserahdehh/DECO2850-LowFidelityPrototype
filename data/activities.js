// Missions combine English context with the selected heritage-language target word.
// Item IDs match Person 5's existing object filenames for Person 2 to integrate.
const indonesian = [
  {
    id: "hungry-carrot",
    instruction: "I'm hungry! Find wortel.",
    options: [
      { itemId: "carrot", label: "wortel" },
      { itemId: "chicken", label: "ayam" },
      { itemId: "rice", label: "nasi" },
    ],
    correctItemId: "carrot",
    vocabulary: {
      itemId: "carrot",
      word: "wortel",
      meaning: "carrot",
      language: "indonesian",
    },
    successReaction: "eating",
  },
  {
    id: "sit-chair",
    instruction: "I want to sit! Find kursi.",
    options: [
      { itemId: "chair", label: "kursi" },
      { itemId: "book", label: "buku" },
      { itemId: "table", label: "meja" },
    ],
    correctItemId: "chair",
    vocabulary: {
      itemId: "chair",
      word: "kursi",
      meaning: "chair",
      language: "indonesian",
    },
    successReaction: "sitting",
  },
  {
    id: "look-butterfly",
    instruction: "Look around! Find kupu-kupu.",
    options: [
      { itemId: "butterfly", label: "kupu-kupu" },
      { itemId: "tree", label: "pohon" },
      { itemId: "bird", label: "burung" },
    ],
    correctItemId: "butterfly",
    vocabulary: {
      itemId: "butterfly",
      word: "kupu-kupu",
      meaning: "butterfly",
      language: "indonesian",
    },
    successReaction: "looking",
  },
];

const chinese = [
  {
    id: "hungry-carrot",
    instruction: "I'm hungry! Find 胡萝卜.",
    options: [
      { itemId: "carrot", label: "胡萝卜" },
      { itemId: "chicken", label: "鸡肉" },
      { itemId: "rice", label: "米饭" },
    ],
    correctItemId: "carrot",
    vocabulary: {
      itemId: "carrot",
      word: "胡萝卜",
      meaning: "carrot",
      language: "chinese",
    },
    successReaction: "eating",
  },
  {
    id: "sit-chair",
    instruction: "I want to sit! Find 椅子.",
    options: [
      { itemId: "chair", label: "椅子" },
      { itemId: "book", label: "书" },
      { itemId: "table", label: "桌子" },
    ],
    correctItemId: "chair",
    vocabulary: {
      itemId: "chair",
      word: "椅子",
      meaning: "chair",
      language: "chinese",
    },
    successReaction: "sitting",
  },
  {
    id: "look-butterfly",
    instruction: "Look around! Find 蝴蝶.",
    options: [
      { itemId: "butterfly", label: "蝴蝶" },
      { itemId: "tree", label: "树" },
      { itemId: "bird", label: "鸟" },
    ],
    correctItemId: "butterfly",
    vocabulary: {
      itemId: "butterfly",
      word: "蝴蝶",
      meaning: "butterfly",
      language: "chinese",
    },
    successReaction: "looking",
  },
];

module.exports = { indonesian, chinese };
