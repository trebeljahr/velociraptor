/*
 * Raptor Runner — cactus entities.
 *
 * Two classes live here:
 *   • Cactus     — a single obstacle instance. Holds its sprite
 *                  reference, its world x/y/w/h, and a cached
 *                  collision polygon in world coordinates.
 *   • Cactuses   — the spawn manager. Decides when to drop a new
 *                  cactus at the right edge of the screen, scrolls
 *                  existing ones leftward at state.bgVelocity, and
 *                  retires each one when it falls off the left edge.
 *                  Retirement is also where score ticks up and the
 *                  per-score achievements and cosmetic unlocks fire.
 *
 * Dependencies on the rest of the game are passed in at construction
 * time so this module has no bare references back to src/main.ts:
 *   • raptor               — used for the body-height scaling ratio
 *                            and for positioning the confetti burst
 *                            at the crown during a cosmetic unlock
 *   • onAchievementUnlock  — fires the "score-25", "party-time",
 *                            "dinosaurs-forever", "score-250",
 *                            "first-jump" achievements
 *   • onCosmeticBurst      — fires the confetti burst on a cosmetic
 *                            unlock; the caller decides where/how
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  INITIAL_BG_VELOCITY,
  VELOCITY_SCALE_DIVISOR,
  SPEED_INCREMENT,
  MAX_BG_VELOCITY,
  CACTUS_SPAWN_GAP_BASE,
  CACTUS_SPAWN_GAP_SPEED_FACTOR,
  CACTUS_SPAWN_GAP_RANDOM_MAX,
  CACTUS_SPAWN_GAP_RANDOM_SHRINK,
  CACTUS_BREATHER_MIN_COUNT,
  CACTUS_BREATHER_MAX_COUNT,
  CACTUS_BREATHER_MIN_SECONDS,
  CACTUS_BREATHER_MAX_SECONDS,
  FLOWER_PATCH_WIDTH_PX,
  PARTY_HAT_SCORE_THRESHOLD,
  THUG_GLASSES_SCORE_THRESHOLD,
  BOW_TIE_SCORE_THRESHOLD,
} from "../constants";
import { state } from "../state";
import { IMAGES } from "../images";
import { CACTUS_VARIANTS, CactusVariant } from "../cactusVariants";
import { Polygon } from "../helpers";
import { makeFlowerPatch } from "./flowers";
import { spawnCoinsInRange } from "./coins";
import { grantCosmetic } from "../cosmetics";
import { Raptor } from "./raptor";

export type CactusAchievementCallback = (id: string) => void;
export type CactusCosmeticBurstCallback = (x: number, y: number) => void;

export class Cactus {
  x: number;
  y: number;
  w: number;
  h: number;
  img: HTMLImageElement | undefined;
  aspectRatio: number;
  private _polyCache: Polygon | null = null;

  constructor(
    public variant: CactusVariant,
    private raptor: Raptor,
  ) {
    this.img = IMAGES[variant.key];
    this.aspectRatio = variant.w / variant.h;
    this.h = raptor.h * variant.heightScale;
    this.w = this.h * this.aspectRatio;
    this.x = state.width;
    this.y = state.ground - this.h;
  }

  /**
   * Recompute this cactus's height / width / y-anchor after a
   * viewport resize (e.g. entering or leaving fullscreen). The
   * horizontal world position stays the same, but the bottom of the
   * cactus has to re-bind to the NEW state.ground so it doesn't
   * visibly jump when the viewport dimensions change.
   */
  resize(): void {
    this.h = this.raptor.h * this.variant.heightScale;
    this.w = this.h * this.aspectRatio;
    this.y = state.ground - this.h;
    this._polyCache = null;
  }

  update(frameScale = 1): void {
    this.x -=
      state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * frameScale;
    // Position changed, invalidate cached polygon.
    this._polyCache = null;
  }

  collisionPolygon(): Polygon {
    if (this._polyCache) return this._polyCache;
    const norm = this.variant.collision;
    const x = this.x;
    const y = this.y;
    const w = this.w;
    const h = this.h;
    const poly: Polygon = new Array(norm.length);
    for (let i = 0; i < norm.length; i++) {
      poly[i] = { x: x + norm[i][0] * w, y: y + norm[i][1] * h };
    }
    this._polyCache = poly;
    return poly;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.img)
      ctx.drawImage(
        this.img,
        Math.round(this.x),
        Math.round(this.y),
        Math.round(this.w),
        Math.round(this.h),
      );
  }
}

