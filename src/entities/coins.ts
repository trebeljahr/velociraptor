/*
 * Raptor Runner — collectible coins.
 *
 * Scattered across each cactus-breather flower field at chest
 * height on the running raptor. Bob gently so they read as
 * collectibles, not static decor. Running through one adds
 * COIN_SCORE_VALUE to the score, plays a short pickup cue, and
 * plays a brief pop-fade so the player sees what they grabbed.
 *
 * Spawn is driven from inside Cactuses._rollNextGap so coins
 * always land inside the same x-range as the flower patches —
 * never on top of an upcoming cactus.
 */

import { state } from "../state";
import { IMAGES } from "../images";
import { audio } from "../audio";
import { saveCoinsBalance } from "../persistence";
import {
  VELOCITY_SCALE_DIVISOR,
  COIN_SCORE_VALUE,
  COIN_BANK_REWARD,
  COIN_SIZE_RATIO,
  COIN_BASE_Y_ABOVE_GROUND_RATIO,
  COIN_BOB_AMPLITUDE_PX,
  COIN_BOB_FREQUENCY_HZ,
  COIN_COUNT_PER_FIELD,
  COIN_SPACING_RATIO,
  COIN_COLLECT_FADE_FRAMES,
  COIN_SPARKLE_FREQUENCY_HZ,
} from "../constants";

export interface Coin {
  x: number;
  /** Y of the coin's top edge, before the bob offset is applied. */
  baseY: number;
  w: number;
  h: number;
  /** Per-coin phase offset so neighbours don't bob in sync. */
  phase: number;
  collected: boolean;
  /** state.frame when collected — drives the pop/fade animation. */
  collectFrame: number;
  /** True for the right-most coin in the field — i.e. the last one
   *  the raptor passes through on its way out. Triggers the
   *  chain-end chord on top of the regular pickup cue. */
  lastInField: boolean;
}

