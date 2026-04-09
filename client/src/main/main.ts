import { app, BrowserWindow, ipcMain, shell, desktopCapturer, session } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

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
    icon: path.join(__dirname, "../../assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
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
  // Screen sharing handled via IPC for source selection

  createWindow();
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

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
ipcMain.on("window:close", () => mainWindow?.close());
