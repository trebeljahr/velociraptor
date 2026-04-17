/*
 * Raptor Runner — Electron preload script.
 *
 * Runs in the renderer's isolated context before the page loads and
 * exposes a narrow window.electronAPI surface for the Steam bridge.
 *
 * The renderer-side wrapper lives in src/steamBridge.ts, which guards
 * every call against window.electronAPI being undefined — that's what
 * makes the game continue to run unchanged in the browser (PWA) build
 * where this preload never executes.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Has Steam init succeeded? Cheap boolean the renderer can cache
  // on startup to skip the reconcile pass when offline.
  isSteam: (): Promise<boolean> => ipcRenderer.invoke("steam:isAvailable"),

  // Fire an achievement unlock to Steam. Idempotent — re-unlocking is
  // a no-op on Steam's side. Returns true on success, false otherwise.
  unlockSteamAchievement: (apiName: string): Promise<boolean> =>
    ipcRenderer.invoke("steam:activateAchievement", apiName),

  // Batched read of Steam's unlock state for every id the renderer
  // passes in. Used once at startup to reconcile local <-> Steam.
  getSteamAchievementStates: (
    apiNames: string[],
  ): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke("steam:getAchievementStates", apiNames),
});
