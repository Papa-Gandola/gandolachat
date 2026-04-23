import { app, BrowserWindow, ipcMain, shell, desktopCapturer, session, Tray, Menu, nativeImage } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

// Performance flags for high refresh rate monitors
app.commandLine.appendSwitch("enable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-frame-rate-limit");
app.commandLine.appendSwitch("disable-gpu-vsync");

let tray: Tray | null = null;
let isQuitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

app.on("second-instance", () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#36393f",
    useContentSize: true,
    icon: path.join(__dirname, "../../assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // F12 or Ctrl+Shift+I to toggle DevTools in production
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    if (input.key === "F12" || (input.control && input.shift && input.key === "I")) {
      mainWindow?.webContents.toggleDevTools();
    }
  });
}

function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, "../../assets/icon.ico"));
  tray.setToolTip("GandolaChat");
  const showWin = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Открыть", click: showWin },
    { type: "separator" },
    { label: "Выход", click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on("click", () => {
    if (mainWindow?.isVisible() && !mainWindow.isMinimized()) {
      mainWindow?.hide();
    } else {
      showWin();
    }
  });
  tray.on("double-click", showWin);
}

// Auto-updater events
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on("update-available", (info) => {
  mainWindow?.webContents.send("update:status", "available", info);
});

autoUpdater.on("update-not-available", () => {
  mainWindow?.webContents.send("update:status", "not-available");
});

autoUpdater.on("download-progress", (progress) => {
  mainWindow?.webContents.send("update:status", "downloading", { percent: Math.round(progress.percent) });
});

autoUpdater.on("update-downloaded", () => {
  mainWindow?.webContents.send("update:status", "ready");
});

autoUpdater.on("error", (err) => {
  mainWindow?.webContents.send("update:status", "error", { message: err.message });
});

// IPC handlers
ipcMain.handle("update:check", async () => {
  if (isDev) return { status: "dev" };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: "checking" };
  } catch (err: any) {
    return { status: "error", message: err.message };
  }
});

ipcMain.on("update:install", () => {
  autoUpdater.quitAndInstall(true, true);
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

app.on("before-quit", () => { isQuitting = true; });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Screen sources for screen sharing
ipcMain.handle("screen:getSources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

// Window controls
ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on("window:close", () => { isQuitting = true; app.quit(); });
ipcMain.on("window:hide", () => mainWindow?.hide());
ipcMain.on("window:quit", () => { isQuitting = true; app.quit(); });

// Unread badge on taskbar icon (Telegram-style red circle with number)
function buildBadgeIcon(count: number) {
  // Render a 32x32 red circle with the count centered, via canvas in a data URL.
  // Main process has no DOM canvas, so we build a tiny SVG and let nativeImage decode it.
  const label = count > 99 ? "99+" : String(count);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="14" fill="#ed4245"/>
    <text x="16" y="21" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${label.length >= 3 ? 12 : 16}" font-weight="700" fill="white">${label}</text>
  </svg>`;
  return nativeImage.createFromDataURL("data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"));
}

ipcMain.on("badge:set", (_e, count: number) => {
  if (!mainWindow) return;
  if (typeof count !== "number" || count < 0) count = 0;
  // Cross-platform numeric badge — works on macOS and Linux (Unity)
  app.setBadgeCount(count);
  // Windows: overlay icon on the taskbar button
  if (process.platform === "win32") {
    if (count > 0) {
      mainWindow.setOverlayIcon(buildBadgeIcon(count), `${count} непрочитанных`);
    } else {
      mainWindow.setOverlayIcon(null, "");
    }
  }
  if (tray) {
    tray.setToolTip(count > 0 ? `GandolaChat — ${count} непрочитанных` : "GandolaChat");
  }
});