export class Cactuses {
  cacti: Cactus[] = [];
  /** Distance-from-last-cactus that has to elapse before the next
   *  cactus spawns. Set once per spawn by _rollNextGap() and then
   *  read (not recomputed) every frame until the next spawn. The
   *  previous getter-based design re-rolled this on every frame,
   *  which broke breathers completely: the first frame the getter
   *  decided "breather time!", returned the big gap, reset the
   *  counter, and pushed flower patches. The very next frame, the
   *  counter was already 0 so the getter fell through to the normal
   *  path and returned a small gap — so a cactus spawned almost
   *  immediately after the flower patches. Caching kills that bug. */
  private _nextGap = 0;

  constructor(
    private raptor: Raptor,
    private onAchievementUnlock: CactusAchievementCallback,
    private onCosmeticBurst: CactusCosmeticBurstCallback,
  ) {
    // Seed the gap for the very first spawn so update() has
    // something to compare against.
    this._rollNextGap();
  }

  /** Decide what gap to wait for before the *next* cactus spawn.
   *  Called exactly once per spawn (from spawn() itself) plus once
   *  at construction. All breather side-effects (resetting the
   *  counter, picking the next breather target, pushing flower
   *  patches, marking the grass-field span) fire from here — and
   *  fire exactly once per breather, never per frame.
   */
  /** Roll a single "normal" spawn gap — the floor+random pacing
   *  used between every pair of non-breather cacti. Factored out
   *  so the breather branch can tack one onto the end of its
   *  gap (the post-breather buffer) without duplicating math. */
  private _rollNormalGap(): number {
    // Progress through the speed ramp: 0 at a fresh run, 1 once
    // bgVelocity has reached MAX. Clamped so debug commands that
    // push velocity beyond MAX don't produce negative random spans.
    const t = Math.min(
      1,
      Math.max(
        0,
        (state.bgVelocity - INITIAL_BG_VELOCITY) /
          (MAX_BG_VELOCITY - INITIAL_BG_VELOCITY),
      ),
    );
    // Minimum safe gap. 1.2w → 1.5w across the ramp.
    const floorGap =
      this.raptor.w *
      (CACTUS_SPAWN_GAP_BASE + t * CACTUS_SPAWN_GAP_SPEED_FACTOR);
    // Random top-up. Starts wide (≈3.6w), collapses at terminal
    // velocity so late-game reads as a tighter rhythm.
    const randSpan =
      this.raptor.w *
      CACTUS_SPAWN_GAP_RANDOM_MAX *
      Math.max(0, 1 - t * CACTUS_SPAWN_GAP_RANDOM_SHRINK);
    return floorGap + Math.random() * randSpan;
  }

  private _rollNextGap(): void {
    if (state._cactiSinceBreather >= state._nextBreatherAt) {
      // ── BREATHER ──
      // Reset counter + pick when the NEXT breather should fire.
      state._cactiSinceBreather = 0;
      state._nextBreatherAt =
        CACTUS_BREATHER_MIN_COUNT +
        Math.floor(
          Math.random() *
            (CACTUS_BREATHER_MAX_COUNT - CACTUS_BREATHER_MIN_COUNT + 1),
        );

      this._queueBreather();
      return;
    }

    // ── NORMAL GAP ──
    this._nextGap = this._rollNormalGap();
  }

