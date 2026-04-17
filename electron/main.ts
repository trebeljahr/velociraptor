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
 *
 * Steam integration:
 *   steamworks.js is initialized once before window creation. If Steam
 *   isn't running / the user isn't logged in / the SDK fails to load,
 *   steamClient stays null and every bridge call short-circuits — the
 *   game still runs and unlocks land in localStorage.
 *   STEAM_APP_ID defaults to 480 (Spacewar) for dev; override via env.
 */

import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import steamworks from "steamworks.js";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

const STEAM_APP_ID = Number(process.env.STEAM_APP_ID ?? 480);

type SteamClient = ReturnType<typeof steamworks.init>;
let steamClient: SteamClient | null = null;

try {
  steamClient = steamworks.init(STEAM_APP_ID);
  steamworks.electronEnableSteamOverlay();
  console.log(`[steam] init ok, appid ${STEAM_APP_ID}`);
} catch (err) {
  console.warn("[steam] init failed, running without Steam:", err);
  steamClient = null;
}

// IPC: renderer asks whether Steam is usable this session.
ipcMain.handle("steam:isAvailable", () => steamClient !== null);

// IPC: activate a Steam achievement by its API Name. Idempotent on
// Steam's side — re-activating an already-unlocked achievement is a
// no-op, so we don't need to gate on isActivated first. Returns true
// on success, false on any failure (SDK absent, name unknown, etc).
ipcMain.handle("steam:activateAchievement", (_evt, apiName: string) => {
  if (!steamClient) return false;
  try {
    return steamClient.achievement.activate(apiName);
  } catch (err) {
    console.warn("[steam] activateAchievement failed:", apiName, err);
    return false;
  }
});

// IPC: batched state fetch used by the init reconcile pass. Returns
// a record of { apiName: unlocked } for every name the renderer asks
// about. Returns an empty object when Steam isn't available so the
// renderer doesn't need a special null code path.
ipcMain.handle(
  "steam:getAchievementStates",
  (_evt, apiNames: string[]): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    if (!steamClient) return out;
    for (const name of apiNames) {
      try {
        out[name] = steamClient.achievement.isActivated(name);
      } catch {
        out[name] = false;
      }
    }
    return out;
  },
);

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
