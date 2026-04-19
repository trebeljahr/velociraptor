/*
 * Raptor Runner — the player-controlled raptor.
 *
 * The core sprite animates through a 12-frame run cycle by picking a
 * row out of the pre-baked sprite sheet. Jumps use a semi-implicit
 * Euler integrator scaled by `frameScale` so trajectories look
 * identical at any frame rate.
 *
 * Couplings back to the main loop are passed in at construction time
 * as two callbacks so this module has no runtime dependency on
 * anything that still lives in src/main.ts:
 *   • onLand  — fires when the raptor's feet touch the ground after
 *               having been airborne; the caller decides whether/how
 *               to spawn the dust burst
 *   • onJump  — fires on a successful jump; the caller uses this to
 *               run the rare-event spawn roll
 *   • onStep  — fires on each individual footfall during the run
 *               cycle (frames 0 and 6 of the 12-frame sheet). The
 *               caller typically spawns a small dust puff at the
 *               foot's X offset; the audio step SFX is handled here
 *               via audio.playStep() so the two stay in sync.
 *
 * Every other reference (audio, state, persistence, images, helpers,
 * constants) is imported directly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  GRAVITY,
  RAPTOR_WIDTH_RATIO,
  RAPTOR_ASPECT,
  VELOCITY_SCALE_DIVISOR,
  DOWNWARD_ACCEL_DIVISOR,
  JUMP_CLEARANCE_MULTIPLIER,
  JUMP_BUFFER_MS,
  FRAME_DELAY_SPEED_RANGE,
  INITIAL_BG_VELOCITY,
  RAPTOR_FRAME_DELAY_MAX,
  RAPTOR_FRAME_DELAY_MIN,
  RAPTOR_FRAMES,
  RAPTOR_IDLE_FRAME,
  RAPTOR_NATIVE_W,
  RAPTOR_NATIVE_H,
  RAPTOR_CROWN,
  RAPTOR_SNOUT,
  RAPTOR_COLLISION_INSET,
} from "../constants";
import { state } from "../state";
import { audio } from "../audio";
import { IMAGES } from "../images";
import { saveTotalJumps } from "../persistence";
import { hapticJump } from "../haptic";
import { clamp, lerp, shrinkPolygon, Polygon } from "../helpers";
import {
  COSMETICS,
  COSMETICS_BY_ID,
  PLACEHOLDER_COLORS,
  type CosmeticSlot,
} from "../cosmetics";

export type RaptorCallback = () => void;
export type RaptorStepCallback = (foot: "left" | "right") => void;

export class Raptor {
  x: number = 0;
  y: number = 0;
  w: number = 0;
  h: number = 0;
  ground: number = 0;
  velocity: number = 0;
  gravity: number = GRAVITY;
  sheet: HTMLImageElement | undefined;
  frame: number = 0;
  lastFrameAdvanceAt: number = 0;

  // Cached collision polygon — rebuilt once per update() call rather
  // than each time the collision code asks for it, and reused across
  // the two call sites (collision test + debug draw).
  private _polyCache: Polygon | null = null;
  private _jumpBufferedAt: number = 0;
  private _wasAirborne: boolean = false;

  constructor(
    private onLand: RaptorCallback,
    private onJump: RaptorCallback,
    private onStep: RaptorStepCallback = () => {},
  ) {
    this.sheet = IMAGES.raptorSheet;
    this.resize();
  }

  resize(): void {
    this.w = state.width * RAPTOR_WIDTH_RATIO;
    this.h = this.w * RAPTOR_ASPECT;
    this.x = 0;
    this.ground = state.ground - this.h;
    this.y = this.ground;
  }

  get downwardAcceleration(): number {
    return (
      (this.gravity *
        state.bgVelocity *
        state.bgVelocity *
        (state.width / VELOCITY_SCALE_DIVISOR)) /
      DOWNWARD_ACCEL_DIVISOR
    );
  }

  jump(): boolean {
    if (this.y !== this.ground || state.gameOver) return false;
    const targetRise = this.h * JUMP_CLEARANCE_MULTIPLIER;
    const a = this.downwardAcceleration;
    const v = Math.sqrt(2 * a * targetRise);
    this.velocity = -v;
    this._jumpBufferedAt = 0;
    audio.playJump();
    if (!audio.muted) hapticJump();
    // Gamepad rumble — light tap on jump. Dispatched via a macrotask
    // (setTimeout 0) because on Chromium/Electron the playEffect IPC
    // to the gamepad driver can block the main thread long enough to
    // miss a frame — getting rumble off the critical path keeps the
    // jump itself smooth.
    setTimeout(() => {
      try {
        const gp = navigator.getGamepads?.()[0];
        gp?.vibrationActuator?.playEffect("dual-rumble", {
          duration: 40,
          weakMagnitude: 0.3,
          strongMagnitude: 0.1,
        });
      } catch (_) {}
    }, 0);
    // Bump both the career-wide total and the per-run counter.
    state.totalJumps += 1;
    state.runJumps += 1;
    saveTotalJumps(state.totalJumps);
    this.onJump();
    return true;
  }

  /**
   * Buffer a jump so a tap ~100ms before landing still fires. Called
   * when the player presses jump while airborne.
   */
  bufferJump(now: number): void {
    this._jumpBufferedAt = now;
  }

  /**
   * Frame delay scales inversely with the background velocity, so the
   * raptor visibly runs faster as the game speeds up. Mirrors the old
   * `img.delay(...)` speed-ramp from the p5 version.
   */
  get frameDelay(): number {
    const t = clamp(
      (state.bgVelocity - INITIAL_BG_VELOCITY) / FRAME_DELAY_SPEED_RANGE,
      0,
      1,
    );
    return lerp(RAPTOR_FRAME_DELAY_MAX, RAPTOR_FRAME_DELAY_MIN, t);
  }

  update(now: number, frameScale = 1): void {
    // Semi-implicit Euler, scaled by frameScale so the trajectory
    // stays the same at any frame rate. downwardAcceleration and jump
    // velocity are already in "pixels per 60fps-frame" units.
    this.velocity += this.downwardAcceleration * frameScale;
    this.y += this.velocity * frameScale;
    if (this.y < this.ground) {
      this._wasAirborne = true;
    }
    if (this.y > this.ground) {
      this.y = this.ground;
      this.velocity = 0;
      if (this._wasAirborne) {
        this.onLand();
        this._wasAirborne = false;
      }
      // Input buffer: if the player pressed jump while airborne
      // (within 100ms), fire the jump now that we've landed.
      if (
        this._jumpBufferedAt &&
        now - this._jumpBufferedAt < JUMP_BUFFER_MS
      ) {
        this.jump();
      }
      this._jumpBufferedAt = 0;
    }

    // Frame animation: running while on the ground, locked to the
    // idle pose (frame 11) while airborne. Uses real wall-clock time
    // (ms) already, so it's frame-rate independent for free.
    if (this.y === this.ground) {
      if (now - this.lastFrameAdvanceAt > this.frameDelay) {
        this.frame = (this.frame + 1) % RAPTOR_FRAMES;
        this.lastFrameAdvanceAt = now;
        // Two footfalls per 12-frame cycle, half a cycle apart.
        // The SFX + dust puff fire from the same check so they stay
        // tightly synced with the visible foot plant.
        if (this.frame === 0) {
          audio.playStep("left");
          this.onStep("left");
        } else if (this.frame === 6) {
          audio.playStep("right");
          this.onStep("right");
        }
      }
    } else {
      this.frame = RAPTOR_IDLE_FRAME;
      this.lastFrameAdvanceAt = now;
    }

    // Invalidate the cached collision polygon — it'll be rebuilt on
    // the next call to collisionPolygon() if anything needs it.
    this._polyCache = null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.sheet) return;
    // Back-slot cosmetics (wings) render BEFORE the body blit so
    // the body covers the wing's near edge — reads as the far
    // wing peeking out around the raptor, not a sticker slapped
    // on top. All other slots render after the body.
    this._drawEquippedSlot(ctx, "back");
    const srcY = this.frame * RAPTOR_NATIVE_H;
    ctx.drawImage(
      this.sheet,
      0,
      srcY,
      RAPTOR_NATIVE_W,
      RAPTOR_NATIVE_H,
      this.x,
      this.y,
      this.w,
      this.h,
    );
    // Cosmetics: iterate the slots and draw whatever id is equipped
    // there. The three score-unlock classics get their bespoke draw
    // functions (hand-tuned anchors + rotations); any other equipped
    // cosmetic falls back to a slot-default placeholder rectangle
    // so we can wire the full shop/equip flow end-to-end before the
    // final art lands.
    //
    // Order: eyes first so the snout draws clean, then head, then
    // neck. Matches the z-ordering the old hand-coded block used.
    this._drawEquippedSlot(ctx, "eyes");
    this._drawEquippedSlot(ctx, "head");
    this._drawEquippedSlot(ctx, "neck");
  }

  /**
   * Back anchor: where the wing's root attaches to the raptor's
   * body. Derived from the crown point so the wing bobs with the
   * head/run cycle instead of locking to the static x/y. Offset
   * back and down from the crown into the upper-back region
   * (~38% from the front of the raptor, shoulder-height).
   */
  currentBackPoint(): { x: number; y: number } {
    const crown = this.currentCrownPoint();
    // crown is roughly at the top-front of the head; the back
    // attachment lives behind it and slightly below, at the
    // raptor's shoulder / upper-back region. Fractions are tuned
    // by eye against the flipped wing art so the wing-root sits
    // on the shoulder instead of floating in the belly area.
    return {
      x: crown.x - this.w * 0.08,
      y: crown.y + this.h * 0.2,
    };
  }

  private _drawEquippedSlot(
    ctx: CanvasRenderingContext2D,
    slot: CosmeticSlot,
  ): void {
    const id = state.equippedCosmetics[slot];
    if (!id) return;
    const def = COSMETICS_BY_ID[id];
    if (!def) return;
    // Bespoke draw path for the three hand-tuned classics — keeps
    // their existing anchors and rotations exactly as before.
    if (id === "party-hat") return this.drawPartyHat(ctx);
    if (id === "thug-glasses") return this.drawThugGlasses(ctx);
    if (id === "bow-tie") return this.drawBowTie(ctx);
    // Everything else: slot placeholder. When the sprite lands,
    // the def will include spriteKey and we can either keep the
    // default-placement path here or move the cosmetic into the
    // bespoke branch above.
    this._drawCosmeticPlaceholder(ctx, slot, def);
  }

  /**
   * Placeholder render for a cosmetic that doesn't yet have a
   * hand-tuned draw routine. Uses slot-default anchors that match
   * the classics (crown for head, snout-crown midpoint for eyes,
   * neck for bow tie) so the placeholder sits roughly where the
   * final art will. If a spriteKey is defined and the image has
   * loaded, draws that instead of the coloured rectangle.
   */
  private _drawCosmeticPlaceholder(
    ctx: CanvasRenderingContext2D,
    slot: CosmeticSlot,
    def: (typeof COSMETICS)[number],
  ): void {
    const sprite = def.spriteKey ? IMAGES[def.spriteKey] : undefined;
    let cx = 0;
    let cy = 0;
    let w = 0;
    let h = 0;
    let rot = 0;
    let bottomAnchored = false;
    if (slot === "head") {
      const crown = this.currentCrownPoint();
      cx = crown.x - this.w * 0.01;
      cy = crown.y + this.h * 0.04;
      h = this.h * 0.3;
      w = h * (sprite ? sprite.width / sprite.height : 0.9);
      rot = -0.35;
      bottomAnchored = true;
    } else if (slot === "eyes") {
      const crown = this.currentCrownPoint();
      const snout = this.currentSnoutPoint();
      cx = crown.x + (snout.x - crown.x) * 0.5 - this.w * 0.012;
      cy = crown.y + (snout.y - crown.y) * 0.5 + this.h * 0.013;
      w = this.w * 0.1;
      h = w * (sprite ? sprite.height / sprite.width : 0.45);
      rot = Math.atan2(snout.y - crown.y, snout.x - crown.x) - 0.25;
    } else if (slot === "neck") {
      const crown = this.currentCrownPoint();
      cx = crown.x - this.w * 0.02;
      cy = crown.y + this.h * 0.2;
      w = this.w * 0.08;
      h = w * (sprite ? sprite.height / sprite.width : 0.7);
      rot = -0.15;
    } else {
      // back slot (wings). All wing sprites are pre-flipped
      // horizontally so the shoulder/attachment sits in the
      // sprite's RIGHT half; we anchor the sprite's right edge
      // on the raptor's back point so the wing-root hugs the
      // shoulder and the wing itself extends left (behind the
      // raptor). Sized by raptor HEIGHT so wings scale cleanly
      // across viewport sizes, and kept well below raptor.h so
      // they read as feathers on the back, not a cape the
      // raptor is drowning in.
      const back = this.currentBackPoint();
      cx = back.x;
      cy = back.y;
      w = this.h * 0.85;
      h = w * (sprite ? sprite.height / sprite.width : 0.85);
      // Small CCW tilt so the wing's top curves upward over the
      // shoulder instead of sticking out flat behind.
      rot = -0.1;
    }
    // Most slots centre the sprite on (cx, cy). The back slot
    // pins the sprite's upper-RIGHT near the anchor instead so
    // the wing-root attaches at the shoulder while the body of
    // the wing sweeps down and back.
    let drawXOverride: number | null = null;
    let drawYOverride: number | null = null;
    if (slot === "back") {
      drawXOverride = -w * 0.9; // right edge near anchor
      drawYOverride = -h * 0.4; // anchor on the upper third
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    const drawX = drawXOverride ?? -w / 2;
    const drawY = drawYOverride ?? (bottomAnchored ? -h : -h / 2);
    if (sprite) {
      ctx.drawImage(sprite, drawX, drawY, w, h);
    } else {
      // Placeholder: flat-coloured rectangle with a two-letter
      // tag so separate items in the same slot stay distinguishable
      // at a glance while we're iterating on art.
      ctx.fillStyle = PLACEHOLDER_COLORS[slot];
      ctx.fillRect(drawX, drawY, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `${Math.max(6, h * 0.35)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.name.slice(0, 2).toUpperCase(), 0, drawY + h / 2);
    }
    ctx.restore();
  }

  /**
   * Crown and snout reference points for the current animation frame,
   * converted to world coords. These come straight out of the
   * per-frame scan of the sprite sheet (RAPTOR_CROWN / RAPTOR_SNOUT)
   * so they track the run cycle exactly. While airborne we lock to
   * the idle frame.
   */
  currentCrownPoint(): { x: number; y: number } {
    const f = this.y === this.ground ? this.frame : RAPTOR_IDLE_FRAME;
    const [nx, ny] = RAPTOR_CROWN[f];
    return { x: this.x + nx * this.w, y: this.y + ny * this.h };
  }

  currentSnoutPoint(): { x: number; y: number } {
    const f = this.y === this.ground ? this.frame : RAPTOR_IDLE_FRAME;
    const [nx, ny] = RAPTOR_SNOUT[f];
    return { x: this.x + nx * this.w, y: this.y + ny * this.h };
  }

  /**
   * Thug-life glasses sprite (Wikimedia Commons, Aboulharakat —
   * CC BY-SA 4.0; see imprint) composited across the raptor's nose.
   * Anchor = interpolation between the crown and snout so the glasses
   * sit flat across the top of the snout ridge, and the position
   * follows the head's motion every frame.
   */
  drawThugGlasses(ctx: CanvasRenderingContext2D): void {
    const sprite = IMAGES.thugGlasses;
    if (!sprite) return;
    const crown = this.currentCrownPoint();
    const snout = this.currentSnoutPoint();
    // 0.5 along from crown toward snout = back a bit from the snout
    // tip, on the upper half of the nose ridge. Far enough from the
    // tip to look like glasses, not a muzzle.
    // Additional tiny offset — back by 5px-ish (scaled to raptor
    // width) and down by 2px — so the lenses settle onto the ridge
    // at the native viewport.
    const t = 0.5;
    const cx = crown.x + (snout.x - crown.x) * t - this.w * 0.012;
    const cy = crown.y + (snout.y - crown.y) * t + this.h * 0.013;
    // Small: 7% of raptor width.
    const gW = this.w * 0.07;
    const gH = gW * (sprite.height / sprite.width);
    ctx.save();
    ctx.translate(cx, cy);
    // Base angle = direction of the nose ridge (crown → snout), minus
    // a small CCW nudge so the glasses tilt back above the nose line
    // rather than following it exactly.
    const rideAngle = Math.atan2(snout.y - crown.y, snout.x - crown.x);
    ctx.rotate(rideAngle - 0.25);
    ctx.drawImage(sprite, -gW / 2, -gH / 2, gW, gH);
    ctx.restore();
  }

  /**
   * Party hat sprite (Freepik, see imprint) composited on top of the
   * raptor's head. The sprite is drawn with its bottom center sitting
   * on the crown of the head, then rotated slightly backwards and to
   * the left for a casual "just put it on" tilt.
   */
  drawPartyHat(ctx: CanvasRenderingContext2D): void {
    const sprite = IMAGES.partyHat;
    if (!sprite) return;
    const crown = this.currentCrownPoint();
    // Anchor the hat's BASE a little below the exact crown so it sits
    // snug on the head instead of teetering on the very top point.
    // Still nudged slightly left (toward the tail) so it doesn't
    // balance right on the tip.
    const anchorX = crown.x - this.w * 0.01;
    const anchorY = crown.y + this.h * 0.04;
    // Hat ~25% of raptor height — small, sits as a hat on top without
    // covering the head. Width follows the source aspect ratio so the
    // pom-pom stays round.
    const hatH = this.h * 0.25;
    const hatW = hatH * (sprite.width / sprite.height);
    // Tilt backwards and to the LEFT — i.e. rotate counter clockwise
    // in canvas coords (negative angle), so the apex leans toward the
    // raptor's tail.
    const tiltRad = -0.35;
    ctx.save();
    ctx.translate(anchorX, anchorY);
    ctx.rotate(tiltRad);
    // Draw the sprite so its bottom-center is at the anchor: the base
    // of the hat sits on the crown and the tip extends up.
    ctx.drawImage(sprite, -hatW / 2, -hatH, hatW, hatH);
    ctx.restore();
  }

  drawBowTie(ctx: CanvasRenderingContext2D): void {
    const sprite = IMAGES.bowTie;
    if (!sprite) return;
    const crown = this.currentCrownPoint();
    // The neck is below and behind the crown — offset downward and
    // slightly toward the body center.
    const neckX = crown.x - this.w * 0.02;
    const neckY = crown.y + this.h * 0.2;
    // Bow tie ~6% of raptor width, aspect ratio from source.
    const btW = this.w * 0.06;
    const btH = btW * (sprite.height / sprite.width);
    ctx.save();
    ctx.translate(neckX, neckY);
    ctx.rotate(-0.15); // slight CCW tilt to match body angle
    ctx.drawImage(sprite, -btW / 2, -btH / 2, btW, btH);
    ctx.restore();
  }

  /**
   * Concave silhouette following the running raptor's body outline,
   * shrunk inward by RAPTOR_COLLISION_INSET pixels so the collision
   * feels forgiving. Cached per update() call — see _polyCache above.
   */
  collisionPolygon(): Polygon {
    if (this._polyCache) return this._polyCache;
    const x = this.x;
    const y = this.y;
    const w = this.w;
    const h = this.h;
    const raw: Polygon = [
      { x: x + w * 0.5, y: y + h * 0.27 },
      { x: x + w * 0.5, y: y + h * 0.4 },
      { x: x + w * 0.6, y: y + h * 0.6 },
      { x: x + w * 0.5, y: y + h * 0.82 },
      { x: x + w * 0.48, y: y + h },
      { x: x + w * 0.55, y: y + h },
      { x: x + w * 0.51, y: y + h * 0.955 },
      { x: x + w * 0.53, y: y + h * 0.9 },
      { x: x + w * 0.55, y: y + h * 0.9 },
      { x: x + w * 0.55, y: y + h * 0.86 },
      { x: x + w * 0.51, y: y + h * 0.86 },
      { x: x + w * 0.53, y: y + h * 0.8 },
      { x: x + w * 0.62, y: y + h * 0.65 },
      { x: x + w * 0.63, y: y + h * 0.6 },
      { x: x + w * 0.67, y: y + h * 0.6 },
      { x: x + w * 0.67, y: y + h * 0.85 },
      { x: x + w * 0.72, y: y + h * 0.95 },
      { x: x + w * 0.78, y: y + h * 0.95 },
      { x: x + w * 0.7, y: y + h * 0.8 },
      { x: x + w * 0.75, y: y + h * 0.8 },
      { x: x + w * 0.8, y: y + h * 0.6 },
      { x: x + w * 0.78, y: y + h * 0.55 },
      { x: x + w * 0.9, y: y + h * 0.3 },
      { x: x + w, y: y + h * 0.3 },
      { x: x + w, y: y + h * 0.23 },
      { x: x + w * 0.9, y: y + h * 0.15 },
      { x: x + w * 0.85, y: y + h * 0.15 },
      { x: x + w * 0.8, y: y + h * 0.35 },
    ];
    this._polyCache = shrinkPolygon(raw, RAPTOR_COLLISION_INSET);
    return this._polyCache;
  }
}