  /**
   * Build and schedule one breather rest-area: push the grass-field
   * span, tile flower patches, scatter coins, and set _nextGap so
   * the next cactus only spawns after the full field — plus a
   * symmetric empty-ground buffer — has scrolled past.
   *
   * Geometry (world-space, relative to last cactus spawn at x=state.width):
   *
   *   state.width          ← last cactus spawns here
   *   + state.width        ← time for last cactus to cross the viewport
   *   + bufferPx           ← empty run-up ground before the field
   *   = fieldStartX        ← first flower enters the right edge
   *
   *   fieldStartX + fieldPx = fieldEndX  ← last flower exits the left edge
   *   fieldEndX + bufferPx              ← next cactus spawns (right edge)
   *
   * Run-up and run-out empty-ground both equal bufferPx, so the
   * rest area is visually symmetric. The previous version used
   * `_nextGap = gap + normalGap`, which made post-field buffer
   * negative — the next cactus was appearing *while* flowers were
   * still on screen.
   */
  private _queueBreather(): void {
    const seconds =
      CACTUS_BREATHER_MIN_SECONDS +
      Math.random() *
        (CACTUS_BREATHER_MAX_SECONDS - CACTUS_BREATHER_MIN_SECONDS);
    // bgVelocity is a per-frame multiplier; ×60 → approx px/sec.
    const pxPerSec =
      state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * 60;
    const fieldPx = seconds * pxPerSec;
    const bufferPx = this._rollNormalGap();

    const fieldStartX = 2 * state.width + bufferPx;
    const fieldEndX = fieldStartX + fieldPx;

    // Mark the grass-field span so the renderer knows where to
    // paint the top ground band green instead of desert-yellow.
    // Scrolls with the ground — see updateGrassFields in main.ts.
    state.grassFields = state.grassFields || [];
    state.grassFields.push({ startX: fieldStartX, endX: fieldEndX });

    // Tile flower patches across the field. Spacing at ≈40% of the
    // patch width → neighbouring patches overlap by ~60%, which
    // reads as a continuous carpet rather than a few clusters.
    // Jittered ±30% so the patches don't tile. Patches are packed
    // so their right edge doesn't poke past fieldEndX.
    state.flowerPatches = state.flowerPatches || [];
    const patchSpacingPx = FLOWER_PATCH_WIDTH_PX * 0.4;
    let x = fieldStartX;
    while (x + FLOWER_PATCH_WIDTH_PX <= fieldEndX) {
      state.flowerPatches.push(makeFlowerPatch(x));
      x += patchSpacingPx * (0.7 + Math.random() * 0.6);
    }

    // Scatter coins across the full field — collision + SFX
    // trigger are wired in main.ts.
    spawnCoinsInRange(fieldStartX, fieldEndX, this.raptor);

    // Next cactus spawns when total scroll (since the last cactus
    // spawn at x=state.width) reaches fieldEndX + bufferPx: last
    // flower has exited the left edge, the player sees bufferPx of
    // empty ground, then the next cactus enters the right edge.
    this._nextGap = fieldEndX + bufferPx;
  }

  /** Debug helper: arm the breather counter and force an immediate
   *  spawn so the next frame kicks off a flower-field rest area.
   *  Wired via Game._forceBreather() — useful for eyeballing the
   *  field layout without waiting ~40 cacti. */
  forceBreather(): void {
    state._cactiSinceBreather = state._nextBreatherAt;
    // Make the current gap "already elapsed" so update() fires a
    // spawn on the very next frame. spawn() → _rollNextGap() sees
    // the maxed counter and takes the breather branch.
    this._scrollSinceLastSpawn = Math.max(
      this._scrollSinceLastSpawn,
      this._nextGap,
    );
  }

  /** Distance in px the world has scrolled since the last cactus
   *  was pushed to the array. Only reset by spawn() / clear().
   *
   *  Why this instead of "state.width - last.x"? During a breather
   *  the last cactus scrolls fully off-screen-left and gets
   *  filtered out of the array. Once the array is empty, the old
   *  `if (!last) this.spawn()` fallback immediately spawned a new
   *  cactus at state.width — right into the middle of the on-
   *  screen flower field. Tracking scroll here keeps the "wait
   *  _nextGap pixels" check alive even when the reference cactus
   *  no longer exists. */
  private _scrollSinceLastSpawn = 0;

