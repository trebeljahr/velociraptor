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
 *   • duneHeightAt(x, off)    — pure function that returns the dune
 *                               height at a given screen x and offset.
 *                               Currently owned by render/world code.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { state } from "../state";
import { saveRareEventsSeen } from "../persistence";

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
  if (e.age >= e.life) state.activeRareEvent = null;
}
