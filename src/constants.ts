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
// Score points per full day/night cycle. Derived from SKY_COLORS.length
// so the pure-day and pure-night sub-periods both stay at exactly 5
// points per band regardless of how many transition bands sit between
// them. Changing the transition count only stretches the twilight; the
// "feel" of day and night duration is preserved.
export const SKY_CYCLE_SCORE = 70;
export const SKY_UPDATE_INTERVAL_FRAMES = 10;

// ── Gameplay & Physics ──────────────────────────────────────
export const RAPTOR_WIDTH_RATIO = 1 / 3;
export const VELOCITY_SCALE_DIVISOR = 1000;
export const DOWNWARD_ACCEL_DIVISOR = 10;
export const SPEED_INCREMENT = 0.1;
export const MAX_BG_VELOCITY = 17;
// Minimum spawn gap between cacti, in raptor-widths. This is the
// floor at a fresh run — no two cacti can be closer than BASE raptor
// widths apart. Lowered from 1.5 to 1.2 so early-game feels more
// active from the first cactus.
export const CACTUS_SPAWN_GAP_BASE = 1.2;
// How much the minimum-safe floor grows as bgVelocity climbs from
// INITIAL to MAX — keeps impossible back-to-back doubles from
// spawning at terminal velocity. Floor = BASE at t=0, BASE+FACTOR
// at t=1 (i.e. 1.2w → 1.5w).
export const CACTUS_SPAWN_GAP_SPEED_FACTOR = 0.3;
// Max extra gap on top of the floor, in raptor-widths. Adds variance
// so the spawn pacing isn't metronomic but stays tight enough to
// keep the run feeling relentless. At floor=1.2w and random top-up
// up to 1.0w, the average gap is 1.7w — which happens to match the
// effective spacing produced by the pre-flower-field bug where the
// `minSpawnDistance` getter rolled fresh every frame and the
// resulting distribution collapsed to ≈floor+10%·randSpan.
//
// Dropped from 3.6 to 1.0 after the flower-field commit moved to a
// cached _nextGap (one honest roll per spawn). With 3.6, the honest
// average jumped to 3.0w and the cadence felt ~1.8× slower than
// "earlier today". 1.0 restores the remembered pace.
export const CACTUS_SPAWN_GAP_RANDOM_MAX = 1.0;
// How much the random span shrinks by the time we hit terminal
// velocity. 0.58 means the span collapses to 42% of its starting
// size at max speed (1.0w → 0.42w), keeping the "late game reads
// denser than early game" ramp the design wants.
export const CACTUS_SPAWN_GAP_RANDOM_SHRINK = 0.58;

// ── Cactus-spawn breathers (designed rest areas) ──────────
// Every so often the spawner skips a normal gap in favour of a long
// empty stretch filled with a flower field — a designed rest area
// the player walks across for ~10 seconds while no cacti spawn.
//
// Counter-driven (not probabilistic) so the pacing is predictable:
// after N cacti, the (N+1)th gap is a breather. N is randomised in
// [MIN_COUNT, MAX_COUNT] so the arrival isn't metronomic, but it
// can never crowd the last breather or go way too long between
// them — both of which a pure coin-flip produces regularly.
//
// 40–55 cacti between breathers ≈ one rest area every 1½–2 minutes
// at the new tight pacing; matches the "every 45 or so" cadence
// the design asks for.
export const CACTUS_BREATHER_MIN_COUNT = 40;
export const CACTUS_BREATHER_MAX_COUNT = 55;
// Length of each rest area in seconds-of-travel, measured against
// the current bgVelocity so the stretch feels the same regardless
// of how fast the player is going. Tightened from 9–12 to 4–6 —
// the longer window made the overall pacing feel genuinely slower
// than pre-breather-fix because the rest was such a big chunk of
// total playtime. 4–6 lands closer to "a few seconds to breathe"
// without the player feeling the game has paused.
export const CACTUS_BREATHER_MIN_SECONDS = 4;
export const CACTUS_BREATHER_MAX_SECONDS = 6;
export const JUMP_BUFFER_MS = 100;
export const JUMP_VIBRATION_MS = 15;
export const FRAME_DELAY_SPEED_RANGE = 15;

