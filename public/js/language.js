(() => {
  "use strict";
  const root = document.getElementById("language-screen");
  if (!root) return;
  if (new URLSearchParams(window.location.search).get("roomDemo") === "1") root.hidden = true;
  let selectedLanguage = null;
  let onStartGame = () => {};

  root.innerHTML = `
    <div class="language-panel">
      <h1>Choose your adventure language</h1>
      <p>Pick one language to begin!</p>
      <div class="language-options" role="group" aria-label="Adventure language">
        <button type="button" class="language-option" data-language="indonesian" aria-pressed="false" aria-label="Bahasa Indonesia"><img src="/assets/indonesian.png" alt=""></button>
        <button type="button" class="language-option" data-language="chinese" aria-pressed="false" aria-label="中文 Chinese"><img src="/assets/chinese.png" alt=""></button>
      </div>
      <button type="button" class="start-adventure" aria-label="Start Adventure" disabled><img src="/assets/startbtn.png" alt=""></button>
    </div>`;
  const options = [...root.querySelectorAll(".language-option")];
  const startButton = root.querySelector(".start-adventure");

  options.forEach((option) => option.addEventListener("click", () => {
    selectedLanguage = option.dataset.language;
    options.forEach((button) => {
      const active = button === option;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    startButton.disabled = false;
  }));
  startButton.addEventListener("click", () => {
    if (selectedLanguage) onStartGame(selectedLanguage);
  });

  window.LanguageSystem = {
    init({ onStartGame: callback } = {}) {
      if (typeof callback === "function") onStartGame = callback;
    },
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    reset() {
      selectedLanguage = null;
      startButton.disabled = true;
      options.forEach((button) => {
        button.classList.remove("is-selected");
        button.setAttribute("aria-pressed", "false");
      });
      root.hidden = false;
    },
  };
})();
