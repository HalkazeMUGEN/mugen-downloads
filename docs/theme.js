// Apply the saved theme before the stylesheet paints, including file previews.
(() => {
  const storageKey = "uploader-theme";
  const labels = { auto: "自動", light: "ライト", dark: "ダーク" };
  const normalize = value => ["light", "dark"].includes(value) ? value : "auto";
  function read() {
    try { return normalize(localStorage.getItem(storageKey)); }
    catch { return "auto"; }
  }
  function apply(value) {
    const theme = normalize(value);
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    const control = document.getElementById("theme");
    if (control) {
      const label = `テーマを変更（現在: ${labels[theme]}）`;
      control.setAttribute("aria-label", label);
      control.title = label;
      for (const icon of control.querySelectorAll("[data-theme-icon]")) {
        icon.toggleAttribute("hidden", icon.dataset.themeIcon !== theme);
      }
    }
    for (const choice of document.querySelectorAll("[data-theme-choice]")) {
      choice.setAttribute("aria-pressed", String(choice.dataset.themeChoice === theme));
    }
  }
  apply(read());
  document.addEventListener("DOMContentLoaded", () => {
    apply(read());
    const control = document.getElementById("theme");
    const panel = document.getElementById("theme-menu");
    const container = control.parentElement;
    const choices = [...panel.querySelectorAll("[data-theme-choice]")];
    function close(restoreFocus = false) {
      panel.hidden = true;
      control.setAttribute("aria-expanded", "false");
      if (restoreFocus) control.focus();
    }
    function open() {
      panel.hidden = false;
      control.setAttribute("aria-expanded", "true");
      choices.find(choice => choice.getAttribute("aria-pressed") === "true").focus();
    }
    control.addEventListener("click", () => panel.hidden ? open() : close());
    for (const choice of choices) {
      choice.addEventListener("click", () => {
        const theme = normalize(choice.dataset.themeChoice);
        apply(theme);
        try {
          if (theme === "auto") localStorage.removeItem(storageKey);
          else localStorage.setItem(storageKey, theme);
        } catch { /* Switching still works when browser storage is unavailable. */ }
        close(true);
      });
    }
    document.addEventListener("pointerdown", event => {
      if (!container.contains(event.target)) close();
    });
    container.addEventListener("focusout", event => {
      if (!container.contains(event.relatedTarget)) close();
    });
    container.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        close(true);
      } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        if (panel.hidden) open();
        else {
          const index = choices.indexOf(document.activeElement);
          choices[(index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length].focus();
        }
      }
    });
  });
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) apply(read());
  });
})();
