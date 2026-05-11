import React, { useEffect, useState } from "react";
import Auth from "./pages/Auth";
import Main from "./pages/Main";
import { userApi, UserOut } from "./services/api";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserOut | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("token") || sessionStorage.getItem("token");
    const storage = localStorage.getItem("token") ? localStorage : sessionStorage;
    if (!saved) { setChecking(false); return; }
    userApi.me()
      .then((res) => {
        const fresh = res.data.access_token;
        storage.setItem("token", fresh);
        setToken(fresh);
        setUser(res.data.user);
      })
      .catch(() => { localStorage.removeItem("token"); sessionStorage.removeItem("token"); })
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-tertiary)" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 18 }}>Загрузка...</span>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <Auth
        onLogin={(t, u) => { setToken(t); setUser(u); }}
      />
    );
  }

  return (
    <Main
      token={token}
      user={user}
      onLogout={() => { setToken(null); setUser(null); }}
    />
  );
}
