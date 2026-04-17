/*
 * Raptor Runner — rare background events (easter eggs).
 *
 * Five one-shot visual events (UFO, Santa, tumbleweed, comet, meteor)
 * that roll against the per-event average interval every time the
 * raptor jumps. Each event type can only be active once at a time.
 *
 * The catalog (interval, time-of-day condition, lifetime) and the
 * spawn/update logic live here. The drawing functions stay in main.ts
 * for now because drawRareEvent is a ~450-line wall of canvas drawing
 * that will move out cleanly once the sky/world render modules split.
 *
 * Two couplings back to the main loop are passed in via setters so
 * this module has no bare references:
 *   • onAchievementUnlock(id) — fires the per-event achievement on
 *                               first sighting
 *   • duneHeightAt(x: number, off)    — pure function that returns the dune
 *                               height at a given screen x and offset.
 *                               Currently owned by render/world code.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { state } from "../state";
import { saveRareEventsSeen } from "../persistence";
import { IMAGES } from "../images";
import { audio } from "../audio";

// ══════════════════════════════════════════════════════════════════
// Couplings (wired from main.ts's init)
// ══════════════════════════════════════════════════════════════════

type AchievementCallback = (id: string) => void;
type DuneHeightProvider = (screenX: number, offset: number) => number;

let onAchievementUnlock: AchievementCallback | null = null;
let duneHeightAt: DuneHeightProvider = () => 0;

/** Register the achievement-unlock hook. Called once during init. */
export function setRareEventsAchievementHandler(
  cb: AchievementCallback | null,
): void {
  onAchievementUnlock = cb;
}

/** Register the dune-height lookup function (currently owned by
 *  render/world code in main.ts). Must be wired before the first
 *  frame — tumbleweed/UFO/meteor positioning reads it. */
export function setDuneHeightProvider(fn: DuneHeightProvider): void {
  duneHeightAt = fn;
}

// ══════════════════════════════════════════════════════════════════
// Catalog
// ══════════════════════════════════════════════════════════════════

interface RareEventDefinition {
  id: string;
  achievement: string;
  avgInterval: number;
  condition: () => boolean;
  duration: number;
}

export const RARE_EVENTS: ReadonlyArray<RareEventDefinition> = [
  {
    id: "ufo",
    achievement: "ufo-sighting",
    avgInterval: 400,
    condition: () => !state.isRaining && state.rainIntensity < 0.1,
    duration: 20,
  },
  {
    id: "santa",
    achievement: "santa-spotted",
    avgInterval: 500,
    condition: () => state.isNight && state.rainIntensity < 0.1,
    duration: 6,
  },
  {
    id: "tumbleweed",
    achievement: "tumbleweed",
    avgInterval: 300,
    condition: () => !state.isNight && state.rainIntensity < 0.1,
    duration: 25,
  },
  {
    id: "comet",
    achievement: "comet",
    avgInterval: 600,
    condition: () => state.isNight && state.rainIntensity < 0.1,
    duration: 8,
  },
  {
    id: "meteor",
    achievement: "meteor-impact",
    avgInterval: 500,
    condition: () => state.isNight && state.rainIntensity < 0.1,
    duration: 5,
  },
];

// ══════════════════════════════════════════════════════════════════
// Spawn
// ══════════════════════════════════════════════════════════════════

/**
 * Check whether to trigger a rare event on this jump. Called from
 * the Raptor entity's `onJump` callback wired in main.ts's init.
 *
 * One event at a time. Unseen events are preferred over repeats.
 * On "shooting-star nights" (night + at least one full cycle behind
 * us), only comet and meteor are eligible so the sky stays sparse.
 */
