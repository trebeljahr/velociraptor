/*
 * Raptor Runner — vanilla canvas + requestAnimationFrame rewrite.
 *
 * Architecture:
 *   • All drawing is done on a single <canvas id="game-canvas"> that
 *     sits behind the UI overlays (start screen, menu, imprint, cog).
 *   • The raptor sprite is a separate <img id="raptor-sprite"> positioned
 *     absolutely over the canvas. The browser handles GIF animation for
 *     free — we just translate the element each frame.
 *   • Music and jump SFX are native <audio> elements controlled directly
 *     from the HTML layer via the Game API. No p5.sound.
 *   • Input: pointerdown on canvas (covers mouse + touch + pen),
 *     keydown on window (Space/W/Up to jump, Enter to restart).
 *   • The game loop is a plain requestAnimationFrame. `state.paused` is
 *     used to gate update() without stopping render() so the canvas
 *     stays visible while the menu/start-screen is open.
 *
 * Public API (exposed on window.Game):
 *   Game.onReady(cb)         – invoked once assets are loaded
 *   Game.start()             – unpauses the game (call after the user
 *                              clicks the Start Game button)
 *   Game.pause() / resume()  – called when menus open/close
 *   Game.isStarted()         – true after Game.start() has been called
 *   Game.setMuted(muted: boolean)     – controls both music and jump SFX
 *   Game.isMuted()
 *
 * TypeScript port notes:
 *   • This is the pragmatic first pass: the 5,400-line game.js was
 *     copied here verbatim so the game runs under Vite + TS. `@ts-nocheck`
 *     is in place while the module split (into src/constants.ts,
 *     src/state.ts, src/audio.ts, src/entities/, src/effects/, etc.) is
 *     done incrementally in follow-up work. Once a file is fully typed,
 *     its code moves out of here and `@ts-nocheck` can eventually be
 *     removed.
 */
