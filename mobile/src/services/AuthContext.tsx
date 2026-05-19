import * as SecureStore from "expo-secure-store";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { apiErrorMessage, authApi, UserOut, userApi } from "./api";
import { wsService } from "./ws";

interface AuthState {
  token: string | null;
  user: UserOut | null;
  ready: boolean;
  loading: boolean;
  error: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  register: (username: string, password: string) => Promise<{ pending: boolean; message?: string }>;
  clearError: () => void;
}

const TOKEN_KEY = "gandola.token";

const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  ready: false,
  loading: false,
  error: null,
  signIn: async () => {},
  signOut: () => {},
  register: async () => ({ pending: false }),
  clearError: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserOut | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On startup: check for a saved token, validate against /api/users/me to
  // catch expired/revoked tokens, and refresh it (server returns a fresh
  // token on /me so the session slides forward as long as you keep opening
  // the app).
  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (saved) {
          // Set token first so the axios interceptor picks it up for the /me call.
          await SecureStore.setItemAsync(TOKEN_KEY, saved);
          setToken(saved);
          try {
            const me = await userApi.me();
            const fresh = me.data.access_token || saved;
            await SecureStore.setItemAsync(TOKEN_KEY, fresh);
            setToken(fresh);
            setUser(me.data.user);
            wsService.connect(fresh);
          } catch {
            // Saved token no longer valid — drop it.
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            setToken(null);
            setUser(null);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      ready,
      loading,
      error,
      clearError: () => setError(null),
      signIn: async (username, password) => {
        setLoading(true);
        setError(null);
        try {
          const res = await authApi.login(username, password);
          const { access_token, user: u } = res.data;
          await SecureStore.setItemAsync(TOKEN_KEY, access_token);
          setToken(access_token);
          setUser(u);
          wsService.connect(access_token);
        } catch (err) {
          setError(apiErrorMessage(err));
          throw err;
        } finally {
          setLoading(false);
        }
      },
      register: async (username, password) => {
        setLoading(true);
        setError(null);
        try {
          const res = await authApi.register(username, password);
          // Server returns either { status: "pending", message } when admin
          // approval is required, OR a full TokenResponse if auto-approved.
          const data = res.data as { status?: string; message?: string; access_token?: string };
          if (data.access_token) {
            await SecureStore.setItemAsync(TOKEN_KEY, data.access_token);
            setToken(data.access_token);
            // Caller will navigate to main on this branch — no pending screen.
            return { pending: false };
          }
          return { pending: true, message: data.message };
        } catch (err) {
          setError(apiErrorMessage(err));
          throw err;
        } finally {
          setLoading(false);
        }
      },
      signOut: () => {
        SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
        wsService.disconnect();
        setToken(null);
        setUser(null);
      },
    }),
    [token, user, ready, loading, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
