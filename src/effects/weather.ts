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

import {
  RAIN_SPAWN_DENSITY_DIVISOR,
  LIGHTNING_INTENSITY_THRESHOLD,
  LIGHTNING_FLASH_PROBABILITY,
  LIGHTNING_MIN_COOLDOWN_MS,
  LIGHTNING_MAX_COOLDOWN_MS,
  THUNDER_DELAY_MIN_MS,
  THUNDER_DELAY_MAX_MS,
  LIGHTNING_BOLT_MIN_SEGMENTS,
  LIGHTNING_BOLT_MAX_SEGMENTS,
} from "../constants";
import { state } from "../state";
import { audio } from "../audio";
import { duneHeight } from "../render/world";

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


// ══════════════════════════════════════════════════════════════════
// Lightning
// ══════════════════════════════════════════════════════════════════

export function updateLightning(frameScale: number, now: number) {
  if (state.lightning.alpha > 0) {
    state.lightning.alpha = Math.max(
      0,
      state.lightning.alpha - 0.015 * frameScale,
    );
  }
  // Random chance for new flash — only at full intensity, not during transitions
  if (
    state.rainIntensity > LIGHTNING_INTENSITY_THRESHOLD &&
    now > state.lightning.nextAt &&
    Math.random() < LIGHTNING_FLASH_PROBABILITY * frameScale
  ) {
    state.lightning.alpha = 0.7 + Math.random() * 0.2;
    state.lightning.nextAt = now + LIGHTNING_MIN_COOLDOWN_MS + Math.random() * (LIGHTNING_MAX_COOLDOWN_MS - LIGHTNING_MIN_COOLDOWN_MS);
    // Generate a jagged bolt path — preferring cacti as targets
    const result = _generateBoltPath();
    state.lightning.bolt = result.path;
    // If the bolt struck a cactus, blacken it
    // Blacken the struck dune cactus (they scroll slowly enough
    // for the visual to read).
    if (result.struckDuneCactus) {
      result.struckDuneCactus.struck = true;
      result.struckDuneCactus.struckAge = 0;
    }
    // Delay thunder after the flash — random 0.1–0.6s simulating
    // varying strike distances (~35–200m away).
    const thunderDelay = THUNDER_DELAY_MIN_MS + Math.random() * (THUNDER_DELAY_MAX_MS - THUNDER_DELAY_MIN_MS);
    setTimeout(() => audio.playThunder(), thunderDelay);
    if (!audio.muted && navigator.vibrate) navigator.vibrate(30);
    // Gamepad rumble — medium rumble for thunder.
    try {
      const gp = navigator.getGamepads?.()[0];
      if (gp?.vibrationActuator) {
        gp.vibrationActuator.playEffect("dual-rumble", {
          duration: 80,
          weakMagnitude: 0.5,
          strongMagnitude: 0.3,
        });
      }
    } catch (_) {}
  }
}

export function _generateBoltPath() {
  // Always target a visible dune cactus if one exists.
  let targetX;
  let struckDuneCactus = null;
  const off = state.duneOffset || 0;
  const visibleDuneCacti = (state.duneCacti || []).filter((dc) => {
    const sx = dc.wx - off;
    return sx > 20 && sx < state.width - 20 && !dc.struck;
  });
  if (visibleDuneCacti.length > 0) {
    const dc =
      visibleDuneCacti[Math.floor(Math.random() * visibleDuneCacti.length)];
    targetX = dc.wx - off;
    struckDuneCactus = dc;
  } else {
    targetX = state.width * (0.35 + Math.random() * 0.55);
  }
  // If targeting a dune cactus, end at the cactus top; otherwise ground.
  const endY = struckDuneCactus
    ? state.ground -
      duneHeight(targetX, state.duneOffset) -
      struckDuneCactus.h * 0.85
    : state.ground;
  const startX = targetX + (Math.random() - 0.5) * state.width * 0.15;
  const segments = LIGHTNING_BOLT_MIN_SEGMENTS + Math.floor(Math.random() * (LIGHTNING_BOLT_MAX_SEGMENTS - LIGHTNING_BOLT_MIN_SEGMENTS + 1));
  const points: {x: number; y: number; branch?: {x:number;y:number}[]}[] = [{ x: startX, y: -10 }];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const isLast = i === segments;
    // Converge toward targetX; final point lands exactly on target
    const baseX = startX + (targetX - startX) * t;
    const jitter = isLast
      ? 0
      : (Math.random() - 0.5) * state.width * 0.08 * (1 - t);
    const x = baseX + jitter;
    const y = isLast ? endY : Math.min(t * endY, endY);
    points.push({ x, y });
    // 35% chance of a branch
    if (i > 2 && i < segments - 1 && Math.random() < 0.35) {
      const branchLen = 2 + Math.floor(Math.random() * 4);
      const branch = [];
      let bx = x,
        by = y;
      const dir = Math.random() < 0.5 ? -1 : 1;
      for (let j = 0; j < branchLen; j++) {
        bx += dir * (15 + Math.random() * 30);
        by += 10 + Math.random() * 25;
        if (by > endY) by = endY; // clamp to ground
        branch.push({ x: bx, y: by });
      }
      points[points.length - 1].branch = branch;
    }
  }
  return { path: points, struckDuneCactus };
}

export function _drawBolt(ctx: CanvasRenderingContext2D, points: any[], lineWidth: number, alpha: number) {
  ctx.save();
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = `rgba(180, 200, 255, ${alpha * 0.8})`;
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  // Draw branches
  for (const p of points) {
    if (p.branch) {
      ctx.beginPath();
      ctx.lineWidth = lineWidth * 0.5;
      ctx.moveTo(p.x, p.y);
      for (const bp of p.branch) ctx.lineTo(bp.x, bp.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawLightning(ctx: CanvasRenderingContext2D) {
  if (state.lightning.alpha <= 0) return;
  // White flash overlay (dims faster than bolt)
  const flashAlpha = Math.max(0, state.lightning.alpha - 0.3) * 0.5;
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
    ctx.fillRect(0, 0, state.width, state.height);
  }
  // Draw the bolt arc
  if (state.lightning.bolt) {
    _drawBolt(ctx, state.lightning.bolt, 3, state.lightning.alpha);
    // Draw a second thinner bright core
    _drawBolt(
      ctx,
      state.lightning.bolt,
      1.2,
      Math.min(1, state.lightning.alpha * 1.5),
    );
  }
}
