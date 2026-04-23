import { useEffect, useState } from "react";

export type Theme = "discord" | "neo";
export type NeoColors = { bg: string; accent: string };

const STORAGE_KEY = "gandola-theme";
const NEO_COLORS_KEY = "gandola-neo-colors";
const listeners = new Set<(t: Theme) => void>();

export const DEFAULT_NEO_COLORS: NeoColors = { bg: "#0a0a0a", accent: "#c6ff3d" };

export function getTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "neo" || saved === "discord") return saved;
  return "discord";
}

export function getNeoColors(): NeoColors {
  try {
    const raw = localStorage.getItem(NEO_COLORS_KEY);
    if (!raw) return DEFAULT_NEO_COLORS;
    const parsed = JSON.parse(raw);
    return {
      bg: parsed.bg || DEFAULT_NEO_COLORS.bg,
      accent: parsed.accent || DEFAULT_NEO_COLORS.accent,
    };
  } catch {
    return DEFAULT_NEO_COLORS;
  }
}

// Mix two hex colors in ratio (0..1). ratio=0 returns a, ratio=1 returns b.
function mixHex(a: string, b: string, ratio: number): string {
  const pa = parseInt(a.replace("#", ""), 16);
  const pb = parseInt(b.replace("#", ""), 16);
  const ra = (pa >> 16) & 255, ga = (pa >> 8) & 255, ba = pa & 255;
  const rb = (pb >> 16) & 255, gb = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ra + (rb - ra) * ratio);
  const g = Math.round(ga + (gb - ga) * ratio);
  const bl = Math.round(ba + (bb - ba) * ratio);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

// Darken accent ~35% toward bg — used for own-message bubble
function bubbleFromAccent(accent: string, bg: string): string {
  return mixHex(accent, bg, 0.35);
}

function applyNeoVariables(colors: NeoColors) {
  const root = document.body;
  if (!document.body.classList.contains("theme-neo")) {
    // still clear overrides if not neo
    root.style.removeProperty("--bg-primary");
    root.style.removeProperty("--bg-secondary");
    root.style.removeProperty("--bg-tertiary");
    root.style.removeProperty("--bg-hover");
    root.style.removeProperty("--bg-active");
    root.style.removeProperty("--bg-message");
    root.style.removeProperty("--bg-input");
    root.style.removeProperty("--bg-modal");
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-hover");
    root.style.removeProperty("--accent-active");
    root.style.removeProperty("--bubble-mine");
    return;
  }
  const { bg, accent } = colors;
  // Derive shades from bg
  root.style.setProperty("--bg-primary", bg);
  root.style.setProperty("--bg-secondary", mixHex(bg, "#ffffff", 0.02));
  root.style.setProperty("--bg-tertiary", mixHex(bg, "#000000", 0.35));
  root.style.setProperty("--bg-hover", mixHex(bg, "#ffffff", 0.04));
  root.style.setProperty("--bg-active", mixHex(bg, "#ffffff", 0.06));
  root.style.setProperty("--bg-message", mixHex(bg, "#ffffff", 0.03));
  root.style.setProperty("--bg-input", mixHex(bg, "#000000", 0.5));
  root.style.setProperty("--bg-modal", mixHex(bg, "#ffffff", 0.02));
  // Accent + derived
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-hover", mixHex(accent, "#000000", 0.1));
  root.style.setProperty("--accent-active", mixHex(accent, "#000000", 0.2));
  root.style.setProperty("--accent-text", bg);
  root.style.setProperty("--bubble-mine", bubbleFromAccent(accent, bg));
}

export function saveNeoColors(colors: NeoColors) {
  localStorage.setItem(NEO_COLORS_KEY, JSON.stringify(colors));
  applyNeoVariables(colors);
}

export function resetNeoColors() {
  localStorage.removeItem(NEO_COLORS_KEY);
  applyNeoVariables(DEFAULT_NEO_COLORS);
}

export function applyTheme(theme: Theme) {
  document.body.classList.remove("theme-discord", "theme-neo");
  document.body.classList.add(`theme-${theme}`);
  localStorage.setItem(STORAGE_KEY, theme);
  // Reapply neo variables (or clear them for discord)
  applyNeoVariables(getNeoColors());
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
