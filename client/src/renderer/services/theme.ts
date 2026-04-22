import { useEffect, useState } from "react";

export type Theme = "discord" | "neo";

const STORAGE_KEY = "gandola-theme";
const listeners = new Set<(t: Theme) => void>();

export function getTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "neo" || saved === "discord") return saved;
  return "discord";
}

export function applyTheme(theme: Theme) {
  document.body.classList.remove("theme-discord", "theme-neo");
  document.body.classList.add(`theme-${theme}`);
  localStorage.setItem(STORAGE_KEY, theme);
  listeners.forEach((l) => l(theme));
}

export function initTheme() {
  applyTheme(getTheme());
}

export function useTheme(): Theme {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  useEffect(() => {
    const l = (t: Theme) => setThemeState(t);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return theme;
}