interface RaptorRef {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Scatter COIN_COUNT_PER_FIELD coins evenly across [startX, endX]
 *  at chest-height on the running raptor. Intended to be called
 *  once per breather, from inside the Cactuses spawn roll.
 *
 *  Also resets the audio coin streak so the first pickup in the new
 *  field plays at base pitch — the rising-pitch chain is a
 *  PER-FIELD cue ("ding ding ding … diiing"), not an endless climb
 *  across the whole run. */
export function spawnCoinsInRange(
  startX: number,
  endX: number,
  raptor: RaptorRef,
): void {
  if (!raptor || raptor.h <= 0 || raptor.w <= 0) return;
  if (endX <= startX) return;
  const coinSize = raptor.h * COIN_SIZE_RATIO;
  state.coins = state.coins || [];
  const baseY =
    state.ground -
    raptor.h * COIN_BASE_Y_ABOVE_GROUND_RATIO -
    coinSize / 2;
  // Coins live in a tight ribbon centred in the field: a fixed
  // raptor-width spacing gives a quick "ding-ding-ding…" run, and
  // the ribbon is short enough that the player hits all COUNT
  // coins in ~1–1.5s regardless of how long the breather itself
  // is. If the ribbon happens to exceed the field width (tiny
  // breather edge case), compress to fit instead of overflowing.
  const fieldWidth = endX - startX;
  const desiredSpacing = raptor.w * COIN_SPACING_RATIO;
  const gaps = COIN_COUNT_PER_FIELD - 1;
  const desiredSpanPx = desiredSpacing * gaps;
  const spacing =
    desiredSpanPx <= fieldWidth ? desiredSpacing : fieldWidth / gaps;
  const spanPx = spacing * gaps;
  const firstCoinX = startX + (fieldWidth - spanPx) / 2;
  for (let i = 0; i < COIN_COUNT_PER_FIELD; i++) {
    state.coins.push({
      x: firstCoinX + spacing * i,
      baseY,
      w: coinSize,
      h: coinSize,
      phase: Math.random() * Math.PI * 2,
      collected: false,
      collectFrame: 0,
      lastInField: i === COIN_COUNT_PER_FIELD - 1,
    });
  }
  audio.resetCoinStreak();
}

/** Phase used for the bob sin() — shared between draw and collision
 *  so the hit-test uses the same y the player sees. */
function bobPhase(c: Coin): number {
  return (
    state.frame * ((Math.PI * 2 * COIN_BOB_FREQUENCY_HZ) / 60) + c.phase
  );
}

/** Scroll all live coins by this frame's ground speed and drop any
 *  that scrolled off the left edge or finished their collect fade. */
export function updateCoins(frameScale: number): void {
  if (!state.coins || state.coins.length === 0) return;
  const dx =
    state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * frameScale;
  for (const c of state.coins) c.x -= dx;
  state.coins = state.coins.filter((c) => {
    if (c.x + c.w < -20) return false;
    if (
      c.collected &&
      state.frame - c.collectFrame > COIN_COLLECT_FADE_FRAMES
    )
      return false;
    return true;
  });
}

/** AABB check against the raptor's bounding box. Coins are small
 *  enough that polygon-precise collision isn't worth the cost —
 *  the raptor hitbox already insets for forgiveness on cacti, and
 *  coins should feel forgiving to grab. */
export function collectCoins(
  raptor: RaptorRef,
  onCollect: (coin: Coin) => void,
): void {
  if (!state.coins || state.coins.length === 0) return;
  const rL = raptor.x;
  const rR = raptor.x + raptor.w;
  const rT = raptor.y;
  const rB = raptor.y + raptor.h;
  for (const c of state.coins) {
    if (c.collected) continue;
    const cL = c.x;
    const cR = c.x + c.w;
    if (cR < rL || cL > rR) continue;
    const cy = c.baseY + Math.sin(bobPhase(c)) * COIN_BOB_AMPLITUDE_PX;
    if (cy + c.h < rT || cy > rB) continue;
    c.collected = true;
    c.collectFrame = state.frame;
    state.score += COIN_SCORE_VALUE;
    // Bank the coin into the persistent shop balance immediately —
    // if the player dies mid-field they still keep what they've
    // already grabbed, which matches the "picked up = yours" feel.
    state.coinsBalance += COIN_BANK_REWARD;
    saveCoinsBalance(state.coinsBalance);
    onCollect(c);
  }
}

/** Blit each coin, honouring the bob offset and the short
 *  pop-fade for coins currently in their collect animation. */
export function drawCoins(ctx: CanvasRenderingContext2D): void {
  if (!state.coins || state.coins.length === 0) return;
  const img = IMAGES.coin;
  if (!img) return;
  for (const c of state.coins) {
    const cy = c.baseY + Math.sin(bobPhase(c)) * COIN_BOB_AMPLITUDE_PX;
    let scale = 1;
    let alpha = 1;
    if (c.collected) {
      // Pop up + fade out so the grab reads, then the coin is gone.
      const t = Math.min(
        1,
        (state.frame - c.collectFrame) / COIN_COLLECT_FADE_FRAMES,
      );
      scale = 1 + t * 0.6;
      alpha = 1 - t;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    const w = c.w * scale;
    const h = c.h * scale;
    const x = c.x - (w - c.w) / 2;
    const y = cy - (h - c.h) / 2;
    ctx.drawImage(
      img,
      Math.round(x),
      Math.round(y),
      Math.round(w),
      Math.round(h),
    );
    // Glint overlay: a small white 4-point sparkle whose opacity
    // pulses on a slower, independent cycle so the field doesn't
    // twinkle in sync. Capped at ~40% so it reads as a shimmer,
    // not a flash.
    if (!c.collected) {
      const sparkleT =
        state.frame * ((Math.PI * 2 * COIN_SPARKLE_FREQUENCY_HZ) / 60) +
        c.phase;
      const s = Math.sin(sparkleT);
      if (s > 0) {
        ctx.globalAlpha = s * 0.45;
        const sx = c.x + c.w * 0.72;
        const sy = cy + c.h * 0.26;
        const sr = c.w * 0.1;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(sx, sy - sr);
        ctx.lineTo(sx + sr * 0.3, sy - sr * 0.3);
        ctx.lineTo(sx + sr, sy);
        ctx.lineTo(sx + sr * 0.3, sy + sr * 0.3);
        ctx.lineTo(sx, sy + sr);
        ctx.lineTo(sx - sr * 0.3, sy + sr * 0.3);
        ctx.lineTo(sx - sr, sy);
        ctx.lineTo(sx - sr * 0.3, sy - sr * 0.3);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

export function clearCoins(): void {
  state.coins = [];
}
