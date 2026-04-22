import React, { useState } from "react";
import { authApi } from "../services/api";
import { useTheme } from "../services/theme";

interface Props {
  onLogin: (token: string, user: any) => void;
}

export default function Auth({ onLogin }: Props) {
  const theme = useTheme();
  const isNeo = theme === "neo";
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    const neoCardExtraP: React.CSSProperties = isNeo ? {
      borderRadius: 0,
      border: "1.5px solid var(--accent)",
      boxShadow: "0 0 24px rgba(198,255,61,0.15)",
      position: "relative",
    } : {};
    return (
      <div style={styles.root}>
        <div style={{ ...styles.card, ...neoCardExtraP }}>
          {isNeo && <CornerBrackets />}
          <div style={styles.logo}>
            {isNeo ? (
              <div style={{ width: 48, height: 48, border: "2px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: "var(--accent)", background: "#0a0a0a" }}>G</div>
            ) : (
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="24" fill="#5865f2" />
                <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle"
                  fill="white" fontSize="22" fontWeight="700" fontFamily="Inter">G</text>
              </svg>
            )}
            <h1 style={{ ...styles.appName, ...mono }}>{isNeo ? <>Gandola<span style={{ color: "var(--accent)" }}>Chat</span></> : "GandolaChat"}</h1>
          </div>
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <span style={{ fontSize: 48 }}>⏳</span>
            <h2 style={{ ...mono, color: isNeo ? "var(--accent)" : "var(--text-header)", fontSize: 20, margin: "16px 0 8px", letterSpacing: isNeo ? "0.05em" : undefined }}>
              {isNeo ? "// ЗАЯВКА_ОТПРАВЛЕНА" : "Заявка отправлена"}
            </h2>
            <p style={{ ...mono, color: "var(--text-secondary)", lineHeight: 1.6 }}>{pendingMessage}</p>
            <button
              style={{ ...styles.btn, ...mono, marginTop: 24, background: "var(--bg-active)", color: "var(--text-primary)", ...(isNeo ? { borderRadius: 0, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", letterSpacing: "0.08em" } : {}) }}
              onClick={() => { setPendingMessage(""); setMode("login"); }}
            >
              {isNeo ? "[ПОПРОБОВАТЬ_ВОЙТИ]" : "Попробовать войти"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const neoCardExtra: React.CSSProperties = isNeo ? {
    borderRadius: 0,
    border: "1.5px solid var(--accent)",
    boxShadow: "0 0 24px rgba(198,255,61,0.15)",
    position: "relative",
  } : {};
  const neoInputExtra: React.CSSProperties = isNeo ? { borderRadius: 0, fontFamily: "var(--font-mono)" } : {};

  return (
    <div style={styles.root}>
      <button style={{ ...styles.closeAppBtn, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }} onClick={() => (window as any).electron?.close()} title="Закрыть">✕</button>
      <div style={{ ...styles.card, ...neoCardExtra }}>
        {isNeo && <CornerBrackets />}
        <div style={styles.logo}>
          {isNeo ? (
            <div style={{ width: 48, height: 48, border: "2px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: "var(--accent)", background: "#0a0a0a" }}>G</div>
          ) : (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="24" fill="#5865f2" />
              <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle"
                fill="white" fontSize="22" fontWeight="700" fontFamily="Inter">G</text>
            </svg>
          )}
          <h1 style={{ ...styles.appName, ...mono, ...(isNeo ? { letterSpacing: "0.08em" } : {}) }}>
            {isNeo ? <>Gandola<span style={{ color: "var(--accent)" }}>Chat</span></> : "GandolaChat"}
          </h1>
        </div>

        <h2 style={{ ...styles.title, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.05em", textAlign: "left" as const } : {}) }}>
          {isNeo
            ? (mode === "login" ? "> Добро_пожаловать_" : "> Новый_аккаунт_")
            : (mode === "login" ? "Добро пожаловать!" : "Создать аккаунт")}
        </h2>
        <p style={{ ...styles.subtitle, ...mono, ...(isNeo ? { textAlign: "left" as const, letterSpacing: "0.03em" } : {}) }}>
          {isNeo
            ? (mode === "login" ? "// рады_видеть_тебя_снова" : "// зарегистрируйся_и_начни_общение")
            : (mode === "login" ? "Рады видеть тебя снова" : "Зарегистрируйся и начни общение")}
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={{ ...styles.label, ...mono }}>{isNeo ? "// ИМЯ_ПОЛЬЗОВАТЕЛЯ" : "ИМЯ ПОЛЬЗОВАТЕЛЯ"}</label>
            <input
              style={{ ...styles.input, ...neoInputExtra }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={isNeo ? "> gandola" : "gandola"}
              required
              minLength={2}
              maxLength={50}
            />
          </div>

          <div style={styles.field}>
            <label style={{ ...styles.label, ...mono }}>{isNeo ? "// ПАРОЛЬ" : "ПАРОЛЬ"}</label>
            <div style={{ position: "relative" }}>
              <input
                style={{ ...styles.input, ...neoInputExtra, paddingRight: 40 }}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={4}
              />
              <button type="button" style={styles.eyeBtn} onClick={() => setShowPassword(!showPassword)} title={showPassword ? "Скрыть" : "Показать"}>
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              style={styles.checkbox}
            />
            <span style={{ ...styles.checkboxLabel, ...mono }}>{isNeo ? "[ ] запомнить_меня".replace("[ ]", rememberMe ? "[x]" : "[ ]") : "Запомнить меня"}</span>
          </label>

          {error && <p style={{ ...styles.error, ...mono }}>{isNeo ? `! ${error}` : error}</p>}

          <button style={{ ...styles.btn, ...mono, ...(isNeo ? { borderRadius: 0, letterSpacing: "0.08em", textTransform: "uppercase" as const } : {}) }} type="submit" disabled={loading}>
            {isNeo
              ? (loading ? "[ЗАГРУЗКА...]" : mode === "login" ? "[ВОЙТИ]" : "[РЕГИСТРАЦИЯ]")
              : (loading ? "Загрузка..." : mode === "login" ? "Войти" : "Зарегистрироваться")}
          </button>
        </form>

        <p style={{ ...styles.toggle, ...mono }}>
          {mode === "login" ? (
            <>
              {isNeo ? "// нет_аккаунта? " : "Нет аккаунта? "}
              <span style={{ ...styles.link, ...(isNeo ? { color: "var(--accent)" } : {}) }} onClick={() => { setMode("register"); setError(""); }}>
                {isNeo ? "[зарегистрироваться]" : "Зарегистрироваться"}
              </span>
            </>
          ) : (
            <>
              {isNeo ? "// уже_есть_аккаунт? " : "Уже есть аккаунт? "}
              <span style={{ ...styles.link, ...(isNeo ? { color: "var(--accent)" } : {}) }} onClick={() => { setMode("login"); setError(""); }}>
                {isNeo ? "[войти]" : "Войти"}
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function CornerBrackets() {
  const size = 16;
  const thick = 2;
  const color = "var(--accent)";
  const base: React.CSSProperties = { position: "absolute", width: size, height: size, pointerEvents: "none" };
  return (
    <>
      <span style={{ ...base, top: -1, left: -1, borderTop: `${thick}px solid ${color}`, borderLeft: `${thick}px solid ${color}` }} />
      <span style={{ ...base, top: -1, right: -1, borderTop: `${thick}px solid ${color}`, borderRight: `${thick}px solid ${color}` }} />
      <span style={{ ...base, bottom: -1, left: -1, borderBottom: `${thick}px solid ${color}`, borderLeft: `${thick}px solid ${color}` }} />
      <span style={{ ...base, bottom: -1, right: -1, borderBottom: `${thick}px solid ${color}`, borderRight: `${thick}px solid ${color}` }} />
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-tertiary)", position: "relative" },
  closeAppBtn: { position: "absolute", top: 12, right: 12, background: "none", color: "var(--text-muted)", border: "none", fontSize: 18, width: 32, height: 32, borderRadius: 4, cursor: "pointer" },
  eyeBtn: { position: "absolute" as const, right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", fontSize: 16, cursor: "pointer", padding: 4 },
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
  btn: { background: "var(--accent)", color: "var(--accent-text)", fontSize: 16, fontWeight: 600, padding: "12px", borderRadius: 4, width: "100%", marginTop: 8 },
  toggle: { color: "var(--text-secondary)", textAlign: "center", marginTop: 16, fontSize: 13 },
  link: { color: "var(--text-link)", cursor: "pointer" },
};
