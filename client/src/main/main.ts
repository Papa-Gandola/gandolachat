import { app, BrowserWindow, ipcMain, shell, desktopCapturer, session, Tray, Menu, nativeImage } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import fs from "fs";
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

// Let Chromium hibernate rendering when the window is fully covered (idle CPU win).
app.commandLine.appendSwitch("enable-features", "CalculateNativeWinOcclusion");

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
      backgroundThrottling: true,
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
  tray = new Tray(path.join(__dirname, "../../assets/gandola.ico"));
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
ipcMain.on("window:focus", () => {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// Unread badge on taskbar icon (Telegram-style red circle with number).
// Renderer builds the PNG via canvas (Electron on Windows doesn't decode SVG
// reliably for overlay icons), main just wraps it into a nativeImage.
// Expose base app icon to the renderer so it can composite a red-dot tray
// version when there are unread messages.
ipcMain.handle("tray:getBaseIcon", () => {
  // Return the base PNG for the tray renderer to composite a red-dot version over.
  // Prefer a PNG if present (canvas Image handles it cleanly); fall back to the ICO bytes.
  const tryPaths = [
    path.join(__dirname, "../../assets/gandola.png"),
    path.join(__dirname, "../../assets/icon.png"),
    path.join(__dirname, "../../assets/gandola.ico"),
  ];
  for (const p of tryPaths) {
    try {
      const buf = fs.readFileSync(p);
      const mime = p.endsWith(".png") ? "image/png" : "image/x-icon";
      return `data:${mime};base64,` + buf.toString("base64");
    } catch {}
  }
  return null;
});

ipcMain.on("tray:setImage", (_e, dataUrl: string) => {
  if (!tray || !dataUrl) return;
  try {
    let img = nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) return;
    // Windows tray prefers 16x16 / 32x32. Resize to a sane tray size.
    img = img.resize({ width: 16, height: 16 });
    tray.setImage(img);
  } catch (err) {
    console.error("[tray] setImage failed", err);
  }
});

ipcMain.on("badge:set", (_e, count: number, pngDataUrl?: string) => {
  if (!mainWindow) return;
  if (typeof count !== "number" || count < 0) count = 0;
  // Cross-platform numeric badge (macOS/Linux Unity)
  app.setBadgeCount(count);
  // Windows: overlay icon on the taskbar button
  if (process.platform === "win32") {
    if (count > 0 && pngDataUrl) {
      try {
        const img = nativeImage.createFromDataURL(pngDataUrl);
        if (!img.isEmpty()) {
          mainWindow.setOverlayIcon(img, `${count} непрочитанных`);
        } else {
          mainWindow.setOverlayIcon(null, "");
        }
      } catch {
        mainWindow.setOverlayIcon(null, "");
      }
    } else {
      mainWindow.setOverlayIcon(null, "");
    }
  }
  if (tray) {
    tray.setToolTip(count > 0 ? `GandolaChat — ${count} непрочитанных` : "GandolaChat");
  }
});
