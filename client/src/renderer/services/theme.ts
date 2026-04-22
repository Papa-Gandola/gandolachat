export type Theme = "discord" | "neo";

const STORAGE_KEY = "gandola-theme";

export function getTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "neo" || saved === "discord") return saved;
  return "discord";
}

export function applyTheme(theme: Theme) {
  document.body.classList.remove("theme-discord", "theme-neo");
  document.body.classList.add(`theme-${theme}`);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function initTheme() {
  applyTheme(getTheme());
}
