/*
 * Raptor Runner — localStorage persistence wrappers.
 *
 * Every read/write to localStorage goes through these helpers so that:
 *   • Private mode / denied storage fails gracefully with sane fallbacks
 *     instead of throwing at the game loop
 *   • The namespaced key strings are centralised in src/constants.ts
 *     and never typed inline
 *   • Existing players' progress is preserved forever — no function
 *     here ever renames or reformats a stored value
 *
 * This module depends only on src/constants.ts — it's a leaf of the
 * module graph and safe to import from anywhere.
 */

import {
  HIGH_SCORE_KEY,
  TOTAL_JUMPS_KEY,
  CAREER_RUNS_KEY,
  ACHIEVEMENTS_KEY,
  TOTAL_DAY_CYCLES_KEY,
  RARE_EVENTS_SEEN_KEY,
  MUTED_KEY,
  MUSIC_MUTED_KEY,
  JUMP_MUTED_KEY,
  RAIN_MUTED_KEY,
  UNLOCKED_PARTY_HAT_KEY,
  UNLOCKED_THUG_GLASSES_KEY,
  WEAR_PARTY_HAT_KEY,
  WEAR_THUG_GLASSES_KEY,
  UNLOCKED_BOW_TIE_KEY,
  WEAR_BOW_TIE_KEY,
  COINS_BALANCE_KEY,
  OWNED_COSMETICS_KEY,
  EQUIPPED_COSMETICS_KEY,
} from "./constants";
import type { CosmeticSlot } from "./cosmetics";

export type UnlockedAchievementSet = { [id: string]: true };
export type RareEventsSeen = { [id: string]: number };

// ── Durable mirror (Capacitor Preferences) ─────────────────
//
// On iOS WKWebView, localStorage is subject to eviction. Every write
// here also fires an async mirror into @capacitor/preferences so the
// player's progress survives a storage purge. The mirror module is
// lazy-imported and its loader promise is cached so we only pay the
// dynamic-import cost once per session. On the web build the guard is
// evaluated at build time to `false`, so the entire branch (and the
// mobile/ tree it references) dead-code-eliminates out of the bundle.

type MirrorApi = {
  mirrorSet(key: string, value: string): void;
  mirrorRemove(key: string): void;
};

let _mirrorApi: MirrorApi | null = null;
let _mirrorLoading: Promise<void> | null = null;

function ensureMirror(): void {
  if (!__IS_CAPACITOR__) return;
  if (_mirrorApi || _mirrorLoading) return;
  _mirrorLoading = import("./mobile/durable")
    .then((m) => {
      _mirrorApi = { mirrorSet: m.mirrorSet, mirrorRemove: m.mirrorRemove };
    })
    .catch(() => {
      /* mirror unavailable — continue with localStorage only */
    });
}

function mirrorWrite(key: string, value: string): void {
  if (!__IS_CAPACITOR__) return;
  ensureMirror();
  if (_mirrorApi) _mirrorApi.mirrorSet(key, value);
  else if (_mirrorLoading)
    _mirrorLoading.then(() => _mirrorApi?.mirrorSet(key, value));
}

/** Every persistence write in the codebase goes through this. Writes
 *  to localStorage synchronously (what the next sync load() will
 *  read) AND queues a mirror into Preferences on mobile. */
function _persistSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore — no-op in environments without localStorage */
  }
  mirrorWrite(key, value);
}

/** The complete list of keys we mirror. Kept here so
 *  hydratePersistence() has a single source of truth and the next
 *  dev to add a key can't forget to include it in the mirror. */
const DURABLE_KEYS: string[] = [
  HIGH_SCORE_KEY,
  TOTAL_JUMPS_KEY,
  CAREER_RUNS_KEY,
  ACHIEVEMENTS_KEY,
  TOTAL_DAY_CYCLES_KEY,
  RARE_EVENTS_SEEN_KEY,
  MUTED_KEY,
  MUSIC_MUTED_KEY,
  JUMP_MUTED_KEY,
  RAIN_MUTED_KEY,
  UNLOCKED_PARTY_HAT_KEY,
  UNLOCKED_THUG_GLASSES_KEY,
  WEAR_PARTY_HAT_KEY,
  WEAR_THUG_GLASSES_KEY,
  UNLOCKED_BOW_TIE_KEY,
  WEAR_BOW_TIE_KEY,
  COINS_BALANCE_KEY,
  OWNED_COSMETICS_KEY,
  EQUIPPED_COSMETICS_KEY,
];

/** Call once at boot, BEFORE any load*() function reads localStorage.
 *  On mobile, this copies any key present in Preferences but missing
 *  from localStorage (the eviction-recovery path) back into
 *  localStorage. On web it's a no-op that resolves immediately. */