export function maybeSpawnRareEvent(): void {
  if (state.activeRareEvent) return; // one at a time
  // Build candidate list: prefer unseen events, then allow repeats.
  // On shooting star nights (phase >= 1, night), only comet/meteor
  // are allowed.
  const shootingStarNight =
    state.isNight && Math.floor(state.smoothPhase) >= 1;
  const eligible = RARE_EVENTS.filter(
    (e) =>
      e.avgInterval > 0 &&
      e.condition() &&
      (!shootingStarNight || e.id === "comet" || e.id === "meteor"),
  );
  if (eligible.length === 0) return;
  const unseen = eligible.filter((e) => !state._rareEventsSeen[e.id]);
  const pool = unseen.length > 0 ? unseen : eligible;
  // Single roll against the average interval of a random candidate
  const evt = pool[Math.floor(Math.random() * pool.length)];
  if (Math.random() >= 1 / evt.avgInterval) return;
  state.activeRareEvent = {
    id: evt.id,
    age: 0,
    life: evt.duration,
    x: state.width + 50,
    y: state.height * (0.1 + Math.random() * 0.3),
  };
  // Fire the per-event SFX. The audio module respects the SFX mute
  // channel, so this is a no-op when the user has SFX off.
  if (evt.id === "ufo") audio.playUfo();
  else if (evt.id === "santa") audio.playSanta();
  else if (evt.id === "comet") audio.playComet();
  // Unlock achievement on first sighting
  if (!state._rareEventsSeen[evt.id]) {
    state._rareEventsSeen[evt.id] = 1;
    saveRareEventsSeen(state._rareEventsSeen);
    if (onAchievementUnlock) onAchievementUnlock(evt.achievement);
  }
}

// ══════════════════════════════════════════════════════════════════
// Update
// ══════════════════════════════════════════════════════════════════