// ── Ground Rendering ───────────────────────────────────────
export const GROUND_HEIGHT_RATIO = 1 / 10;
export const GROUND_BAND_HEIGHTS_PX = [5, 10, 20, 200];
// Top band is desert-yellow topsoil; the flower-field rest areas
// overlay the top band in green (GRASS_FIELD_COLOR) via the draw
// pass in main.ts, restricted to the grassFields x-ranges. That way
// the map stays "desert" by default and grass appears only where
// it should — inside the designed rest areas.
export const GROUND_BAND_COLORS = ["#ebc334", "#ebab21", "#ba8c27", "#EDC9AF"];
/** Green used to paint the top ground band inside a flower-field
 *  rest area. Sits right over the topsoil band (GROUND_BAND_HEIGHTS_PX[0]
 *  tall) so the transition into the field reads as "grass growing
 *  on top of the sand". */
export const GRASS_FIELD_COLOR = "#7fb844";

// ── Flower patches ─────────────────────────────────────────
// Spawned inside the long "breather" gaps between cacti so those
// empty stretches read as a scenic break rather than dead grass.
// A patch is a cluster of 3–7 flowers along the grass line.
export const FLOWER_PATCH_MIN_COUNT = 3;
export const FLOWER_PATCH_MAX_COUNT = 7;
// Display height range per flower, in px. Gives a cluster a bit
// of scale variance so it doesn't read as tiled.
export const FLOWER_MIN_HEIGHT_PX = 34;
export const FLOWER_MAX_HEIGHT_PX = 58;
// Pixel width of a patch cluster. Individual flowers are
// distributed across this span with random offsets.
export const FLOWER_PATCH_WIDTH_PX = 220;

// ── Collectible coins (breather rest-area pickups) ────────
// Coins scatter across each flower-field breather at chest-height
// on the running raptor. Running through one adds COIN_SCORE_VALUE
// to the score. Spawn is driven from Cactuses._rollNextGap so
// coins always land inside the same x-range as the flower patches.
/** Score awarded per collected coin. Cactus survival is +1 per
 *  obstacle passed — coins give the same so a full field is
 *  equivalent to clearing 10 cacti. */
export const COIN_SCORE_VALUE = 1;
/** Coins added to the persistent shop balance per pickup. Separate
 *  from COIN_SCORE_VALUE so the in-run score and the across-run
 *  currency can be rebalanced independently. */
export const COIN_BANK_REWARD = 1;
/** How many coins are scattered across each flower field. Fixed
 *  count (instead of spacing-based) so the "ding-ding-diiing"
 *  pitch chain always has a predictable number of steps. */
export const COIN_COUNT_PER_FIELD = 10;
/** Distance between neighbouring coins in raptor-widths. Coins are
 *  a tight cluster centred inside the field — NOT spread across
 *  the whole field — so the pitch chain plays out as a quick run
 *  rather than a slow drip. At 0.5 × raptor.w the coin sprites
 *  overlap by about a third of their width (coin.w ≈ 0.28 ×
 *  raptor.h), reading as a stacked ribbon. The full 10-coin
 *  cluster fits inside the middle ~10% of a typical 5 s breather
 *  — unmistakably centred, not end-to-end. Clamped down to fit
 *  if the ribbon ever exceeds the breather width. */
export const COIN_SPACING_RATIO = 0.5;
/** Coin sprite height as a fraction of raptor height — keeps the
 *  coin readable against the raptor at any viewport scale. */
export const COIN_SIZE_RATIO = 0.28;
/** Center of the coin hover above ground as a fraction of raptor
 *  height. 0.65 sits the coin around upper-chest / shoulder height
 *  so it reads as "worth reaching for" while still collecting on a
 *  straight run — low enough the raptor grabs it without jumping,
 *  high enough to feel airborne instead of pinned to the torso. */
export const COIN_BASE_Y_ABOVE_GROUND_RATIO = 0.65;
/** Clearance inside a flower field where coins are NOT spawned, in
 *  raptor-widths from each edge of the field. Keeps the ribbon of
 *  coins clear of the cactus that's about to enter the field on the
 *  right and the one the raptor just jumped on the left, so a grab
 *  is never fighting with the "jump or die" beat. */
