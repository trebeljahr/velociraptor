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
} from "./constants";

export type UnlockedAchievementSet = { [id: string]: true };
export type RareEventsSeen = { [id: string]: number };

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
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(value));
  } catch (e) {
    /* ignore — no-op in environments without localStorage */
  }
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
  try {
    window.localStorage.setItem(CAREER_RUNS_KEY, String(value));
  } catch (e) {
    /* ignore */
  }
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
  try {
    const arr = Object.keys(set);
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(arr));
  } catch (e) {
    /* ignore */
  }
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
  try {
    window.localStorage.setItem(TOTAL_JUMPS_KEY, String(value));
  } catch (e) {
    /* ignore */
  }
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
  try {
    window.localStorage.setItem(TOTAL_DAY_CYCLES_KEY, String(n));
  } catch (e) {
    /* ignored */
  }
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
  try {
    window.localStorage.setItem(RARE_EVENTS_SEEN_KEY, JSON.stringify(seen));
  } catch (e) {
    /* ignored */
  }
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
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch (e) {
    /* ignore */
  }
}
