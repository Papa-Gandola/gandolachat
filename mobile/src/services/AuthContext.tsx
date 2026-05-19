import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

import * as SecureStore from "expo-secure-store";

interface AuthState {
  token: string | null;
  ready: boolean;
  signIn: (token: string) => void;
  signOut: () => void;
}

const TOKEN_KEY = "gandola.token";

const AuthContext = createContext<AuthState>({
  token: null,
  ready: false,
  signIn: () => {},
  signOut: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (saved) setToken(saved);
      } catch {
        // ignore
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      ready,
      signIn: (t: string) => {
        setToken(t);
        SecureStore.setItemAsync(TOKEN_KEY, t).catch(() => {});
      },
      signOut: () => {
        setToken(null);
        SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
      },
    }),
    [token, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