export const COIN_FIELD_EDGE_MARGIN_RAPTOR_WIDTHS = 1.25;
/** Bob amplitude in absolute px. Kept small so the coin stays
 *  within the raptor's AABB and is always collectible on contact. */
export const COIN_BOB_AMPLITUDE_PX = 6;
/** Bob frequency in Hz — one full up-down cycle per (1/freq)s. */
export const COIN_BOB_FREQUENCY_HZ = 1.2;
/** Pop-fade duration for a collected coin, in frames (60 Hz).
 *  Short — the grab should register as a snap, not a decay. */
export const COIN_COLLECT_FADE_FRAMES = 6;
/** Sparkle glint frequency — slower than bob so the two visual
 *  rhythms don't beat against each other. */
export const COIN_SPARKLE_FREQUENCY_HZ = 0.9;
/** Main glint star size as a fraction of coin width. Chunky enough
 *  that the shine reads at a glance without looking painted on. */
export const COIN_GLINT_SIZE_RATIO = 0.22;
/** Peak opacity of the main rotating glint (0..1). */
export const COIN_GLINT_MAX_ALPHA = 1.0;
/** Number of secondary twinkle sparkles drawn near each coin. They
 *  sit at fixed offsets relative to the coin, each with its own
 *  phase so neighbouring coins don't twinkle in sync. */
export const COIN_AMBIENT_TWINKLE_COUNT = 5;
/** Twinkle sparkles cycle independently of the main glint so the
 *  coin feels "alive" rather than pulsing on one rhythm. */
export const COIN_TWINKLE_FREQUENCY_HZ = 1.8;
/** Number of sparkle particles emitted when a coin is collected. */
export const COIN_COLLECT_BURST_COUNT = 16;
/** Lifetime (seconds) of each collect-burst sparkle before it fades.
 *  Short so the burst reads as a quick flash, not a lingering cloud. */
export const COIN_COLLECT_SPARK_LIFE_MIN_SEC = 0.18;
export const COIN_COLLECT_SPARK_LIFE_MAX_SEC = 0.32;
/** Max radial speed (px/s) for collect-burst sparkles. Paired with a
 *  per-particle drag so they decelerate into drift. */
export const COIN_COLLECT_SPARK_SPEED_MIN = 140;
export const COIN_COLLECT_SPARK_SPEED_MAX = 300;
/** Gain for the chain-end chord — lower than the base pickup
 *  (0.35) so the chord doesn't blow out when it layers on top of
 *  the tenth pickup's already-maxed pitch. */
export const COIN_CHAIN_END_GAIN = 0.25;
/** Pitch step per coin in a streak. The first coin plays at 1.0×
 *  playbackRate; each subsequent pickup within COIN_STREAK_RESET_MS
 *  adds this much, up to COIN_STREAK_MAX_PITCH. With 10 coins per
 *  field and step 0.07 the chain lands cleanly at 1.63× on the
 *  tenth pickup — confident rising run that stays below the cap
 *  so the chain-end chord can sit on top without clipping. */
export const COIN_STREAK_PITCH_STEP = 0.07;
/** Ceiling for the streak pitch so the top of a long chain doesn't
 *  disappear into chipmunk territory. */
export const COIN_STREAK_MAX_PITCH = 1.7;
/** If no coin is picked up for this many ms, the streak resets and
 *  the next pickup plays at base pitch again. 1500 ms comfortably
 *  covers the ~600 ms between coins in a field at any bgVelocity,
 *  while still resetting between fields if the player walks an
 *  empty stretch. Explicit per-field resets in spawnCoinsInRange
 *  are the real source of truth — this is just the safety net. */
export const COIN_STREAK_RESET_MS = 1500;

