/*
 * Raptor Runner — pterodactyl flying obstacle.
 *
 * Alternative obstacle to the cacti. Uses a 5×5 sprite sheet (22
 * frames, last 3 slots empty) for a full flap cycle. Sprite is drawn
 * horizontally flipped so the head leads the scroll (feels like it's
 * flying toward the raptor).
 *
 * Every frame has its own collision polygon: body-only, excluding
 * wing tips, so the hit feels fair when a well-timed jump grazes the
 * wingspan. Because wing position changes which part of the frame
 * the body occupies, per-frame polygons are load-bearing — a single
 * generic polygon would either under-cover frames where the body
 * sits high (wings down) or over-cover frames where the body sits
 * low (wings up).
 *
 *   • Pterodactyl   — single obstacle: world x/y/w/h, current frame,
 *                     cached polygon. Advances animation in update().
 *   • Pterodactyls  — spawn manager: called from the cactus spawn
 *                     path when a roll hits PTERODACTYL_SPAWN_CHANCE,
 *                     so flyers replace the occasional cactus rather
 *                     than layering on top of them.
 */

import {
  VELOCITY_SCALE_DIVISOR,
  PTERODACTYL_SHEET_COLS,
  PTERODACTYL_FRAMES,
  PTERODACTYL_FRAME_W,
  PTERODACTYL_FRAME_H,
  PTERODACTYL_HEIGHT_SCALE,
  PTERODACTYL_FLIGHT_HEIGHT_RATIO,
  PTERODACTYL_FRAME_DELAY_MS,
} from "../constants";
import { state } from "../state";
import { IMAGES } from "../images";
import { Polygon } from "../helpers";
import { Raptor } from "./raptor";
import type { NormalizedPoint } from "../cactusVariants";

/** Build an 8-point body silhouette from four Y anchors.
 *  • yBackTop: back/shoulder ridge
 *  • yBellyBot: belly/chin underside
 *  • yHeadTip: forward-most head point (leftmost in the sprite)
 *  • yTailTip: trailing-most tail point (rightmost)
 *  X anchors are fixed — the body occupies roughly x=0.26..0.72 of
 *  the frame; wings extend outward past those bounds and are
 *  intentionally excluded.
 *  Orientation: source sprites face LEFT (head on left, tail on
 *  right), and we draw them un-flipped — so these X anchors match
 *  the sprite one-to-one. */
function buildBody(
  yBackTop: number,
  yBellyBot: number,
  yHeadTip: number,
  yTailTip: number,
): NormalizedPoint[] {
  return [
    [0.26, yHeadTip], // head tip (nose)
    [0.30, yBackTop - 0.01], // crown
    [0.38, yBackTop], // shoulders
    [0.50, yBackTop + 0.005], // back
    [0.62, (yBackTop + yBellyBot) / 2 - 0.003], // tail-base top
    [0.72, yTailTip], // tail tip
    [0.62, (yBackTop + yBellyBot) / 2 + 0.015], // tail-base bot
    [0.50, yBellyBot], // belly back
    [0.40, yBellyBot + 0.005], // belly middle
    [0.32, yBellyBot - 0.005], // chin
  ];
}

/** Per-frame collision polygons in normalized (0..1) coordinates,
 *  rendered orientation (head on LEFT). 22 entries for the 22
 *  populated slots on the 5×5 sheet. Y anchors were measured from
 *  each frame's orange/brown body region — wings (teal) are excluded
 *  so a wing-tip graze doesn't kill the player. */
export const PTERODACTYL_COLLISION: ReadonlyArray<ReadonlyArray<NormalizedPoint>> = [
  // Row 0 — wings level, body sits roughly centred (~y=0.60) with a
  // ~0.13 vertical span.
  buildBody(0.54, 0.67, 0.59, 0.605), // 0
  buildBody(0.54, 0.67, 0.59, 0.605), // 1
  buildBody(0.55, 0.68, 0.60, 0.615), // 2
  buildBody(0.56, 0.70, 0.62, 0.625), // 3
  buildBody(0.57, 0.72, 0.63, 0.635), // 4
  // Row 1 — wings swoop down, body rides near the top of the bbox.
  buildBody(0.51, 0.64, 0.56, 0.575), // 5
  buildBody(0.50, 0.63, 0.555, 0.565), // 6
  buildBody(0.49, 0.62, 0.545, 0.555), // 7
  buildBody(0.49, 0.62, 0.545, 0.555), // 8
  buildBody(0.50, 0.63, 0.555, 0.565), // 9
  // Row 2 — wings rising, body drifts toward the lower-middle.
  buildBody(0.57, 0.70, 0.625, 0.64), // 10
  buildBody(0.58, 0.71, 0.635, 0.65), // 11
  buildBody(0.60, 0.73, 0.655, 0.66), // 12
  buildBody(0.62, 0.75, 0.675, 0.67), // 13
  buildBody(0.63, 0.76, 0.685, 0.68), // 14
  // Row 3 — wings way up, body is in the lower third of the frame.
  buildBody(0.64, 0.77, 0.695, 0.69), // 15
  buildBody(0.65, 0.78, 0.705, 0.70), // 16
  buildBody(0.66, 0.79, 0.715, 0.71), // 17
  buildBody(0.65, 0.78, 0.705, 0.70), // 18
  buildBody(0.62, 0.75, 0.675, 0.67), // 19
  // Row 4 — wings back to roughly level; body centred horizontally.
  buildBody(0.49, 0.62, 0.545, 0.555), // 20
  buildBody(0.51, 0.64, 0.565, 0.58), // 21
];

