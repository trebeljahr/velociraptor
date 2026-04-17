/*
 * Raptor Runner — renderer-side Steam bridge.
 *
 * A thin wrapper around window.electronAPI. Keeps the Electron-specific
 * lookup in one place so the rest of the game (main.ts in particular)
 * doesn't need to know whether it's running in a browser or under
 * Electron.
 *
 * Design:
 *   - localStorage is the operational source of truth for achievement
 *     unlocks (see src/persistence.ts).
 *   - Steam is a mirror. On every successful init we reconcile both
 *     directions: push local-only unlocks up, and pull Steam-only
 *     unlocks down into localStorage.
 *   - Every call to window.electronAPI is guarded so the web build
 *     just silently skips the Steam work.
 */

import { ACHIEVEMENTS } from "./achievements";

/**
 * Map a game-side achievement id (e.g. "first-run", "score-25") to the
 * Steam API Name configured in the Steamworks partner backend
 * ("ACH_FIRST_RUN", "ACH_SCORE_25"). Uppercase with underscores and an
 * ACH_ prefix — matching the convention used by most Steam titles.
 */
export function toSteamApiName(id: string): string {
  return "ACH_" + id.replace(/-/g, "_").toUpperCase();
}

/**
 * Fire-and-forget: push an unlock to Steam. Safe to call in the
 * browser build (no-ops when window.electronAPI is undefined) and
 * safe to call when Steam init failed (IPC handler returns false).
 * Errors are swallowed — the next successful init reconcile will
 * catch anything that missed.
 */
export function pushAchievementToSteam(id: string): void {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (!api) return;
  api.unlockSteamAchievement(toSteamApiName(id)).catch(() => {
    /* swallow — reconcile on next launch will recover */
  });
}

/**
 * Reconcile local <-> Steam at startup.
 *
 * - For each catalog achievement:
 *   - local unlocked && !steam unlocked → push to Steam
 *   - !local unlocked && steam unlocked → call onRemoteDiscovery(id)
 *     so the caller can merge into state + localStorage
 *   - both unlocked or both locked → no-op
 *
 * Silent on the UI: onRemoteDiscovery is expected NOT to fire the
 * toast callback, to avoid flooding the player with notifications on
 * first launch after migrating an existing save to Steam.
 *
 * Fire-and-forget friendly: swallows all errors and resolves even
 * when window.electronAPI is absent. Safe to call without awaiting.
 */
export async function reconcileWithSteam(
  localUnlocked: Record<string, boolean>,
  onRemoteDiscovery: (id: string) => void,
): Promise<void> {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (!api) return;

  let available = false;
  try {
    available = await api.isSteam();
  } catch {
    return;
  }
  if (!available) return;

  const ids = ACHIEVEMENTS.map((a) => a.id);
  const apiNames = ids.map(toSteamApiName);

  let states: Record<string, boolean> = {};
  try {
    states = await api.getSteamAchievementStates(apiNames);
  } catch {
    return;
  }

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const apiName = apiNames[i]!;
    const steamHas = !!states[apiName];
    const localHas = !!localUnlocked[id];

    if (localHas && !steamHas) {
      // Local ahead of Steam — push. Fire-and-forget.
      api.unlockSteamAchievement(apiName).catch(() => {
        /* swallow */
      });
    } else if (!localHas && steamHas) {
      // Steam ahead of local — backfill via caller.
      onRemoteDiscovery(id);
    }
  }
}
