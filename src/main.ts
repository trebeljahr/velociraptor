// @ts-nocheck
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
 *   Game.setMuted(muted)     – controls both music and jump SFX
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
import ScoreCardWorker from "./workers/scoreCard.worker.ts?worker";
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
  MOON_SYNODIC_CYCLE,
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
} from "./persistence";
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
} from "./effects/weather";
import {
  RARE_EVENTS,
  maybeSpawnRareEvent,
  updateRareEvent,
  setRareEventsAchievementHandler,
  setDuneHeightProvider,
} from "./effects/rareEvents";

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
  // src/constants.ts. The _isNightBand / _isDayBand derivation and
  // isNightPhase() helper remain here for now — they'll move into a
  // dedicated sky module later.
  const _isNightBand = SKY_COLORS.map(
    (c) =>
      c[0] === NIGHT_COLOR[0] &&
      c[1] === NIGHT_COLOR[1] &&
      c[2] === NIGHT_COLOR[2],
  );
  /** True when bandIndex (+ fractional bandT) is in the dark zone:
   *  solid-night bands, plus the dark half of each adjacent twilight. */
  function isNightPhase(bandIndex, bandT) {
    if (_isNightBand[bandIndex]) return true;
    // Transitioning INTO night (next band is night): dark half = bandT > 0.5
    const next = (bandIndex + 1) % SKY_COLORS.length;
    if (_isNightBand[next] && bandT > 0.5) return true;
    // Transitioning OUT OF night (prev band is night): dark half = bandT < 0.5
    const prev = (bandIndex - 1 + SKY_COLORS.length) % SKY_COLORS.length;
    if (_isNightBand[prev] && bandT < 0.5) return true;
    return false;
  }
  // Daytime band indices (for night-survival tracking: count the
  // night as survived once the sky is solidly in a day band).
  const _isDayBand = _isNightBand.map((night, i) => {
    if (night) return false;
    // Exclude twilight/transition bands (adjacent to a night band).
    const prev = (i - 1 + SKY_COLORS.length) % SKY_COLORS.length;
    const next = (i + 1) % SKY_COLORS.length;
    return !_isNightBand[prev] && !_isNightBand[next];
  });

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

  /** Strength of the foreground sky-light tint applied in render().
   *  Continuous: 0.05 at midday under a clean blue sky (so the
   *  foreground reads as neutral, not blue-cast), rising through
   *  ~0.21 at the peak of a magenta-pink twilight, and up to ~0.37
   *  at full night. The ramp is quadratic in `t` so twilight stays
   *  subtle — roughly half of what a linear ramp would give — while
   *  night still lands at ~2/3 of the "full strength" tint. */
  function tintStrength() {
    const sky = state.currentSky;
    const dayBlue = SKY_COLORS[0];
    const dx = sky[0] - dayBlue[0];
    const dy = sky[1] - dayBlue[1];
    const dz = sky[2] - dayBlue[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Maximum sensible distance is from blue to night (~258).
    const t = Math.min(1, distance / 250);
    return 0.05 + t * t * 0.32;
  }
  /** Per-channel multiply factor that the global tint applies. */
  function tintFactor() {
    const sky = state.currentSky;
    const s = tintStrength();
    return [
      255 + (sky[0] - 255) * s,
      255 + (sky[1] - 255) * s,
      255 + (sky[2] - 255) * s,
    ];
  }
  // randRange / clamp / polygonsOverlap / pointInPolygon /
  // segmentsIntersect / cross / shrinkPolygon all live in src/helpers.ts.

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

  let canvas, ctx;
  let skyCanvas, skyCtx;
  // Offscreen canvas for the foreground layer (clouds, ground,
  // cacti, raptor). We tint just this canvas with the sky color and
  // then composite it over the main canvas — that way the sky and
  // light sources (stars, sun, moon) keep their full brightness
  // while the foreground gets a uniform sky-light wash.
  let fgCanvas, fgCtx;
  // Offscreen canvas that captures the main game canvas at the
  // exact moment of death (before the game-over overlay is drawn).
  // Used as the background for the shareable score card so the
  // card literally shows the scene the player just died in.
  let deathCanvas, deathCtx;
  let deathSnapshotReady = false;
  let _rafId = 0;
  let raptor, cactuses, stars;

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
  // drawRareEvent + drawRareEventSky + drawRareEventFg + drawUfoBeam
  // still live in this file because they're ~450 lines of canvas
  // drawing entangled with sky/world rendering — they'll migrate
  // when the render modules split out.

  /** Draw sky-layer rare events (comet, meteor) — on main canvas, no tint. */
  function drawRareEventSky(ctx) {
    if (!state.activeRareEvent) return;
    const e = state.activeRareEvent;
    if (e.id !== "comet" && e.id !== "meteor") return;
    drawRareEvent(ctx);
  }

  /** Draw foreground rare events (UFO, Santa, tumbleweed) — on fgCtx, gets tint. */
  /** Draw the UFO beam on the background canvas so dunes paint over it. */
  function drawUfoBeam(ctx) {
    if (!state.activeRareEvent || state.activeRareEvent.id !== "ufo") return;
    const e = state.activeRareEvent;
    if (!e.beam) return;
    const ufoH = IMAGES.ufo ? 60 * (IMAGES.ufo.height / IMAGES.ufo.width) : 35;
    const scan =
      0.4 + 0.2 * Math.sin(e.age * 4.5) + 0.1 * Math.sin(e.age * 7.3);
    const beamBottomL = e.x - 30,
      beamBottomR = e.x + 30;
    ctx.save();
    ctx.fillStyle = `rgba(245, 250, 255, ${scan})`;
    ctx.beginPath();
    ctx.moveTo(e.x - 12, e.y + ufoH / 2);
    ctx.lineTo(e.x + 12, e.y + ufoH / 2);
    ctx.lineTo(beamBottomR, state.ground);
    ctx.lineTo(beamBottomL, state.ground);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawRareEventFg(ctx) {
    if (!state.activeRareEvent) return;
    const e = state.activeRareEvent;
    // Comet/meteor on sky canvas, tumbleweed in dune layer
    if (e.id === "comet" || e.id === "meteor" || e.id === "tumbleweed") return;
    drawRareEvent(ctx);
  }

  function drawRareEvent(ctx) {
    if (!state.activeRareEvent) return;
    const e = state.activeRareEvent;
    const t = e.age / e.life;
    let alpha = 1;
    // These events enter/exit the screen naturally — no fade
    if (e.id !== "comet" && e.id !== "meteor" && e.id !== "tumbleweed") {
      if (t < 0.1) alpha = t / 0.1;
      else if (t > 0.9) alpha = (1 - t) / 0.1;
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    if (e.id === "ufo") {
      const img = IMAGES.ufo;
      const ufoW = 60,
        ufoH = img ? 60 * (img.height / img.width) : 35;
      if (img) {
        ctx.drawImage(img, e.x - ufoW / 2, e.y - ufoH / 2, ufoW, ufoH);
      }
      // Draw abducted cactus spiraling up in the beam
      if (e.phase === "abduct" && e.targetCactus && e.cactusLift != null) {
        const dc = e.targetCactus;
        const cImg = IMAGES[dc.key];
        if (cImg) {
          // Use stored grab position (cactus is already dead/hidden)
          const grabX = e.abductSx || e.x;
          const grabY = e.abductDuneY || state.ground;
          const liftT = e.cactusLift;
          const cx =
            grabX +
            (e.x - grabX) * liftT +
            Math.sin(e.age * 6) * 8 * (1 - liftT);
          const cy = grabY + (e.y + ufoH / 2 - grabY) * liftT;
          const cScale = 1 - liftT * 0.5; // shrinks as it gets "further"
          const cw = dc.w * cScale;
          const ch = dc.h * cScale;
          const rot = e.age * 3; // spinning
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(rot);
          ctx.drawImage(cImg, -cw / 2, -ch, cw, ch);
          ctx.restore();
        }
      }
    } else if (e.id === "santa") {
      const sleighImg = IMAGES.santaSleigh;
      const deerImg = IMAGES.reindeer;
      const sleighW = 55,
        sleighH = sleighImg ? 55 * (sleighImg.height / sleighImg.width) : 30;
      const deerW = 22,
        deerH = deerImg ? 22 * (deerImg.height / deerImg.width) : 25;
      // Sleigh harness attachment — measured from sprite (165/200, 55/128)
      const harnessX = e.x + sleighW * 0.325;
      const harnessY = e.y - sleighH * 0.07;
      // Draw 2 reindeer in front, connected by curved harness lines
      const deerPositions = [];
      for (let i = 0; i < 2; i++) {
        const dx = 40 + i * 30;
        const bobY = Math.sin(e.age * 3 + i * 1.5) * 4;
        const deerX = e.x + dx;
        const deerY = e.y - 5 + bobY;
        // Collar attachment — measured from sprite (185/200, 88/274)
        const collarX = deerX + deerW * 0.425;
        const collarY = deerY - deerH * 0.179;
        deerPositions.push({ deerX, deerY, collarX, collarY, bobY });
        // Curved harness line — droops slightly between sleigh and collar
        ctx.strokeStyle = `rgba(90, 60, 35, ${0.6 * alpha})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(harnessX, harnessY);
        const midX = (harnessX + collarX) / 2;
        const midY = Math.max(harnessY, collarY) + 6; // droop below both points
        ctx.quadraticCurveTo(midX, midY, collarX, collarY);
        ctx.stroke();
        if (deerImg) {
          ctx.drawImage(
            deerImg,
            deerX - deerW / 2,
            deerY - deerH / 2,
            deerW,
            deerH,
          );
        }
      }
      // Draw sleigh (on top of harness lines)
      if (sleighImg) {
        ctx.drawImage(
          sleighImg,
          e.x - sleighW / 2,
          e.y - sleighH / 2,
          sleighW,
          sleighH,
        );
      }
      // Rudolph's red nose on the lead reindeer
      if (Math.sin(e.age * 8) > 0 && deerPositions[1]) {
        const lead = deerPositions[1];
        const noseX = lead.deerX + deerW * 0.4;
        const noseY = lead.deerY - deerH * 0.15;
        ctx.fillStyle = `rgba(255, 40, 20, ${alpha})`;
        ctx.beginPath();
        ctx.arc(noseX, noseY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (e.id === "tumbleweed") {
      const twImg = IMAGES.tumbleweed;
      const twSize = 20;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.rot || 0);
      if (twImg) {
        ctx.drawImage(twImg, -twSize / 2, -twSize / 2, twSize, twSize);
      }
      ctx.restore();
    } else if (e.id === "comet") {
      // "Your Name" style comet — very bright, multi-tailed, sparkly.
      const tailAngle = Math.atan2(state.height * 0.25, state.width * 1.6);
      const tailLen = state.width * 0.3;
      const headR = 10;
      const a = alpha;

      // Double-layered glow halo for extra brightness
      const outerR = headR * 14;
      const g1 = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, outerR);
      g1.addColorStop(0, `rgba(240, 248, 255, ${0.7 * a})`);
      g1.addColorStop(0.1, `rgba(200, 225, 255, ${0.35 * a})`);
      g1.addColorStop(0.3, `rgba(130, 180, 250, ${0.12 * a})`);
      g1.addColorStop(1, "rgba(60,100,200,0)");
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.arc(e.x, e.y, outerR, 0, Math.PI * 2);
      ctx.fill();
      // Inner glow — tighter, brighter
      const g2 = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, headR * 4);
      g2.addColorStop(0, `rgba(255, 255, 255, ${0.6 * a})`);
      g2.addColorStop(0.4, `rgba(200, 230, 255, ${0.25 * a})`);
      g2.addColorStop(1, "rgba(150,200,255,0)");
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, headR * 4, 0, Math.PI * 2);
      ctx.fill();

      // Bright core
      const core = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, headR);
      core.addColorStop(0, `rgba(255,255,255,${a})`);
      core.addColorStop(0.3, `rgba(230,245,255,${0.95 * a})`);
      core.addColorStop(1, `rgba(160,210,255,${0.65 * a})`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(e.x, e.y, headR, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(tailAngle);

      // Tail helper
      const _ct = (c0, c1, c2, w, x1, y1, x2, y2, ex, ey) => {
        const g = ctx.createLinearGradient(0, 0, ex, 0);
        g.addColorStop(0, c0);
        g.addColorStop(0.35, c1);
        g.addColorStop(1, c2);
        ctx.strokeStyle = g;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(x1, y1, x2, y2, ex, ey);
        ctx.stroke();
      };
      const L = tailLen;
      // Main blue-white dust tail
      _ct(
        `rgba(200,225,255,${0.75 * a})`,
        `rgba(130,180,250,${0.3 * a})`,
        "rgba(70,120,210,0)",
        9,
        L * 0.3,
        -10,
        L * 0.6,
        -18,
        L,
        -30,
      );
      // Cyan ion tail
      _ct(
        `rgba(0,250,255,${0.6 * a})`,
        `rgba(50,210,250,${0.25 * a})`,
        "rgba(30,140,230,0)",
        3,
        L * 0.4,
        5,
        L * 0.9,
        8,
        L * 1.4,
        6,
      );
      // Bright crimson
      _ct(
        `rgba(255,60,35,${0.5 * a})`,
        `rgba(230,35,20,${0.18 * a})`,
        "rgba(150,10,5,0)",
        5,
        L * 0.2,
        -20,
        L * 0.55,
        -38,
        L * 1.15,
        -55,
      );
      // Deep red
      _ct(
        `rgba(190,25,12,${0.3 * a})`,
        `rgba(140,12,8,${0.1 * a})`,
        "rgba(80,5,5,0)",
        3,
        L * 0.15,
        -28,
        L * 0.4,
        -50,
        L * 0.85,
        -70,
      );
      // Warm orange wisp
      _ct(
        `rgba(255,170,60,${0.3 * a})`,
        `rgba(230,110,30,${0.1 * a})`,
        "rgba(180,60,10,0)",
        2.5,
        L * 0.35,
        -6,
        L * 0.65,
        -14,
        L,
        -22,
      );

      // Sparkles — cover the full x/y extent of all tails,
      // similar blink frequency but very different phase offsets,
      // some detaching and lingering in the sky.
      for (let i = 0; i < 30; i++) {
        const h1 = Math.sin(i * 73.1 + 3.7) * 0.5 + 0.5;
        const h2 = Math.sin(i * 127.3 + 17.1) * 0.5 + 0.5;
        const h3 = Math.sin(i * 31.7 + 91.3) * 0.5 + 0.5;
        const h4 = Math.sin(i * 211.9 + 47.3) * 0.5 + 0.5;

        // Position along the tail (0-1)
        const along = h1 * 0.95 + 0.03;
        const baseX = along * L;
        // Y range covers the full tail fan: from +8 (ion tail)
        // down to -70 (deep red tail), scattered by h2
        const yTop = 8 * along; // ion tail top
        const yBot = -15 * along - 55 * along * along; // deep red bottom
        const sy0 = yTop + (yBot - yTop) * h2; // spread across full fan
        let sx = baseX + (h3 - 0.5) * 15;
        let sy = sy0;

        // 30% detach and drift away
        const detaches = h3 > 0.7;
        if (detaches) {
          const driftAge = Math.max(0, e.age - h4 * e.life * 0.5);
          sx += driftAge * 6 * (h2 - 0.4);
          sy += driftAge * 4 * (h4 - 0.5);
          const driftFade = Math.max(0, 1 - driftAge * 0.7);
          if (driftFade < 0.05) continue;
        }

        // Similar blink speed (4.5-6 Hz) but wildly different offsets
        const blinkSpeed = 4.5 + h4 * 1.5;
        const blinkPhase = h1 * 17.3 + h2 * 11.7; // large spread
        const blink = Math.pow(
          Math.max(0, Math.sin(e.age * blinkSpeed + blinkPhase)),
          5,
        );
        const baseBright = detaches ? 0.6 : 1;
        const sa = (1 - along * 0.5) * blink * a * baseBright;
        if (sa < 0.05) continue;

        const sr = 1.5 + (1 - along) * 2.5 + h4 * 1.5;
        const ci = i % 5;
        const sC = [
          "255,255,255",
          "200,240,255",
          "255,180,170",
          "255,230,200",
          "160,250,255",
        ][ci];
        ctx.strokeStyle = `rgba(${sC},${sa})`;
        ctx.fillStyle = `rgba(${sC},${sa})`;
        const shape = Math.floor(h4 * 3);
        if (shape === 0) {
          // 4-pointed cross
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, sy - sr * 1.3);
          ctx.lineTo(sx, sy + sr * 1.3);
          ctx.moveTo(sx - sr * 1.3, sy);
          ctx.lineTo(sx + sr * 1.3, sy);
          ctx.stroke();
        } else if (shape === 1) {
          // 6-pointed star
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(sx, sy - sr);
          ctx.lineTo(sx, sy + sr);
          ctx.moveTo(sx - sr * 0.87, sy - sr * 0.5);
          ctx.lineTo(sx + sr * 0.87, sy + sr * 0.5);
          ctx.moveTo(sx - sr * 0.87, sy + sr * 0.5);
          ctx.lineTo(sx + sr * 0.87, sy - sr * 0.5);
          ctx.stroke();
        } else {
          // Bright dot
          ctx.beginPath();
          ctx.arc(sx, sy, sr * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Soft glow around each sparkle
        ctx.fillStyle = `rgba(${sC},${sa * 0.25})`;
        ctx.beginPath();
        ctx.arc(sx, sy, sr * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (e.id === "meteor") {
      if (!e.impact) {
        const streakLen = 50;
        const angle = Math.atan2(e.vy || 1, e.vx || -0.5);
        // Head glow — bigger, brighter
        const glow = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 12);
        glow.addColorStop(0, `rgba(255, 255, 220, ${alpha})`);
        glow.addColorStop(0.4, `rgba(255, 180, 50, ${0.6 * alpha})`);
        glow.addColorStop(1, `rgba(255, 80, 0, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 12, 0, Math.PI * 2);
        ctx.fill();
        // Trail
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(angle + Math.PI);
        const tg = ctx.createLinearGradient(0, 0, streakLen, 0);
        tg.addColorStop(0, `rgba(255, 220, 80, ${0.8 * alpha})`);
        tg.addColorStop(0.3, `rgba(255, 120, 20, ${0.4 * alpha})`);
        tg.addColorStop(0.7, `rgba(220, 50, 0, ${0.15 * alpha})`);
        tg.addColorStop(1, `rgba(150, 30, 0, 0)`);
        ctx.strokeStyle = tg;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(streakLen, 0);
        ctx.stroke();
        // Sparks flying off
        for (let i = 0; i < 6; i++) {
          const sx = Math.random() * streakLen * 0.7;
          const sy = (Math.random() - 0.5) * 10;
          ctx.fillStyle = `rgba(255, ${120 + Math.random() * 135}, ${Math.random() * 40}, ${0.7 * alpha})`;
          ctx.beginPath();
          ctx.arc(sx, sy, 0.8 + Math.random() * 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else {
        // Impact — particle-based fireball + mushroom cloud
        const it = (e.age / e.life - 0.5) / 0.5;
        const ix = e.impactX,
          iy = e.impactY;
        const S = 1.3; // scale factor

        // Initial flash (first 15% of impact)
        if (it < 0.2) {
          const fa = (1 - it / 0.2) * alpha;
          ctx.fillStyle = `rgba(255, 255, 200, ${fa * 0.4})`;
          ctx.beginPath();
          ctx.arc(ix, iy, (40 + it * 100) * S, 0, Math.PI * 2);
          ctx.fill();
        }

        // Fireball particles — many small circles rising and expanding
        const particleCount = 20;
        for (let i = 0; i < particleCount; i++) {
          const pt = Math.min(1, it * 1.5 + i * 0.02);
          if (pt < 0 || pt > 1) continue;
          // Each particle rises and expands
          const seed = Math.sin(i * 73.7 + 31.1) * 0.5 + 0.5;
          const seed2 = Math.sin(i * 127.3 + 89.9) * 0.5 + 0.5;
          const px = ix + (seed - 0.5) * 40 * S * pt;
          const py = iy - pt * (30 + seed2 * 50) * S;
          const pr = (3 + pt * (4 + seed * 6)) * S;
          const pa = Math.max(0, 1 - pt * 1.2) * alpha;
          if (pa < 0.02) continue;
          // Color: white→yellow→orange→dark as particle ages
          let r, g, b;
          if (pt < 0.2) {
            r = 255;
            g = 240;
            b = 200;
          } else if (pt < 0.5) {
            const k = (pt - 0.2) / 0.3;
            r = 255;
            g = Math.round(240 - k * 120);
            b = Math.round(200 - k * 170);
          } else {
            const k = (pt - 0.5) / 0.5;
            r = Math.round(255 - k * 155);
            g = Math.round(120 - k * 80);
            b = Math.round(30 - k * 20);
          }
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pa})`;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.fill();
        }

        // Smoke column — darker particles rising higher, slower
        const smokeCount = 12;
        for (let i = 0; i < smokeCount; i++) {
          const st = Math.min(1, it * 1.2 - 0.1 + i * 0.03);
          if (st < 0 || st > 1) continue;
          const seed = Math.sin(i * 47.3 + 17.7) * 0.5 + 0.5;
          const spx = ix + (seed - 0.5) * 20 * S * st;
          const spy = iy - st * (60 + seed * 40) * S;
          const spr = (4 + st * 8) * S;
          const spa = Math.max(0, 0.8 - st) * alpha * 0.35;
          if (spa < 0.02) continue;
          ctx.fillStyle = `rgba(60, 50, 40, ${spa})`;
          ctx.beginPath();
          ctx.arc(spx, spy, spr, 0, Math.PI * 2);
          ctx.fill();
        }

        // Mushroom cap — cluster of overlapping smoke puffs at the top
        const capY = iy - (60 * Math.min(1, it * 1.3) + 30) * S;
        const capA = Math.max(0, 1 - it * 1.8) * alpha * 0.3;
        if (capA > 0.02) {
          for (let i = 0; i < 7; i++) {
            const seed = Math.sin(i * 31.7 + 5.3) * 0.5 + 0.5;
            const cpx = ix + (seed - 0.5) * 40 * S;
            const cpy = capY + Math.sin(i * 2.1) * 6;
            ctx.fillStyle = `rgba(70, 55, 40, ${capA})`;
            ctx.beginPath();
            ctx.arc(cpx, cpy, (10 + seed * 8) * S, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    ctx.restore();
  }

  // ── Rain weather system ────────────────────────────────────────

  // loadTotalDayCycles / saveTotalDayCycles live in src/persistence.ts.

  // shouldRainForCycle / spawnRain / updateRain / drawRain live in
  // src/effects/weather.ts. Lightning and rainbow still live in this
  // file because they're entangled with dune-cactus rendering and
  // achievement unlocks — they'll migrate once the render code
  // splits out.

  function updateLightning(frameScale, now) {
    if (state.lightning.alpha > 0) {
      state.lightning.alpha = Math.max(
        0,
        state.lightning.alpha - 0.015 * frameScale,
      );
    }
    // Random chance for new flash — only at full intensity, not during transitions
    if (
      state.rainIntensity > LIGHTNING_INTENSITY_THRESHOLD &&
      now > state.lightning.nextAt &&
      Math.random() < LIGHTNING_FLASH_PROBABILITY * frameScale
    ) {
      state.lightning.alpha = 0.7 + Math.random() * 0.2;
      state.lightning.nextAt = now + LIGHTNING_MIN_COOLDOWN_MS + Math.random() * (LIGHTNING_MAX_COOLDOWN_MS - LIGHTNING_MIN_COOLDOWN_MS);
      // Generate a jagged bolt path — preferring cacti as targets
      const result = _generateBoltPath();
      state.lightning.bolt = result.path;
      // If the bolt struck a cactus, blacken it
      // Blacken the struck dune cactus (they scroll slowly enough
      // for the visual to read).
      if (result.struckDuneCactus) {
        result.struckDuneCactus.struck = true;
        result.struckDuneCactus.struckAge = 0;
      }
      // Delay thunder after the flash — random 0.1–0.6s simulating
      // varying strike distances (~35–200m away).
      const thunderDelay = THUNDER_DELAY_MIN_MS + Math.random() * (THUNDER_DELAY_MAX_MS - THUNDER_DELAY_MIN_MS);
      setTimeout(() => audio.playThunder(), thunderDelay);
      if (!audio.muted && navigator.vibrate) navigator.vibrate(30);
    }
  }

  function _generateBoltPath() {
    // Always target a visible dune cactus if one exists.
    let targetX;
    let struckDuneCactus = null;
    const off = state.duneOffset || 0;
    const visibleDuneCacti = (state.duneCacti || []).filter((dc) => {
      const sx = dc.wx - off;
      return sx > 20 && sx < state.width - 20 && !dc.struck;
    });
    if (visibleDuneCacti.length > 0) {
      const dc =
        visibleDuneCacti[Math.floor(Math.random() * visibleDuneCacti.length)];
      targetX = dc.wx - off;
      struckDuneCactus = dc;
    } else {
      targetX = state.width * (0.35 + Math.random() * 0.55);
    }
    // If targeting a dune cactus, end at the cactus top; otherwise ground.
    const endY = struckDuneCactus
      ? state.ground -
        _duneHeight(targetX, state.duneOffset) -
        struckDuneCactus.h * 0.85
      : state.ground;
    const startX = targetX + (Math.random() - 0.5) * state.width * 0.15;
    const segments = LIGHTNING_BOLT_MIN_SEGMENTS + Math.floor(Math.random() * (LIGHTNING_BOLT_MAX_SEGMENTS - LIGHTNING_BOLT_MIN_SEGMENTS + 1));
    const points = [{ x: startX, y: -10 }];
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const isLast = i === segments;
      // Converge toward targetX; final point lands exactly on target
      const baseX = startX + (targetX - startX) * t;
      const jitter = isLast
        ? 0
        : (Math.random() - 0.5) * state.width * 0.08 * (1 - t);
      const x = baseX + jitter;
      const y = isLast ? endY : Math.min(t * endY, endY);
      points.push({ x, y });
      // 35% chance of a branch
      if (i > 2 && i < segments - 1 && Math.random() < 0.35) {
        const branchLen = 2 + Math.floor(Math.random() * 4);
        const branch = [];
        let bx = x,
          by = y;
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (let j = 0; j < branchLen; j++) {
          bx += dir * (15 + Math.random() * 30);
          by += 10 + Math.random() * 25;
          if (by > endY) by = endY; // clamp to ground
          branch.push({ x: bx, y: by });
        }
        points[points.length - 1].branch = branch;
      }
    }
    return { path: points, struckDuneCactus };
  }

  function _drawBolt(ctx, points, lineWidth, alpha) {
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = `rgba(180, 200, 255, ${alpha * 0.8})`;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    // Draw branches
    for (const p of points) {
      if (p.branch) {
        ctx.beginPath();
        ctx.lineWidth = lineWidth * 0.5;
        ctx.moveTo(p.x, p.y);
        for (const bp of p.branch) ctx.lineTo(bp.x, bp.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawLightning(ctx) {
    if (state.lightning.alpha <= 0) return;
    // White flash overlay (dims faster than bolt)
    const flashAlpha = Math.max(0, state.lightning.alpha - 0.3) * 0.5;
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
      ctx.fillRect(0, 0, state.width, state.height);
    }
    // Draw the bolt arc
    if (state.lightning.bolt) {
      _drawBolt(ctx, state.lightning.bolt, 3, state.lightning.alpha);
      // Draw a second thinner bright core
      _drawBolt(
        ctx,
        state.lightning.bolt,
        1.2,
        Math.min(1, state.lightning.alpha * 1.5),
      );
    }
  }

  // drawShootingStars lives in src/effects/particles.ts.

  // ════════════════════════════════════════════════════════════════
  // Sun + Moon
  //
  // Both bodies travel along a parabolic arc across the visible sky
  // tied to `state.smoothPhase`. The sun is visible during the day
  // half of the cycle (centered on phase 0 = blue daytime), the moon
  // during the night half (centered on phase 0.5 = night).
  // ════════════════════════════════════════════════════════════════

  /**
   * Returns {visible, x, y, t} for a celestial body whose visible arc
   * is centered on cycle `phaseCenter` and lasts half a cycle. `t` is
   * 0 at rise (right edge) and 1 at set (left edge), or null if not
   * visible.
   */
  function celestialArc(phaseCenter, halfWidth) {
    // Wrap so that `rel` is in [-0.5, 0.5] around phaseCenter.
    let rel = (((state.smoothPhase % 1) + 1) % 1) - phaseCenter;
    if (rel > 0.5) rel -= 1;
    if (rel < -0.5) rel += 1;
    // The "above-horizon" arc spans rel ∈ [-halfWidth, +halfWidth].
    // We extend the computed range a bit past those bounds so the
    // body actually travels below the horizon (and off-screen at the
    // left/right edge) rather than stopping at the horizon and
    // fading out — that's how a real sun sets. The ground bands
    // drawn over the top of the canvas naturally occlude the disc
    // once it dips below.
    const extension = halfWidth * CELESTIAL_ARC_EXTENSION;
    if (rel < -halfWidth - extension || rel > halfWidth + extension) {
      return { visible: false, x: 0, y: 0, t: 0, alpha: 0 };
    }
    // No clamp on t — beyond [0, 1] the parabola pushes y below the
    // ground (sun has already dipped below the horizon) and x off
    // the screen edge.
    const t = (rel + halfWidth) / (halfWidth * 2);
    const x = state.width * (1 - t);
    const arcH = state.height * CELESTIAL_ARC_HEIGHT_RATIO;
    const y = state.ground - 4 * arcH * t * (1 - t);
    return { visible: true, x, y, t, alpha: 1 };
  }

  function drawSun(ctx) {
    // Sun is visible during the entire day half (solid blue + half
    // of each twilight transition). Its peak sits at the middle of
    // the solid-blue stretch.
    const arc = celestialArc(SUN_PHASE_CENTER, CELESTIAL_ARC_HALF_WIDTH);
    if (!arc.visible) return;
    const r = Math.max(SUN_MIN_RADIUS_PX, state.width * SUN_RADIUS_SCALE);
    // Elevation = 1 at the zenith, 0 at the horizon. We bend the
    // curve hard with a high exponent so the disc stays bright white
    // across almost the entire arc, only shifting to yellow in the
    // final stretch and to red right at the horizon. The lerp logic
    // below splits the elevation range into "white half" (near
    // zenith) and "warm half" (near horizon) — with this curve, the
    // warm half only kicks in for the last ~10% of the arc on each
    // side, so red is a brief sunset/sunrise moment, not the norm.
    // Clamp to [0, 1] — t can extend slightly below 0 / above 1
    // when the sun is dipping below the horizon, which would
    // otherwise produce a negative elevation.
    const elevation = Math.max(0, 1 - Math.pow(Math.abs(arc.t - 0.5) * 2, 4));
    const cZenith = [255, 250, 235];
    const cMid = [255, 200, 110];
    const cHorizon = [220, 60, 25];
    let core, halo;
    if (elevation > 0.5) {
      const k = (elevation - 0.5) * 2; // 0..1 across upper half
      core = lerpColor(cMid, cZenith, k);
      halo = lerpColor([255, 180, 100], [255, 230, 170], k);
    } else {
      const k = elevation * 2; // 0..1 across lower half
      core = lerpColor(cHorizon, cMid, k);
      halo = lerpColor([225, 70, 30], [255, 180, 100], k);
    }

    ctx.save();
    const ri = state.rainIntensity;
    if (ri > 0.05) {
      // Overcast sun: diffuse halo glow, dim disc proportional to intensity
      const haloR = r * 3;
      const ha = 0.18 * ri;
      const glow = ctx.createRadialGradient(
        arc.x,
        arc.y,
        r * 0.5,
        arc.x,
        arc.y,
        haloR,
      );
      glow.addColorStop(0, `rgba(255, 240, 200, ${ha})`);
      glow.addColorStop(0.5, `rgba(255, 230, 180, ${ha * 0.45})`);
      glow.addColorStop(1, `rgba(255, 220, 160, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.2 + 0.8 * (1 - ri);
      ctx.fillStyle = rgb(core);
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Clear sky: solid disc, no halo
      ctx.fillStyle = rgb(core);
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMoon(ctx) {
    // Moon mirrors the sun: visible during the entire night half
    // (solid night + half of each twilight transition), with the
    // same arc width so it traces a matching gentle parabola.
    const arc = celestialArc(MOON_PHASE_CENTER, CELESTIAL_ARC_HALF_WIDTH);
    if (!arc.visible) return;
    const r = Math.max(MOON_MIN_RADIUS_PX, state.width * MOON_RADIUS_SCALE);
    // Bright near-white moon. The shadow is the sky color so it
    // reads as the dark side of the disc.
    const core = [250, 250, 252];
    const halo = [220, 230, 250];
    const shadow = [
      Math.round(state.currentSky[0] * 0.5),
      Math.round(state.currentSky[1] * 0.5),
      Math.round(state.currentSky[2] * 0.5),
    ];

    ctx.save();
    ctx.globalAlpha = arc.alpha * (0.2 + 0.8 * (1 - state.rainIntensity));
    // Halo.
    const glow = ctx.createRadialGradient(
      arc.x,
      arc.y,
      r * 0.3,
      arc.x,
      arc.y,
      r * 2.6,
    );
    glow.addColorStop(0, rgba(halo, 0.45));
    glow.addColorStop(0.5, rgba(halo, 0.14));
    glow.addColorStop(1, rgba(halo, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    // Disc.
    ctx.fillStyle = rgb(core);
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Subtle craters — clipped to the moon disc.
    ctx.save();
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = `rgba(200, 200, 210, 0.15)`;
    const craters = [
      { dx: -0.25, dy: -0.3, cr: 0.18 },
      { dx: 0.3, dy: 0.15, cr: 0.22 },
      { dx: -0.1, dy: 0.35, cr: 0.14 },
      { dx: 0.15, dy: -0.2, cr: 0.1 },
      { dx: -0.35, dy: 0.1, cr: 0.12 },
      { dx: 0.05, dy: 0.05, cr: 0.08 },
    ];
    for (const c of craters) {
      ctx.beginPath();
      ctx.arc(arc.x + c.dx * r, arc.y + c.dy * r, c.cr * r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Realistic moon phase using terminator ellipse.
    // Phase 0 = new moon (dark), 0.25 = first quarter,
    // 0.5 = full moon (bright), 0.75 = last quarter.
    ctx.save();
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.clip();
    const ph = state.moonPhase;
    // Illumination fraction: 0 at new, 1 at full
    const illum = (1 - Math.cos(ph * Math.PI * 2)) / 2;
    if (illum < 0.98) {
      // Terminator x-radius: how far the shadow ellipse extends.
      // cos maps illumination to the terminator position on the disc.
      const terminatorX = r * Math.cos(illum * Math.PI);
      // Waxing (ph < 0.5): shadow on the left, light on right
      // Waning (ph > 0.5): shadow on the right, light on left
      const waxing = ph < 0.5;
      // Draw shadow on the dark side
      ctx.fillStyle = rgba(shadow, 0.8);
      ctx.beginPath();
      // Dark half: semicircle on shadow side
      if (waxing) {
        ctx.arc(arc.x, arc.y, r, Math.PI * 0.5, Math.PI * 1.5);
      } else {
        ctx.arc(arc.x, arc.y, r, -Math.PI * 0.5, Math.PI * 0.5);
      }
      // Terminator edge: ellipse connecting top and bottom
      ctx.ellipse(
        arc.x,
        arc.y,
        Math.abs(terminatorX),
        r,
        0,
        waxing ? -Math.PI * 0.5 : Math.PI * 0.5,
        waxing ? Math.PI * 0.5 : -Math.PI * 0.5,
        waxing ? terminatorX > 0 : terminatorX < 0,
      );
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════
  // Clouds — drawn with four overlapping top-half ellipses to match
  // the original game's four-arc cloud shape.
  // ══════════════════════════════════════════════════════════════════

  const CLOUD_BUMPS = [
    { dx: 0, rx: 12.5, ry: 10 },
    { dx: 10, rx: 12.5, ry: 22.5 },
    { dx: 25, rx: 12.5, ry: 17.5 },
    { dx: 40, rx: 15, ry: 10 },
  ];

  function drawPolygon(ctx, poly, opts) {
    if (!poly || poly.length === 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    if (opts.fill) {
      ctx.fillStyle = opts.fill;
      ctx.fill();
    }
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = opts.lineWidth || 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCloud(ctx, x, y, size) {
    // Canvas angle convention (y-down): 0 = right, PI/2 = down,
    // PI = left, 3*PI/2 = up. Going CW (counterclockwise=false) from
    // PI to 0 traces: left → up → right, giving the TOP half of the
    // ellipse — a dome pointing upward, matching the original p5 shape.
    //
    // Drawn pure white — the global multiply tint applied at the end
    // of render() picks up the sky color and tints clouds to match
    // (peachy at sunset, blue-grey at night, white at midday).
    ctx.fillStyle = "#ffffff";
    for (const b of CLOUD_BUMPS) {
      ctx.beginPath();
      ctx.ellipse(
        x + b.dx * size,
        y,
        b.rx * size,
        b.ry * size,
        0,
        Math.PI,
        0,
        false,
      );
      ctx.fill();
    }
  }

  /** Draw a rain cloud — long, flat, hazy streak instead of puffy bumps.
   *  Multiple overlapping ellipses create a layered overcast look. */
  /** Draw a persistent overcast layer across the entire sky.
   *  Called once per frame (not per cloud) when rain intensity > 0.
   *  Uses wide, flat, band-like rectangles at varying heights. */
  function drawOvercastBands(ctx, intensity) {
    if (intensity <= 0) return;
    const w = state.width;
    const coverH = state.height * 0.55;
    // Thick impermeable cover at the top, gradually thinning downward.
    const a = intensity;
    const mainGrad = ctx.createLinearGradient(0, 0, 0, coverH);
    mainGrad.addColorStop(0, `rgba(55, 60, 65, ${0.98 * a})`);
    mainGrad.addColorStop(0.1, `rgba(60, 65, 70, ${0.95 * a})`);
    mainGrad.addColorStop(0.25, `rgba(70, 75, 80, ${0.8 * a})`);
    mainGrad.addColorStop(0.45, `rgba(85, 90, 95, ${0.5 * a})`);
    mainGrad.addColorStop(0.7, `rgba(100, 105, 110, ${0.2 * a})`);
    mainGrad.addColorStop(1, `rgba(115, 120, 125, 0)`);
    ctx.fillStyle = mainGrad;
    ctx.fillRect(0, 0, w, coverH);
    // Thicker sub-bands for visible layering at the top
    const bands = [
      { y: 0, h: coverH * 0.15, alpha: 0.25 },
      { y: coverH * 0.12, h: coverH * 0.2, alpha: 0.18 },
      { y: coverH * 0.28, h: coverH * 0.25, alpha: 0.12 },
      { y: coverH * 0.45, h: coverH * 0.2, alpha: 0.08 },
    ];
    for (const b of bands) {
      const ba = b.alpha * a;
      const grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      grad.addColorStop(0, `rgba(80, 85, 90, ${ba})`);
      grad.addColorStop(1, `rgba(100, 105, 110, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, b.y, w, b.h);
    }
  }

  /** Draw a cloud that morphs from puffy (ri=0) to flat overcast band (ri=1).
   *  Uses the same ellipse geometry but interpolates radii and color. */
  function drawCloudMorphed(ctx, x, y, size, ri) {
    // Interpolate between white puffy and gray flat
    const r = Math.round(255 - ri * 135);
    const g = Math.round(255 - ri * 130);
    const b = Math.round(255 - ri * 125);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

    if (ri < 0.01) {
      // Pure puffy cloud — use CLOUD_BUMPS directly
      for (const bmp of CLOUD_BUMPS) {
        ctx.beginPath();
        ctx.ellipse(
          x + bmp.dx * size,
          y,
          bmp.rx * size,
          bmp.ry * size,
          0,
          Math.PI,
          0,
          false,
        );
        ctx.fill();
      }
      return;
    }

    // Morph: each bump stretches wider and flatter with intensity.
    // At ri=1, bumps merge into one wide flat band.
    for (const bmp of CLOUD_BUMPS) {
      const rx = bmp.rx * (1 + ri * 7) * size; // much wider
      const ry = bmp.ry * (1 - ri * 0.7) * size; // much flatter
      // Shift bumps toward center x as they merge
      const dx = bmp.dx * (1 - ri * 0.6) * size;
      ctx.beginPath();
      ctx.ellipse(x + dx, y, rx, Math.max(ry, 3 * size), 0, Math.PI, 0, false);
      ctx.fill();
    }

    // At high intensity, add a wider semi-transparent band on top
    if (ri > 0.3) {
      const bandAlpha = (ri - 0.3) * 0.5;
      ctx.fillStyle = `rgba(${r - 10}, ${g - 10}, ${b - 10}, ${bandAlpha})`;
      const bandW = 100 * size * ri;
      const bandH = 6 * size;
      ctx.beginPath();
      ctx.ellipse(x, y - bandH * 0.3, bandW, bandH, 0, Math.PI, 0, false);
      ctx.fill();
    }
  }

  /** Approximate pixel width of a cloud at the given size+scale, used
   *  to spawn each cloud just past the right edge so it drifts into
   *  view smoothly instead of popping in. Based on the CLOUD_BUMPS
   *  footprint: leftmost bump at dx=-12.5 to rightmost at dx=55. */
  function cloudVisualWidth(size, scale) {
    // Rain clouds are wider streaks (~240px base vs 70px for puffy clouds)
    const base = state.rainIntensity > 0.3 ? 240 : 70;
    return base * size * scale;
  }

  /** Target cloud count for the current viewport — tuned so a typical
   *  desktop gets ~5-7 clouds and mobile gets ~3-4. The update loop
   *  maintains this density by spawning a new cloud whenever one
   *  drifts off-screen, so the sky never clusters or empties. */
  function targetCloudCount() {
    const base = Math.max(CLOUD_MIN_COUNT, Math.round(state.width / CLOUD_DENSITY_DIVISOR));
    const density = state._cloudDensity || 1;
    // Smoothly interpolate cloud count with rain intensity
    const rainMult = 1 + state.rainIntensity * CLOUD_RAIN_MULTIPLIER_MAX; // 1× to 3×
    return Math.round(base * Math.max(density, rainMult));
  }

  /** Minimum horizontal distance between a newly-spawned cloud and the
   *  previous rightmost cloud, to avoid visual stacking. */
  function minCloudSpacing() {
    const base = Math.max(CLOUD_MIN_SPACING_FLOOR_PX, state.width * CLOUD_MIN_SPACING_RATIO);
    return state.rainIntensity > CLOUD_HEAVY_RAIN_SPACING ? base * CLOUD_HEAVY_RAIN_SPACING : base;
  }

  function makeCloudObject(xAbsolute) {
    // Y range spans from the top of the screen down to roughly half
    // of the play area so some clouds hang low over the horizon.
    const yMin = 40;
    const yMax = Math.max(180, state.ground * 0.55);
    const size = randRange(0.55, 1.2) * (state.width / VELOCITY_SCALE_DIVISOR);
    const scale = 2;
    return {
      x: xAbsolute,
      y: yMin + Math.random() * (yMax - yMin),
      size,
      scale,
    };
  }

  /** Spawn a single new cloud just past the right edge, but only if
   *  it won't sit on top of the rightmost existing cloud. Returns
   *  true if the cloud was added. */
  function trySpawnCloud() {
    const candidate = makeCloudObject(0);
    const visualWidth = cloudVisualWidth(candidate.size, candidate.scale);
    // Find the rightmost existing cloud.
    let rightmost = -Infinity;
    for (const c of state.clouds) {
      if (c.x > rightmost) rightmost = c.x;
    }
    const spawnX = state.width + visualWidth * 0.5;
    if (rightmost > -Infinity && spawnX - rightmost < minCloudSpacing()) {
      return false;
    }
    candidate.x = spawnX;
    state.clouds.push(candidate);
    return true;
  }

  /** Pre-populate the sky with a balanced handful of clouds so the
   *  game doesn't start with an empty background. Positions are
   *  deterministically spaced across the full width so no two seed
   *  clouds collide. */
  function seedClouds() {
    state.clouds = [];
    const count = targetCloudCount();
    const gap = state.width / count;
    for (let i = 0; i < count; i++) {
      // Base position evenly spaced, plus a small random jitter so
      // it doesn't look mechanical.
      const baseX = gap * (i + 0.5);
      const jitter = (Math.random() - 0.5) * gap * 0.4;
      const cloud = makeCloudObject(baseX + jitter);
      state.clouds.push(cloud);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Parallax background layers (dunes, procedural)
  // ══════════════════════════════════════════════════════════════════

  /** Dune ridge height above ground — gentle rolling sin waves.
   *  Frequencies are relative to viewport width for consistent look. */
  function _duneHeight(screenX, offset) {
    const wx = screenX + offset;
    const h = state.height;
    const f = (Math.PI * 2) / (state.width * 2);
    return (
      h * 0.04 * Math.sin(wx * f * 3 + 1.2) +
      h * 0.025 * Math.sin(wx * f * 5 + 0.7) +
      h * 0.015 * Math.sin(wx * f * 8 + 2.1) +
      h * DUNE_BASE_HEIGHT_RATIO
    );
  }

  /** Spawn a dune cactus at the given world-space x. */
  function _spawnDuneCactus(worldX) {
    const variant =
      CACTUS_VARIANTS[Math.floor(Math.random() * CACTUS_VARIANTS.length)];
    const ch = (DUNE_CACTUS_MIN_HEIGHT_PX + Math.random() * DUNE_CACTUS_HEIGHT_RANGE_PX) * variant.heightScale;
    const cw = ch * (variant.w / variant.h);
    return {
      wx: worldX,
      h: ch,
      w: cw,
      key: variant.key,
      struck: false,
      depth: Math.random() < 0.5 ? 1 : 3, // tumbleweed draws at depth 2
    };
  }

  function initDunes() {
    state.duneCacti = [];
    state._nextDuneCactusX = 0;
    // Pre-populate cacti across the initial visible area + buffer
    let wx = -state.width * 0.5;
    while (wx < state.width * 2) {
      state.duneCacti.push(_spawnDuneCactus(wx));
      wx += DUNE_CACTUS_MIN_SPACING_PX + Math.random() * DUNE_CACTUS_SPACING_RANGE_PX;
    }
    state._nextDuneCactusX = wx;
  }

  // ══════════════════════════════════════════════════════════════════
  // Sky gradient (cached in an off-screen canvas, repainted only when
  // the current sky color changes)
  // ══════════════════════════════════════════════════════════════════

  function computeSkyGradient() {
    if (!skyCanvas || !skyCtx) return;
    const w = state.width;
    const h = state.height;
    if (skyCanvas.width !== w) skyCanvas.width = w;
    if (skyCanvas.height !== h) skyCanvas.height = h;
    // Fade from the current sky color at the top to a slightly
    // brighter, desaturated version at the horizon for atmospheric
    // depth. Both stops are pre-divided by the foreground multiply
    // tint that gets applied over the whole canvas in render(), so
    // that AFTER the multiply, the visible sky still looks like
    // `currentSky` rather than darkened. Without this compensation
    // the sky reads too dark, especially at night where the multiply
    // factor is highest.
    const sky = state.currentSky;
    const horizonR = Math.round(sky[0] + (255 - sky[0]) * 0.45);
    const horizonG = Math.round(sky[1] + (255 - sky[1]) * 0.45);
    const horizonB = Math.round(sky[2] + (255 - sky[2]) * 0.45);
    const grad = skyCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgb(sky));
    grad.addColorStop(1, `rgb(${horizonR}, ${horizonG}, ${horizonB})`);
    skyCtx.fillStyle = grad;
    skyCtx.fillRect(0, 0, w, h);
  }

  // ══════════════════════════════════════════════════════════════════
  // Shareable score card
  //
  // Composes a 1200×630 PNG with the current sky color, a fresh
  // raptor (carrying whatever cosmetics the player has unlocked
  // AND toggled on), the final score, and the personal best. The
  // shell exposes this through Game.generateScoreCard() and hands
  // the resulting Blob to either navigator.share (mobile) or a
  // download link (desktop). Returns a Promise<Blob>.
  // ══════════════════════════════════════════════════════════════════

  // Persistent worker reused across calls so we don't pay startup
  // cost every game-over.
  let scoreCardWorker = null;
  function getScoreCardWorker() {
    if (scoreCardWorker) return scoreCardWorker;
    try {
      // Vite bundles the worker via the ?worker query import at the
      // top of this file and returns a constructor class.
      scoreCardWorker = new ScoreCardWorker();
    } catch (e) {
      scoreCardWorker = null;
    }
    return scoreCardWorker;
  }

  async function generateScoreCardBlob() {
    // Try the web-worker path first — keeps the main thread
    // free so the raptor keeps animating smoothly under the
    // game-over scrim.
    try {
      if (
        deathSnapshotReady &&
        typeof createImageBitmap === "function" &&
        typeof OffscreenCanvas !== "undefined"
      ) {
        const worker = getScoreCardWorker();
        if (worker) {
          const bitmap = await createImageBitmap(deathCanvas);
          const blob = await new Promise((resolve, reject) => {
            const onMessage = (e) => {
              worker.removeEventListener("message", onMessage);
              worker.removeEventListener("error", onError);
              if (e.data && e.data.blob) resolve(e.data.blob);
              else
                reject(new Error((e.data && e.data.error) || "worker failed"));
            };
            const onError = (ev) => {
              worker.removeEventListener("message", onMessage);
              worker.removeEventListener("error", onError);
              reject(new Error("worker error: " + ev.message));
            };
            worker.addEventListener("message", onMessage);
            worker.addEventListener("error", onError);
            worker.postMessage(
              {
                bitmap,
                score: state.score,
                highScore: state.highScore,
                newHighScore: state.newHighScore,
              },
              [bitmap],
            );
          });
          return blob;
        }
      }
    } catch (e) {
      // Fall through to main-thread path.
    }
    return generateScoreCardBlobMainThread();
  }

  // Main-thread fallback for browsers without OffscreenCanvas /
  // Web Worker support, or when the worker errors out.
  function generateScoreCardBlobMainThread() {
    const W = 1200;
    const H = 630;
    // Render at 2× logical resolution so text and sprites stay
    // crisp on retina-class devices. All drawing below uses
    // logical W/H coordinates.
    const scale = 2;
    const card = document.createElement("canvas");
    card.width = W * scale;
    card.height = H * scale;
    const cctx = card.getContext("2d");
    cctx.scale(scale, scale);
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = "high";

    // ── Background: the actual game screenshot from death ─────
    // If we have a death snapshot, draw it as "object-fit: cover"
    // on the card. Otherwise fall back to a plain dark backdrop.
    if (
      deathSnapshotReady &&
      deathCanvas &&
      deathCanvas.width > 0 &&
      deathCanvas.height > 0
    ) {
      const srcW = deathCanvas.width;
      const srcH = deathCanvas.height;
      const srcAspect = srcW / srcH;
      const dstAspect = W / H;
      let sx;
      let sy;
      let sw;
      let sh;
      if (srcAspect > dstAspect) {
        // Source is wider than card — crop left/right.
        sh = srcH;
        sw = sh * dstAspect;
        sy = 0;
        sx = (srcW - sw) / 2;
      } else {
        // Source is taller than card — crop top/bottom, biased
        // toward the upper portion so the raptor + ground stay
        // in frame.
        sw = srcW;
        sh = sw / dstAspect;
        sx = 0;
        sy = Math.max(0, (srcH - sh) * 0.75);
      }
      cctx.drawImage(deathCanvas, sx, sy, sw, sh, 0, 0, W, H);
    } else {
      cctx.fillStyle = "#0c0e15";
      cctx.fillRect(0, 0, W, H);
    }

    // ── Dark gradient strip at the top for title legibility ──
    const topShadeH = 220;
    const topShade = cctx.createLinearGradient(0, 0, 0, topShadeH);
    topShade.addColorStop(0, "rgba(0, 0, 0, 0.7)");
    topShade.addColorStop(1, "rgba(0, 0, 0, 0)");
    cctx.fillStyle = topShade;
    cctx.fillRect(0, 0, W, topShadeH);

    // Dark gradient strip at the bottom for the score block.
    const botShadeH = 260;
    const botShade = cctx.createLinearGradient(0, H - botShadeH, 0, H);
    botShade.addColorStop(0, "rgba(0, 0, 0, 0)");
    botShade.addColorStop(1, "rgba(0, 0, 0, 0.75)");
    cctx.fillStyle = botShade;
    cctx.fillRect(0, H - botShadeH, W, botShadeH);

    // ── Title + URL (top left) ────────────────────────────────
    cctx.save();
    cctx.textAlign = "left";
    cctx.textBaseline = "alphabetic";
    cctx.fillStyle = "#ffffff";
    cctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    cctx.shadowBlur = 14;
    cctx.font = 'bold 72px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillText("Raptor Runner", 60, 100);
    cctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    cctx.font = '26px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillText("raptor.trebeljahr.com", 62, 142);
    cctx.restore();

    // ── Score block (bottom right) ────────────────────────────
    cctx.save();
    cctx.textAlign = "right";
    cctx.textBaseline = "alphabetic";
    cctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    cctx.shadowBlur = 16;
    // Uppercase label.
    cctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    cctx.font = '600 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillText("FINAL SCORE", W - 60, H - 180);
    // Big gradient score.
    cctx.font = 'bold 180px "Helvetica Neue", Helvetica, Arial, sans-serif';
    const scoreGrad = cctx.createLinearGradient(0, H - 170, 0, H - 40);
    scoreGrad.addColorStop(0, "#ffee9a");
    scoreGrad.addColorStop(1, "#e89d33");
    cctx.fillStyle = scoreGrad;
    cctx.fillText(`${state.score}`, W - 60, H - 50);
    cctx.restore();

    // Personal best / new record line (left side, bottom).
    cctx.save();
    cctx.textAlign = "left";
    cctx.textBaseline = "alphabetic";
    cctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    cctx.shadowBlur = 14;
    cctx.font = 'italic 36px "Helvetica Neue", Helvetica, Arial, sans-serif';
    if (state.newHighScore) {
      cctx.fillStyle = "#ffd84a";
      cctx.fillText("★ New personal best!", 60, H - 60);
    } else {
      cctx.fillStyle = "rgba(255, 255, 255, 0.82)";
      cctx.fillText(`Personal best: ${state.highScore}`, 60, H - 60);
    }
    cctx.restore();

    return new Promise((resolve) => {
      card.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // Update + render
  // ══════════════════════════════════════════════════════════════════

  function update(now) {
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

    // Rain cycle tracking: detect when we enter a new day cycle.
    const cycleIndex = Math.floor(state.smoothPhase);
    if (cycleIndex > state.lastCycleIndex && state.lastCycleIndex >= 0) {
      state.totalDayCycles += 1;
      saveTotalDayCycles(state.totalDayCycles);
      // Moon phase: realistic ~29.5 day synodic month
      state.moonPhase = (state.totalDayCycles % MOON_SYNODIC_CYCLE) / MOON_SYNODIC_CYCLE;
      if (Math.abs(state.moonPhase - 0.5) < 0.02)
        unlockAchievement("full-moon");
      // Start rain at cycle boundaries; duration is 0.3–1.2 day cycles
      if (!state.isRaining && shouldRainForCycle(state.totalDayCycles)) {
        state.isRaining = true;
        state.rainEndPhase = state.smoothPhase + 0.3 + Math.random() * 0.9;
      }
    }
    state.lastCycleIndex = cycleIndex;

    // End rain when duration expires
    if (state.isRaining && state.smoothPhase >= state.rainEndPhase) {
      state.isRaining = false;
      if (!state.gameOver) unlockAchievement("rainy-day");
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
    if (state._pendingNights > 0 && _isDayBand[bandIndex] && !state.gameOver) {
      state.runNightsSurvived += state._pendingNights;
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
      state.currentSky = lerpColor(state.currentSky, target, lerpT);
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
            if (!audio.muted && navigator.vibrate)
              navigator.vibrate([50, 30, 80]);
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
          state.duneCacti.push(_spawnDuneCactus(wx));
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
        const y = groundY - _duneHeight(sx, off);
        fgCtx.lineTo(sx, y);
      }
      fgCtx.lineTo(state.width, state.height);
      fgCtx.closePath();
      fgCtx.fill();

      // Dune cacti + tumbleweed in 3 depth layers:
      // depth 1 cacti → tumbleweed (depth 2) → depth 3 cacti
      const _drawDuneCacti = (targetDepth) => {
        if (!state.duneCacti) return;
        for (const dc of state.duneCacti) {
          if (dc.dead || dc.depth !== targetDepth) continue;
          const sx = dc.wx - off;
          if (sx < -dc.w * 2 || sx > state.width + dc.w * 2) continue;
          const duneY = groundY - _duneHeight(sx, off);
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
  const perf = {
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

  function loop(now) {
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
  function unlockAchievement(id) {
    const def = ACHIEVEMENTS_BY_ID[id];
    if (!def) return;
    if (state.unlockedAchievements[id]) return;
    state.unlockedAchievements[id] = true;
    saveUnlockedAchievements(state.unlockedAchievements);
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
    // Sound of Silence: snapshot the mute state right now.
    // If the player unmutes at any point during the run,
    // setMuted() flips this to false. Checked at game-over.
    state._runMutedThroughout = !!(audio && audio.muted);
  }

  function resetGame() {
    state.gameOver = false;
    state.gameOverFade = 0;
    state.gameOverFrame = 0;
    state.newHighScore = false;
    state.currentSky = [...SKY_COLORS[0]];
    state.lastSkyScore = -1;
    state.smoothPhase = 0;
    state.score = 0;
    state.bgVelocity = INITIAL_BG_VELOCITY;
    state.lastNow = null;
    state.shootingStars = [];
    state.confetti = [];
    state.dust = [];
    state.ash = [];
    state.activeRareEvent = null;
    state.rainParticles = [];
    state.lightning = { alpha: 0, nextAt: 0 };
    state.isRaining = false;
    state.rainIntensity = 0;
    state.rainEndPhase = 0;
    state.rainbow = null;
    state.lastCycleIndex = -1;
    audio.stopRain();
    // Cloud density: 20% cloudless, 50% normal, 30% extra cloudy
    const cdRoll = Math.random();
    state._cloudDensity = cdRoll < 0.2 ? 0 : cdRoll < 0.7 ? 1 : 2;
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

  function onPointerDown(e) {
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

  function onKeyDown(e) {
    // ESC is reserved for the menu overlay — let it through.
    if (e.key === "Escape") return;

    // Before the game has started, Space/Enter acts as "Start Game".
    if (!state.started) {
      if (
        e.code === "Space" ||
        e.code === "Enter" ||
        e.code === "NumpadEnter"
      ) {
        e.preventDefault();
        if (typeof window.__onStartKey === "function") {
          window.__onStartKey();
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

  const GameAPI = {
    _ready: false,
    _readyCb: null,
    // Game-over / reset listener arrays. Fired synchronously from
    // the game loop on the exact transition so the shell can
    // show/hide its share button without polling.
    _gameOverCbs: [],
    _gameResetCbs: [],
    _achievementCbs: [],

    onReady(cb) {
      if (this._ready) cb();
      else this._readyCb = cb;
    },

    /** Register a callback to run the moment the player dies.
     *  Fired once per run, synchronously from the game loop. */
    onGameOver(cb) {
      if (typeof cb === "function") this._gameOverCbs.push(cb);
    },
    /** Register a callback to run every time the game resets
     *  (after an auto-restart, or a manual Back-to-home). */
    onGameReset(cb) {
      if (typeof cb === "function") this._gameResetCbs.push(cb);
    },

    /** Register a callback fired whenever a new achievement is
     *  unlocked. Receives the achievement definition
     *  ({id, title, desc, iconPath, iconStroke}) so the shell
     *  can render a toast. */
    onAchievementUnlock(cb) {
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

    setMuted(muted) {
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

    setMusicMuted(muted) {
      audio.setMusicMuted(muted);
    },

    isMusicMuted() {
      return audio.musicMuted;
    },

    setJumpMuted(muted) {
      audio.setJumpMuted(muted);
    },

    isJumpMuted() {
      return audio.jumpMuted;
    },

    setRainMuted(muted) {
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
    setScore(n) {
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
      resetGame();
      state.started = false;
      state.paused = true;
    },

    /** Compose a 1200×630 "share your score" PNG on an offscreen
     *  canvas, using whatever sky/time-of-day and cosmetics the
     *  player had on during the run they just finished. Resolves
     *  to a Blob the shell can hand to navigator.share or a
     *  download link. */
    generateScoreCard() {
      return generateScoreCardBlob();
    },

    isShowingHitboxes() {
      return state.showHitboxes;
    },

    setShowHitboxes(on) {
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
      }
      return state.isRaining;
    },

    /** Debug: trigger a specific rare event by id. */
    triggerEvent(id) {
      const evt = RARE_EVENTS.find((e) => e.id === id);
      if (!evt) return false;
      state.activeRareEvent = {
        id: evt.id,
        age: 0,
        life: evt.duration,
        x: state.width + 50,
        y: state.height * (0.1 + Math.random() * 0.3),
      };
      if (!state._rareEventsSeen[evt.id]) {
        state._rareEventsSeen[evt.id] = true;
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
      state.moonPhase = (state.totalDayCycles % MOON_SYNODIC_CYCLE) / MOON_SYNODIC_CYCLE;
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
    setWearPartyHat(on) {
      if (!this.isPartyHatUnlocked()) return false;
      state.wearPartyHat = !!on;
      saveBoolFlag(WEAR_PARTY_HAT_KEY, state.wearPartyHat);
      return state.wearPartyHat;
    },
    setWearThugGlasses(on) {
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

    setWearBowTie(on) {
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
  window.Game = GameAPI;

  // ══════════════════════════════════════════════════════════════════
  // Init
  // ══════════════════════════════════════════════════════════════════

  function preloadImages() {
    return Promise.all(
      Object.entries(IMAGE_SRCS).map(
        ([key, src]) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              IMAGES[key] = img;
              resolve();
            };
            img.onerror = () => {
              console.warn(`Failed to load ${src}`);
              IMAGES[key] = null;
              resolve();
            };
            img.src = src;
          }),
      ),
    );
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
    canvas = contexts.mainCanvas;
    ctx = contexts.main;
    skyCanvas = contexts.skyCanvas;
    skyCtx = contexts.sky;
    fgCanvas = contexts.fgCanvas;
    fgCtx = contexts.fg;
    deathCanvas = contexts.deathCanvas;
    deathCtx = contexts.death;

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
    setDuneHeightProvider((x, off) => _duneHeight(x, off));

    // Load the player's saved mute preference into the audio object's
    // state, without triggering .play() yet (browser autoplay
    // policies require a user gesture). The saved value will be
    // applied for real on the first Start Game click, which IS a
    // user gesture.
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
    state._rareEventsSeen = loadRareEventsSeen();
    state.careerRuns = loadCareerRuns();
    state.unlockedAchievements = loadUnlockedAchievements();
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

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    // Start the rAF loop. The game stays paused (state.paused = true)
    // until Game.start() is called by the Start button click handler.
    _rafId = requestAnimationFrame(loop);

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
