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

/**
 * A lightweight frameless window shown from app launch until the main
 * renderer finishes its first paint. This covers the otherwise-blank
 * sky-blue gap (in dev: while waiting for Vite and the bundle; in
 * prod: while Electron parses the bundle) and hides the macOS window
 * icon flash that appears during that gap.
 *
 * Loads electron/splash.html with a raptor-image path injected via
 * query string so the same splash works in dev (public/assets) and
 * in the packaged app (dist/).
 */
function createSplash(): BrowserWindow {
  // Vite copies public/* to dist/* preserving structure, so the
  // packaged asset lives at dist/assets/raptor-idle.png.
  const raptorPath = isDev
    ? path.join(__dirname, "..", "public", "assets", "raptor-idle.png")
    : path.join(__dirname, "..", "dist", "assets", "raptor-idle.png");

  const splash = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: "#50b4cd",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  splash.once("ready-to-show", () => splash.show());
  splash.loadFile(path.join(__dirname, "splash.html"), {
    query: { raptor: `file://${raptorPath}` },
  });

  return splash;
}

function createWindow(): void {
  const splash = createSplash();

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
    // Launch fullscreen by default — this is a desktop game, not a
    // productivity tool. ESC exits fullscreen for debugging.
    fullscreen: true,
    // Frameless on macOS for a cleaner look; standard frame on Windows/Linux.
    // Takes effect if the user exits fullscreen.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#50b4cd", // sky-blue to match the game's background
    show: false, // stays hidden until the splash hands off
  });

  // Hand off from splash → main window. Using did-finish-load rather
  // than ready-to-show because the game's own JS needs a tick to
  // initialize after the HTML paints; closing the splash on
  // did-finish-load lets the game's first real frame be what the
  // player sees rather than a white flash of unstyled content.
  const handoff = () => {
    if (!win.isDestroyed()) win.show();
    if (!splash.isDestroyed()) splash.close();
  };
  win.webContents.once("did-finish-load", handoff);
  // Failsafe: never leave the splash up for more than 15s even if
  // the load event never fires (e.g. Vite server never comes up).
  const failsafe = setTimeout(handoff, 15_000);
  win.once("closed", () => clearTimeout(failsafe));

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
  // macOS dock icon. In packaged builds this comes from the .icns
  // baked into the app bundle (build.mac.icon), but in dev mode
  // Electron shows its own icon unless we override it here. Windows
  // / Linux dock/taskbar icons come from the BrowserWindow `icon:`
  // option below.
  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(
        path.join(__dirname, "..", "public", "assets", "icon-512.png"),
      );
    } catch (err) {
      console.warn("[app] failed to set dock icon:", err);
    }
  }

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