export async function hydratePersistence(): Promise<void> {
  if (!__IS_CAPACITOR__) return;
  try {
    const { hydrateKeys } = await import("./mobile/durable");
    await hydrateKeys(DURABLE_KEYS);
  } catch {
    /* fall through — continue with whatever localStorage has */
  }
}

// ── High score ──────────────────────────────────────────────

export function loadHighScore(): number {
  try {
    const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

/** Persist the high score. Silently no-ops if storage is unavailable. */
export function saveHighScore(value: number): void {
  _persistSet(HIGH_SCORE_KEY, String(value));
}

// ── Career runs ─────────────────────────────────────────────

export function loadCareerRuns(): number {
  try {
    const raw = window.localStorage.getItem(CAREER_RUNS_KEY);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

export function saveCareerRuns(value: number): void {
  _persistSet(CAREER_RUNS_KEY, String(value));
}

// ── Unlocked achievements ───────────────────────────────────

export function loadUnlockedAchievements(): UnlockedAchievementSet {
  const set: UnlockedAchievementSet = Object.create(null);
  try {
    const raw = window.localStorage.getItem(ACHIEVEMENTS_KEY);
    if (!raw) return set;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const id of arr) if (typeof id === "string") set[id] = true;
    }
  } catch (e) {
    /* ignore corrupt values */
  }
  return set;
}

export function saveUnlockedAchievements(set: UnlockedAchievementSet): void {
  _persistSet(ACHIEVEMENTS_KEY, JSON.stringify(Object.keys(set)));
}

// ── Total jumps (career) ────────────────────────────────────

export function loadTotalJumps(): number {
  try {
    const raw = window.localStorage.getItem(TOTAL_JUMPS_KEY);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

export function saveTotalJumps(value: number): void {
  _persistSet(TOTAL_JUMPS_KEY, String(value));
}

// ── Total day/night cycles witnessed ────────────────────────

export function loadTotalDayCycles(): number {
  try {
    const raw = window.localStorage.getItem(TOTAL_DAY_CYCLES_KEY);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

export function saveTotalDayCycles(n: number): void {
  _persistSet(TOTAL_DAY_CYCLES_KEY, String(n));
}

// ── Rare events seen ────────────────────────────────────────

export function loadRareEventsSeen(): RareEventsSeen {
  try {
    const raw = window.localStorage.getItem(RARE_EVENTS_SEEN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export function saveRareEventsSeen(seen: RareEventsSeen): void {
  _persistSet(RARE_EVENTS_SEEN_KEY, JSON.stringify(seen));
}

// ── Generic boolean flag (per-channel mute, cosmetic unlocks) ─

/** Returns `fallback` if the key is missing or unparseable
 *  (e.g. private mode, denied storage). */
export function loadBoolFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch (e) {
    return fallback;
  }
}

export function saveBoolFlag(key: string, value: boolean): void {
  _persistSet(key, value ? "1" : "0");
}

// ── Coin balance ────────────────────────────────────────────

export function loadCoinsBalance(): number {
  try {
    const raw = window.localStorage.getItem(COINS_BALANCE_KEY);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveCoinsBalance(value: number): void {
  _persistSet(COINS_BALANCE_KEY, String(value));
}

// ── Owned cosmetics (set of ids) ────────────────────────────

export function loadOwnedCosmetics(): { [id: string]: true } {
  const set: { [id: string]: true } = Object.create(null);
  try {
    const raw = window.localStorage.getItem(OWNED_COSMETICS_KEY);
    if (!raw) return set;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const id of arr) if (typeof id === "string") set[id] = true;
    }
  } catch {
    /* ignore corrupt value */
  }
  return set;
}

export function saveOwnedCosmetics(set: { [id: string]: true }): void {
  _persistSet(OWNED_COSMETICS_KEY, JSON.stringify(Object.keys(set)));
}

// ── Equipped cosmetics (per-slot id or null) ────────────────

export type EquippedMap = Record<CosmeticSlot, string | null>;

export function loadEquippedCosmetics(): EquippedMap {
  const fallback: EquippedMap = { head: null, eyes: null, neck: null };
  try {
    const raw = window.localStorage.getItem(EQUIPPED_COSMETICS_KEY);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return fallback;
    return {
      head: typeof obj.head === "string" ? obj.head : null,
      eyes: typeof obj.eyes === "string" ? obj.eyes : null,
      neck: typeof obj.neck === "string" ? obj.neck : null,
    };
  } catch {
    return fallback;
  }
}

export function saveEquippedCosmetics(map: EquippedMap): void {
  _persistSet(EQUIPPED_COSMETICS_KEY, JSON.stringify(map));
}