export class Pterodactyl {
  x: number;
  y: number;
  w: number;
  h: number;
  frame: number = 0;
  private _lastAdvance: number = 0;
  img: HTMLImageElement | undefined;
  private _polyCache: Polygon | null = null;

  constructor(private raptor: Raptor) {
    this.img = IMAGES.pterodactylSprite;
    this.h = raptor.h * PTERODACTYL_HEIGHT_SCALE;
    this.w = this.h * (PTERODACTYL_FRAME_W / PTERODACTYL_FRAME_H);
    this.x = state.width;
    this.y = state.ground - this.h - raptor.h * PTERODACTYL_FLIGHT_HEIGHT_RATIO;
    // Randomise entry frame so two back-to-back spawns don't sync their
    // flap cycles — avoids a distracting "two metronomes" read when a
    // debug spawn fires mid-cycle.
    this.frame = Math.floor(Math.random() * PTERODACTYL_FRAMES);
  }

  resize(): void {
    this.h = this.raptor.h * PTERODACTYL_HEIGHT_SCALE;
    this.w = this.h * (PTERODACTYL_FRAME_W / PTERODACTYL_FRAME_H);
    this.y =
      state.ground - this.h - this.raptor.h * PTERODACTYL_FLIGHT_HEIGHT_RATIO;
    this._polyCache = null;
  }

  update(now: number, frameScale = 1): void {
    this.x -=
      state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * frameScale;
    if (now - this._lastAdvance > PTERODACTYL_FRAME_DELAY_MS) {
      this.frame = (this.frame + 1) % PTERODACTYL_FRAMES;
      this._lastAdvance = now;
    }
    this._polyCache = null;
  }

  collisionPolygon(): Polygon {
    if (this._polyCache) return this._polyCache;
    const norm = PTERODACTYL_COLLISION[this.frame] ?? PTERODACTYL_COLLISION[0];
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
    if (!this.img) return;
    const col = this.frame % PTERODACTYL_SHEET_COLS;
    const row = Math.floor(this.frame / PTERODACTYL_SHEET_COLS);
    const srcX = col * PTERODACTYL_FRAME_W;
    const srcY = row * PTERODACTYL_FRAME_H;
    // Source sprites already face right (same direction the raptor
    // runs), so no flip is needed — the pterodactyl reads as hovering
    // in place with its head forward, which matches the raptor's
    // point of view as obstacles scroll past.
    ctx.drawImage(
      this.img,
      srcX,
      srcY,
      PTERODACTYL_FRAME_W,
      PTERODACTYL_FRAME_H,
      Math.round(this.x),
      Math.round(this.y),
      Math.round(this.w),
      Math.round(this.h),
    );
  }
}

export class Pterodactyls {
  pteros: Pterodactyl[] = [];

  constructor(private raptor: Raptor) {}

  /** Called by the cactus spawn path when a replacement roll hits —
   *  see Cactuses.spawn() in src/entities/cactus.ts. Lets the cactus
   *  gap/breather logic stay the source of truth for pacing. */
  spawn(): Pterodactyl {
    const p = new Pterodactyl(this.raptor);
    this.pteros.push(p);
    return p;
  }

  update(now: number, frameScale = 1): void {
    for (const p of this.pteros) p.update(now, frameScale);
    this.pteros = this.pteros.filter((p) => p.x >= -p.w);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pteros) p.draw(ctx);
  }

  resize(): void {
    for (const p of this.pteros) p.resize();
  }

  clear(): void {
    this.pteros = [];
  }
}
