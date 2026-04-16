/*
 * Raptor Runner — constants.
 *
 * This module holds every numeric and string constant that the game
 * code treats as a tuning knob: physics parameters, visual thresholds,
 * localStorage keys, per-frame raptor sprite anchor tables, the sky
 * color palette, etc.
 *
 * Everything here is a leaf of the dependency graph — this file imports
 * nothing from any other game module, so it's safe to import anywhere.
 */

// ── Core physics & pacing ─────────────────────────────────
export const INITIAL_BG_VELOCITY = 7;
export const GRAVITY = 0.1;
export const JUMP_CLEARANCE_MULTIPLIER = 1.65;
export const SKY_CYCLE_SCORE = 60;
export const SKY_UPDATE_INTERVAL_FRAMES = 10;

// ── Gameplay & Physics ──────────────────────────────────────
export const RAPTOR_WIDTH_RATIO = 1 / 3;
export const VELOCITY_SCALE_DIVISOR = 1000;
export const DOWNWARD_ACCEL_DIVISOR = 10;
export const SPEED_INCREMENT = 0.1;
export const MAX_BG_VELOCITY = 17;
export const CACTUS_SPAWN_GAP_BASE = 1.5;
export const CACTUS_SPAWN_GAP_SPEED_FACTOR = 0.3;
export const JUMP_BUFFER_MS = 100;
export const JUMP_VIBRATION_MS = 15;
export const FRAME_DELAY_SPEED_RANGE = 15;

// ── Ground Rendering ───────────────────────────────────────
export const GROUND_HEIGHT_RATIO = 1 / 10;
export const GROUND_BAND_HEIGHTS_PX = [5, 10, 20, 200];
export const GROUND_BAND_COLORS = ["#ebc334", "#ebab21", "#ba8c27", "#EDC9AF"];

// ── Celestial Bodies (Sun & Moon) ──────────────────────────
export const SUN_PHASE_CENTER = 1 / 6;
export const MOON_PHASE_CENTER = 2 / 3;
export const CELESTIAL_ARC_HALF_WIDTH = 0.25;
export const CELESTIAL_ARC_EXTENSION = 0.18;
export const CELESTIAL_ARC_HEIGHT_RATIO = 0.7;
export const SUN_MIN_RADIUS_PX = 21;
export const SUN_RADIUS_SCALE = 0.03;
export const MOON_MIN_RADIUS_PX = 13;
export const MOON_RADIUS_SCALE = 0.0192;
export const MOON_SYNODIC_CYCLE = 30;

// ── Gamepad / controller ─────────────────────────────────
// Standard Gamepad layout button indices.
export const GAMEPAD_JUMP_BUTTONS = [0, 1, 12]; // A, B, D-pad Up
export const GAMEPAD_MENU_BUTTON = 9; // Start / Options

// ── Cinematic / filming mode (F9) ────────────────────────
// Phase values derived from SKY_COLORS band order + sun/moon arcs.
export const CINEMATIC_PHASES = [
  { key: "1", phase: 0.02, label: "Early morning" },
  { key: "2", phase: 0.167, label: "Midday (sun zenith)" },
  { key: "3", phase: 0.3, label: "Afternoon" },
  { key: "4", phase: 0.44, label: "Sunset" },
  { key: "5", phase: 0.55, label: "Early night" },
  { key: "6", phase: 0.667, label: "Midnight (moon zenith)" },
  { key: "7", phase: 0.8, label: "Late night" },
  { key: "8", phase: 0.9, label: "Pre-dawn" },
  { key: "9", phase: 0.96, label: "Sunrise" },
] as const;

// ── Dunes & Parallax ──────────────────────────────────────
export const DUNE_SCROLL_SPEED = 0.08;
export const DUNE_BASE_HEIGHT_RATIO = 0.09;
export const DUNE_CACTUS_MIN_HEIGHT_PX = 18;
export const DUNE_CACTUS_HEIGHT_RANGE_PX = 20;
export const DUNE_CACTUS_MIN_SPACING_PX = 80;
export const DUNE_CACTUS_SPACING_RANGE_PX = 200;
export const CLOUD_PARALLAX_DIVISOR = 2000;

