import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles/global.css";
import { initTheme } from "./services/theme";
import { installLogBuffer } from "./services/logbuffer";

// Буфер логов для «Нашёл баг» — раньше всего остального, чтобы поймать ранние падения
installLogBuffer();
initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