export function updateRareEvent(dtSec: number): void {
  if (!state.activeRareEvent) return;
  const e = state.activeRareEvent;
  e.age += dtSec;
  // Move event across the screen (right to left for most)
  if (e.id === "tumbleweed") {
    // Tumbleweed rolls left along the dune surface, bouncing above it
    e.x -= state.width * 0.06 * dtSec; // gentle roll, crosses screen in ~18s
    const duneY = state.ground - duneHeightAt(e.x, state.duneOffset);
    const bounce = Math.abs(Math.sin(e.age * 3.5)) * 12;
    e.y = duneY - 10 - bounce;
    // End when fully off-screen left
    if (e.x < -30) e.age = e.life;
    e.rot = (e.rot || 0) - dtSec * 4; // counter-clockwise (rolling left)
  } else if (e.id === "ufo") {
    const t = e.age / e.life;
    const hoverX = state.width * 0.6;
    const hoverY = state.height * 0.35;
    if (t < 0.08) {
      // Phase 1: Fast descent
      e.x = hoverX;
      e.y = -30 + (t / 0.08) * (hoverY + 30);
      e.beam = false;
      e.phase = "descend";
    } else if (!e.targetCactus) {
      // Phase 2: Hover + beam on — wait for a cactus to scroll into
      // the beam.
      e.x = hoverX + Math.sin(e.age * 2) * 10;
      e.y = hoverY + Math.sin(e.age * 3) * 5;
      e.beam = true;
      e.phase = "search";
      // Check if any cactus is under the beam footprint (e.x ± 30)
      const duneCacti = (state as any).duneCacti;
      if (duneCacti) {
        const off = state.duneOffset;
        for (const dc of duneCacti) {
          if (dc.dead || dc.struck) continue;
          const sx = dc.wx - off;
          if (sx > e.x - 28 && sx < e.x + 28) {
            e.targetCactus = dc;
            e.abductStartAge = e.age;
            // Store position and hide original immediately
            e.abductSx = sx;
            e.abductDuneY = state.ground - duneHeightAt(sx, state.duneOffset);
            dc.dead = true;
            break;
          }
        }
      }
    } else if (e.cactusLift == null || e.cactusLift < 1) {
      // Phase 3: Beam up the cactus
      e.x = hoverX + Math.sin(e.age * 2) * 5;
      e.y = hoverY + Math.sin(e.age * 3) * 3;
      e.beam = true;
      e.phase = "abduct";
      const liftTime = 3; // seconds to beam up
      const elapsed = e.age - (e.abductStartAge || e.age);
      e.cactusLift = Math.min(1, elapsed / liftTime);
    } else if (!e._absorbed) {
      // Phase 4: Cactus absorbed, brief pause
      e.beam = false;
      e.phase = "absorbed";
      e.x = hoverX;
      e.y = hoverY;
      // Cactus already marked dead when grabbed
      e._absorbed = true;
      e._absorbedAt = e.age;
    } else {
      // Phase 5: Fly away upward-right after a brief pause
      const pauseTime = 0.5;
      const flyElapsed = e.age - (e._absorbedAt || e.age) - pauseTime;
      if (flyElapsed < 0) {
        e.x = hoverX;
        e.y = hoverY;
      } else {
        e.beam = false;
        e.phase = "flyaway";
        e.x = hoverX + flyElapsed * state.width * 0.15;
        e.y = hoverY - flyElapsed * state.height * 0.15;
        if (e.y < -60 || e.x > state.width + 60) e.age = e.life;
      }
    }
  } else if (e.id === "santa") {
    // Santa flies across the night sky left to right
    e.x = -50 + (e.age / e.life) * (state.width + 100);
    e.y = state.height * 0.12 + Math.sin(e.age * 1.5) * 8;
  } else if (e.id === "comet") {
    // Slow arc across night sky — enters right, exits left
    const ct = e.age / e.life;
    e.x = state.width * 1.3 - ct * state.width * 1.6;
    e.y = state.height * 0.05 + ct * state.height * 0.25;
  } else if (e.id === "meteor") {
    // Streak from upper-right to a specific impact point on/behind
    // the dune band.
    if (!e.startX) {
      e.startX = state.width * (0.7 + Math.random() * 0.3);
      e.startY = -10;
      e.targetX = state.width * (0.3 + Math.random() * 0.4);
      e.targetY =
        state.ground - duneHeightAt(e.targetX, state.duneOffset) + 3;
    }
    const mt = e.age / e.life;
    const flightT = 0.5; // first 50% is the streak, rest is impact
    if (mt < flightT) {
      const ft = mt / flightT;
      e.x = e.startX + (e.targetX - e.startX) * ft;
      e.y = e.startY + (e.targetY - e.startY) * ft;
      e.vx = (e.targetX - e.startX) / (e.life * flightT);
      e.vy = (e.targetY - e.startY) / (e.life * flightT);
    } else {
      // First frame past the flight phase — fire the explosion cue
      // exactly once per meteor, on the transition into impact.
      if (!e.impact) audio.playMeteor();
      e.impact = true;
      e.impactX = e.impactX || e.targetX;
      // Recalculate impact Y from current dune position (dunes
      // scroll).
      e.impactY =
        e.impactY ||
        state.ground -
          duneHeightAt(e.impactX || e.targetX, state.duneOffset) +
          3;
    }
  }
  if (e.age >= e.life) {
    // Fade out any rare-event audio that plays for the whole event
    // window. UFO's ~12s sample is shorter than the ~20s event so
    // this is just a safety net there; santa's loop needs the
    // explicit stop + fade-out as it approaches the far edge.
    if (e.id === "ufo") audio.stopUfo();
    else if (e.id === "santa") audio.stopSanta();
    state.activeRareEvent = null;
  }
}


// ══════════════════════════════════════════════════════════════════
// Drawing
// ══════════════════════════════════════════════════════════════════

/** Draw sky-layer rare events (comet, meteor) — on main canvas, no tint. */
export function drawRareEventSky(ctx: CanvasRenderingContext2D) {
  if (!state.activeRareEvent) return;
  const e = state.activeRareEvent;
  if (e.id !== "comet" && e.id !== "meteor") return;
  drawRareEvent(ctx);
}

/** Draw foreground rare events (UFO, Santa, tumbleweed) — on fgCtx, gets tint. */
/** Draw the UFO beam on the background canvas so dunes paint over it. */
export function drawUfoBeam(ctx: CanvasRenderingContext2D) {
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

export function drawRareEventFg(ctx: CanvasRenderingContext2D) {
  if (!state.activeRareEvent) return;
  const e = state.activeRareEvent;
  // Comet/meteor on sky canvas, tumbleweed in dune layer
  if (e.id === "comet" || e.id === "meteor" || e.id === "tumbleweed") return;
  drawRareEvent(ctx);
}

export function drawRareEvent(ctx: CanvasRenderingContext2D) {
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
    const _ct = (c0: string, c1: string, c2: string, w: number, x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
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
