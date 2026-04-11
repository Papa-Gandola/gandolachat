import React, { useState } from "react";
import { authApi } from "../services/api";

interface Props {
  onLogin: (token: string, user: any) => void;
}

export default function Auth({ onLogin }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingMessage, setPendingMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      let res;
      if (mode === "register") {
        res = await authApi.register(username, password);
        if (res.data.status === "pending") {
          setError("");
          setPendingMessage(res.data.message);
          return;
        }
      } else {
        res = await authApi.login(username, password);
      }
      const { access_token, user } = res.data;
      if (rememberMe) {
        localStorage.setItem("token", access_token);
      } else {
        sessionStorage.setItem("token", access_token);
      }
      onLogin(access_token, user);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Ошибка. Попробуй снова.");
    } finally {
      setLoading(false);
    }
  }

  if (pendingMessage) {
    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={styles.logo}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="24" fill="#5865f2" />
              <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle"
                fill="white" fontSize="22" fontWeight="700" fontFamily="Inter">G</text>
            </svg>
            <h1 style={styles.appName}>GandolaChat</h1>
          </div>
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <span style={{ fontSize: 48 }}>⏳</span>
            <h2 style={{ color: "var(--text-header)", fontSize: 20, margin: "16px 0 8px" }}>Заявка отправлена</h2>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>{pendingMessage}</p>
            <button style={{ ...styles.btn, marginTop: 24, background: "var(--bg-active)" }} onClick={() => { setPendingMessage(""); setMode("login"); }}>
              Попробовать войти
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="24" fill="#5865f2" />
            <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle"
              fill="white" fontSize="22" fontWeight="700" fontFamily="Inter">G</text>
          </svg>
          <h1 style={styles.appName}>GandolaChat</h1>
        </div>

        <h2 style={styles.title}>
          {mode === "login" ? "Добро пожаловать!" : "Создать аккаунт"}
        </h2>
        <p style={styles.subtitle}>
          {mode === "login" ? "Рады видеть тебя снова" : "Зарегистрируйся и начни общение"}
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>ИМЯ ПОЛЬЗОВАТЕЛЯ</label>
            <input
              style={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="gandola"
              required
              minLength={2}
              maxLength={50}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>ПАРОЛЬ</label>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={4}
            />
          </div>

          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              style={styles.checkbox}
            />
            <span style={styles.checkboxLabel}>Запомнить меня</span>
          </label>

          {error && <p style={styles.error}>{error}</p>}

          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? "Загрузка..." : mode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>
        </form>

        <p style={styles.toggle}>
          {mode === "login" ? (
            <>
              Нет аккаунта?{" "}
              <span style={styles.link} onClick={() => { setMode("register"); setError(""); }}>
                Зарегистрироваться
              </span>
            </>
          ) : (
            <>
              Уже есть аккаунт?{" "}
              <span style={styles.link} onClick={() => { setMode("login"); setError(""); }}>
                Войти
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-tertiary)" },
  card: { background: "var(--bg-primary)", borderRadius: 8, padding: "32px 40px", width: 440, boxShadow: "var(--shadow)" },
  logo: { display: "flex", alignItems: "center", gap: 12, marginBottom: 24, justifyContent: "center" },
  appName: { color: "var(--text-header)", fontSize: 24, fontWeight: 700 },
  title: { color: "var(--text-header)", fontSize: 24, fontWeight: 700, textAlign: "center", marginBottom: 8 },
  subtitle: { color: "var(--text-secondary)", textAlign: "center", marginBottom: 24 },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  field: { display: "flex", flexDirection: "column", gap: 8 },
  label: { fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: "0.05em" },
  input: { background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: 4, padding: "10px 12px", fontSize: 16, color: "var(--text-primary)", width: "100%" },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" },
  checkbox: { width: 16, height: 16, accentColor: "var(--accent)" },
  checkboxLabel: { color: "var(--text-secondary)", fontSize: 13 },
  error: { color: "var(--danger)", fontSize: 13 },
  btn: { background: "var(--accent)", color: "#fff", fontSize: 16, fontWeight: 600, padding: "12px", borderRadius: 4, width: "100%", marginTop: 8 },
  toggle: { color: "var(--text-secondary)", textAlign: "center", marginTop: 16, fontSize: 13 },
  link: { color: "var(--text-link)", cursor: "pointer" },
};
