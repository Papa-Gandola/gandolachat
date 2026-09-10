import * as SecureStore from "./secureStorage";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { apiErrorMessage, authApi, UserOut, userApi } from "./api";
import { registerForPushNotifications, unregisterCurrentPushToken } from "./notifications";
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
  updateUser: (user: UserOut) => void;
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
  updateUser: () => {},
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
  //
  // ВАЖНО (баг «не могу зайти по ярлыку»): раньше ЛЮБАЯ ошибка /me — включая
  // сетевую — трактовалась как протухший токен и удаляла его. iPhone
  // открывает PWA с ярлыка, радио просыпается долю секунды, запрос падает —
  // и человека разлогинивало на ровном месте. Теперь токен выкидывается
  // только на 401/403 (реально невалиден); сетевые/серверные сбои — входим
  // со старым токеном и дотягиваем /me фоновыми повторами.
  useEffect(() => {
    let cancelled = false;

    const isAuthRejection = (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      return status === 401 || status === 403;
    };

    const fetchMe = async (fallbackToken: string): Promise<"ok" | "auth" | "net"> => {
      try {
        const me = await userApi.me();
        if (cancelled) return "ok";
        const fresh = me.data.access_token || fallbackToken;
        await SecureStore.setItemAsync(TOKEN_KEY, fresh);
        setToken(fresh);
        setUser(me.data.user);
        wsService.connect(fresh);
        // Re-register the push token after relog so the server has a
        // fresh user_id↔token mapping (handles account switches too).
        registerForPushNotifications().catch(() => {});
        return "ok";
      } catch (err) {
        return isAuthRejection(err) ? "auth" : "net";
      }
    };

    (async () => {
      const saved = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
      if (!saved) {
        setReady(true);
        return;
      }
      // Set token first so the axios interceptor picks it up for the /me call.
      setToken(saved);

      const first = await fetchMe(saved);
      if (first === "auth") {
        await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
        if (!cancelled) {
          setToken(null);
          setUser(null);
        }
        setReady(true);
        return;
      }
      setReady(true);
      if (first === "ok") return;

      // Сеть моргнула на старте — приложение уже открыто со старым токеном,
      // WS сам реконнектится; здесь добиваем профиль повторами с бэкоффом.
      wsService.connect(saved);
      const delays = [3000, 5000, 10000, 20000, 30000];
      for (const d of delays) {
        await new Promise((r) => setTimeout(r, d));
        if (cancelled) return;
        const res = await fetchMe(saved);
        if (res === "ok") return;
        if (res === "auth") {
          await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
          if (!cancelled) {
            setToken(null);
            setUser(null);
          }
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      ready,
      loading,
      error,
      clearError: () => setError(null),
      updateUser: (u: UserOut) => setUser(u),
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
          registerForPushNotifications().catch(() => {});
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
        // Drop the push token on the server BEFORE we wipe the local one,
        // otherwise the next user on this device would inherit incoming
        // notifications for the old account.
        unregisterCurrentPushToken().catch(() => {});
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
