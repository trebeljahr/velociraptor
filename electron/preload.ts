/*
 * Raptor Runner — Electron preload script.
 *
 * Runs in the renderer's isolated context before the page loads.
 * Currently empty — placeholder for the Steam SDK bridge that will
 * expose window.electronAPI.unlockSteamAchievement(id) to the game.
 *
 * When the Steamworks integration lands, this file will:
 *   1. Import the Steamworks.js bindings
 *   2. contextBridge.exposeInMainWorld("electronAPI", {
 *        unlockSteamAchievement: (id: string) => { ... },
 *        isRunningOnSteam: () => true,
 *      })
 *   3. The game's unlockAchievement() in main.ts will check
 *      window.electronAPI and call it alongside the localStorage
 *      write.
 */

// Intentionally empty for now.
export {};
