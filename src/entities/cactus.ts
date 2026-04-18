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
  CACTUS_BREATHER_PROBABILITY,
  CACTUS_BREATHER_MIN_SECONDS,
  CACTUS_BREATHER_MAX_SECONDS,
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
  /** Gap (in px) that the next cactus must cover before it can
   *  spawn. Rolled exactly once per spawn — see _rollSpawnGap. A
   *  getter that re-rolls every frame (as this used to be) means a
   *  long breather roll on one frame gets silently replaced by a
   *  short roll on the next and cacti end up spawning through the
   *  empty stretch that was supposed to be scenery-only. */
  private _nextSpawnDistance: number = 0;

  constructor(
    private raptor: Raptor,
    private onAchievementUnlock: CactusAchievementCallback,
    private onCosmeticBurst: CactusCosmeticBurstCallback,
  ) {}

  /**
   * Pick the next spawn-gap distance + any side effects (flower
   * patches during breathers). Called exactly once per cactus
   * spawn so the chosen gap is the one that's actually enforced.
   */
  private _rollSpawnGap(): number {
    // Breather roll: every so often return a long empty gap so the
    // player gets 5-10 seconds of scenery-only before the next
    // cactus. Measured in seconds-of-travel at the *current*
    // velocity so the breather feels the same length regardless of
    // how fast the player is going. Evaluated first so the normal
    // pacing formula below is the fallback path.
    if (Math.random() < CACTUS_BREATHER_PROBABILITY) {
      const seconds =
        CACTUS_BREATHER_MIN_SECONDS +
        Math.random() *
          (CACTUS_BREATHER_MAX_SECONDS - CACTUS_BREATHER_MIN_SECONDS);
      // Convert bgVelocity (a per-frame multiplier) into px/sec.
      // Matches the scroll math in Cactus.update(): each frame moves
      // a cactus by bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR).
      // Multiply by 60 to approximate frames-per-second.
      const pxPerSec =
        state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * 60;
      const gap = seconds * pxPerSec;
      // Drop a flower patch somewhere in the middle of the empty
      // stretch — positioned at screen-space x so the patch scrolls
      // in naturally with the rest of the foreground. Only fires
      // because this breather is the one that will be enforced
      // (cached in _nextSpawnDistance below), so the patch is
      // guaranteed not to overlap a cactus.
      (state as any).flowerPatches = (state as any).flowerPatches || [];
      const patchX = state.width + gap * (0.3 + Math.random() * 0.4);
      (state as any).flowerPatches.push(makeFlowerPatch(patchX));
      return gap;
    }

    // Progress through the speed ramp: 0 at a fresh run, 1 once
    // bgVelocity has reached MAX. Clamped so debug commands that push
    // velocity beyond MAX don't produce negative random spans.
    const t = Math.min(
      1,
      Math.max(
        0,
        (state.bgVelocity - INITIAL_BG_VELOCITY) /
          (MAX_BG_VELOCITY - INITIAL_BG_VELOCITY),
      ),
    );

    // Minimum safe gap. Grows a touch with speed so impossible
    // back-to-back doubles don't spawn at terminal velocity.
    // Default: 1.2w → 1.5w across the speed ramp.
    const floorGap =
      this.raptor.w *
      (CACTUS_SPAWN_GAP_BASE + t * CACTUS_SPAWN_GAP_SPEED_FACTOR);

    // Random top-up on top of the floor. Previously a fixed
    //   Math.random() * raptor.w * 10
    // which dominated the spawn gap at every speed and masked the
    // progression — a long random roll at terminal velocity still
    // created a long dead stretch, so the game didn't feel denser
    // as you sped up.
    //
    // Now: the span starts wide (≈3.6w) so early-game has varied
    // pacing with small variance, and collapses to ≈1.5w at terminal
    // velocity so the late game reads as a tight relentless rhythm.
    // Long rest periods are handled separately by the breather roll
    // above, not by this span.
    const randSpan =
      this.raptor.w *
      CACTUS_SPAWN_GAP_RANDOM_MAX *
      Math.max(0, 1 - t * CACTUS_SPAWN_GAP_RANDOM_SHRINK);

    return floorGap + Math.random() * randSpan;
  }

  spawn(): void {
    const variant =
      CACTUS_VARIANTS[Math.floor(Math.random() * CACTUS_VARIANTS.length)];
    this.cacti.push(new Cactus(variant, this.raptor));
    // Immediately decide how far the next cactus has to travel
    // before it can enter. Locked until the next spawn fires.
    this._nextSpawnDistance = this._rollSpawnGap();
  }

  update(frameScale = 1): void {
    const last = this.cacti[this.cacti.length - 1];
    if (!last) {
      this.spawn();
    } else if (state.width - last.x >= this._nextSpawnDistance) {
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
