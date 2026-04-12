import { app, BrowserWindow, ipcMain, shell, desktopCapturer, session, Tray, Menu } from "electron";
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
}

function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, "../../assets/icon.ico"));
  tray.setToolTip("GandolaChat");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Открыть", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: "separator" },
    { label: "Выход", click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow?.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
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
