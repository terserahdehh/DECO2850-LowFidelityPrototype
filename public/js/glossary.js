(() => {
  "use strict";
  const root = document.getElementById("glossary-screen");
  const app = document.getElementById("phone-app");
  if (!root || !app) return;
  const words = { indonesian: new Map(), chinese: new Map() };
  let language = null;
  let onExitGame = () => {};
  let onOpen = () => {};
  let onClose = () => {};

  const bookButton = document.createElement("button");
  bookButton.type = "button";
  bookButton.className = "glossary-book-button";
  bookButton.textContent = "📖";
  bookButton.setAttribute("aria-label", "Open glossary");
  bookButton.hidden = true;
  app.append(bookButton);
  root.innerHTML = `
    <div class="glossary-panel" role="dialog" aria-modal="true" aria-labelledby="glossary-title">
      <div class="glossary-header"><h2 id="glossary-title">My words</h2><button type="button" class="glossary-close" aria-label="Close glossary">Close</button></div>
      <div class="glossary-words"></div>
      <button type="button" class="glossary-exit">Exit Activity</button>
    </div>`;
  const list = root.querySelector(".glossary-words");
  const closeButton = root.querySelector(".glossary-close");
  const exitButton = root.querySelector(".glossary-exit");

  function render() {
    list.replaceChildren();
    const entries = language ? [...words[language].values()] : [];
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "glossary-empty";
      empty.innerText = "You haven’t collected any words yet.\nComplete a mission to add your first word!";
      list.append(empty);
      return;
    }
    entries.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "glossary-card";
      const target = document.createElement("strong");
      target.textContent = entry.word;
      const meaning = document.createElement("span");
      meaning.textContent = entry.meaning;
      card.append(target, meaning);
      if (language === "chinese" && entry.pronunciation) {
        const pronunciation = document.createElement("small");
        pronunciation.textContent = entry.pronunciation;
        card.append(pronunciation);
      }
      if ("speechSynthesis" in window) {
        const speak = document.createElement("button");
        speak.type = "button";
        speak.className = "glossary-speak";
        speak.textContent = "🔊";
        speak.setAttribute("aria-label", `Hear ${entry.word}`);
        speak.addEventListener("click", () => {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(entry.word);
          utterance.lang = language === "indonesian" ? "id-ID" : "zh-CN";
          window.speechSynthesis.speak(utterance);
        });
        card.append(speak);
      }
      list.append(card);
    });
  }
  function close() {
    if (root.hidden) return;
    root.hidden = true;
    bookButton.hidden = !language;
    onClose();
    bookButton.focus();
  }
  bookButton.addEventListener("click", () => {
    if (!language) return;
    render();
    root.hidden = false;
    bookButton.hidden = true;
    onOpen();
    closeButton.focus();
  });
  closeButton.addEventListener("click", close);
  exitButton.addEventListener("click", () => {
    exitButton.disabled = true;
    onExitGame();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  window.GlossarySystem = {
    init(callbacks = {}) {
      if (typeof callbacks.onExitGame === "function") onExitGame = callbacks.onExitGame;
      if (typeof callbacks.onOpen === "function") onOpen = callbacks.onOpen;
      if (typeof callbacks.onClose === "function") onClose = callbacks.onClose;
    },
    setLanguage(value) {
      language = value === "indonesian" || value === "chinese" ? value : null;
      bookButton.hidden = !language || !root.hidden;
      render();
    },
    addWord(data) {
      if (!data || !words[data.language] || typeof data.word !== "string" || typeof data.meaning !== "string") return false;
      const key = typeof data.itemId === "string" ? data.itemId : data.word;
      if (words[data.language].has(key)) return false;
      words[data.language].set(key, { word: data.word, meaning: data.meaning, pronunciation: data.pronunciation });
      if (language === data.language) render();
      return true;
    },
    open() { bookButton.click(); },
    close,
    reset() {
      if (!root.hidden) { root.hidden = true; onClose(); }
      language = null;
      bookButton.hidden = true;
      exitButton.disabled = false;
    },
  };
})();
