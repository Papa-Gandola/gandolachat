import { createContext, useContext } from "react";

import { discordTheme } from "./discord";
import { neoTheme } from "./neo";
import { Theme, ThemeId } from "./types";

export const THEMES: Record<ThemeId, Theme> = {
  neo: neoTheme,
  discord: discordTheme,
};

export const defaultTheme: Theme = neoTheme;

export interface ThemeContextValue {
  theme: Theme;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: defaultTheme,
  themeId: defaultTheme.id,
  setThemeId: () => {},
});

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useThemeControls(): ThemeContextValue {
  return useContext(ThemeContext);
}

export type { Theme, ThemeId };