// ── Celestial Bodies (Sun & Moon) ──────────────────────────
// Sun zenith at the start of the middle day band (band 2 of 0-4),
// moon at the start of the middle night band (band 9 of 7-11).
// Expressed as band-index / SKY_COLORS.length so the anchors
// stay in lockstep with the palette if the band count ever
// changes again.
export const SUN_PHASE_CENTER = 2 / 14;
export const MOON_PHASE_CENTER = 9 / 14;
export const CELESTIAL_ARC_HALF_WIDTH = 0.25;
export const CELESTIAL_ARC_EXTENSION = 0.18;
export const CELESTIAL_ARC_HEIGHT_RATIO = 0.7;
export const SUN_MIN_RADIUS_PX = 21;
export const SUN_RADIUS_SCALE = 0.03;
export const MOON_MIN_RADIUS_PX = 13;
export const MOON_RADIUS_SCALE = 0.0192;
export const MOON_SYNODIC_CYCLE = 30;
/** Day-cycle offset added before mapping to moon phase. The very first
 *  night of a fresh save should show a small waxing crescent, not an
 *  invisible new moon, so we shift the whole cycle forward by a couple
 *  of days. A value of 2 lands the first night at ~20° past new, which
 *  draws as a visible fingernail sliver. */
export const MOON_PHASE_OFFSET_DAYS = 2;

// ── Gamepad / controller ─────────────────────────────────
// Standard Gamepad layout button indices.
// https://www.w3.org/TR/gamepad/#remapping
//
// We target a broad cross-section of controllers: Xbox-style, PS
// DualShock/DualSense, Switch Pro, generic clones. The naming of
// face buttons (ABXY vs Cross/Circle/Square/Triangle vs BAXY on
// Nintendo hardware) shifts by vendor, but Standard Mapping always
// puts the "bottom" face button at index 0 and "right" at 1 — which
// is WHY we accept all four. The ABXY/BA swap on Switch Pro means
// a Nintendo player reaching for "A to confirm" presses button 1,
// while an Xbox player reaches for "A to confirm" and presses 0.
// Treating every face button as "select" lands both correctly
// without having to detect the hardware.

/** Buttons that trigger a jump during gameplay. A, B, X, Y, and
 *  D-pad up — any face button works so players don't have to hunt
 *  for "the right one". */
export const GAMEPAD_JUMP_BUTTONS = [0, 1, 2, 3, 12];

/** Buttons that toggle the pause menu from gameplay, and close it
 *  from inside. Index 8 is Back / Select / Share / View / Minus
 *  (−), index 9 is Start / Options / Plus (+), index 16 is
 *  Guide / Home / PS / Xbox, index 17 is a few oddball pads' extra
 *  meta button. Accepting all four means the player can open the
 *  menu with whichever "system" button sits under their thumb. */
export const GAMEPAD_MENU_TOGGLE_BUTTONS = [8, 9, 16, 17];

// Back-compat aliases for the primary Start and Home indices.
export const GAMEPAD_MENU_BUTTON = 9;
export const GAMEPAD_HOME_BUTTON = 16;

/** Buttons that activate the focused menu item. Face buttons A / X
 *  / Y (indices 0, 2, 3) — deliberately excluding B (1) because B
 *  is reserved for "back" across virtually every console convention.
 *  Players who instinctively hit B expecting to back out of a
 *  sub-screen shouldn't accidentally toggle whatever happens to be
 *  focused at that moment. */
export const GAMEPAD_MENU_SELECT_BUTTONS = [0, 2, 3];
/** Buttons that mean "go back" — close the current menu / sub-
 *  overlay. Button 1 is Xbox B / PlayStation Circle / Switch Pro A
 *  (at the right face position): universally the "cancel" face
 *  button on every vendor except Japan-region PlayStation (where
 *  circle confirms), which is niche enough that we accept the
 *  tradeoff. Index 14 is D-pad left, the traditional console
 *  "previous page" direction. */
export const GAMEPAD_MENU_BACK_BUTTONS = [1, 14];

/** D-pad buttons for menu navigation. Left stick Y axis is also
 *  checked separately via `axes[1]` so players without a usable
 *  D-pad (rare but it happens on some knock-offs) can still walk
 *  the focus ring. */
export const GAMEPAD_MENU_UP_BUTTONS = [12];
export const GAMEPAD_MENU_DOWN_BUTTONS = [13];
// Left / right d-pad — only meaningful in sub-overlays that lay
// buttons out side-by-side (the reset-confirm dialog is the main
// consumer). The main menu treats all four directions as prev/next
// so a player never has to remember the layout.
export const GAMEPAD_MENU_LEFT_BUTTONS = [14];
export const GAMEPAD_MENU_RIGHT_BUTTONS = [15];