import "./styles/base.css";
// ScoreCardWorker import moved into src/render/scoreCard.ts.
import {
  INITIAL_BG_VELOCITY,
  GRAVITY,
  JUMP_CLEARANCE_MULTIPLIER,
  SKY_CYCLE_SCORE,
  SKY_UPDATE_INTERVAL_FRAMES,
  RAPTOR_WIDTH_RATIO,
  VELOCITY_SCALE_DIVISOR,
  DOWNWARD_ACCEL_DIVISOR,
  SPEED_INCREMENT,
  MAX_BG_VELOCITY,
  CACTUS_SPAWN_GAP_BASE,
  CACTUS_SPAWN_GAP_SPEED_FACTOR,
  JUMP_BUFFER_MS,
  JUMP_VIBRATION_MS,
  FRAME_DELAY_SPEED_RANGE,
  GROUND_HEIGHT_RATIO,
  GROUND_BAND_HEIGHTS_PX,
  GROUND_BAND_COLORS,
  SUN_PHASE_CENTER,
  MOON_PHASE_CENTER,
  CELESTIAL_ARC_HALF_WIDTH,
  CELESTIAL_ARC_EXTENSION,
  CELESTIAL_ARC_HEIGHT_RATIO,
  SUN_MIN_RADIUS_PX,
  SUN_RADIUS_SCALE,
  MOON_MIN_RADIUS_PX,
  MOON_RADIUS_SCALE,
  DUNE_SCROLL_SPEED,
  DUNE_BASE_HEIGHT_RATIO,
  DUNE_CACTUS_MIN_HEIGHT_PX,
  DUNE_CACTUS_HEIGHT_RANGE_PX,
  DUNE_CACTUS_MIN_SPACING_PX,
  DUNE_CACTUS_SPACING_RANGE_PX,
  CLOUD_PARALLAX_DIVISOR,
  CLOUD_DENSITY_DIVISOR,
  CLOUD_MIN_COUNT,
  CLOUD_RAIN_MULTIPLIER_MAX,
  CLOUD_MIN_SPACING_RATIO,
  CLOUD_MIN_SPACING_FLOOR_PX,
  CLOUD_HEAVY_RAIN_SPACING,
  CLOUD_SPAWN_INTERVAL,
  STAR_AREA_PER_STAR_PX2,
  STAR_MIN_COUNT,
  STAR_BRIGHT_PROBABILITY,
  STAR_TWINKLE_PROBABILITY,
  MILKY_WAY_STAR_COUNT,
  MILKY_WAY_TILT,
  MILKY_WAY_LENGTH_SCALE,
  MILKY_WAY_THICKNESS_RATIO,
  STAR_ROTATION_PER_CYCLE,
  STAR_PIVOT_HEIGHT_RATIO,
  RAIN_SPAWN_DENSITY_DIVISOR,
  RAIN_FADE_IN_RATE,
  RAIN_FADE_OUT_RATE,
  RAIN_AUDIO_MAX_VOLUME,
  LIGHTNING_INTENSITY_THRESHOLD,
  LIGHTNING_FLASH_PROBABILITY,
  LIGHTNING_MIN_COOLDOWN_MS,
  LIGHTNING_MAX_COOLDOWN_MS,
  THUNDER_DELAY_MIN_MS,
  THUNDER_DELAY_MAX_MS,
  LIGHTNING_BOLT_MIN_SEGMENTS,
  LIGHTNING_BOLT_MAX_SEGMENTS,
  SHOOTING_STAR_SPAWN_RATE,
  SHOOTING_STAR_SPEED_SCALE,
  SHOOTING_STAR_LIFETIME_MIN_SEC,
  SHOOTING_STAR_LIFETIME_MAX_SEC,
  SHOOTING_STAR_RAIN_THRESHOLD,
  CONFETTI_BURST_COUNT,
  CONFETTI_GRAVITY_PX_S2,
  CONFETTI_DRAG,
  DUST_BURST_MIN,
  DUST_BURST_MAX,
  DUST_GRAVITY_PX_S2,
  RAINBOW_LIFETIME_SEC,
  RAINBOW_MAX_OPACITY,
  RAINBOW_SPAWN_CHANCE,
  GAME_OVER_FADE_RATE,
  DELTA_TIME_CLAMP,
  HIGH_SCORE_KEY,
  MUTED_KEY,
  MUSIC_MUTED_KEY,
  JUMP_MUTED_KEY,
  RAIN_MUTED_KEY,
  TOTAL_JUMPS_KEY,
  UNLOCKED_PARTY_HAT_KEY,
  UNLOCKED_THUG_GLASSES_KEY,
  WEAR_PARTY_HAT_KEY,
  WEAR_THUG_GLASSES_KEY,
  UNLOCKED_BOW_TIE_KEY,
  WEAR_BOW_TIE_KEY,
  CAREER_RUNS_KEY,
  ACHIEVEMENTS_KEY,
  TOTAL_DAY_CYCLES_KEY,
  RARE_EVENTS_SEEN_KEY,
  PARTY_HAT_SCORE_THRESHOLD,
  THUG_GLASSES_SCORE_THRESHOLD,
  BOW_TIE_SCORE_THRESHOLD,
  RAPTOR_NATIVE_W,
  RAPTOR_NATIVE_H,
  RAPTOR_ASPECT,
  RAPTOR_FRAMES,
  RAPTOR_IDLE_FRAME,
  RAPTOR_FRAME_DELAY_MIN,
  RAPTOR_FRAME_DELAY_MAX,
  RAPTOR_COLLISION_INSET,
  RAPTOR_CROWN,
  RAPTOR_SNOUT,
  SKY_COLORS,
  NIGHT_COLOR,
  GAMEPAD_JUMP_BUTTONS,
  GAMEPAD_MENU_BUTTON,
  CINEMATIC_PHASES,
} from "./constants";
import {
  loadHighScore,
  saveHighScore,
  loadCareerRuns,
  saveCareerRuns,
  loadUnlockedAchievements,
  saveUnlockedAchievements,
  loadTotalJumps,
  saveTotalJumps,
  loadTotalDayCycles,
  saveTotalDayCycles,
  loadRareEventsSeen,
  saveRareEventsSeen,
  loadBoolFlag,
  saveBoolFlag,
  hydratePersistence,
} from "./persistence";
import { hapticDeath } from "./haptic";
import {
  lerp,
  lerpColor,
  rgb,
  rgba,
  randRange,
  clamp,
  polygonsOverlap,
  pointInPolygon,
  segmentsIntersect,
  cross,
  shrinkPolygon,
  moonPhaseFromCycles,
} from "./helpers";
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID } from "./achievements";
import { CACTUS_VARIANTS } from "./cactusVariants";
import { IMAGE_SRCS, IMAGES } from "./images";
import { audio } from "./audio";
import { state } from "./state";
import { contexts, initCanvas } from "./canvas";
import { Stars } from "./entities/stars";
import { Raptor } from "./entities/raptor";
import { Cactus, Cactuses } from "./entities/cactus";
import {
  setParticlesAchievementHandler,
  bakeShootingStarSprite,
  maybeSpawnShootingStar,
  updateShootingStars,
  drawShootingStars,
  spawnConfettiBurst,
  updateConfetti,
  drawConfetti,
  spawnDust,
  updateDust,
  drawDust,
  spawnAsh,
  updateAsh,
  drawAsh,
  SHOOTING_STAR_TRAIL_LEN,
  SHOOTING_STAR_TRAIL_H,
  warmShootingStarSprite,
} from "./effects/particles";
import {
  shouldRainForCycle,
  spawnRain,
  updateRain,
  drawRain,
  updateLightning,
  drawLightning,
  _generateBoltPath,
} from "./effects/weather";
import {
  RARE_EVENTS,
  maybeSpawnRareEvent,
  updateRareEvent,
  setRareEventsAchievementHandler,
  setDuneHeightProvider,
  drawRareEventSky,
  drawUfoBeam,
  drawRareEventFg,
  drawRareEvent,
} from "./effects/rareEvents";
import { pushAchievementToSteam, reconcileWithSteam } from "./steamBridge";
import {
  unlockAchievement as reportAchievementToServices,
  submitScore as reportScoreToServices,
} from "./services/gameServices";
import {
  _isNightBand,
  _isDayBand,
  isNightPhase,
  tintStrength,
  tintFactor,
  celestialArc,
  drawSun,
  drawMoon,
  computeSkyGradient,
} from "./render/sky";
import {
  drawPolygon,
  drawCloud,
  drawOvercastBands,
  drawCloudMorphed,
  cloudVisualWidth,
  targetCloudCount,
  minCloudSpacing,
  makeCloudObject,
  trySpawnCloud,
  seedClouds,
} from "./render/clouds";
import { duneHeight, spawnDuneCactus, initDunes } from "./render/world";
import { generateScoreCardBlob } from "./render/scoreCard";

  // ══════════════════════════════════════════════════════════════════
  // Constants
  //
  // Pure numeric/string/key constants live in src/constants.ts and are
  // imported at the top of this file. The catalog-shaped constants
  // (ACHIEVEMENTS, CACTUS_VARIANTS, IMAGE_SRCS) still live here until
  // they move into their own dedicated modules.
  // ══════════════════════════════════════════════════════════════════

  // The ACHIEVEMENTS catalog and ACHIEVEMENTS_BY_ID lookup live in
  // src/achievements.ts. The unlockAchievement() function below still
  // lives here until state and GameAPI are split out.

  // Raptor sprite constants (RAPTOR_NATIVE_W/H, RAPTOR_FRAMES,
  // RAPTOR_IDLE_FRAME, RAPTOR_CROWN, RAPTOR_SNOUT, RAPTOR_FRAME_DELAY_*,
  // RAPTOR_COLLISION_INSET) live in src/constants.ts and are imported
  // at the top of this file.

  // CACTUS_VARIANTS (sprite + collision catalog) lives in
  // src/cactusVariants.ts.

  // The 12-band day/night palette (SKY_COLORS) and NIGHT_COLOR live in
  // _isNightBand / _isDayBand / isNightPhase / tintStrength /
  // tintFactor / celestialArc / drawSun / drawMoon /
  // computeSkyGradient all live in src/render/sky.ts.

  // IMAGE_SRCS (key → path) and IMAGES (runtime dictionary) live in
  // src/images.ts. The preloader later in this file populates IMAGES.

  // ══════════════════════════════════════════════════════════════════
  // Math + collision helpers
  //
  // Pure helpers (lerp, lerpColor, rgb, rgba, randRange, clamp,
  // polygonsOverlap, pointInPolygon, segmentsIntersect, cross,
  // shrinkPolygon) live in src/helpers.ts and are imported at the top
  // of this file. tintStrength / tintFactor stay here because they
  // read state.currentSky.
  // ══════════════════════════════════════════════════════════════════

  // tintStrength / tintFactor / helpers all imported at the top.

  // ══════════════════════════════════════════════════════════════════
  // Audio (native HTMLAudioElement — no p5.sound)
  //
  // The audio singleton lives in src/audio.ts and is imported at the
  // top of this file. The Sound-of-Silence achievement invalidation
  // (previously inline in audio.setMuted) is now wired as a callback
  // during init() below.
  // ══════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════
  // Game state
  //
  // The `state` singleton lives in src/state.ts and is imported at
  // the top of this file. It's a flat mutable object; every subsystem
  // reads and writes the same reference.
  // ══════════════════════════════════════════════════════════════════

  // These are populated in init() which runs before any game code
  // reads them. The `null as unknown as T` cast avoids hundreds of
  // null-checks in the game loop while keeping the declared type
  // correct for consumer code.
  let canvas = null as unknown as HTMLCanvasElement;
  let ctx = null as unknown as CanvasRenderingContext2D;
  let skyCanvas = null as unknown as HTMLCanvasElement;
  let skyCtx = null as unknown as CanvasRenderingContext2D;
  let fgCanvas = null as unknown as HTMLCanvasElement;
  let fgCtx = null as unknown as CanvasRenderingContext2D;
  let deathCanvas = null as unknown as HTMLCanvasElement;
  let deathCtx = null as unknown as CanvasRenderingContext2D;
  let deathSnapshotReady = false;
  let _rafId = 0;
  let raptor = null as unknown as Raptor;
  let cactuses = null as unknown as Cactuses;
  let stars = null as unknown as Stars;

  // ══════════════════════════════════════════════════════════════════
  // Entities
  // ══════════════════════════════════════════════════════════════════

  // The Raptor class lives in src/entities/raptor.ts. Its two
  // side-effect hooks (onLand for dust spawning, onJump for rare-event
  // rolls) are passed at construction time in init() below.

  // Cactus + Cactuses classes live in src/entities/cactus.ts.
  // Cactuses takes a raptor instance + two callbacks (achievement
  // unlock, cosmetic burst spawner) at construction time in init().

  // ════════════════════════════════════════════════════════════════
  // Stars + Milky Way
  //
  // The night sky is a "dome" that we rotate around a pivot point
  // far above the visible viewport. Star positions are generated
  // once across an area wider/taller than the viewport so that as
  // the dome rotates, stars enter from one edge and exit the other
  // without empty patches appearing at the corners.
  //
  // The Milky Way is a denser band of small stars + a soft haze
  // strip drawn along a tilted line. It lives in the same rotated
  // frame so it drifts in/out with the rest of the sky.
  // ════════════════════════════════════════════════════════════════

  // The Stars class lives in src/entities/stars.ts.

  // ════════════════════════════════════════════════════════════════
  // Shooting stars (easter egg)
  //
  // Spawned only from the SECOND night onward. Each shooting star
  // is a pre-rendered trail sprite (baked once into an offscreen
  // canvas) that we translate + rotate + drawImage per frame —
  // avoids any per-frame gradient compile or path building, so
  // the first shooting star doesn't stall the frame.
  // ════════════════════════════════════════════════════════════════

  // Shooting star spawning/update/baking lives in src/effects/particles.ts.

  // Confetti / dust / ash particle systems live in
  // src/effects/particles.ts.

  // RARE_EVENTS catalog, maybeSpawnRareEvent, and updateRareEvent
  // live in src/effects/rareEvents.ts. The achievement unlock hook
  // and the dune-height provider are registered during init() above.
  // All rare event code (catalog, spawn, update, draw) lives in
  // src/effects/rareEvents.ts.
  // ── Rain weather system ────────────────────────────────────────

  // loadTotalDayCycles / saveTotalDayCycles live in src/persistence.ts.

  // shouldRainForCycle / spawnRain / updateRain / drawRain live in
  // src/effects/weather.ts. Lightning and rainbow still live in this
  // file because they're entangled with dune-cactus rendering and
  // achievement unlocks — they'll migrate once the render code
  // splits out.

  // updateLightning / _generateBoltPath / _drawBolt / drawLightning
  // live in src/effects/weather.ts.

  // drawShootingStars lives in src/effects/particles.ts.

  // Sun + Moon rendering lives in src/render/sky.ts.

  // Cloud system lives in src/render/clouds.ts.
  // Dunes (duneHeight, spawnDuneCactus, initDunes) live in
  // src/render/world.ts.

  // computeSkyGradient lives in src/render/sky.ts.

  // Score card rendering lives in src/render/scoreCard.ts.

  // ══════════════════════════════════════════════════════════════════
  // Update + render
  // ══════════════════════════════════════════════════════════════════

  function update(now: number) {
    state.frame++;

    // ── Delta-time / frame-rate independence ────────────────────
    // Every per-frame integration in the game (raptor physics,
    // cactus and cloud drift, star/smoothPhase advance, sky-color
    // lerp, star opacity fade) was originally written assuming a
    // steady 60fps step. `frameScale` is "how many 60fps frames
    // this actual frame represents", so multiplying any of those
    // integrations by it makes the game run at the same real-time
    // speed on a 60Hz display, a 120Hz one, or a 30fps one.
    //
    // We clamp the upper bound at 1/20s (≈3 frames at 60fps) so a
    // browser tab-switch or long GC pause doesn't teleport the
    // raptor through a cactus when the loop resumes.
    const prevNow = state.lastNow || now;
    const rawDtSec = (now - prevNow) / 1000;
    state.lastNow = now;
    const dtSec = Math.min(Math.max(rawDtSec, 0), DELTA_TIME_CLAMP);
    const frameScale = dtSec * 60; // 1.0 at 60fps, 0.5 at 120fps

    // Continuous, monotonic day-phase. Drives the sky color, the
    // sun/moon arc, and the star rotation so they all stay locked
    // together.
    const speedMult = state.bgVelocity / INITIAL_BG_VELOCITY;
    state.smoothPhase += (speedMult / (SKY_CYCLE_SCORE * 60)) * frameScale;

    // Cinematic phase lock — freeze the day/night cycle at a
    // specific point so a shot can be recomposed without the
    // sky drifting between takes.
    if (state.cinematicPhaseLock !== null) {
      state.smoothPhase = state.cinematicPhaseLock;
    }

    // Rain cycle tracking: detect when we enter a new day cycle.
    const cycleIndex = Math.floor(state.smoothPhase);
    if (cycleIndex > state.lastCycleIndex && state.lastCycleIndex >= 0) {
      state.totalDayCycles += 1;
      saveTotalDayCycles(state.totalDayCycles);
      // Moon phase: realistic ~29.5 day synodic month
      state.moonPhase = moonPhaseFromCycles(state.totalDayCycles);
      if (Math.abs(state.moonPhase - 0.5) < 0.02)
        unlockAchievement("full-moon");
      // Start rain at cycle boundaries; duration is 0.3–1.2 day cycles
      if (!state.isRaining && shouldRainForCycle(state.totalDayCycles)) {
        state.isRaining = true;
        state.rainEndPhase = state.smoothPhase + 0.3 + Math.random() * 0.9;
        // Mark that the player witnessed this storm's beginning — a
        // prerequisite for the rainy-day achievement when it ends.
        state._runSawRainStart = true;
      }
    }
    state.lastCycleIndex = cycleIndex;

    // End rain when duration expires. Only grant the achievement if
    // the storm actually started during the current run — continuing
    // through an inherited post-death storm doesn't qualify.
    if (state.isRaining && state.smoothPhase >= state.rainEndPhase) {
      state.isRaining = false;
      if (!state.gameOver && state._runSawRainStart) {
        unlockAchievement("rainy-day");
      }
    }

    // Smooth rain intensity transition (0→1 fade in, 1→0 fade out)
    const raining = state.isRaining;
    const targetIntensity = raining ? 1 : 0;
    // Fade in slower than fade out for natural feel
    const fadeRate = raining ? RAIN_FADE_IN_RATE : RAIN_FADE_OUT_RATE;
    state.rainIntensity +=
      (targetIntensity - state.rainIntensity) * fadeRate * frameScale;
    if (state.rainIntensity < 0.005) state.rainIntensity = 0;
    if (state.rainIntensity > 0.995) state.rainIntensity = 1;

    // Spawn rain proportional to intensity
    if (state.rainIntensity > 0.01) spawnRain(frameScale);
    updateRain(dtSec);
    updateLightning(frameScale, now);

    // Rainbow: rare chance after rain fades out during daytime.
    // Never on the first storm, ~30% chance thereafter.
    if (
      !state.gameOver &&
      !raining &&
      state.rainIntensity < 0.1 &&
      state.rainIntensity > 0 &&
      !state.rainbow
    ) {
      const phase = ((state.smoothPhase % 1) + 1) % 1;
      const bi = Math.floor(phase * SKY_COLORS.length);
      if (!_isNightBand[bi] && !_isNightBand[(bi + 1) % SKY_COLORS.length]) {
        // Debug rain stop: always rainbow. Natural: 50% chance.
        if (state._debugRainStop || Math.random() < RAINBOW_SPAWN_CHANCE) {
          state.rainbow = { age: 0, life: RAINBOW_LIFETIME_SEC };
          unlockAchievement("rainbow");
        }
        state._debugRainStop = false;
      }
    }
    // Update rainbow
    if (state.rainbow) {
      state.rainbow.age += dtSec;
      if (state.rainbow.age >= state.rainbow.life) state.rainbow = null;
    }

    // Rain audio: fade volume with intensity
    if (state.rainIntensity > 0.01 && !audio._isRainPlaying) audio.startRain();
    else if (state.rainIntensity < 0.01 && audio._isRainPlaying)
      audio.stopRain();
    if (audio.rain && audio._isRainPlaying) {
      audio.rain.volume = RAIN_AUDIO_MAX_VOLUME * state.rainIntensity;
    }

    // Slow rotation of the night-sky dome, tied to the cycle phase
    // so every night repeats the same visible arc. The rotation wraps
    // from its max angle back to zero at phase 1 → 0, which happens
    // during solid daylight when stars are fully faded out — so the
    // discontinuity is never visible.
    //
    // The total rotation per cycle is intentionally small (~18°):
    // because the pivot sits ~1.5 screen-heights above the viewport,
    // a star at screen-center is ~2h from the pivot, so even a
    // modest rotation traces a long arc. At 0.1π/cycle the drift
    // across a single night is ~7.5° — enough to see the sky move,
    // not enough to drift stars off before the night ends.
    const wrappedPhase = ((state.smoothPhase % 1) + 1) % 1;
    state.starRotation = wrappedPhase * STAR_ROTATION_PER_CYCLE;

    // Day/night cycle driven by smoothPhase (continuous), not score
    // (discrete) — so the sun/moon position never jumps when the
    // player passes a cactus.
    const phase = ((state.smoothPhase % 1) + 1) % 1;
    const bandF = phase * SKY_COLORS.length;
    const bandIndex = Math.floor(bandF);
    const bandT = bandF - bandIndex;
    const nextBand = (bandIndex + 1) % SKY_COLORS.length;

    // Stars fade in when the sky is genuinely dark — solid-night
    // bands plus the dark half of each twilight transition.
    state.isNight = isNightPhase(bandIndex, bandT);

    // Night-survival tracking for the "survive N nights"
    // achievements. Two-phase detection:
    //   1. When isNight goes true → false, mark a pending night
    //      (the raptor survived through the dark).
    //   2. Only count it + fire achievements once the sky is
    //      solidly in daytime (bands 0-4) — i.e. fully past the
    //      sunrise phase — so the toast appears when the sun is
    //      clearly out, not mid-transition.
    if (state._wasInNight && !state.isNight && !state.gameOver) {
      state._pendingNights = (state._pendingNights || 0) + 1;
    }
    if ((state._pendingNights ?? 0) > 0 && _isDayBand[bandIndex] && !state.gameOver) {
      state.runNightsSurvived += state._pendingNights!;
      state._pendingNights = 0;
      if (state.runNightsSurvived >= 1) {
        unlockAchievement("first-night");
      }
      if (state.runNightsSurvived >= 10) {
        unlockAchievement("ten-nights");
      }
      if (state.runNightsSurvived >= 20) {
        unlockAchievement("twenty-nights");
      }
    }
    state._wasInNight = state.isNight;

    if (
      state.frame % SKY_UPDATE_INTERVAL_FRAMES === 0 ||
      state.score !== state.lastSkyScore
    ) {
      let target = lerpColor(
        SKY_COLORS[bandIndex],
        SKY_COLORS[nextBand],
        bandT,
      );
      // Overcast sky during rain — lerp toward dark gray proportional to intensity.
      if (state.rainIntensity > 0) {
        target = lerpColor(target, [55, 60, 68], 0.7 * state.rainIntensity);
      }
      // 0.2-per-60fps-frame lerp, scaled to the real frame delta
      // (multiplied by SKY_UPDATE_INTERVAL_FRAMES because we're in
      // the throttled branch that only runs every N frames).
      const lerpT = Math.min(1, 0.2 * frameScale);
      state.currentSky = lerpColor(state.currentSky as [number,number,number], target as [number,number,number], lerpT);
      computeSkyGradient();
      state.lastSkyScore = state.score;
    }

    stars.update(state.isNight, frameScale);
    // Shooting-star easter egg: only runs from the 2nd night onward.
    // Don't spawn new shooting stars or rare events on the death screen.
    if (!state.gameOver) maybeSpawnShootingStar(frameScale);
    updateShootingStars(dtSec);
    // Confetti particles from cosmetic unlocks.
    updateConfetti(dtSec);
    updateDust(dtSec);
    updateAsh(dtSec);
    if (!state.gameOver) updateRareEvent(dtSec);

    if (!state.gameOver) {
      raptor.update(now, frameScale);
      cactuses.update(frameScale);

      // Collision: raptor concave polygon vs each cactus polygon.
      if (!state.noCollisions) {
        const raptorPoly = raptor.collisionPolygon();
        for (const c of cactuses.cacti) {
          if (polygonsOverlap(raptorPoly, c.collisionPolygon())) {
            state.gameOver = true;
            state.gameOverFrame = state.frame;
            audio.playHit();
            if (!audio.muted) hapticDeath();
            // Gamepad rumble — heavy jolt on death.
            try {
              const gp = navigator.getGamepads?.()[0];
              if (gp?.vibrationActuator) {
                gp.vibrationActuator.playEffect("dual-rumble", {
                  duration: 150,
                  weakMagnitude: 0.8,
                  strongMagnitude: 1.0,
                });
              }
            } catch (_) {}
            commitRunScore();
            // Bump the career run counter and unlock the
            // "first-run" / "century-runner" milestones.
            state.careerRuns += 1;
            saveCareerRuns(state.careerRuns);
            if (state.careerRuns >= 1) unlockAchievement("first-run");
            if (state.careerRuns >= 100) unlockAchievement("century-runner");
            // Sound-of-silence is awarded for surviving a full
            // run (any length) with audio muted the whole time.
            // We ignore trivial zero-jump runs so the player
            // can't game it by instantly dying.
            if (state._runMutedThroughout && state.runJumps >= 5) {
              unlockAchievement("sound-of-silence");
            }
            // Notify any listeners (e.g. the shell's share button)
            // that a game-over just happened. Fired exactly once per
            // run, directly from the transition instead of via a poll.
            for (const cb of GameAPI._gameOverCbs) {
              try {
                cb();
              } catch (e) {
                /* ignore listener errors */
              }
            }
            break;
          }
        }
      } // end noCollisions guard

      // Clouds drift — slower than the ground but a bit faster than
      // the first-pass fix, so the parallax reads as "distant sky"
      // without feeling sluggish.
      for (const cloud of state.clouds) {
        cloud.x -= state.bgVelocity * (state.width / CLOUD_PARALLAX_DIVISOR) * frameScale;
        cloud.y += randRange(-0.2, 0.2) * frameScale;
      }
      // Parallax layer offsets.
      state.duneOffset += state.bgVelocity * DUNE_SCROLL_SPEED * frameScale;
      // Age struck dune cacti; discard dead/offscreen; spawn new on right.
      if (state.duneCacti) {
        for (const dc of state.duneCacti) {
          if (dc.struck) dc.struckAge = (dc.struckAge || 0) + dtSec;
        }
        state.duneCacti = state.duneCacti.filter(
          (dc) => !dc.dead && dc.wx - state.duneOffset > -dc.w * 3,
        );
        const rightEdge = state.duneOffset + state.width + 100;
        if (!state._nextDuneCactusX || state._nextDuneCactusX < rightEdge) {
          const wx =
            (state._nextDuneCactusX || rightEdge) + DUNE_CACTUS_MIN_SPACING_PX + Math.random() * DUNE_CACTUS_SPACING_RANGE_PX;
          state.duneCacti.push(spawnDuneCactus(wx));
          state._nextDuneCactusX = wx;
        }
      }
      // Keep clouds until they've fully drifted past the left edge.
      state.clouds = state.clouds.filter((c) => {
        const w = cloudVisualWidth(c.size, c.scale);
        return c.x > -w && c.x < state.width + w * 2;
      });
      // Maintain a constant cloud density: if we're below the target
      // count AND the rightmost cloud is far enough away to avoid
      // visual stacking, add a new cloud just past the right edge.
      // trySpawnCloud() enforces the min-spacing constraint itself.
      if (state.clouds.length < targetCloudCount() && state.frame % CLOUD_SPAWN_INTERVAL === 0) {
        trySpawnCloud();
      }
    } else {
      state.gameOverFade = Math.min(state.gameOverFade + GAME_OVER_FADE_RATE * frameScale, 1);
    }
  }

  function render() {
    // === Background pass (no tint) =================================
    // Sky background (single blit of the cached gradient buffer).
    if (skyCanvas) ctx.drawImage(skyCanvas, 0, 0);

    // Stars + Milky Way (fade in only at night).
    // Stars fade out during rain — overcast sky blocks them.
    if (state.rainIntensity < 1) {
      if (state.rainIntensity > 0) {
        ctx.save();
        ctx.globalAlpha = 1 - state.rainIntensity;
        stars.draw(ctx);
        ctx.restore();
      } else {
        stars.draw(ctx);
      }
    }
    // Shooting stars (easter egg, second night onward).
    drawShootingStars(ctx);
    drawUfoBeam(ctx);

    // Sun + moon ride parabolic arcs across the sky. Drawn at full
    // brightness — they're light sources, not lit objects, and they
    // sit behind the foreground because the foreground gets drawn
    // on top of them below.
    drawSun(ctx);
    drawMoon(ctx);

    // Comet/meteor draw ON TOP of sun, moon, and stars.
    drawRareEventSky(ctx);

    // Rainbow — drawn in the background so foreground elements
    // (ground, cacti, raptor, clouds, dunes) all render on top.
    if (state.rainbow) {
      const rb = state.rainbow;
      let alpha;
      if (rb.age < 1) alpha = rb.age;
      else if (rb.age < 3) alpha = 1;
      else alpha = 1 - (rb.age - 3) / 3;
      alpha = Math.max(0, Math.min(1, alpha)) * RAINBOW_MAX_OPACITY;
      if (alpha > 0) {
        const cx = state.width * 0.7;
        const cy = state.ground + state.height * 0.15;
        const outerR = state.height * 0.55;
        const thickness = Math.max(15, state.width * 0.025);
        const innerR = outerR - thickness;
        // Continuous radial gradient — colors blend smoothly
        const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
        grad.addColorStop(0, `rgba(148, 0, 211, ${alpha})`); // violet (inner)
        grad.addColorStop(0.17, `rgba(75, 0, 200, ${alpha})`); // indigo
        grad.addColorStop(0.33, `rgba(30, 130, 255, ${alpha})`); // blue
        grad.addColorStop(0.5, `rgba(30, 200, 30, ${alpha})`); // green
        grad.addColorStop(0.67, `rgba(255, 240, 30, ${alpha})`); // yellow
        grad.addColorStop(0.83, `rgba(255, 140, 0, ${alpha})`); // orange
        grad.addColorStop(1, `rgba(255, 30, 30, ${alpha})`); // red (outer)
        ctx.save();
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, Math.PI, 0);
        ctx.arc(cx, cy, innerR, 0, Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // === Foreground pass (rendered on offscreen canvas, then       =
    // === uniformly sky-tinted, then composited onto the main pass) =
    fgCtx.clearRect(0, 0, state.width, state.height);

    // Clouds — drawn pure white here, the source-atop tint below
    // picks up the sky color and washes them toward it.
    for (const cloud of state.clouds) {
      drawCloudMorphed(
        fgCtx,
        cloud.x,
        cloud.y,
        cloud.size * cloud.scale,
        state.rainIntensity,
      );
    }

    // Parallax dunes — drawn procedurally from noise each frame.
    {
      const off = state.duneOffset;
      const groundY = state.ground;
      const step = 4;
      // Dune color blended with sky for atmospheric depth
      const sky = state.currentSky;
      const dr = Math.round(200 * 0.65 + sky[0] * 0.35);
      const dg = Math.round(168 * 0.65 + sky[1] * 0.35);
      const db = Math.round(120 * 0.65 + sky[2] * 0.35);
      fgCtx.fillStyle = `rgb(${dr}, ${dg}, ${db})`;
      fgCtx.beginPath();
      fgCtx.moveTo(0, state.height);
      for (let sx = 0; sx <= state.width; sx += step) {
        const y = groundY - duneHeight(sx, off);
        fgCtx.lineTo(sx, y);
      }
      fgCtx.lineTo(state.width, state.height);
      fgCtx.closePath();
      fgCtx.fill();

      // Dune cacti + tumbleweed in 3 depth layers:
      // depth 1 cacti → tumbleweed (depth 2) → depth 3 cacti
      const _drawDuneCacti = (targetDepth: number) => {
        if (!state.duneCacti) return;
        for (const dc of state.duneCacti) {
          if (dc.dead || dc.depth !== targetDepth) continue;
          const sx = dc.wx - off;
          if (sx < -dc.w * 2 || sx > state.width + dc.w * 2) continue;
          const duneY = groundY - duneHeight(sx, off);
          const img = IMAGES[dc.key];
          if (!img) continue;
          fgCtx.save();
          if (dc.struck) {
            fgCtx.filter = "brightness(0.1) saturate(0)";
            if (dc.struckAge > 0.8) {
              const fadeT = Math.min(1, (dc.struckAge - 0.8) / 0.6);
              fgCtx.globalAlpha = 1 - fadeT;
              if (Math.random() < 0.3) spawnAsh(sx, duneY, dc.w, dc.h);
              if (fadeT >= 1) {
                dc.dead = true;
                fgCtx.restore();
                continue;
              }
            }
          }
          fgCtx.drawImage(
            img,
            Math.round(sx - dc.w / 2),
            Math.round(duneY + dc.h * 0.15 - dc.h),
            Math.round(dc.w),
            Math.round(dc.h),
          );
          fgCtx.restore();
        }
      };
      _drawDuneCacti(1); // behind tumbleweed
      // Tumbleweed at depth 2
      const _re = state.activeRareEvent;
      if (_re && _re.id === "tumbleweed") {
        const twImg = IMAGES.tumbleweed;
        if (twImg) {
          fgCtx.save();
          fgCtx.translate(_re.x, _re.y);
          fgCtx.rotate(_re.rot || 0);
          fgCtx.drawImage(twImg, -10, -10, 20, 20);
          fgCtx.restore();
        }
      }
      _drawDuneCacti(3); // in front of tumbleweed
    }

    // Extra sky tint on dunes + dune cacti — stronger than the
    // foreground tint so they feel more distant.
    {
      const sky = state.currentSky;
      const strength = Math.min(1, tintStrength() * 1.8);
      fgCtx.save();
      fgCtx.globalCompositeOperation = "source-atop";
      fgCtx.fillStyle = `rgba(${sky[0]}, ${sky[1]}, ${sky[2]}, ${strength})`;
      fgCtx.fillRect(0, 0, state.width, state.height);
      fgCtx.restore();
    }

    // Ground bands.
    let bandY = 0;
    for (let i = 0; i < GROUND_BAND_COLORS.length; i++) {
      fgCtx.fillStyle = GROUND_BAND_COLORS[i];
      fgCtx.fillRect(0, state.ground + bandY, state.width, GROUND_BAND_HEIGHTS_PX[i]);
      bandY += GROUND_BAND_HEIGHTS_PX[i];
    }

    // Cacti.
    cactuses.draw(fgCtx);

    // Raptor.
    raptor.draw(fgCtx);
    drawDust(fgCtx);
    drawRareEventFg(fgCtx);
    drawAsh(fgCtx);

    // Sky-light tint applied ONLY where the foreground has drawn
    // pixels. `source-atop` performs alpha blending only over
    // existing dest pixels, leaving transparent areas untouched —
    // so the tint doesn't bleed into the sky region around the
    // raptor or above the cacti.
    {
      const sky = state.currentSky;
      const strength = tintStrength();
      fgCtx.save();
      fgCtx.globalCompositeOperation = "source-atop";
      fgCtx.fillStyle = `rgba(${sky[0]}, ${sky[1]}, ${sky[2]}, ${strength})`;
      fgCtx.fillRect(0, 0, state.width, state.height);
      fgCtx.restore();
    }

    // Composite the tinted foreground over the background.
    ctx.drawImage(
      fgCanvas,
      0,
      0,
      fgCanvas.width,
      fgCanvas.height,
      0,
      0,
      state.width,
      state.height,
    );

    // Confetti — drawn AFTER the tinted foreground so the
    // colors pop at any time of day (no sky-tint washing them
    // out). Only alive when a cosmetic was just unlocked.
    drawConfetti(ctx);

    // Overcast bands — persistent layered cloud cover during rain.
    drawOvercastBands(ctx, state.rainIntensity);

    // Grey wash-out overlay proportional to rain intensity.
    if (state.rainIntensity > 0) {
      ctx.fillStyle = `rgba(50, 55, 60, ${state.rainIntensity * 0.15})`;
      ctx.fillRect(0, 0, state.width, state.height);
    }

    drawRain(ctx);
    drawLightning(ctx);

    // Score text lives in the DOM now (see #score-display in
    // index.html), not on the canvas. That means it doesn't appear
    // in the death-snapshot that feeds the share card, and it can
    // pick up the same pill styling as the top-right icon cluster.

    // Debug: draw the raptor and cactus collision polygons on top of
    // everything so the player can see what the collision tests are
    // actually checking against.
    if (state.showHitboxes) {
      drawPolygon(ctx, raptor.collisionPolygon(), {
        stroke: "rgba(255, 80, 80, 0.95)",
        fill: "rgba(255, 80, 80, 0.18)",
      });
      for (const c of cactuses.cacti) {
        drawPolygon(ctx, c.collisionPolygon(), {
          stroke: "rgba(80, 200, 255, 0.95)",
          fill: "rgba(80, 200, 255, 0.18)",
        });
      }
    }

    // Capture a pristine snapshot of the canvas the first frame
    // after the player dies — before the Game Over overlay is
    // drawn on top of it. Used by the share card as its
    // background, so the card literally shows the scene the
    // player just died in.
    if (state.gameOver && !deathSnapshotReady && canvas && deathCanvas) {
      deathCanvas.width = canvas.width;
      deathCanvas.height = canvas.height;
      deathCtx.setTransform(1, 0, 0, 1, 0, 0);
      deathCtx.drawImage(canvas, 0, 0);
      deathSnapshotReady = true;
    }

    // Game-over overlay: just a dim scrim. The DOM score-card
    // panel (shown by the shell on Game.onGameOver) handles the
    // "Game Over" / score / personal best / restart hint text
    // now, so the canvas only needs to provide the dark fade
    // underneath it for contrast.
    if (state.gameOver) {
      ctx.fillStyle = `rgba(0, 0, 0, ${state.gameOverFade * 0.6})`;
      ctx.fillRect(0, 0, state.width, state.height);
    }
  }

  // ── Debug performance instrumentation ──────────────────────────
  // When ?debug=true, tracks per-frame timings and draws an
  // overlay with FPS + frame budget breakdown. Updated every 30
  // frames to avoid the readout itself costing performance.
  const perf: {
    enabled: boolean;
    samples: Array<{update: number; render: number; total: number}>;
    maxSamples: number;
    lastDisplay: {fps: number; update: number | string; render: number | string; total: number | string};
    frameCount: number;
  } = {
    enabled: false,
    samples: [],
    maxSamples: 60,
    lastDisplay: { fps: 0, update: 0, render: 0, total: 0 },
    frameCount: 0,
  };

  function drawPerfOverlay() {
    if (!perf.enabled || !ctx) return;
    if (++perf.frameCount % 30 === 0 && perf.samples.length > 0) {
      const n = perf.samples.length;
      let sumU = 0,
        sumR = 0,
        sumT = 0;
      for (const s of perf.samples) {
        sumU += s.update;
        sumR += s.render;
        sumT += s.total;
      }
      perf.lastDisplay = {
        fps: Math.round(1000 / (sumT / n)),
        update: (sumU / n).toFixed(2),
        render: (sumR / n).toFixed(2),
        total: (sumT / n).toFixed(2),
      };
      perf.samples.length = 0;
    }
    const d = perf.lastDisplay;
    const lines = [
      `FPS: ${d.fps}`,
      `Update: ${d.update} ms`,
      `Render: ${d.render} ms`,
      `Frame:  ${d.total} ms`,
    ];
    ctx.save();
    ctx.font = "bold 11px monospace";
    ctx.textBaseline = "top";
    const x = 10,
      y = state.height - 70;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - 4, y - 4, 150, lines.length * 15 + 8);
    ctx.fillStyle = "#0f0";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x, y + i * 15);
    }
    ctx.restore();
  }

  function loop(now: number) {
    pollGamepad();
    const t0 = performance.now();
    let tUpdate = t0;
    if (!state.paused) {
      update(now || t0);
      tUpdate = performance.now();
    }
    render();
    const tRender = performance.now();
    if (perf.enabled) {
      perf.samples.push({
        update: tUpdate - t0,
        render: tRender - tUpdate,
        total: tRender - t0,
      });
      drawPerfOverlay();
    }
    _rafId = requestAnimationFrame(loop);
  }

  // ══════════════════════════════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════════════════════════════

  // ── Persistent high score (localStorage) ──────────────────────────

  /** Read the saved personal best. Returns 0 if storage is
   *  unavailable (private mode, denied permission) or unparseable. */
  // loadHighScore / saveHighScore / loadCareerRuns / saveCareerRuns /
  // loadUnlockedAchievements / saveUnlockedAchievements all live in
  // src/persistence.ts.

  /** Unlock an achievement by id. Silently no-ops if the id is
   *  unknown or already unlocked. Fires the onAchievementUnlock
   *  callbacks so the shell can show a toast. */
  function unlockAchievement(id: string) {
    const def = ACHIEVEMENTS_BY_ID[id];
    if (!def) return;
    if (state.unlockedAchievements[id]) return;
    state.unlockedAchievements[id] = true;
    saveUnlockedAchievements(state.unlockedAchievements);
    // Mirror to Steam. Fire-and-forget: no-op in the browser build,
    // silent when Steam isn't running. Next successful init reconcile
    // will recover anything that fails here.
    pushAchievementToSteam(id);
    // Mirror to Game Center / Play Games Services. Also a no-op until
    // the Capacitor adapter is wired up with a real plugin — see
    // src/mobile/gameServices.ts and docs/GAME_SERVICES.md.
    reportAchievementToServices(id);
    for (const cb of GameAPI._achievementCbs) {
      try {
        cb(def);
      } catch (e) {
        /* ignore listener errors */
      }
    }
  }

  // loadTotalJumps / saveTotalJumps / loadBoolFlag / saveBoolFlag all
  // live in src/persistence.ts.

  /** Called once the player dies. Checks if this run's score beat
   *  the stored personal best and, if so, saves it and flags the
   *  run for celebration on the game-over overlay. */
  function commitRunScore() {
    if (state.score > state.highScore) {
      state.highScore = state.score;
      state.newHighScore = true;
      saveHighScore(state.highScore);
    } else {
      state.newHighScore = false;
    }
    // Report every finished run's score to the platform leaderboard.
    // The service keeps the best — submitting a lower score is fine and
    // expected. No-op on web/desktop + on mobile until the adapter is
    // wired up.
    reportScoreToServices(state.score);
  }

  /** Reset per-run tracking state. Called from both start()
   *  (first run) and resetGame() (subsequent runs) so the
   *  initialization is identical regardless of code path. */
  function initRunState() {
    state.runJumps = 0;
    state.runNightsSurvived = 0;
    state._pendingNights = 0;
    state.runShootingStars = 0;
    state._wasInNight = false;
    // Rainy Day achievement: gate on whether the player witnessed
    // the rain START during this run. A continuation run that begins
    // already-raining (because soft-reset preserves weather across
    // deaths) leaves this false — so surviving until THIS storm ends
    // is not enough; only a storm that started during the current
    // run counts. Flips true in the rain-start handler below.
    state._runSawRainStart = false;
    // Sound of Silence: snapshot the mute state right now.
    // If the player unmutes at any point during the run,
    // setMuted() flips this to false. Checked at game-over.
    state._runMutedThroughout = !!(audio && audio.muted);
  }

  /** Reset game state for a new run.
   *
   *  `hard = false` (default, post-death soft restart):
   *    Preserves the ambient day/night/weather cycle so the world
   *    keeps running uninterrupted — player doesn't feel like the
   *    universe rewinds every time they die to a cactus. Only
   *    per-run things (score, velocity, particles, dust) reset.
   *
   *  `hard = true` (explicit return-to-home / progress reset):
   *    Nukes everything. New cycle, fresh sky, no inherited weather.
   */
  function resetGame(hard: boolean = false) {
    state.gameOver = false;
    state.gameOverFade = 0;
    state.gameOverFrame = 0;
    state.newHighScore = false;
    state.score = 0;
    state.bgVelocity = INITIAL_BG_VELOCITY;
    state.lastNow = null;
    // Ephemeral per-frame particle pools: always cleared (the death
    // animation snapshot burned them out visually, starting fresh is
    // correct regardless of hard/soft).
    state.shootingStars = [];
    state.confetti = [];
    state.dust = [];
    state.ash = [];
    state.activeRareEvent = null;
    state.rainParticles = [];
    state.lightning = { alpha: 0, nextAt: 0 };
    if (hard) {
      // Full reset — tear down the ambient cycle too.
      state.currentSky = [...SKY_COLORS[0]];
      state.lastSkyScore = -1;
      state.smoothPhase = 0;
      state.isRaining = false;
      state.rainIntensity = 0;
      state.rainEndPhase = 0;
      state.rainbow = null;
      state.lastCycleIndex = -1;
      audio.stopRain();
      // Cloud density reroll: 20% cloudless, 50% normal, 30% extra cloudy
      const cdRoll = Math.random();
      state._cloudDensity = cdRoll < 0.2 ? 0 : cdRoll < 0.7 ? 1 : 2;
    }
    // Note: soft reset keeps state.isRaining, state.rainIntensity,
    // state.smoothPhase, state.currentSky, state.rainbow,
    // state.lastCycleIndex, state._cloudDensity, and the in-flight
    // rain audio playing — the world keeps going. The rain-achievement
    // guard in initRunState() catches the edge case where a run
    // starts already-raining.
    initRunState();
    // Fresh dunes and cacti each run.
    initDunes();
    // Next game-over will capture a fresh snapshot.
    deathSnapshotReady = false;
    seedClouds();
    if (raptor) {
      raptor.velocity = 0;
      raptor.y = raptor.ground;
      raptor.frame = 0;
      raptor.lastFrameAdvanceAt = 0;
    }
    if (cactuses) cactuses.clear();
    stars = new Stars();
    computeSkyGradient();
    // Notify any listeners (e.g. the shell's share button) that
    // the game has transitioned back to a fresh state.
    for (const cb of GameAPI._gameResetCbs) {
      try {
        cb();
      } catch (e) {
        /* ignore listener errors */
      }
    }
  }

  function maybeResetAfterGameOver() {
    if (state.gameOver && state.frame - state.gameOverFrame > 30) {
      resetGame();
    }
  }

  function onResize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight + 1;
    state.groundHeight = state.height * GROUND_HEIGHT_RATIO;
    state.ground = state.height - state.groundHeight;

    if (canvas && ctx) {
      // HiDPI/retina: back the canvas at dpr × logical size so drawing
      // stays crisp on retina screens, but cap dpr at 2 to avoid the
      // 9× pixel fill-rate on 3× Windows HiDPI displays. Then scale the
      // context so drawing code still works in logical coordinates.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(state.width * dpr);
      canvas.height = Math.round(state.height * dpr);
      canvas.style.width = state.width + "px";
      canvas.style.height = state.height + "px";
      ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
      ctx.scale(dpr, dpr);
      // Bilinear smoothing stays on — the raptor and cacti are
      // vector-ish art, not true pixel art, so nearest-neighbour gives
      // ugly jagged edges.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
    }

    // Resize the offscreen foreground canvas to match the main one
    // (in device pixels, with a matching scale transform).
    if (fgCanvas && fgCtx) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fgCanvas.width = Math.round(state.width * dpr);
      fgCanvas.height = Math.round(state.height * dpr);
      fgCtx.setTransform(1, 0, 0, 1, 0, 0);
      fgCtx.scale(dpr, dpr);
      fgCtx.imageSmoothingEnabled = true;
      fgCtx.imageSmoothingQuality = "medium";
    }

    if (raptor) raptor.resize();
    // Re-anchor every currently-alive cactus to the new
    // state.ground so they don't visibly jump when the viewport
    // dimensions change (most obvious when toggling fullscreen).
    if (cactuses && raptor) {
      for (const c of cactuses.cacti) c.resize();
    }
    if (stars) stars = new Stars();
    state.clouds = [];
    initDunes();
    computeSkyGradient();
  }

  // ══════════════════════════════════════════════════════════════════
  // Input
  // ══════════════════════════════════════════════════════════════════

  function onPointerDown(e: PointerEvent) {
    if (!state.started || state.paused) return;
    // If the touch started on an overlay control (cog, sound, menu),
    // let the browser handle it — those elements live above the canvas
    // in the DOM tree so they'd get their own click events anyway, but
    // pointerdown on the canvas fires first on some browsers when the
    // touch overlaps the canvas area.
    if (e.target !== canvas) return;
    e.preventDefault();
    if (state.gameOver) {
      maybeResetAfterGameOver();
    } else {
      if (!raptor.jump()) raptor.bufferJump(performance.now());
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    // ESC is reserved for the menu overlay — let it through.
    if (e.key === "Escape") return;

    // F9 toggles cinematic / filming mode.
    if (e.code === "F9") {
      e.preventDefault();
      toggleCinematicMode();
      return;
    }

    // While cinematic mode is active, intercept extra keys for
    // phase / weather / cosmetic control.
    if (state.cinematicMode && handleCinematicKey(e)) {
      e.preventDefault();
      return;
    }

    // Before the game has started, Space/Enter acts as "Start Game".
    if (!state.started) {
      if (
        e.code === "Space" ||
        e.code === "Enter" ||
        e.code === "NumpadEnter"
      ) {
        e.preventDefault();
        if (typeof (window as any).__onStartKey === "function") {
          (window as any).__onStartKey();
        }
      }
      return;
    }

    if (state.paused) return;

    const isJumpKey =
      e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp";
    if (isJumpKey) {
      e.preventDefault();
      if (state.gameOver) {
        maybeResetAfterGameOver();
      } else {
        if (!raptor.jump()) raptor.bufferJump(performance.now());
      }
      return;
    }

    if (e.code === "Enter" || e.code === "NumpadEnter") {
      e.preventDefault();
      maybeResetAfterGameOver();
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════════════

  /* eslint-disable @typescript-eslint/no-explicit-any */
  type GameCallback = (...args: any[]) => void;

  const GameAPI = {
    _ready: false as boolean,
    _readyCb: null as GameCallback | null,
    _gameOverCbs: [] as GameCallback[],
    _gameResetCbs: [] as GameCallback[],
    _achievementCbs: [] as GameCallback[],

    onReady(cb: GameCallback) {
      if (this._ready) cb();
      else this._readyCb = cb;
    },

    onGameOver(cb: GameCallback) {
      if (typeof cb === "function") this._gameOverCbs.push(cb);
    },
    onGameReset(cb: GameCallback) {
      if (typeof cb === "function") this._gameResetCbs.push(cb);
    },

    onAchievementUnlock(cb: GameCallback) {
      if (typeof cb === "function" && !this._achievementCbs.includes(cb)) {
        this._achievementCbs.push(cb);
      }
    },

    /** Full achievement catalog with unlocked status. Used by
     *  the Achievements menu overlay. Returns a shallow copy so
     *  callers can't mutate the source. */
    getAchievements() {
      return ACHIEVEMENTS.map((a) => ({
        id: a.id,
        title: a.title,
        desc: a.desc,
        iconHTML: a.iconHTML || null,
        iconImage: a.iconImage || null,
        unlocked: !!state.unlockedAchievements[a.id],
        secret: !!a.secret,
      }));
    },

    start() {
      if (state.started) return;
      state.started = true;
      state.paused = false;
      const cdRoll = Math.random();
      state._cloudDensity = cdRoll < 0.2 ? 0 : cdRoll < 0.7 ? 1 : 2;
      // Reset per-run state identically to resetGame() so the
      // very first run after page load starts clean.
      initRunState();
    },

    pause() {
      state.paused = true;
    },

    resume() {
      if (!state.started) return;
      // Clear the delta-time timestamp so the first post-resume
      // frame doesn't see a huge elapsed time and teleport
      // everything forward.
      state.lastNow = null;
      state.paused = false;
    },

    isStarted() {
      return state.started;
    },

    isPaused() {
      return state.paused;
    },

    setMuted(muted: boolean) {
      audio.setMuted(muted);
    },

    isMuted() {
      return audio.muted;
    },

    /** True when the player has explicitly saved a mute/unmute
     *  choice (either this session or a previous one). The Start
     *  Game handler uses this to decide whether to auto-unmute on
     *  first visit or honour a returning visitor's saved preference. */
    hasSavedMutePreference() {
      return audio.hasSavedPreference;
    },

    unlockAudio() {
      audio.unlockAudio();
    },

    setMusicMuted(muted: boolean) {
      audio.setMusicMuted(muted);
    },

    isMusicMuted() {
      return audio.musicMuted;
    },

    setJumpMuted(muted: boolean) {
      audio.setJumpMuted(muted);
    },

    isJumpMuted() {
      return audio.jumpMuted;
    },

    setRainMuted(muted: boolean) {
      audio.setRainMuted(muted);
    },

    isRainMuted() {
      return audio.rainMuted;
    },

    isDebug() {
      return state.debug;
    },

    /** Current run's score. */
    getScore() {
      return state.score;
    },

    /** Debug helper — overwrite the current run's score. Used by
     *  the debug menu's score editor so testers can verify unlock
     *  / personal-best / share-card behavior without waiting for
     *  natural cactus passes. */
    setScore(n: number) {
      const next = Math.max(0, Math.floor(Number(n) || 0));
      state.score = next;
      // Fire any score-threshold achievements the player just
      // skipped over so debug-setting the score to e.g. 6000
      // unlocks everything in one go.
      if (next >= 1) unlockAchievement("first-jump");
      if (next >= 25) unlockAchievement("score-25");
      if (next >= 100) unlockAchievement("party-time");
      if (next >= BOW_TIE_SCORE_THRESHOLD)
        unlockAchievement("dinosaurs-forever");
      if (next >= THUG_GLASSES_SCORE_THRESHOLD) unlockAchievement("score-250");
      // Also trigger cosmetic unlocks if thresholds are met.
      if (!state.unlockedPartyHat && next >= PARTY_HAT_SCORE_THRESHOLD) {
        state.unlockedPartyHat = true;
        state.wearPartyHat = true;
        saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, true);
        saveBoolFlag(WEAR_PARTY_HAT_KEY, true);
      }
      if (!state.unlockedThugGlasses && next >= THUG_GLASSES_SCORE_THRESHOLD) {
        state.unlockedThugGlasses = true;
        state.wearThugGlasses = true;
        saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, true);
        saveBoolFlag(WEAR_THUG_GLASSES_KEY, true);
      }
      if (!state.unlockedBowTie && next >= BOW_TIE_SCORE_THRESHOLD) {
        state.unlockedBowTie = true;
        state.wearBowTie = true;
        saveBoolFlag(UNLOCKED_BOW_TIE_KEY, true);
        saveBoolFlag(WEAR_BOW_TIE_KEY, true);
      }
    },

    /** Best score persisted in localStorage across all runs. */
    getHighScore() {
      return state.highScore;
    },

    /** True while a game-over overlay is showing for a run that
     *  broke the previous personal best. */
    isNewHighScore() {
      return state.newHighScore;
    },

    /** True if the player is currently looking at the game-over
     *  screen. Used by the shell to decide when to show the
     *  "Share your score" button. */
    isGameOver() {
      return state.gameOver;
    },

    /** Reset to a fresh run right now. Safe to call any time
     *  during a game-over state; the short death animation
     *  cooldown is still applied inside maybeResetAfterGameOver. */
    restartFromGameOver() {
      maybeResetAfterGameOver();
    },

    /** Manually drive one update+render tick. Used by cinematic mode
     *  when rAF is throttled (hidden tabs). */
    _tick() {
      loop(performance.now());
    },

    /** Cinematic helper: snap rain state instantly. */
    _forceRain(on: boolean) {
      state.isRaining = !!on;
      state.rainIntensity = on ? 1 : 0;
      if (on) {
        state.rainEndPhase = state.smoothPhase + 100;
      } else {
        state.rainParticles = [];
        state.lightning = { alpha: 0, nextAt: 0 };
      }
    },

    /** Cinematic helper: force all cosmetics at once. */
    _forceCosmetics(hat: boolean, glasses: boolean, bow: boolean) {
      state.unlockedPartyHat = !!hat;
      state.wearPartyHat = !!hat;
      state.unlockedThugGlasses = !!glasses;
      state.wearThugGlasses = !!glasses;
      state.unlockedBowTie = !!bow;
      state.wearBowTie = !!bow;
    },

    /** Debug helper: force a game-over immediately without needing
     *  an actual collision. Lets the shell test the share card
     *  flow end to end. */
    _forceGameOver() {
      if (state.gameOver) return;
      state.gameOver = true;
      state.gameOverFrame = state.frame;
      commitRunScore();
      for (const cb of GameAPI._gameOverCbs) {
        try {
          cb();
        } catch (e) {
          /* ignore */
        }
      }
    },

    /** Reset the game back to its idle pre-start state: paused,
     *  not-started, fresh score and entities. The shell pairs this
     *  with re-showing the start screen when the player picks
     *  "Back to home screen" from the menu. */
    returnToHome() {
      // Hard reset — returning to the home screen should feel like
      // a fresh boot, not a paused continuation. Clears sky / weather
      // / smoothPhase so the next Start Game doesn't begin mid-storm.
      resetGame(true);
      state.started = false;
      state.paused = true;
    },

    /** Compose a 1200×630 "share your score" PNG on an offscreen
     *  canvas, using whatever sky/time-of-day and cosmetics the
     *  player had on during the run they just finished. Resolves
     *  to a Blob the shell can hand to navigator.share or a
     *  download link. */
    generateScoreCard() {
      return generateScoreCardBlob(deathSnapshotReady);
    },

    isShowingHitboxes() {
      return state.showHitboxes;
    },

    setShowHitboxes(on: boolean) {
      state.showHitboxes = !!on;
    },

    toggleShowHitboxes() {
      state.showHitboxes = !state.showHitboxes;
      return state.showHitboxes;
    },

    isNoCollisions() {
      return state.noCollisions;
    },

    toggleNoCollisions() {
      state.noCollisions = !state.noCollisions;
      return state.noCollisions;
    },

    isPerfOverlay() {
      return perf.enabled;
    },

    togglePerfOverlay() {
      perf.enabled = !perf.enabled;
      return perf.enabled;
    },

    isRaining() {
      return state.isRaining;
    },

    /** Debug: trigger or stop a rain cycle with natural duration. */
    toggleRain() {
      if (state.isRaining) {
        // Stop current rain immediately — force rainbow
        state.isRaining = false;
        state.rainEndPhase = 0;
        state._debugRainStop = true;
      } else {
        // Start a natural-length rain cycle
        state.isRaining = true;
        state.rainEndPhase = state.smoothPhase + 0.3 + Math.random() * 0.9;
        state._runSawRainStart = true;
      }
      return state.isRaining;
    },

    /** Debug: trigger a specific rare event by id. */
    triggerEvent(id: string) {
      const evt = RARE_EVENTS.find((e) => e.id === id);
      if (!evt) return false;
      state.activeRareEvent = {
        id: evt.id,
        age: 0,
        life: evt.duration,
        x: state.width + 50,
        y: state.height * (0.1 + Math.random() * 0.3),
      };
      // Mirror the SFX fire in maybeSpawnRareEvent so debug triggers
      // sound the same as natural spawns.
      if (evt.id === "ufo") audio.playUfo();
      else if (evt.id === "santa") audio.playSanta();
      if (!state._rareEventsSeen[evt.id]) {
        state._rareEventsSeen[evt.id] = 1;
        saveRareEventsSeen(state._rareEventsSeen);
        unlockAchievement(evt.achievement);
      }
      return true;
    },

    /** List available rare event IDs for debug. */
    getEventIds() {
      return RARE_EVENTS.map((e) => e.id);
    },

    /** Debug: advance to next day cycle and update moon phase. */
    advanceMoonPhase() {
      state.totalDayCycles += 1;
      saveTotalDayCycles(state.totalDayCycles);
      state.moonPhase = moonPhaseFromCycles(state.totalDayCycles);
      // Jump to the start of night (band 6 of 12 = phase 0.5)
      state.smoothPhase = Math.floor(state.smoothPhase) + 0.5;
      state.lastCycleIndex = Math.floor(state.smoothPhase);
      if (Math.abs(state.moonPhase - 0.5) < 0.02)
        unlockAchievement("full-moon");
      return state.moonPhase;
    },

    // ── Accessory unlock state (persisted) ─────────────────────

    /** True once the player has cleared PARTY_HAT_SCORE_THRESHOLD
     *  cacti in a single run. In debug mode, always true. */
    isPartyHatUnlocked() {
      return state.unlockedPartyHat;
    },
    isThugGlassesUnlocked() {
      return state.unlockedThugGlasses;
    },

    /** True when the accessory is both unlocked and the player has
     *  the cosmetic turned on. This is what actually gates the
     *  sprite on the raptor. */
    isPartyHatActive() {
      return this.isPartyHatUnlocked() && state.wearPartyHat;
    },
    isThugGlassesActive() {
      return this.isThugGlassesUnlocked() && state.wearThugGlasses;
    },

    isBowTieUnlocked() {
      return state.unlockedBowTie;
    },
    isBowTieActive() {
      return this.isBowTieUnlocked() && state.wearBowTie;
    },

    /** Player preference setters. Silently no-op if the accessory
     *  isn't unlocked yet, so you can't turn something on you
     *  don't own. Debug mode unlocks everything, so testers can
     *  still use these. */
    setWearPartyHat(on: boolean) {
      if (!this.isPartyHatUnlocked()) return false;
      state.wearPartyHat = !!on;
      saveBoolFlag(WEAR_PARTY_HAT_KEY, state.wearPartyHat);
      return state.wearPartyHat;
    },
    setWearThugGlasses(on: boolean) {
      if (!this.isThugGlassesUnlocked()) return false;
      state.wearThugGlasses = !!on;
      saveBoolFlag(WEAR_THUG_GLASSES_KEY, state.wearThugGlasses);
      return state.wearThugGlasses;
    },

    togglePartyHat() {
      return this.setWearPartyHat(!state.wearPartyHat);
    },
    toggleThugGlasses() {
      return this.setWearThugGlasses(!state.wearThugGlasses);
    },

    setWearBowTie(on: boolean) {
      if (!this.isBowTieUnlocked()) return false;
      state.wearBowTie = !!on;
      saveBoolFlag(WEAR_BOW_TIE_KEY, state.wearBowTie);
      return state.wearBowTie;
    },
    toggleBowTie() {
      return this.setWearBowTie(!state.wearBowTie);
    },

    getTotalJumps() {
      return state.totalJumps;
    },

    /** Debug: wipe saved career jumps, unlock bits, and wear
     *  preferences so the raptor reverts to its naked state. */
    /** Wipe all persistent progress — jumps, cosmetic unlocks,
     *  career runs, achievements, and high score — back to a
     *  fresh-install state. Debug-only affordance. */
    resetAllProgress() {
      state.totalJumps = 0;
      state.highScore = 0;
      state.careerRuns = 0;
      state.unlockedPartyHat = false;
      state.unlockedThugGlasses = false;
      state.wearPartyHat = false;
      state.wearThugGlasses = false;
      state.unlockedAchievements = {};
      saveTotalJumps(0);
      saveHighScore(0);
      saveCareerRuns(0);
      saveUnlockedAchievements({});
      saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, false);
      saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, false);
      saveBoolFlag(WEAR_PARTY_HAT_KEY, false);
      saveBoolFlag(WEAR_THUG_GLASSES_KEY, false);
      state.unlockedBowTie = false;
      state.wearBowTie = false;
      saveBoolFlag(UNLOCKED_BOW_TIE_KEY, false);
      saveBoolFlag(WEAR_BOW_TIE_KEY, false);
      state.totalDayCycles = 0;
      saveTotalDayCycles(0);
      state._rareEventsSeen = {};
      saveRareEventsSeen({});
    },

    /** Remove all event listeners and stop the game loop. Call
     *  when the game is being torn down (e.g. page navigation). */
    destroy() {
      if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = 0;
      }
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("keydown", onKeyDown);
      if (canvas) canvas.removeEventListener("pointerdown", onPointerDown);
    },
  };
  (window as any).Game = GameAPI;

  // ══════════════════════════════════════════════════════════════════
  // Init
  // ══════════════════════════════════════════════════════════════════

  function preloadImages() {
    return Promise.all(
      Object.entries(IMAGE_SRCS).map(
        ([key, src]) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              IMAGES[key] = img;
              resolve();
            };
            img.onerror = () => {
              console.warn(`Failed to load ${src}`);
              IMAGES[key] = undefined;
              resolve();
            };
            img.src = src;
          }),
      ),
    );
  }

  /**
   * Warm the GPU texture cache for every loaded image by drawing it
   * once to a tiny offscreen canvas. Without this, the first
   * in-game drawImage of a sprite that hasn't been used yet (UFO,
   * Santa sleigh, reindeer, tumbleweed, cosmetic overlays) triggers
   * a texture upload stall — a frame hitch big enough to kill the
   * player when a rare event first spawns mid-run.
   *
   * Cacti and the raptor sprite don't need this because they're
   * drawn from frame 1 and warm naturally.
   */
  function warmImageTextures() {
    const warm = document.createElement("canvas");
    warm.width = 2;
    warm.height = 2;
    const wctx = warm.getContext("2d");
    if (!wctx) return;
    for (const key of Object.keys(IMAGES)) {
      const img = IMAGES[key];
      if (!img) continue;
      try {
        wctx.drawImage(img, 0, 0, 2, 2);
      } catch {
        /* ignore — warm is best-effort */
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Cinematic / filming mode (F9)
  // ══════════════════════════════════════════════════════════════════

  const CINEMATIC_HUD_ID = "cinematic-hud";

  function toggleCinematicMode() {
    state.cinematicMode = !state.cinematicMode;
    if (state.cinematicMode) {
      state._preCinematicNoCollisions = state.noCollisions;
      state.noCollisions = true;
      document.body.classList.add("cinematic-mode");
      if (!state.started) {
        GameAPI.start();
      } else if (state.paused) {
        GameAPI.resume();
      }
      ensureCinematicHUD();
      updateCinematicHUD();
    } else {
      state.cinematicPhaseLock = null;
      state.noCollisions = state._preCinematicNoCollisions;
      document.body.classList.remove("cinematic-mode");
      const hud = document.getElementById(CINEMATIC_HUD_ID);
      if (hud) hud.remove();
    }
  }

  function handleCinematicKey(e: KeyboardEvent): boolean {
    if (e.code === "Digit0" || e.key === "0") {
      state.cinematicPhaseLock = null;
      updateCinematicHUD();
      return true;
    }
    for (const p of CINEMATIC_PHASES) {
      if (e.key === p.key) {
        const baseCycle = Math.floor(state.smoothPhase);
        state.cinematicPhaseLock = baseCycle + p.phase;
        state.smoothPhase = state.cinematicPhaseLock;
        state.lastCycleIndex = baseCycle;
        // Snap sky color instantly (bypass the gradual lerp).
        const frac = state.smoothPhase % 1;
        const bandIndex = Math.floor(frac * SKY_COLORS.length);
        const bandT = frac * SKY_COLORS.length - bandIndex;
        const nextBand = (bandIndex + 1) % SKY_COLORS.length;
        state.currentSky = lerpColor(
          SKY_COLORS[bandIndex],
          SKY_COLORS[nextBand],
          bandT,
        );
        computeSkyGradient();
        updateCinematicHUD();
        return true;
      }
    }
    switch (e.code) {
      case "KeyR":
        GameAPI.toggleRain();
        updateCinematicHUD();
        return true;
      case "KeyL":
        forceCinematicLightning();
        updateCinematicHUD();
        return true;
      case "KeyH":
        state.unlockedPartyHat = true;
        state.wearPartyHat = !state.wearPartyHat;
        updateCinematicHUD();
        return true;
      case "KeyG":
        state.unlockedThugGlasses = true;
        state.wearThugGlasses = !state.wearThugGlasses;
        updateCinematicHUD();
        return true;
      case "KeyB":
        state.unlockedBowTie = true;
        state.wearBowTie = !state.wearBowTie;
        updateCinematicHUD();
        return true;
      case "KeyM":
        state.cinematicShowHUD = !state.cinematicShowHUD;
        updateCinematicHUD();
        return true;
    }
    return false;
  }

  function forceCinematicLightning() {
    state.lightning.alpha = 0.85;
    state.lightning.nextAt =
      performance.now() + LIGHTNING_MIN_COOLDOWN_MS;
    const result = _generateBoltPath();
    if (result?.path) (state.lightning as any).bolt = result.path;
  }

  function ensureCinematicHUD() {
    if (document.getElementById(CINEMATIC_HUD_ID)) return;
    const hud = document.createElement("div");
    hud.id = CINEMATIC_HUD_ID;
    hud.setAttribute("aria-hidden", "true");
    document.body.appendChild(hud);
  }

  function updateCinematicHUD() {
    const hud = document.getElementById(CINEMATIC_HUD_ID);
    if (!hud) return;
    hud.style.display = state.cinematicShowHUD ? "block" : "none";
    if (!state.cinematicShowHUD) return;
    let phaseLabel = "natural";
    if (state.cinematicPhaseLock !== null) {
      const frac = state.cinematicPhaseLock % 1;
      const nearest = CINEMATIC_PHASES.find(
        (p) => Math.abs(frac - p.phase) < 0.005,
      );
      phaseLabel = nearest ? nearest.label : frac.toFixed(2);
    }
    const cosmetics = [
      state.unlockedPartyHat && state.wearPartyHat ? "hat" : null,
      state.unlockedThugGlasses && state.wearThugGlasses ? "glasses" : null,
      state.unlockedBowTie && state.wearBowTie ? "bow" : null,
    ]
      .filter(Boolean)
      .join(" ") || "none";
    hud.innerHTML =
      '<div class="cinematic-hud-title">● CINEMATIC MODE</div>' +
      '<div class="cinematic-hud-row">Time: <b>' + phaseLabel + "</b></div>" +
      '<div class="cinematic-hud-row">Rain: <b>' + (state.isRaining ? "on" : "off") + "</b></div>" +
      '<div class="cinematic-hud-row">Cosmetics: <b>' + cosmetics + "</b></div>" +
      '<div class="cinematic-hud-keys">' +
      "<div><kbd>1-9</kbd> time &nbsp; <kbd>0</kbd> natural</div>" +
      "<div><kbd>R</kbd> rain &nbsp; <kbd>L</kbd> lightning</div>" +
      "<div><kbd>H</kbd> hat &nbsp; <kbd>G</kbd> glasses &nbsp; <kbd>B</kbd> bow</div>" +
      "<div><kbd>M</kbd> hide hud &nbsp; <kbd>F9</kbd> exit</div>" +
      "</div>";
  }

  // ══════════════════════════════════════════════════════════════════
  // Gamepad / controller support
  // ══════════════════════════════════════════════════════════════════

  const _gamepad = {
    connected: false,
    prevButtons: new Array(17).fill(false) as boolean[],
  };

  function pollGamepad() {
    let gp: Gamepad | undefined;
    try {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) {
          gp = pads[i]!;
          break;
        }
      }
    } catch (_) {
      return;
    }
    if (!gp) return;

    const prev = _gamepad.prevButtons;
    const btns = gp.buttons;

    // ── Jump / start / restart (A, B, D-pad Up) ──────────────
    for (const idx of GAMEPAD_JUMP_BUTTONS) {
      if (idx >= btns.length) continue;
      const pressed = btns[idx].value > 0.5 || btns[idx].pressed;
      if (pressed && !prev[idx]) {
        if (!state.started) {
          if (typeof (window as any).__onStartKey === "function") {
            (window as any).__onStartKey();
          }
        } else if (state.paused) {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              code: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        } else if (state.gameOver) {
          maybeResetAfterGameOver();
        } else {
          if (!raptor.jump()) raptor.bufferJump(performance.now());
        }
      }
    }

    // ── Start / Options button → toggle menu ─────────────────
    if (GAMEPAD_MENU_BUTTON < btns.length) {
      const pressed =
        btns[GAMEPAD_MENU_BUTTON].value > 0.5 ||
        btns[GAMEPAD_MENU_BUTTON].pressed;
      if (pressed && !prev[GAMEPAD_MENU_BUTTON]) {
        if (!state.started) {
          if (typeof (window as any).__onStartKey === "function") {
            (window as any).__onStartKey();
          }
        } else {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              code: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      }
    }

    for (let i = 0; i < btns.length && i < prev.length; i++) {
      prev[i] = btns[i].value > 0.5 || btns[i].pressed;
    }
  }

  async function init() {
    // Parse `?debug=true` — turns on debug mode which makes the
    // "Show hitboxes" toggle visible in the menu.
    try {
      const params = new URLSearchParams(window.location.search);
      state.debug = params.get("debug") === "true";
      if (state.debug) {
        document.body.setAttribute("data-debug", "true");
        state.showHitboxes = false;
        state.noCollisions = true;
        perf.enabled = false;
      }
    } catch (e) {
      /* no-op */
    }

    // Populate the shared contexts bag from src/canvas.ts, then alias
    // the local let-variables so the existing render code (which
    // still references bare `ctx`, `skyCtx`, etc.) keeps working.
    // Once the render code moves into its own modules, these aliases
    // and the outer `let` declarations will be deleted.
    if (!initCanvas("game-canvas")) return;
    canvas = contexts.mainCanvas!;
    ctx = contexts.main!;
    skyCanvas = contexts.skyCanvas!;
    skyCtx = contexts.sky!;
    fgCanvas = contexts.fgCanvas!;
    fgCtx = contexts.fg!;
    deathCanvas = contexts.deathCanvas!;
    deathCtx = contexts.death!;

    audio.init();
    // Break the audio → state hard dependency: invalidate the
    // Sound-of-Silence streak when the player un-mutes mid-run.
    audio.setUnmuteDuringRunHandler(() => {
      if (state && state.started && !state.gameOver) {
        state._runMutedThroughout = false;
      }
    });
    // Register the achievement hook for particles (used by
    // maybeSpawnShootingStar to fire the `first-shooting-star`
    // unlock). unlockAchievement itself still lives in this file.
    setParticlesAchievementHandler((id) => unlockAchievement(id));
    // Wire the rare-events module: achievement callback for
    // "ufo-sighting"/"santa-spotted"/etc, plus the dune-height
    // provider for tumbleweed / UFO abduction / meteor impact
    // positioning. _duneHeight still lives in this file.
    setRareEventsAchievementHandler((id) => unlockAchievement(id));
    setDuneHeightProvider((x, off) => duneHeight(x, off));

    // Load the player's saved mute preference into the audio object's
    // state, without triggering .play() yet (browser autoplay
    // policies require a user gesture). The saved value will be
    // applied for real on the first Start Game click, which IS a
    // user gesture.
    // On Capacitor, copy any key that was evicted from localStorage
    // but still lives in @capacitor/preferences back into localStorage
    // before the sync load block below reads it. No-op on web (resolves
    // immediately). See src/mobile/durable.ts for why this exists.
    await hydratePersistence();

    const savedMuted = audio.loadSavedMuted();
    if (savedMuted != null) {
      audio.muted = savedMuted;
      audio.hasSavedPreference = true;
    }

    // Load the player's saved personal best (if any) so the start
    // screen and game-over overlay can show it.
    state.highScore = loadHighScore();
    // Load the cumulative jump count + the two accessory unlock
    // bits. wearX defaults to true so a newly-unlocked accessory
    // shows up immediately; returning players get whatever they
    // last saved.
    state.totalJumps = loadTotalJumps();
    state.totalDayCycles = loadTotalDayCycles();
    // Derive the initial moon phase from saved cycle count — otherwise
    // a returning player renders at ph=0 (invisible new moon) until the
    // next day-cycle boundary, even if they were mid-cycle last session.
    state.moonPhase = moonPhaseFromCycles(state.totalDayCycles);
    state._rareEventsSeen = loadRareEventsSeen();
    state.careerRuns = loadCareerRuns();
    state.unlockedAchievements = loadUnlockedAchievements();
    // Bidirectional reconcile with Steam. Runs in the background so
    // the game doesn't block on IPC during startup. Remote unlocks
    // discovered here are merged silently into localStorage (no toast
    // flood on first launch). No-op in the browser build.
    reconcileWithSteam(state.unlockedAchievements, (id) => {
      state.unlockedAchievements[id] = true;
      saveUnlockedAchievements(state.unlockedAchievements);
    });
    state.unlockedPartyHat = loadBoolFlag(UNLOCKED_PARTY_HAT_KEY, false);
    state.unlockedThugGlasses = loadBoolFlag(UNLOCKED_THUG_GLASSES_KEY, false);
    state.wearPartyHat = loadBoolFlag(WEAR_PARTY_HAT_KEY, true);
    state.wearThugGlasses = loadBoolFlag(WEAR_THUG_GLASSES_KEY, true);
    state.unlockedBowTie = loadBoolFlag(UNLOCKED_BOW_TIE_KEY, false);
    state.wearBowTie = loadBoolFlag(WEAR_BOW_TIE_KEY, true);

    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    await preloadImages();
    // Pre-upload every sprite to the GPU now so the first drawImage
    // of a rare-event sprite doesn't cause a texture-upload hitch
    // mid-run (previously killed the player when the UFO spawned).
    warmImageTextures();

    // Re-init dunes now that images are loaded so background cacti
    // don't "plop in" on the first frame (onResize already called
    // initDunes, but IMAGES were still empty at that point).
    initDunes();

    // Pass the landing-dust and rare-event-roll hooks into the raptor
    // so src/entities/raptor.ts has no dependency on module-local
    // helpers. Both are defined later in this file.
    raptor = new Raptor(
      () => {
        spawnDust(raptor.x + raptor.w * 0.51, state.ground);
        spawnDust(raptor.x + raptor.w * 0.73, state.ground);
      },
      () => {
        maybeSpawnRareEvent();
      },
    );
    cactuses = new Cactuses(
      raptor,
      (id) => unlockAchievement(id),
      (x, y) => spawnConfettiBurst(x, y),
    );
    stars = new Stars();
    computeSkyGradient();

    // Eagerly bake the shooting-star trail sprite BEFORE the
    // first frame so the first star to spawn doesn't pay a
    // canvas / gradient compile cost on the hot path.
    bakeShootingStarSprite();
    if (ctx) warmShootingStarSprite(ctx);

    // Warm ctx.shadowBlur on the live game canvas by drawing a
    // tiny throwaway stroke with shadow on, off-screen. Chromium's
    // Skia pipeline compiles a shader on first use of shadowBlur —
    // previously caused a visible hitch on the very first lightning
    // flash (when drawLightning uses shadowBlur: 15 on the bolt).
    //
    // Same trick for gradients: first createRadialGradient and first
    // multi-stop createLinearGradient also compile shaders on use.
    // Previously caused a hitch on the meteor (extinction event)
    // first spawn, when the streak head glow and trail fill the
    // render with fresh gradients.
    if (ctx) {
      ctx.save();
      ctx.shadowBlur = 15;
      ctx.shadowColor = "rgba(180,200,255,0.8)";
      ctx.strokeStyle = "rgba(255,255,255,1)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-50, -50);
      ctx.lineTo(-40, -40);
      ctx.stroke();
      ctx.restore();

      // Warm radial-gradient shader with the same color-stop profile
      // used by the meteor head glow (white → orange → transparent).
      const rg = ctx.createRadialGradient(-100, -100, 0, -100, -100, 12);
      rg.addColorStop(0, "rgba(255, 255, 220, 1)");
      rg.addColorStop(0.4, "rgba(255, 180, 50, 0.6)");
      rg.addColorStop(1, "rgba(255, 80, 0, 0)");
      ctx.fillStyle = rg;
      ctx.fillRect(-200, -200, 30, 30);

      // Warm multi-stop linear-gradient shader (4 stops — same shape
      // as the meteor trail) and a 2-stop variant covering the
      // common case used elsewhere (sky gradient, lightning bolt).
      const lg4 = ctx.createLinearGradient(-100, -100, -50, -50);
      lg4.addColorStop(0, "rgba(255, 220, 80, 0.8)");
      lg4.addColorStop(0.3, "rgba(255, 120, 20, 0.4)");
      lg4.addColorStop(0.7, "rgba(220, 50, 0, 0.15)");
      lg4.addColorStop(1, "rgba(150, 30, 0, 0)");
      ctx.fillStyle = lg4;
      ctx.fillRect(-200, -200, 30, 30);
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    // Gamepad connection tracking.
    window.addEventListener("gamepadconnected", (e: GamepadEvent) => {
      _gamepad.connected = true;
      console.log("Gamepad connected:", e.gamepad.id);
    });
    window.addEventListener("gamepaddisconnected", () => {
      _gamepad.connected = false;
      _gamepad.prevButtons.fill(false);
      console.log("Gamepad disconnected");
    });

    // Start the rAF loop. The game stays paused (state.paused = true)
    // until Game.start() is called by the Start button click handler.
    _rafId = requestAnimationFrame(loop);

    // Capacitor wire-up. Gated on __IS_CAPACITOR__ so Rollup drops the
    // dynamic import and the entire src/mobile/ tree from the web
    // bundle. The async work is fire-and-forget: a slow lock or a
    // missing plugin must never block the first frame.
    if (__IS_CAPACITOR__) {
      import("./mobile/bridge")
        .then(({ initMobile, hideSplash }) => {
          initMobile({
            onBackButton: () => {
              const w = window as any;
              if (w.__rrIsMenuOpen && w.__rrIsMenuOpen()) {
                w.__rrCloseMenu?.();
                return true;
              }
              w.__rrToggleMenu?.();
              return true;
            },
            // Backgrounded: freeze the game. Audio is already gated on
            // state.paused via the visibilitychange hook; pausing is
            // enough.
            onPause: () => {
              GameAPI.pause();
            },
            // Returning from background: DO NOT auto-resume — leave
            // the game paused and show the menu, so the player isn't
            // killed by a cactus that appeared while they were away.
            onResume: () => {
              GameAPI.pause();
              const w = window as any;
              if (w.__rrIsMenuOpen && !w.__rrIsMenuOpen()) {
                w.__rrToggleMenu?.();
              }
            },
          });
          // Dismiss the native splash now that the rAF loop is running
          // and has rendered at least the first frame. 300ms fade hides
          // any remaining asset-decode jitter.
          hideSplash();
        })
        .catch(() => {
          /* ignore — missing bridge must not break the web game */
        });
    }

    GameAPI._ready = true;
    if (GameAPI._readyCb) {
      const cb = GameAPI._readyCb;
      GameAPI._readyCb = null;
      cb();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
