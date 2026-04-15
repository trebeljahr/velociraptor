/*
 * Raptor Runner — weather particle system.
 *
 * Currently scoped to the rain layer: deterministic per-cycle rain
 * scheduling, multi-depth rain-drop spawning, update + draw.
 *
 * Lightning (bolt generation, flash overlay) and rainbow (post-storm
 * spawn + draw) still live in src/main.ts because they couple back
 * into dune-cactus world-rendering and into the achievements system
 * through `unlockAchievement("rainbow")`. Both will migrate here
 * once the sky/world render code splits out and the achievement
 * unlock function itself moves into src/achievements.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { RAIN_SPAWN_DENSITY_DIVISOR } from "../constants";
import { state } from "../state";

/**
 * Deterministic rain check: within each block of 10 cycles, exactly
 * 1 cycle is rainy. Every 50th is guaranteed rainy.
 *
 * The "block" derivation means the pattern is stable across reloads
 * once a given cycle index is reached — no RNG fork, no save-file
 * fiddling to force rain, just predictable weather as a function of
 * the total day-night cycle counter.
 */
export function shouldRainForCycle(cycleIndex: number): boolean {
  if (cycleIndex % 50 === 0 && cycleIndex > 0) return true;
  const block = Math.floor(cycleIndex / 10);
  // Simple hash to pick which cycle in the block rains
  const rainSlot = (block * 7 + 3) % 10;
  return cycleIndex % 10 === rainSlot;
}

/**
 * Spawn new rain particles for this frame. Density scales with
 * `frameScale` so the visual rate stays constant regardless of
 * actual frame rate. Each drop picks one of three depth layers
 * (far / mid / near) for parallax: farther drops are shorter,
 * fainter, and fall slower; nearer drops are longer, brighter,
 * and fall faster.
 */
export function spawnRain(frameScale: number): void {
  const count = Math.ceil(
    (state.width / RAIN_SPAWN_DENSITY_DIVISOR) *
      frameScale *
      state.rainIntensity,
  );
  for (let i = 0; i < count; i++) {
    const layer = Math.random();
    let len: number;
    let opacity: number;
    let vy: number;
    let vx: number;
    let lw: number;
    if (layer < 0.3) {
      // Far — small, faint, slow
      len = 5 + Math.random() * 3;
      opacity = 0.08 + Math.random() * 0.1;
      vy = 400 + Math.random() * 100;
      vx = -40 - Math.random() * 20;
      lw = 0.6;
    } else if (layer < 0.7) {
      // Mid — medium
      len = 10 + Math.random() * 5;
      opacity = 0.18 + Math.random() * 0.12;
      vy = 600 + Math.random() * 200;
      vx = -60 - Math.random() * 30;
      lw = 1.0;
    } else {
      // Near — large, bright, fast
      len = 15 + Math.random() * 10;
      opacity = 0.3 + Math.random() * 0.2;
      vy = 800 + Math.random() * 300;
      vx = -80 - Math.random() * 40;
      lw = 1.8;
    }
    state.rainParticles.push({
      x: Math.random() * (state.width + 100) - 50,
      y: -10 - Math.random() * 30,
      vx,
      vy,
      len,
      opacity,
      lw,
    });
  }
}

export function updateRain(dtSec: number): void {
  if (state.rainParticles.length === 0) return;
  let expired = 0;
  for (const p of state.rainParticles) {
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    if (p.y > state.ground) {
      p.dead = true;
      expired++;
    }
  }
  if (expired > 0) {
    state.rainParticles = state.rainParticles.filter((p: any) => !p.dead);
  }
}

export function drawRain(ctx: CanvasRenderingContext2D): void {
  if (state.rainParticles.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  const gnd = state.ground;
  for (const p of state.rainParticles) {
    ctx.lineWidth = p.lw || 1;
    ctx.strokeStyle = `rgba(180, 210, 240, ${p.opacity})`;
    ctx.beginPath();
    const angle = Math.atan2(p.vy, p.vx);
    let endX = p.x + Math.cos(angle) * p.len;
    let endY = p.y + Math.sin(angle) * p.len;
    // Clip streak at ground level
    if (endY > gnd) {
      const t = (gnd - p.y) / (endY - p.y);
      endX = p.x + (endX - p.x) * t;
      endY = gnd;
    }
    if (p.y < gnd) {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
  }
  ctx.restore();
}