  spawn(): void {
    const variant =
      CACTUS_VARIANTS[Math.floor(Math.random() * CACTUS_VARIANTS.length)];
    this.cacti.push(new Cactus(variant, this.raptor));
    this._scrollSinceLastSpawn = 0;
    // Counts toward the next breather.
    state._cactiSinceBreather = (state._cactiSinceBreather ?? 0) + 1;
    // Decide the gap to the cactus after this one. Has to happen AFTER
    // the counter increment so _rollNextGap sees the fresh count.
    this._rollNextGap();
  }

  update(frameScale = 1): void {
    // Accumulate this frame's scroll BEFORE the spawn check. Must
    // match the per-frame scroll that Cactus.update applies to each
    // cactus (and that updateFlowerPatches applies to flower patches)
    // so the gap check here and the visible motion stay in lockstep.
    const dx =
      state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * frameScale;
    this._scrollSinceLastSpawn += dx;

    if (this._scrollSinceLastSpawn >= this._nextGap) {
      const isFirstSpawn = this.cacti.length === 0 && this._nextGap === 0;
      this.spawn();
      if (!isFirstSpawn) {
        state.bgVelocity = Math.min(
          state.bgVelocity + SPEED_INCREMENT,
          MAX_BG_VELOCITY,
        );
      }
    }

    for (const c of this.cacti) c.update(frameScale);

    this.cacti = this.cacti.filter((c) => {
      if (c.x < -c.w) {
        state.score++;
        // Score-threshold achievements.
        if (state.score === 1) this.onAchievementUnlock("first-jump");
        if (state.score === 25) this.onAchievementUnlock("score-25");
        if (state.score === 100) this.onAchievementUnlock("party-time");
        if (state.score === BOW_TIE_SCORE_THRESHOLD)
          this.onAchievementUnlock("dinosaurs-forever");
        if (state.score === THUG_GLASSES_SCORE_THRESHOLD)
          this.onAchievementUnlock("score-250");
        // Cosmetic unlocks — party hat at 100 points, thug glasses at
        // 200. Both fire at most once per save and burst a little
        // confetti off the raptor's head so the player actually
        // notices. The achievement toasts fire from the
        // score-threshold block above (not here) so they trigger on
        // every qualifying run, even if the cosmetic was already
        // earned.
        // Cosmetic unlocks via score. grantCosmetic handles the
        // owned/equipped maps AND bridges the legacy unlock/wear
        // flags, so old Game API shims stay correct. It auto-
        // equips when the slot is empty — on first unlock that's
        // always the case, so the cosmetic pops onto the raptor
        // immediately. Idempotent, so re-crossing the threshold
        // in a later run is a no-op.
        if (
          !state.ownedCosmetics["party-hat"] &&
          state.score >= PARTY_HAT_SCORE_THRESHOLD
        ) {
          grantCosmetic("party-hat");
          const crown = this.raptor.currentCrownPoint();
          this.onCosmeticBurst(crown.x, crown.y);
        }
        if (
          !state.ownedCosmetics["thug-glasses"] &&
          state.score >= THUG_GLASSES_SCORE_THRESHOLD
        ) {
          grantCosmetic("thug-glasses");
          const crown = this.raptor.currentCrownPoint();
          this.onCosmeticBurst(crown.x, crown.y);
        }
        if (
          !state.ownedCosmetics["bow-tie"] &&
          state.score >= BOW_TIE_SCORE_THRESHOLD
        ) {
          grantCosmetic("bow-tie");
          const crown = this.raptor.currentCrownPoint();
          this.onCosmeticBurst(crown.x, crown.y);
        }
        return false;
      }
      return true;
    });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const c of this.cacti) c.draw(ctx);
  }

  clear(): void {
    this.cacti = [];
    this._scrollSinceLastSpawn = 0;
    // Reset the gap too so the first cactus of the next run
    // spawns immediately (matches the pre-fix "!last → spawn"
    // behaviour at run-start, just without the bug where that
    // path also fired mid-breather after the last cactus
    // scrolled off-screen).
    this._nextGap = 0;
  }
}
