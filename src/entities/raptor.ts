/*
 * Raptor Runner — the player-controlled raptor.
 *
 * 12-frame run cycle driven off a pre-baked sprite sheet. Jumps use
 * semi-implicit Euler scaled by `frameScale` so trajectories stay
 * consistent at any frame rate. onLand/onJump/onStep callbacks are
 * injected at construction (no runtime dep on src/main.ts); step
 * fires on frames 0 and 6 of the walk cycle.
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
  RAPTOR_NECK_CORRECTION,
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
    // Gamepad rumble via setTimeout(0) so the blocking playEffect
    // IPC can't steal frame time from the jump itself.
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

  /** Frame delay scales inversely with bgVelocity — the raptor
   *  visibly runs faster as the game speeds up. */
  get frameDelay(): number {
    const t = clamp(
      (state.bgVelocity - INITIAL_BG_VELOCITY) / FRAME_DELAY_SPEED_RANGE,
      0,
      1,
    );
    return lerp(RAPTOR_FRAME_DELAY_MAX, RAPTOR_FRAME_DELAY_MIN, t);
  }

  update(now: number, frameScale = 1): void {
    // Semi-implicit Euler. velocity/acceleration are in "pixels per
    // 60fps-frame" units — frameScale keeps trajectories identical
    // at any real frame rate.
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
      // Jump buffered in the last JUMP_BUFFER_MS airtime fires now
      // that we've landed.
      if (
        this._jumpBufferedAt &&
        now - this._jumpBufferedAt < JUMP_BUFFER_MS
      ) {
        this.jump();
      }
      this._jumpBufferedAt = 0;
    }

    // Run on ground, lock to idle pose mid-air. Footfalls fire on
    // frames 0 and 6 of the cycle.
    if (this.y === this.ground) {
      if (now - this.lastFrameAdvanceAt > this.frameDelay) {
        this.frame = (this.frame + 1) % RAPTOR_FRAMES;
        this.lastFrameAdvanceAt = now;
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

    this._polyCache = null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.sheet) return;
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
    // Head-area cosmetics render on top of the body so they read
    // as worn, not painted into the silhouette.
    this._drawEquippedSlot(ctx, "eyes");
    this._drawEquippedSlot(ctx, "head");
    this._drawEquippedSlot(ctx, "neck");
  }

  private _drawEquippedSlot(
    ctx: CanvasRenderingContext2D,
    slot: CosmeticSlot,
  ): void {
    const id = state.equippedCosmetics[slot];
    if (!id) return;
    const def = COSMETICS_BY_ID[id];
    if (!def) return;
    // Classics have bespoke draw routines with hand-tuned anchors.
    if (id === "party-hat") return this.drawPartyHat(ctx);
    if (id === "thug-glasses") return this.drawThugGlasses(ctx);
    if (id === "bow-tie") return this.drawBowTie(ctx);
    this._drawCosmeticPlaceholder(ctx, slot, def);
  }

  /** Slot-default draw for cosmetics without bespoke routines.
   *  Falls back to a coloured rectangle with a 2-letter tag when
   *  the sprite hasn't loaded yet. */
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
    const drawOverride = def.draw;
    if (slot === "head") {
      const crown = this.currentCrownPoint();
      cx = crown.x - this.w * 0.01;
      cy = crown.y + this.h * 0.04;
      const scale = drawOverride?.scale ?? 0.3;
      h = this.h * scale;
      w = h * (sprite ? sprite.width / sprite.height : 0.9);
      rot = drawOverride?.rotation ?? -0.35;
      bottomAnchored = true;
    } else if (slot === "eyes") {
      const crown = this.currentCrownPoint();
      const snout = this.currentSnoutPoint();
      cx = crown.x + (snout.x - crown.x) * 0.5 - this.w * 0.012;
      cy = crown.y + (snout.y - crown.y) * 0.5 + this.h * 0.013;
      const scale = drawOverride?.scale ?? 0.1;
      w = this.w * scale;
      h = w * (sprite ? sprite.height / sprite.width : 0.45);
      const rideAngle = Math.atan2(snout.y - crown.y, snout.x - crown.x);
      rot = drawOverride?.rotation ?? rideAngle - 0.25;
    } else if (slot === "neck") {
      const crown = this.currentCrownPoint();
      cx = crown.x - this.w * 0.02;
      cy = crown.y + this.h * 0.2;
      // Per-frame correction: the neck/throat bends on a slightly
      // delayed cycle from the crown, so we add the differential
      // motion (zero-mean) to replace the head's bob with the
      // throat's actual motion. Without this the bandana rides
      // the head bounce instead of the throat.
      const f = this.y === this.ground ? this.frame : RAPTOR_IDLE_FRAME;
      const [ncx, ncy] = RAPTOR_NECK_CORRECTION[f];
      cx += this.w * ncx;
      cy += this.h * ncy;
      const scale = drawOverride?.scale ?? 0.08;
      w = this.w * scale;
      h = w * (sprite ? sprite.height / sprite.width : 0.7);
      rot = drawOverride?.rotation ?? -0.15;
    }
    if (drawOverride?.offset) {
      if (drawOverride.offset.x != null) cx += this.w * drawOverride.offset.x;
      if (drawOverride.offset.y != null) cy += this.h * drawOverride.offset.y;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    const drawX = -w / 2;
    const drawY = bottomAnchored ? -h : -h / 2;
    if (sprite) {
      ctx.drawImage(sprite, drawX, drawY, w, h);
    } else {
      // Flat-coloured placeholder with a 2-letter tag so separate
      // items in the same slot stay distinguishable while iterating.
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

  /** Crown / snout reference points for the current frame, in world
   *  coords. Locked to the idle frame while airborne. */
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

  /** Thug-life glasses — anchor is the crown→snout midpoint so the
   *  lenses sit flat across the top of the snout ridge. Sprite
   *  credit: Wikimedia Commons / Aboulharakat CC BY-SA 4.0. */
  drawThugGlasses(ctx: CanvasRenderingContext2D): void {
    const sprite = IMAGES.thugGlasses;
    if (!sprite) return;
    const crown = this.currentCrownPoint();
    const snout = this.currentSnoutPoint();
    const cx = crown.x + (snout.x - crown.x) * 0.5 - this.w * 0.012;
    const cy = crown.y + (snout.y - crown.y) * 0.5 + this.h * 0.013;
    const gW = this.w * 0.07;
    const gH = gW * (sprite.height / sprite.width);
    ctx.save();
    ctx.translate(cx, cy);
    // Ride the nose ridge minus a small CCW nudge so the glasses
    // tilt back above the line rather than following it exactly.
    const rideAngle = Math.atan2(snout.y - crown.y, snout.x - crown.x);
    ctx.rotate(rideAngle - 0.25);
    ctx.drawImage(sprite, -gW / 2, -gH / 2, gW, gH);
    ctx.restore();
  }

  /** Party hat — base anchored just below the crown with a CCW tilt
   *  so the apex leans toward the tail. Sprite credit: Freepik. */
  drawPartyHat(ctx: CanvasRenderingContext2D): void {
    const sprite = IMAGES.partyHat;
    if (!sprite) return;
    const crown = this.currentCrownPoint();
    const anchorX = crown.x - this.w * 0.01;
    const anchorY = crown.y + this.h * 0.04;
    const hatH = this.h * 0.25;
    const hatW = hatH * (sprite.width / sprite.height);
    ctx.save();
    ctx.translate(anchorX, anchorY);
    ctx.rotate(-0.35);
    // Bottom-center at the anchor — base on the crown, tip up.
    ctx.drawImage(sprite, -hatW / 2, -hatH, hatW, hatH);
    ctx.restore();
  }

  drawBowTie(ctx: CanvasRenderingContext2D): void {
    const sprite = IMAGES.bowTie;
    if (!sprite) return;
    const crown = this.currentCrownPoint();
    // Offset down+back from the crown onto the throat, plus the
    // per-frame neck correction so the bow tracks the throat's
    // actual motion rather than the head's bob.
    let neckX = crown.x - this.w * 0.02;
    let neckY = crown.y + this.h * 0.2;
    const f = this.y === this.ground ? this.frame : RAPTOR_IDLE_FRAME;
    const [ncx, ncy] = RAPTOR_NECK_CORRECTION[f];
    neckX += this.w * ncx;
    neckY += this.h * ncy;
    const btW = this.w * 0.06;
    const btH = btW * (sprite.height / sprite.width);
    ctx.save();
    ctx.translate(neckX, neckY);
    ctx.rotate(-0.15);
    ctx.drawImage(sprite, -btW / 2, -btH / 2, btW, btH);
    ctx.restore();
  }

  /** Concave body silhouette, shrunk by RAPTOR_COLLISION_INSET px so
   *  the collision feels forgiving. Cached per update() call. */
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
