import React from "react";

interface State {
  err: Error | null;
  info: string | null;
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { err: null, info: null };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    this.setState({ err, info: info.componentStack || null });
    console.error("[ErrorBoundary] caught:", err, info);
  }

  render() {
    if (!this.state.err) return this.props.children;
    const isStorageRelated = /JSON|parse|undefined.*length/i.test(this.state.err.message);
    return (
      <div style={{
        height: "100%", background: "#0a0a0a", color: "#eee",
        padding: 32, fontFamily: "JetBrains Mono, monospace", fontSize: 13,
        overflow: "auto", boxSizing: "border-box",
      }}>
        <div style={{ color: "#ff3d6b", fontSize: 18, marginBottom: 12 }}>
          GandolaChat — ошибка при загрузке
        </div>
        <div style={{ marginBottom: 12, color: "#c6ff3d" }}>
          {this.state.err.name}: {this.state.err.message}
        </div>
        <pre style={{
          background: "#1a1a1a", padding: 12, border: "1px solid #333",
          overflow: "auto", fontSize: 11, color: "#999", maxHeight: 200,
        }}>{this.state.err.stack || "(no stack)"}</pre>
        {this.state.info && (
          <pre style={{
            background: "#1a1a1a", padding: 12, border: "1px solid #333",
            overflow: "auto", fontSize: 11, color: "#666", maxHeight: 200, marginTop: 8,
          }}>{this.state.info}</pre>
        )}
        <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
          {isStorageRelated && (
            <button
              onClick={() => {
                try { localStorage.clear(); sessionStorage.clear(); } catch {}
                location.reload();
              }}
              style={{
                background: "#c6ff3d", color: "#000", border: "none",
                padding: "10px 20px", fontFamily: "inherit", fontSize: 13,
                cursor: "pointer", fontWeight: 700,
              }}
            >
              Очистить локальные данные и перезагрузить
            </button>
          )}
          <button
            onClick={() => location.reload()}
            style={{
              background: "transparent", color: "#c6ff3d", border: "1px solid #c6ff3d",
              padding: "10px 20px", fontFamily: "inherit", fontSize: 13, cursor: "pointer",
            }}
          >
            Перезагрузить
          </button>
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: "#666" }}>
          Пришли этот стек разработчику (Ctrl+Shift+I → Console → Copy)
        </div>
      </div>
    );
  }
}