// ── Cloud Spawning ─────────────────────────────────────────
export const CLOUD_DENSITY_DIVISOR = 380;
export const CLOUD_MIN_COUNT = 3;
export const CLOUD_RAIN_MULTIPLIER_MAX = 2;
export const CLOUD_MIN_SPACING_RATIO = 0.22;
export const CLOUD_MIN_SPACING_FLOOR_PX = 220;
export const CLOUD_HEAVY_RAIN_SPACING = 0.3;
export const CLOUD_SPAWN_INTERVAL = 8;

// ── Stars & Night Sky ──────────────────────────────────────
export const STAR_AREA_PER_STAR_PX2 = 8000;
export const STAR_MIN_COUNT = 80;
export const STAR_BRIGHT_PROBABILITY = 0.15;
export const STAR_TWINKLE_PROBABILITY = 0.65;
export const MILKY_WAY_STAR_COUNT = 220;
export const MILKY_WAY_TILT = -Math.PI / 7;
export const MILKY_WAY_LENGTH_SCALE = 1.6;
export const MILKY_WAY_THICKNESS_RATIO = 0.22;
export const STAR_ROTATION_PER_CYCLE = Math.PI * 0.1;
export const STAR_PIVOT_HEIGHT_RATIO = -1.5;

// ── Weather (Rain & Lightning) ─────────────────────────────
export const RAIN_SPAWN_DENSITY_DIVISOR = 300;
export const RAIN_FADE_IN_RATE = 0.008;
export const RAIN_FADE_OUT_RATE = 0.02;
export const RAIN_AUDIO_MAX_VOLUME = 0.2;
export const LIGHTNING_INTENSITY_THRESHOLD = 0.8;
export const LIGHTNING_FLASH_PROBABILITY = 0.002;
export const LIGHTNING_MIN_COOLDOWN_MS = 5000;
export const LIGHTNING_MAX_COOLDOWN_MS = 10000;
export const THUNDER_DELAY_MIN_MS = 100;
export const THUNDER_DELAY_MAX_MS = 600;
export const LIGHTNING_BOLT_MIN_SEGMENTS = 8;
export const LIGHTNING_BOLT_MAX_SEGMENTS = 13;

// ── Shooting Stars ─────────────────────────────────────────
export const SHOOTING_STAR_SPAWN_RATE = 0.018;
export const SHOOTING_STAR_SPEED_SCALE = 0.9;
export const SHOOTING_STAR_LIFETIME_MIN_SEC = 0.9;
export const SHOOTING_STAR_LIFETIME_MAX_SEC = 1.5;
export const SHOOTING_STAR_RAIN_THRESHOLD = 0.1;

// ── Particle Effects ───────────────────────────────────────
export const CONFETTI_BURST_COUNT = 70;
export const CONFETTI_GRAVITY_PX_S2 = 900;
export const CONFETTI_DRAG = 0.985;
export const DUST_BURST_MIN = 8;
export const DUST_BURST_MAX = 12;
export const DUST_GRAVITY_PX_S2 = 200;
export const RAINBOW_LIFETIME_SEC = 6;
export const RAINBOW_MAX_OPACITY = 0.55;
export const RAINBOW_SPAWN_CHANCE = 0.5;

// ── Game Over & Timing ─────────────────────────────────────
export const GAME_OVER_FADE_RATE = 0.01;
export const DELTA_TIME_CLAMP = 1 / 20;

// ── localStorage keys (namespaced under `raptor-runner:*`) ─
export const HIGH_SCORE_KEY = "raptor-runner:highScore";
export const MUTED_KEY = "raptor-runner:muted";
export const MUSIC_MUTED_KEY = "raptor-runner:musicMuted";
export const JUMP_MUTED_KEY = "raptor-runner:jumpMuted";
export const RAIN_MUTED_KEY = "raptor-runner:rainMuted";
export const TOTAL_JUMPS_KEY = "raptor-runner:totalJumps";
export const UNLOCKED_PARTY_HAT_KEY = "raptor-runner:unlocked:partyHat";
export const UNLOCKED_THUG_GLASSES_KEY = "raptor-runner:unlocked:thugGlasses";
export const WEAR_PARTY_HAT_KEY = "raptor-runner:wear:partyHat";
export const WEAR_THUG_GLASSES_KEY = "raptor-runner:wear:thugGlasses";
export const UNLOCKED_BOW_TIE_KEY = "raptor-runner:unlocked:bowTie";
export const WEAR_BOW_TIE_KEY = "raptor-runner:wear:bowTie";
export const CAREER_RUNS_KEY = "raptor-runner:careerRuns";
export const ACHIEVEMENTS_KEY = "raptor-runner:achievements";
export const TOTAL_DAY_CYCLES_KEY = "raptor-runner:totalDayCycles";
export const RARE_EVENTS_SEEN_KEY = "raptor-runner:rareEventsSeen";

