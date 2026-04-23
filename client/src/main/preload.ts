import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  hide: () => ipcRenderer.send("window:hide"),
  quit: () => ipcRenderer.send("window:quit"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.send("update:install"),
  onUpdateStatus: (callback: (status: string, info?: any) => void) => {
    ipcRenderer.on("update:status", (_e, status, info) => callback(status, info));
  },
  getScreenSources: () => ipcRenderer.invoke("screen:getSources"),
  setBadgeCount: (count: number, pngDataUrl?: string) => ipcRenderer.send("badge:set", count, pngDataUrl),
  getTrayBaseIcon: () => ipcRenderer.invoke("tray:getBaseIcon"),
  setTrayImage: (dataUrl: string) => ipcRenderer.send("tray:setImage", dataUrl),
  focus: () => ipcRenderer.send("window:focus"),
});