/** Left-stick Y deadzone + threshold for counting a "press up" or
 *  "press down" event. Above the threshold the stick is treated as
 *  a discrete direction; returning below the deadzone re-arms the
 *  next press. The gap between them is hysteresis — stops a stick
 *  resting near the threshold from rapid-firing navigations. */
export const GAMEPAD_STICK_PRESS_THRESHOLD = 0.6;
export const GAMEPAD_STICK_DEADZONE = 0.25;

// ── Cinematic / filming mode (F9) ────────────────────────
// Phase values derived from SKY_COLORS band order + sun/moon arcs.
// Phases are (band_index + offset) / SKY_COLORS.length, using band
// centres where "between" a phenomenon reads better than its start.
export const CINEMATIC_PHASES = [
  { key: "1", phase: 0.02, label: "Early morning" },
  { key: "2", phase: 2 / 14, label: "Midday (sun zenith)" },
  { key: "3", phase: 3.5 / 14, label: "Afternoon" },
  { key: "4", phase: 5.5 / 14, label: "Sunset" },
  { key: "5", phase: 6.5 / 14, label: "Blue hour" },
  { key: "6", phase: 7.5 / 14, label: "Early night" },
  { key: "7", phase: 9 / 14, label: "Midnight (moon zenith)" },
  { key: "8", phase: 10.5 / 14, label: "Late night" },
  { key: "9", phase: 12.5 / 14, label: "Pre-dawn blue hour" },
  { key: "0", phase: 13.5 / 14, label: "Sunrise" },
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
// Finer-grained SFX channels. Older saves won't have these set —
// the audio loader treats missing values as "not muted" so every
// channel defaults to ON on first launch.
export const FOOTSTEPS_MUTED_KEY = "raptor-runner:footstepsMuted";
export const COINS_MUTED_KEY = "raptor-runner:coinsMuted";
export const UI_MUTED_KEY = "raptor-runner:uiMuted";
export const EVENTS_MUTED_KEY = "raptor-runner:eventsMuted";
export const THUNDER_MUTED_KEY = "raptor-runner:thunderMuted";
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
// ── Coin economy ───────────────────────────────────────────
/** Persistent lifetime coin balance — earned by picking up coins
 *  during runs, spent at the cosmetics shop. */
export const COINS_BALANCE_KEY = "raptor-runner:coinsBalance";
/** JSON array of owned cosmetic ids (buys + score unlocks). */
export const OWNED_COSMETICS_KEY = "raptor-runner:ownedCosmetics";
/** JSON object {head, eyes, neck} → cosmetic id or null — the
 *  currently-equipped piece in each slot. */
export const EQUIPPED_COSMETICS_KEY = "raptor-runner:equippedCosmetics";

// ── Cosmetic unlock thresholds (single-run scores) ─────────
// Rebalanced from 100/200/500 → 100/150/200. The original top tier
// at 500 was steep enough that almost no one reached it; this
// compresses the ladder so each unlock is genuinely attainable
// within a focused session.
export const PARTY_HAT_SCORE_THRESHOLD = 100;
export const BOW_TIE_SCORE_THRESHOLD = 150;
export const THUG_GLASSES_SCORE_THRESHOLD = 200;

// ── Raptor sprite sheet ────────────────────────────────────
export const RAPTOR_NATIVE_W = 578;
export const RAPTOR_NATIVE_H = 212;
export const RAPTOR_ASPECT = RAPTOR_NATIVE_H / RAPTOR_NATIVE_W;
export const RAPTOR_FRAMES = 12;
export const RAPTOR_IDLE_FRAME = 11;
// Animation cadence for the running loop. frameDelay scales inversely
// with bgVelocity — MAX at the start-of-run slow pace, MIN at top
// speed. Original values were 70 / 40 (feet pedaling air). Tightened
// in two 1.3x passes (70→54→42, 40→31→24) for a combined ~1.67x
// speedup — the feet now drive the motion instead of lagging it.
//
// The step SFX (src/audio.ts playStep + src/entities/raptor.ts frame-
// advance handler) fire on frames 0 and 6 of the 12-frame walk cycle,
// so they're frame-synced: changing these constants automatically
// retimes the grass-running footfalls at the same ratio without
// needing a separate step-interval knob.
export const RAPTOR_FRAME_DELAY_MIN = 24;
export const RAPTOR_FRAME_DELAY_MAX = 42;
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

// Per-frame animation corrections for the NECK and BACK anchors.
//
// Every slot-default cx/cy in raptor._drawCosmeticPlaceholder is
// derived from the crown (a per-frame lookup) plus a fixed anatomical
// offset. That's right on AVERAGE but wrong per-frame: the actual
// back barely bobs while the crown dips with the stride, and the
// throat/neck bends on a slightly delayed cycle from the head. Without
// correcting for this the bandana tracks the head bob instead of the
// throat, and wings slosh around exaggeratedly instead of staying
// pinned to a near-rigid shoulder blade.
//
// Values below were extracted by scanning each frame of
// assets/raptor-sheet.png for the topmost opaque pixel in the
// upper-back region ([0.35W, 0.55W]) for BACK, and the rightmost
// opaque pixel in the throat valley (where the head's body-facing
// curve meets the chest) for NECK — then subtracting the crown's
// per-frame delta from each so the correction is zero-mean. Adding
// this to the crown-derived cy gives cosmetic anchors that track
// their actual body part instead of the head.
export const RAPTOR_BACK_CORRECTION: ReadonlyArray<readonly [number, number]> = [
  [+0.00678, -0.00118], // frame 0
  [+0.00332, +0.00354], // frame 1
  [-0.01225, -0.00119], // frame 2
  [-0.0036, -0.0059], // frame 3
  [+0.00159, +0.00353], // frame 4
  [+0.00332, +0.00354], // frame 5
  [+0.00505, -0.00118], // frame 6
  [+0.00159, -0.00118], // frame 7
  [-0.00187, -0.00119], // frame 8
  [-0.00533, -0.00118], // frame 9
  [-0.00187, -0.00118], // frame 10
  [+0.00332, +0.00354], // frame 11
];
export const RAPTOR_NECK_CORRECTION: ReadonlyArray<readonly [number, number]> = [
  [+0.0036, -0.00079], // frame 0
  [+0.00187, -0.00078], // frame 1
  [-0.01197, +0.00393], // frame 2
  [-0.00332, +0.00393], // frame 3
  [+0.00187, -0.00079], // frame 4
  [+0.00187, -0.00078], // frame 5
  [+0.0036, -0.00078], // frame 6
  [+0.00187, -0.00078], // frame 7
  [+0.00014, +0.00393], // frame 8
  [-0.00159, -0.00078], // frame 9
  [+0.00014, -0.0055], // frame 10
  [+0.00187, -0.00078], // frame 11
];

// ── 14-band day/night sky palette ──────────────────────────
// 5 day + sunset + blue-hour + 5 night + blue-hour + sunrise.
//
// Twilight now takes TWO bands on each side instead of one:
//   day → magenta sunset → blue-hour indigo → night
// The magenta is the dramatic pink-horizon moment; the blue hour
// is the deep-blue twilight that actually precedes night and
// follows sunset in the real world. Chaining the two bands keeps
// each lerp step short (one band each), so the ugly desaturated
// mauve-grey that sits halfway between day-blue and magenta is
// only briefly visible — the eye passes through it on the way
// into the magenta, rather than dwelling on it as "the"
// transition colour like it did with the original single-band
// twilight. SKY_CYCLE_SCORE scales from 60 → 70 to keep pure
// day and pure night each at exactly 5 points per band (25 pts),
// matching the old cycle; the extra 10 points/cycle is the
// blue-hour extension the user asked for.
export const SKY_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [80, 180, 205], // 0  blue (day)
  [80, 180, 205], // 1  blue (day)
  [80, 180, 205], // 2  blue (day)
  [80, 180, 205], // 3  blue (day)
  [80, 180, 205], // 4  blue (day)
  [220, 90, 120], // 5  magenta-pink (sunset)
  [40, 65, 130], // 6  blue hour (post-sunset)
  [21, 34, 56], // 7  night
  [21, 34, 56], // 8  night
  [21, 34, 56], // 9  night
  [21, 34, 56], // 10 night
  [21, 34, 56], // 11 night
  [40, 65, 130], // 12 blue hour (pre-sunrise)
  [220, 90, 120], // 13 magenta-pink (sunrise)
];

export const NIGHT_COLOR: readonly [number, number, number] = [21, 34, 56];
