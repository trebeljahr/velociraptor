/*
 * Raptor Runner — collectible coins. Scattered across each flower-
 * field breather + one above each cactus. Bob, pop-fade on pickup,
 * add to the score and the persistent shop balance. Spawning runs
 * from Cactuses._rollNextGap / Cactus.spawn so coins can never
 * collide with an upcoming cactus.
 */

import { state } from "../state";
import { IMAGES } from "../images";
import { audio } from "../audio";
import { saveCoinsBalance } from "../persistence";
import { pointInPolygon, Polygon } from "../helpers";
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
  COIN_FIELD_EDGE_MARGIN_RAPTOR_WIDTHS,
  COIN_COLLECT_FADE_FRAMES,
  COIN_SPARKLE_FREQUENCY_HZ,
  COIN_GLINT_SIZE_RATIO,
  COIN_GLINT_MAX_ALPHA,
  COIN_AMBIENT_TWINKLE_COUNT,
  COIN_TWINKLE_FREQUENCY_HZ,
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
  /** True for coins spawned inside a flower-field breather (the
   *  10-coin ribbon). These coins feed the rising-pitch chain cue.
   *  Coins spawned above cacti set this to false and play the flat
   *  base-pitch chime — the chain is specifically a "full field"
   *  reward, not a metric for every pickup in a run. */
  fieldCoin: boolean;
}

interface RaptorRef {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional body silhouette — when present, coin pickup uses it
   *  as the authoritative hit test. Without it, collectCoins falls
   *  back to the raptor's bounding box. */
  collisionPolygon?: () => Polygon;
}

/** Scatter COIN_COUNT_PER_FIELD coins across [startX, endX] at
 *  chest-height on the running raptor. Resets the audio coin streak
 *  so the rising-pitch chain restarts per-field rather than climbing
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
  // Inset the usable span by EDGE_MARGIN on each side so coins don't
  // hug the cactus bookends. Fall back to the full width on tiny
  // breathers where 2× margin would leave nothing to spawn into.
  const edgeMarginPx = raptor.w * COIN_FIELD_EDGE_MARGIN_RAPTOR_WIDTHS;
  const rawFieldWidth = endX - startX;
  const usableStartX =
    rawFieldWidth > edgeMarginPx * 2 ? startX + edgeMarginPx : startX;
  const usableEndX =
    rawFieldWidth > edgeMarginPx * 2 ? endX - edgeMarginPx : endX;
  // Tight ribbon centred in the usable span — quick ding-ding-ding
  // run regardless of field length. Compress to fit if the full
  // ribbon would overflow the margin.
  const fieldWidth = usableEndX - usableStartX;
  const desiredSpacing = raptor.w * COIN_SPACING_RATIO;
  const gaps = COIN_COUNT_PER_FIELD - 1;
  const desiredSpanPx = desiredSpacing * gaps;
  const spacing =
    desiredSpanPx <= fieldWidth ? desiredSpacing : fieldWidth / gaps;
  const spanPx = spacing * gaps;
  const firstCoinX = usableStartX + (fieldWidth - spanPx) / 2;
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
      fieldCoin: true,
    });
  }
  audio.resetCoinStreak();
}

/** Spawn a single coin above a cactus: clearing IS the pickup. Coin
 *  sits at the peak of a just-clearing arc. `isLarge` doubles the
 *  gap (0.7 → 1.4 × coinSize) so tall cacti aren't trivially clipped
 *  by a shallow hop. Sole score source in the coins-only model. */
export function spawnCoinAboveCactus(
  cactusX: number,
  cactusY: number,
  cactusW: number,
  raptor: RaptorRef,
  isLarge: boolean = false,
): void {
  if (!raptor || raptor.h <= 0 || raptor.w <= 0) return;
  const coinSize = raptor.h * COIN_SIZE_RATIO;
  state.coins = state.coins || [];
  const cx = cactusX + cactusW / 2 - coinSize / 2;
  const gapMultiplier = isLarge ? 1.4 : 0.7;
  const baseY = cactusY - coinSize - coinSize * gapMultiplier;
  state.coins.push({
    x: cx,
    baseY,
    w: coinSize,
    h: coinSize,
    phase: Math.random() * Math.PI * 2,
    collected: false,
    collectFrame: 0,
    // Not part of a field — no chain-end chord.
    lastInField: false,
    // Per-cactus coins are NOT part of the pitched chain cue. The
    // rising "ding-ding-diiing" is specifically the 10-coin field
    // reward; per-cactus pickups play the flat base-pitch chime.
    fieldCoin: false,
  });
}

/** Shared bob phase — same y used by draw and collision. */
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

/** Polygon-precise pickup. AABB-rejects first (cheap), then samples
 *  the coin disc (centre + 4 cardinal edges) against the raptor body
 *  silhouette so phantom grabs through tail/neck-air don't register.
 *
 *  `onCollect` gets the coin centre after bob offset so callers can
 *  spawn bursts exactly where the coin was rendered. */
