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
  // Shrink the usable span so coins don't hug the cactus on either
  // side of the field. Fall back to the full field width on tiny
  // breathers where 2× margin would leave nothing to spawn into.
  const edgeMarginPx = raptor.w * COIN_FIELD_EDGE_MARGIN_RAPTOR_WIDTHS;
  const rawFieldWidth = endX - startX;
  const usableStartX =
    rawFieldWidth > edgeMarginPx * 2 ? startX + edgeMarginPx : startX;
  const usableEndX =
    rawFieldWidth > edgeMarginPx * 2 ? endX - edgeMarginPx : endX;
  // Coins live in a tight ribbon centred in the usable span: a
  // fixed raptor-width spacing gives a quick "ding-ding-ding…"
  // run, and the ribbon is short enough that the player hits all
  // COUNT coins in ~1–1.5s regardless of how long the breather
  // itself is. If the ribbon happens to exceed the usable width
  // (tiny breather edge case), compress to fit instead of
  // overflowing the margin.
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

/** Spawn a single coin directly above a cactus — the raptor must
 *  jump to clear the cactus, and the coin sits in the arc so
 *  clearing it IS the pickup. Replaces the old "cactus-pass = +1
 *  score" in the new coins-only scoring model: only the coin
 *  grants points, not the jump itself.
 *
 *  `isLarge` bumps the gap above the cactus top. Small cacti leave
 *  0.7 × coinSize of air between coin-bottom and cactus-top; tall
 *  cacti double that to 1.4 × coinSize so the raptor has to commit
 *  to a real peak-of-arc grab instead of clipping the coin with a
 *  shallow hop. */
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
  // Horizontally centred on the cactus top.
  const cx = cactusX + cactusW / 2 - coinSize / 2;
  // Vertically: the coin's BOTTOM sits a configurable gap above the
  // cactus top. 0.7 × coinSize is the default — puts the coin roughly
  // where the raptor's torso arcs at the peak of a just-clearing jump.
  // For tall cacti we double the gap so the coin isn't inside the
  // minimum clearance envelope.
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
    // Not part of a field — suppresses the chain-end chord so the
    // per-cactus coin plays as a normal pickup, not a field finale.
    lastInField: false,
    // Per-cactus coins are NOT part of the pitched chain cue. The
    // rising "ding-ding-diiing" is specifically the 10-coin field
    // reward; per-cactus pickups play the flat base-pitch chime.
    fieldCoin: false,
  });
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

/** Polygon-precise pickup test. The raptor's bounding box covers
 *  the tail-to-snout sprite, most of which is empty air; coin
 *  collection against that AABB fires on coins the player clearly
 *  ran past. Instead we AABB-reject quickly, then confirm against
 *  the body silhouette (same polygon the cactus collision uses)
 *  so a coin is only grabbed when it actually overlaps the raptor.
 *
 *  `onCollect` receives the coin center (after bob offset) so
 *  callers can spawn burst particles at exactly where the coin
 *  was rendered this frame, not at its stored baseY. */
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
      // A handful of sample points around the coin's disc — centre
      // plus the four cardinal edge midpoints — give a coin-radius
      // approximation without the cost of full polygon-vs-polygon.
      // Any one sample inside the body silhouette counts as a hit,
      // so the test stays forgiving on glancing contacts but rejects
      // the misses where the AABB used to false-positive (tail,
      // neck-above-head air, feet-behind-body).
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
    // Bank the coin into the persistent shop balance immediately —
    // if the player dies mid-field they still keep what they've
    // already grabbed, which matches the "picked up = yours" feel.
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
      // ── Main rotating glint ────────────────────────────────
      // A 4-point white star that sweeps across the coin face
      // over time, stronger than the original shimmer so the
      // coin reads as actively shiny instead of just bright.
      // Position orbits a small arc across the top-right of the
      // coin; opacity pulses on its own sin so the sweep has a
      // dim-bright cadence on top of the motion.
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

      // ── Ambient twinkles ───────────────────────────────────
      // Small star-flicks at fixed offsets around the coin, each
      // on an independent phase so they pop in and out at
      // irregular intervals. They sit OUTSIDE the coin's disc
      // (at 1.1× radius) so they read as "shine escaping the
      // coin" rather than being engraved on the face.
      const twinkleBaseT =
        state.frame * ((Math.PI * 2 * COIN_TWINKLE_FREQUENCY_HZ) / 60);
      const cx = c.x + c.w / 2;
      const centerY = cy + c.h / 2;
      for (let i = 0; i < COIN_AMBIENT_TWINKLE_COUNT; i++) {
        // Fixed angular offsets give a predictable constellation
        // around each coin; adding c.phase rotates the set per
        // coin so neighbours aren't stamped identically.
        const ang =
          ((i / COIN_AMBIENT_TWINKLE_COUNT) * Math.PI * 2) +
          c.phase * 0.5;
        const orbit = c.w * 0.6;
        const tx = cx + Math.cos(ang) * orbit;
        const ty = centerY + Math.sin(ang) * orbit * 0.7;
        // Per-twinkle phase: offset by i * 2.1 rad and by this
        // coin's phase so the twinkles don't flash in sync.
        const tPhase = twinkleBaseT + c.phase * 1.7 + i * 2.1;
        const tAmp = Math.sin(tPhase);
        if (tAmp <= 0) continue;
        // Squared envelope keeps a narrow "blink" feel but with a
        // brighter peak than the cubed version — the twinkles now
        // read as real shine pops, not hint-level flickers.
        const tAlpha = tAmp * tAmp * 0.95;
        const tr = c.w * 0.11;
        drawFourPointStar(ctx, tx, ty, tr, tAlpha);
      }
    }
    ctx.restore();
  }
}

/** Shared helper: a 4-point (plus-shape with tapered points)
 *  white sparkle. Used for the main glint, ambient twinkles, and
 *  the collect-burst particles so the whole system shares one
 *  visual language. */
// Unit-radius four-point star, baked once so the up-to-60 star
// draws per frame (10 live coins × 1 main glint + 5 ambient twinkles
// each) don't rebuild the same 8-segment path every call. At draw
// time we translate + scale to the requested (x, y, r) and fill this
// constant Path2D — the shape is pure geometry, so no need to bake
// per-radius canvases like the moon halo.
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
