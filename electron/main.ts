/*
 * Raptor Runner — Electron main process.
 *
 * In dev mode: loads the Vite dev server at localhost:5173.
 * In production: loads the built dist/index.html via file://.
 *
 * The service worker is silently ignored in Electron (file:// doesn't
 * support SW registration). The VitePWA plugin's "auto" inject
 * handles this gracefully — the register call fails silently and the
 * game runs without offline support, which is fine for a desktop app.
 */

import { app, BrowserWindow } from "electron";
import path from "path";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: "Raptor Runner",
    icon: path.join(__dirname, "../public/assets/icon-512.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // Frameless on macOS for a cleaner look; standard frame on Windows/Linux
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#50b4cd", // sky-blue to match the game's background
    show: false, // don't flash white — show after ready-to-show
  });

  // Show once content is painted so the sky-blue backgroundColor
  // is the only thing visible during load, not a white flash.
  win.once("ready-to-show", () => {
    win.show();
  });

  if (isDev) {
    // Dev: connect to the Vite dev server for HMR
    win.loadURL("http://localhost:5173");
    // Open DevTools in dev mode (detached so it doesn't resize the game)
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Production: load the built dist/index.html
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Force landscape by preventing the window from being narrower than tall
  win.on("resize", () => {
    const [w, h] = win.getSize();
    if (h > w) {
      win.setSize(h, w); // swap dimensions to force landscape
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  // macOS: re-create window when dock icon is clicked and no windows open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS where apps stay
// running until explicitly quit via Cmd+Q).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
