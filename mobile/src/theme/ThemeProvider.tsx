import * as SecureStore from "../services/secureStorage";
import { ReactNode, useEffect, useMemo, useState } from "react";

import { defaultTheme, ThemeContext, THEMES } from "./index";
import { ThemeId } from "./types";

const STORAGE_KEY = "gandola.themeId";

interface Props {
  children: ReactNode;
}

export function ThemeProvider({ children }: Props) {
  const [themeId, setThemeIdState] = useState<ThemeId>(defaultTheme.id);

  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(STORAGE_KEY);
        if (saved === "neo" || saved === "discord") {
          setThemeIdState(saved);
        }
      } catch {
        // ignore — defaults stay
      }
    })();
  }, []);

  const value = useMemo(
    () => ({
      theme: THEMES[themeId],
      themeId,
      setThemeId: (id: ThemeId) => {
        setThemeIdState(id);
        SecureStore.setItemAsync(STORAGE_KEY, id).catch(() => {});
      },
    }),
    [themeId],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
