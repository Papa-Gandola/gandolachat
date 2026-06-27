/**
 * Runtime platform detection for the renderer.
 *
 * The same renderer bundle runs in two places:
 *   - inside Electron (the desktop .exe), where `window.electron` is injected
 *     by the preload bridge
 *   - in a plain browser (the adaptive web build served at /desktop/), where
 *     there is no `window.electron`
 *
 * Electron-only chrome — window min/max/close, tray, auto-updater, native
 * save dialog — should be hidden or swapped for a web fallback when running
 * in a browser. Use `isElectron` to gate that UI.
 */
export const isElectron: boolean =
  typeof window !== "undefined" && !!(window as any).electron;

/**
 * Save a binary buffer to disk. Uses Electron's native save dialog when
 * available, otherwise falls back to a browser blob download (anchor click).
 */
export function saveFile(buffer: ArrayBuffer, filename: string): void {
  const electron = (window as any).electron;
  if (electron?.saveFileAs) {
    electron.saveFileAs(buffer, filename);
    return;
  }
  try {
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // best-effort — nothing more we can do from the renderer
  }
}
