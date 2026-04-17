/*
 * Raptor Runner — durable persistence mirror for Capacitor.
 *
 * On the web build every export here is a no-op (the module itself
 * tree-shakes out because main.ts only calls into it under
 * __IS_CAPACITOR__ guards).
 *
 * On iOS WKWebView, localStorage is classified as non-critical web
 * data and can be evicted when the device is low on storage or after
 * ~7 days of app inactivity. That would wipe the player's high score,
 * achievements, career stats — a real data-loss bug. The fix is to
 * mirror every write to @capacitor/preferences (UserDefaults on iOS,
 * SharedPreferences on Android), and at boot, restore any key that's
 * missing from localStorage.
 *
 * Design:
 *   - localStorage remains the operational source of truth. All reads
 *     inside the game loop stay synchronous, no async rewrite needed.
 *   - Writes are fire-and-forget: localStorage first (sync), then a
 *     queued async Preferences write. A failed Preferences write just
 *     means the next session won't have that value durably persisted;
 *     the game continues to work.
 *   - Hydration runs once at boot, before the sync load block. It
 *     only writes to localStorage for keys that are CURRENTLY missing
 *     there — no "last-write-wins" conflict.
 *   - The Preferences plugin is lazily imported to keep the Capacitor
 *     SDK out of the hot init path when the user is still on the
 *     splash screen.
 */

import { Preferences } from "@capacitor/preferences";

/**
 * Copy any key that exists in Preferences but not in localStorage
 * back into localStorage. Must complete before the game's sync
 * load functions read localStorage.
 *
 * Keys should include every `raptor-runner:*` key the game writes —
 * not just the progress keys, also the audio prefs. Callers pass
 * the full list; we don't hardcode to keep coupling loose.
 *
 * Resolves (never rejects) even on plugin or storage failures —
 * returning means "best effort, continue with whatever localStorage
 * has now". A failed hydrate is indistinguishable from a fresh
 * install, which is the correct graceful-degradation behavior.
 */
export async function hydrateKeys(keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      // Already present in localStorage — fresh install is authoritative.
      if (window.localStorage.getItem(key) != null) continue;
    } catch {
      continue;
    }

    let durable: string | null = null;
    try {
      const res = await Preferences.get({ key });
      durable = res.value;
    } catch {
      continue;
    }
    if (durable == null) continue;

    try {
      window.localStorage.setItem(key, durable);
    } catch {
      /* storage denied — leave it; next write will retry */
    }
  }
}

/**
 * Fire-and-forget mirror write to Preferences. Safe to call many
 * times per frame; every call resolves independently.
 *
 * Do NOT await this. The sync localStorage write the caller did
 * immediately before is what the next load() will see in this
 * session; the durable mirror exists solely to survive eviction
 * between sessions.
 */
export function mirrorSet(key: string, value: string): void {
  Preferences.set({ key, value }).catch(() => {
    /* swallow — next write will retry, hydrate recovers at boot */
  });
}

/** Mirror a localStorage key removal. Same fire-and-forget semantics. */
export function mirrorRemove(key: string): void {
  Preferences.remove({ key }).catch(() => {
    /* swallow */
  });
}
