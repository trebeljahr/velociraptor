/*
 * Raptor Runner — game state singleton.
 *
 * A single mutable object that holds everything the game loop reads
 * and writes during a run: viewport dimensions, physics scalars, the
 * day/night cycle, particle arrays, rain weather state, cosmetic
 * unlocks, and the persisted career counters loaded at init.
 *
 * This module is a leaf of the dependency graph — it imports only
 * from src/constants.ts. Every subsystem (entities, effects, render,
 * physics, gameplay, api) imports `state` from here.
 *
 * Types are deliberately loose for the initial port: particle arrays
 * are `any[]`, optional fields use `any | null`. They'll be tightened
 * in follow-up work once the consumer modules are split out and have
 * their own type definitions to hand back here.
 */

import { INITIAL_BG_VELOCITY, SKY_COLORS } from "./constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GameState {
  // ── Viewport dimensions ─────────────────────────────
  width: number;
  height: number;
  groundHeight: number;
  ground: number;

  // ── Physics / scoring ───────────────────────────────
  bgVelocity: number;
  score: number;
  /** Personal best, persisted to localStorage under HIGH_SCORE_KEY.
   *  Loaded once at init, updated on game-over if the current run
   *  beat it. */
  highScore: number;
  /** True for the run that just broke the previous record — drives
   *  the game-over overlay celebration. */
  newHighScore: boolean;

  // ── Run lifecycle ───────────────────────────────────
  gameOver: boolean;
  gameOverFade: number;
  gameOverFrame: number;
  started: boolean;
  paused: boolean;
  frame: number;

  // ── Day/night cycle ─────────────────────────────────
  /** Current interpolated sky color — a mutable 3-tuple shared across
   *  the sky, cloud, and tint rendering paths. */
  currentSky: number[];
  lastSkyScore: number;
  isNight: boolean;
  /** Continuous version of (score / SKY_CYCLE_SCORE), smoothed every
   *  frame so the sun/moon arc and star rotation move smoothly even
   *  though score is integer-stepped. */
  smoothPhase: number;
  /** Monotonic frame-based angle used to rotate the night-sky dome
   *  (stars + Milky Way) gently across the screen. */
  starRotation: number;

  /** Timestamp of the previous update() call, used to derive the
   *  per-frame delta-time for frame-rate independence. Reset to null
   *  on pause/reset so the first post-resume frame doesn't see a
   *  huge stale delta. */
  lastNow: number | null;

  // ── Career & per-run counters ──────────────────────
  /** Total jumps the player has ever performed. Persists across
   *  sessions via localStorage (TOTAL_JUMPS_KEY). */
  totalJumps: number;
  /** Jumps performed within the current run only. Resets on every
   *  resetGame(). Drives the per-run cosmetic unlocks (party hat at
   *  100, thug glasses at 200) so the player has to earn them in a
   *  single go. */
  runJumps: number;
  /** Nights fully survived within the current run. Incremented when
   *  state.isNight goes from true → false (i.e. dawn arrives while
   *  the raptor is still alive). */
  runNightsSurvived: number;
  /** Was the raptor in the night portion of the cycle on the previous
   *  frame? Tracked so we can detect the night → day transition
   *  without double-counting. */
  _wasInNight: boolean;
  /** Shooting stars seen during the current run. */
  runShootingStars: number;

  careerRuns: number;
  /** Set of unlocked achievement IDs. Serialized as a JSON array in
   *  localStorage so the player keeps their trophies across visits. */
  unlockedAchievements: { [id: string]: true };
  /** Was the player muted for the entire current run? Flipped to
   *  false the instant the player touches the mute toggle mid-run. */
  _runMutedThroughout: boolean;

  // ── Cosmetic unlocks (sticky) and wear prefs ───────
  unlockedPartyHat: boolean;
  wearPartyHat: boolean;
  unlockedThugGlasses: boolean;
  wearThugGlasses: boolean;
  unlockedBowTie: boolean;
  wearBowTie: boolean;

  // ── Particle / effect arrays ───────────────────────
  /* eslint-disable @typescript-eslint/no-explicit-any */
  shootingStars: any[];
  confetti: any[];
  dust: any[];
  ash: any[];
  activeRareEvent: any | null;
  _rareEventsSeen: { [id: string]: number };
  moonPhase: number;
  clouds: any[];
  duneOffset: number;

  // ── Dune parallax (populated by initDunes) ─────────
  duneCacti: any[];
  _nextDuneCactusX: number;

  // ── Rain weather ───────────────────────────────────
  totalDayCycles: number;
  lastCycleIndex: number;
  isRaining: boolean;
  rainIntensity: number;
  rainEndPhase: number;
  rainParticles: any[];
  lightning: { alpha: number; nextAt: number; bolt?: any };
  rainbow: { age: number; life: number } | null;
  _cloudDensity: number;

  // ── Debug helpers (toggled via ?debug=true or menu) ─
  debug: boolean;
  showHitboxes: boolean;
  noCollisions: boolean;
  _debugRainStop?: boolean;
  _pendingNights?: number;

  // ── Cinematic / filming mode (F9) ─────────────────────
  cinematicMode: boolean;
  cinematicPhaseLock: number | null;
  cinematicShowHUD: boolean;
  _preCinematicNoCollisions: boolean;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export const state: GameState = {
  width: 0,
  height: 0,
  groundHeight: 0,
  ground: 0,
  bgVelocity: INITIAL_BG_VELOCITY,
  score: 0,
  highScore: 0,
  newHighScore: false,
  gameOver: false,
  gameOverFade: 0,
  gameOverFrame: 0,
  started: false,
  paused: true,
  frame: 0,
  currentSky: [...SKY_COLORS[0]],
  lastSkyScore: -1,
  isNight: false,
  smoothPhase: 0,
  starRotation: 0,
  lastNow: null,
  totalJumps: 0,
  runJumps: 0,
  runNightsSurvived: 0,
  _wasInNight: false,
  runShootingStars: 0,
  careerRuns: 0,
  unlockedAchievements: {},
  _runMutedThroughout: false,
  unlockedPartyHat: false,
  wearPartyHat: true,
  unlockedThugGlasses: false,
  wearThugGlasses: true,
  unlockedBowTie: false,
  wearBowTie: true,
  shootingStars: [],
  confetti: [],
  dust: [],
  ash: [],
  activeRareEvent: null,
  _rareEventsSeen: {},
  moonPhase: 0,
  clouds: [],
  duneOffset: 0,
  duneCacti: [],
  _nextDuneCactusX: 0,
  totalDayCycles: 0,
  lastCycleIndex: -1,
  isRaining: false,
  rainIntensity: 0,
  rainEndPhase: 0,
  rainParticles: [],
  lightning: { alpha: 0, nextAt: 0 },
  rainbow: null,
  _cloudDensity: 1,
  debug: false,
  showHitboxes: false,
  noCollisions: false,
  cinematicMode: false,
  cinematicPhaseLock: null,
  cinematicShowHUD: true,
  _preCinematicNoCollisions: false,
};