// ── Cosmetic unlock thresholds (single-run scores) ─────────
export const PARTY_HAT_SCORE_THRESHOLD = 100;
export const THUG_GLASSES_SCORE_THRESHOLD = 500;
export const BOW_TIE_SCORE_THRESHOLD = 200;

// ── Raptor sprite sheet ────────────────────────────────────
export const RAPTOR_NATIVE_W = 578;
export const RAPTOR_NATIVE_H = 212;
export const RAPTOR_ASPECT = RAPTOR_NATIVE_H / RAPTOR_NATIVE_W;
export const RAPTOR_FRAMES = 12;
export const RAPTOR_IDLE_FRAME = 11;
export const RAPTOR_FRAME_DELAY_MIN = 40;
export const RAPTOR_FRAME_DELAY_MAX = 70;
export const RAPTOR_COLLISION_INSET = 4;

// Per-frame head reference points, extracted by scanning each frame of
// assets/raptor-sheet.png for the topmost opaque pixel (the "crown")
// and the rightmost opaque pixel in the upper head band (the "snout
// tip"). Values are normalized to the native 578x212 frame dimensions
// so the game can multiply them by the current raptor w/h to get exact
// anchor positions. Used to bob head-mounted accessories (party hat,
// thug glasses) so they track the run cycle animation instead of
// floating.
export const RAPTOR_CROWN: ReadonlyArray<readonly [number, number]> = [
  [0.86332, 0.16038], // frame 0
  [0.86678, 0.16509], // frame 1
  [0.88062, 0.17925], // frame 2
  [0.8737, 0.17453], // frame 3
  [0.86851, 0.16038], // frame 4
  [0.86851, 0.15566], // frame 5
  [0.86505, 0.16509], // frame 6
  [0.86851, 0.16981], // frame 7
  [0.87024, 0.17925], // frame 8
  [0.87543, 0.16981], // frame 9
  [0.87197, 0.16509], // frame 10
  [0.86851, 0.15566], // frame 11
];

export const RAPTOR_SNOUT: ReadonlyArray<readonly [number, number]> = [
  [0.98097, 0.25943], // frame 0
  [0.98616, 0.26415], // frame 1
  [0.99135, 0.27358], // frame 2
  [0.99827, 0.26415], // frame 3
  [0.99135, 0.25943], // frame 4
  [0.98789, 0.25472], // frame 5
  [0.98097, 0.25943], // frame 6
  [0.98616, 0.26887], // frame 7
  [0.99135, 0.27358], // frame 8
  [0.99827, 0.26415], // frame 9
  [0.99135, 0.25943], // frame 10
  [0.98616, 0.25472], // frame 11
];

// ── 12-band day/night sky palette ──────────────────────────
// Day and night are roughly equal, with shorter sunset/sunrise
// transitions in between. See main.ts for the full explanation of
// why the transition color is magenta-pink rather than orange.
export const SKY_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [80, 180, 205], // 0  blue
  [80, 180, 205], // 1  blue
  [80, 180, 205], // 2  blue
  [80, 180, 205], // 3  blue
  [80, 180, 205], // 4  blue
  [220, 90, 120], // 5  magenta-pink (sunset)
  [21, 34, 56], // 6  night
  [21, 34, 56], // 7  night
  [21, 34, 56], // 8  night
  [21, 34, 56], // 9  night
  [21, 34, 56], // 10 night
  [220, 90, 120], // 11 magenta-pink (sunrise)
];

export const NIGHT_COLOR: readonly [number, number, number] = [21, 34, 56];
