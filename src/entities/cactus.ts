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
  UNLOCKED_PARTY_HAT_KEY,
  UNLOCKED_THUG_GLASSES_KEY,
  UNLOCKED_BOW_TIE_KEY,
  WEAR_PARTY_HAT_KEY,
  WEAR_THUG_GLASSES_KEY,
  WEAR_BOW_TIE_KEY,
} from "../constants";
import { state } from "../state";
import { IMAGES } from "../images";
import { saveBoolFlag } from "../persistence";
import { CACTUS_VARIANTS, CactusVariant } from "../cactusVariants";
import { Polygon } from "../helpers";
import { makeFlowerPatch } from "./flowers";
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

      const seconds =
        CACTUS_BREATHER_MIN_SECONDS +
        Math.random() *
          (CACTUS_BREATHER_MAX_SECONDS - CACTUS_BREATHER_MIN_SECONDS);
      // bgVelocity is a per-frame multiplier; ×60 → approx px/sec.
      const pxPerSec =
        state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * 60;
      const gap = seconds * pxPerSec;

      // The last cactus JUST spawned at x = state.width. It has to
      // travel the full state.width (plus its own width) before
      // scrolling fully off the left edge. During that window the
      // flower field and grass overlay would visibly overlap the
      // cactus — a "cacti on the flower field" bug that looked wrong.
      // Push the flower / grass start point state.width pixels
      // further off-screen so it enters the viewport right-edge only
      // after the cactus has already exited the left-edge. The
      // velocity cancels out: at any bgVelocity the cactus exit and
      // the first patch entry arrive at state.width at the same time.
      const exitMargin = state.width;

      // Mark the grass-field span so the renderer knows where to
      // paint the top ground band green instead of desert-yellow.
      // Scrolls with the ground — see updateGrassFields in main.ts.
      state.grassFields = state.grassFields || [];
      state.grassFields.push({
        startX: state.width + exitMargin,
        endX: state.width + gap,
      });

      // Tile flower patches densely across the whole rest area so
      // it reads as a continuous *field*, not a few lonely clusters.
      // Spacing at ≈40% of the patch width → neighbouring patches
      // overlap by ~60%, erasing the visible gaps that the previous
      // spacing (1.2 seconds × pxPerSec) left behind. Jittered ±30%
      // so the patches don't tile. Leading and trailing patches
      // sit one full patch-width inside the usable zone so the field
      // doesn't start or end flush against a cactus. If the gap is
      // so short that no patches fit (happens at low bgVelocity with
      // the short 4–6s breather), that's fine — the while() loop
      // just doesn't enter.
      state.flowerPatches = state.flowerPatches || [];
      const patchSpacingPx = FLOWER_PATCH_WIDTH_PX * 0.4;
      let x = state.width + exitMargin + FLOWER_PATCH_WIDTH_PX;
      const endX = state.width + gap - FLOWER_PATCH_WIDTH_PX;
      while (x < endX) {
        state.flowerPatches.push(makeFlowerPatch(x));
        x += patchSpacingPx * (0.7 + Math.random() * 0.6);
      }
      this._nextGap = gap;
      return;
    }

    // ── NORMAL GAP ──
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
    // Minimum safe gap. Grows slightly with speed so impossible
    // back-to-back doubles don't spawn at terminal velocity.
    // 1.2w → 1.5w across the ramp.
    const floorGap =
      this.raptor.w *
      (CACTUS_SPAWN_GAP_BASE + t * CACTUS_SPAWN_GAP_SPEED_FACTOR);
    // Random top-up. Span starts wide (≈3.6w) so early game has
    // varied pacing, collapses to ≈1.5w at terminal velocity so
    // the late game reads as a tight relentless rhythm. Long rest
    // periods are the breather's job, not this span's.
    const randSpan =
      this.raptor.w *
      CACTUS_SPAWN_GAP_RANDOM_MAX *
      Math.max(0, 1 - t * CACTUS_SPAWN_GAP_RANDOM_SHRINK);

    this._nextGap = floorGap + Math.random() * randSpan;
  }

  spawn(): void {
    const variant =
      CACTUS_VARIANTS[Math.floor(Math.random() * CACTUS_VARIANTS.length)];
    this.cacti.push(new Cactus(variant, this.raptor));
    // Counts toward the next breather.
    state._cactiSinceBreather = (state._cactiSinceBreather ?? 0) + 1;
    // Decide the gap to the cactus after this one. Has to happen AFTER
    // the counter increment so _rollNextGap sees the fresh count.
    this._rollNextGap();
  }

  update(frameScale = 1): void {
    const last = this.cacti[this.cacti.length - 1];
    if (!last) {
      this.spawn();
    } else if (state.width - last.x >= this._nextGap) {
      this.spawn();
      state.bgVelocity = Math.min(
        state.bgVelocity + SPEED_INCREMENT,
        MAX_BG_VELOCITY,
      );
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
        if (
          !state.unlockedPartyHat &&
          state.score >= PARTY_HAT_SCORE_THRESHOLD
        ) {
          state.unlockedPartyHat = true;
          state.wearPartyHat = true;
          saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, true);
          saveBoolFlag(WEAR_PARTY_HAT_KEY, true);
          const crown = this.raptor.currentCrownPoint();
          this.onCosmeticBurst(crown.x, crown.y);
        }
        if (
          !state.unlockedThugGlasses &&
          state.score >= THUG_GLASSES_SCORE_THRESHOLD
        ) {
          state.unlockedThugGlasses = true;
          state.wearThugGlasses = true;
          saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, true);
          saveBoolFlag(WEAR_THUG_GLASSES_KEY, true);
          const crown = this.raptor.currentCrownPoint();
          this.onCosmeticBurst(crown.x, crown.y);
        }
        if (
          !state.unlockedBowTie &&
          state.score >= BOW_TIE_SCORE_THRESHOLD
        ) {
          state.unlockedBowTie = true;
          state.wearBowTie = true;
          saveBoolFlag(UNLOCKED_BOW_TIE_KEY, true);
          saveBoolFlag(WEAR_BOW_TIE_KEY, true);
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
  }
}