export function collectCoins(
  raptor: RaptorRef,
  onCollect: (coin: Coin, centerX: number, centerY: number) => void,
): void {
  if (!state.coins || state.coins.length === 0) return;
  const rL = raptor.x;
  const rR = raptor.x + raptor.w;
  const rT = raptor.y;
  const rB = raptor.y + raptor.h;
  const poly = raptor.collisionPolygon ? raptor.collisionPolygon() : null;
  for (const c of state.coins) {
    if (c.collected) continue;
    const cL = c.x;
    const cR = c.x + c.w;
    if (cR < rL || cL > rR) continue;
    const cy = c.baseY + Math.sin(bobPhase(c)) * COIN_BOB_AMPLITUDE_PX;
    if (cy + c.h < rT || cy > rB) continue;
    if (poly) {
      const cxC = c.x + c.w / 2;
      const cyC = cy + c.h / 2;
      const r = Math.min(c.w, c.h) / 2;
      const samples = [
        { x: cxC, y: cyC },
        { x: cxC - r, y: cyC },
        { x: cxC + r, y: cyC },
        { x: cxC, y: cyC - r },
        { x: cxC, y: cyC + r },
      ];
      let hit = false;
      for (const s of samples) {
        if (pointInPolygon(s, poly)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
    }
    c.collected = true;
    c.collectFrame = state.frame;
    state.score += COIN_SCORE_VALUE;
    // Bank immediately — "picked up = yours" even if the player
    // dies later in the field.
    state.coinsBalance += COIN_BANK_REWARD;
    saveCoinsBalance(state.coinsBalance);
    onCollect(c, c.x + c.w / 2, cy + c.h / 2);
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

    if (!c.collected) {
      // Main glint — a 4-point star sweeping across the coin face,
      // opacity pulsed on its own sin so the orbit has a dim-bright
      // cadence on top of the motion.
      const sparkleT =
        state.frame * ((Math.PI * 2 * COIN_SPARKLE_FREQUENCY_HZ) / 60) +
        c.phase;
      const s = Math.sin(sparkleT);
      if (s > 0) {
        const orbitT = sparkleT * 0.5;
        const orbitRx = c.w * 0.18;
        const orbitRy = c.h * 0.12;
        const sx = c.x + c.w * 0.62 + Math.cos(orbitT) * orbitRx;
        const sy = cy + c.h * 0.32 + Math.sin(orbitT) * orbitRy;
        const sr = c.w * COIN_GLINT_SIZE_RATIO;
        drawFourPointStar(ctx, sx, sy, sr, s * COIN_GLINT_MAX_ALPHA);
      }

      // Ambient twinkles — star-flicks on an orbit around the coin,
      // each with its own phase so they blink irregularly and
      // neighbours don't stamp identically.
      const twinkleBaseT =
        state.frame * ((Math.PI * 2 * COIN_TWINKLE_FREQUENCY_HZ) / 60);
      const cx = c.x + c.w / 2;
      const centerY = cy + c.h / 2;
      for (let i = 0; i < COIN_AMBIENT_TWINKLE_COUNT; i++) {
        const ang =
          ((i / COIN_AMBIENT_TWINKLE_COUNT) * Math.PI * 2) +
          c.phase * 0.5;
        const orbit = c.w * 0.6;
        const tx = cx + Math.cos(ang) * orbit;
        const ty = centerY + Math.sin(ang) * orbit * 0.7;
        const tPhase = twinkleBaseT + c.phase * 1.7 + i * 2.1;
        const tAmp = Math.sin(tPhase);
        if (tAmp <= 0) continue;
        // Squared envelope = narrow "blink" with a bright peak.
        const tAlpha = tAmp * tAmp * 0.95;
        const tr = c.w * 0.11;
        drawFourPointStar(ctx, tx, ty, tr, tAlpha);
      }
    }
    ctx.restore();
  }
}

// Unit-radius 4-point star baked once as a Path2D — translate+scale
// per draw instead of rebuilding the 8-segment path (~60 star draws
// per frame across live coins' glints + twinkles).
const UNIT_STAR_PATH: Path2D = (() => {
  const p = new Path2D();
  p.moveTo(0, -1);
  p.lineTo(0.3, -0.3);
  p.lineTo(1, 0);
  p.lineTo(0.3, 0.3);
  p.lineTo(0, 1);
  p.lineTo(-0.3, 0.3);
  p.lineTo(-1, 0);
  p.lineTo(-0.3, -0.3);
  p.closePath();
  return p;
})();

/** Shared 4-point white sparkle — main glint, ambient twinkles, and
 *  collect-burst particles all use this one primitive. */
function drawFourPointStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  alpha: number,
): void {
  if (alpha <= 0 || r <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha) * ctx.globalAlpha;
  ctx.fillStyle = "#fff";
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.fill(UNIT_STAR_PATH);
  ctx.restore();
}

export { drawFourPointStar };

export function clearCoins(): void {
  state.coins = [];
}
