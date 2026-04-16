/*
 * Raptor Runner — sky rendering.
 *
 * Day/night cycle detection, sun/moon arc computation and drawing,
 * sky gradient painting, and the foreground tint factor that applies
 * a sky-color wash over the foreground canvas.
 */

import {
  SKY_COLORS,
  NIGHT_COLOR,
  SUN_PHASE_CENTER,
  MOON_PHASE_CENTER,
  CELESTIAL_ARC_HALF_WIDTH,
  CELESTIAL_ARC_EXTENSION,
  CELESTIAL_ARC_HEIGHT_RATIO,
  SUN_MIN_RADIUS_PX,
  SUN_RADIUS_SCALE,
  MOON_MIN_RADIUS_PX,
  MOON_RADIUS_SCALE,
} from "../constants";
import { state } from "../state";
import { contexts } from "../canvas";
import { rgb, rgba, lerpColor } from "../helpers";

// ── Night detection (derived from SKY_COLORS) ───────────────

export const _isNightBand = SKY_COLORS.map(
  (c) =>
    c[0] === NIGHT_COLOR[0] &&
    c[1] === NIGHT_COLOR[1] &&
    c[2] === NIGHT_COLOR[2],
);

/** True when bandIndex (+ fractional bandT) is in the dark zone:
 *  solid-night bands, plus the dark half of each adjacent twilight. */
export function isNightPhase(bandIndex: number, bandT: number) {
  if (_isNightBand[bandIndex]) return true;
  const next = (bandIndex + 1) % SKY_COLORS.length;
  if (_isNightBand[next] && bandT > 0.5) return true;
  const prev = (bandIndex - 1 + SKY_COLORS.length) % SKY_COLORS.length;
  if (_isNightBand[prev] && bandT < 0.5) return true;
  return false;
}

// Daytime band indices (for night-survival tracking).
export const _isDayBand = _isNightBand.map((night, i) => {
  if (night) return false;
  const prev = (i - 1 + SKY_COLORS.length) % SKY_COLORS.length;
  const next = (i + 1) % SKY_COLORS.length;
  return !_isNightBand[prev] && !_isNightBand[next];
});

// ── Tint factor ─────────────────────────────────────────────

/** Strength of the foreground sky-light tint. Quadratic ramp so
 *  twilight stays subtle and night reaches ~2/3 of full strength. */
export function tintStrength() {
  const sky = state.currentSky;
  const dayBlue = SKY_COLORS[0];
  const dx = sky[0] - dayBlue[0];
  const dy = sky[1] - dayBlue[1];
  const dz = sky[2] - dayBlue[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const t = Math.min(1, distance / 250);
  return 0.05 + t * t * 0.32;
}

/** Per-channel multiply factor that the global tint applies. */
export function tintFactor() {
  const sky = state.currentSky;
  const s = tintStrength();
  return [
    255 + (sky[0] - 255) * s,
    255 + (sky[1] - 255) * s,
    255 + (sky[2] - 255) * s,
  ];
}

// ── Celestial arc ───────────────────────────────────────────

/**
 * Returns {visible, x, y, t} for a celestial body whose visible arc
 * is centered on cycle `phaseCenter` and lasts half a cycle.
 */
export function celestialArc(phaseCenter: number, halfWidth: number) {
  let rel = (((state.smoothPhase % 1) + 1) % 1) - phaseCenter;
  if (rel > 0.5) rel -= 1;
  if (rel < -0.5) rel += 1;
  const extension = halfWidth * CELESTIAL_ARC_EXTENSION;
  if (rel < -halfWidth - extension || rel > halfWidth + extension) {
    return { visible: false, x: 0, y: 0, t: 0, alpha: 0 };
  }
  const t = (rel + halfWidth) / (halfWidth * 2);
  const x = state.width * (1 - t);
  const arcH = state.height * CELESTIAL_ARC_HEIGHT_RATIO;
  const y = state.ground - 4 * arcH * t * (1 - t);
  return { visible: true, x, y, t, alpha: 1 };
}

// ── Draw sun ────────────────────────────────────────────────

export function drawSun(ctx: CanvasRenderingContext2D) {
  const arc = celestialArc(SUN_PHASE_CENTER, CELESTIAL_ARC_HALF_WIDTH);
  if (!arc.visible) return;
  const r = Math.max(SUN_MIN_RADIUS_PX, state.width * SUN_RADIUS_SCALE);
  const elevation = Math.max(0, 1 - Math.pow(Math.abs(arc.t - 0.5) * 2, 4));
  const cZenith: [number,number,number] = [255, 250, 235];
  const cMid: [number,number,number] = [255, 200, 110];
  const cHorizon: [number,number,number] = [220, 60, 25];
  let core: [number,number,number], halo: [number,number,number];
  if (elevation > 0.5) {
    const k = (elevation - 0.5) * 2;
    core = lerpColor(cMid, cZenith, k) as [number,number,number];
    halo = lerpColor([255, 180, 100] as [number,number,number], [255, 230, 170] as [number,number,number], k) as [number,number,number];
  } else {
    const k = elevation * 2;
    core = lerpColor(cHorizon, cMid, k) as [number,number,number];
    halo = lerpColor([225, 70, 30] as [number,number,number], [255, 180, 100] as [number,number,number], k) as [number,number,number];
  }

  ctx.save();
  const ri = state.rainIntensity;
  if (ri > 0.05) {
    const haloR = r * 3;
    const ha = 0.18 * ri;
    const glow = ctx.createRadialGradient(arc.x, arc.y, r * 0.5, arc.x, arc.y, haloR);
    glow.addColorStop(0, `rgba(255, 240, 200, ${ha})`);
    glow.addColorStop(0.5, `rgba(255, 230, 180, ${ha * 0.45})`);
    glow.addColorStop(1, `rgba(255, 220, 160, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, haloR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.2 + 0.8 * (1 - ri);
    ctx.fillStyle = rgb(core);
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = rgb(core);
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Draw moon ───────────────────────────────────────────────

export function drawMoon(ctx: CanvasRenderingContext2D) {
  const arc = celestialArc(MOON_PHASE_CENTER, CELESTIAL_ARC_HALF_WIDTH);
  if (!arc.visible) return;
  const r = Math.max(MOON_MIN_RADIUS_PX, state.width * MOON_RADIUS_SCALE);
  const core: [number,number,number] = [250, 250, 252];
  const halo: [number,number,number] = [220, 230, 250];
  const shadow = [
    Math.round(state.currentSky[0] * 0.5),
    Math.round(state.currentSky[1] * 0.5),
    Math.round(state.currentSky[2] * 0.5),
  ];

  ctx.save();
  ctx.globalAlpha = arc.alpha * (0.2 + 0.8 * (1 - state.rainIntensity));
  // Halo
  const glow = ctx.createRadialGradient(arc.x, arc.y, r * 0.3, arc.x, arc.y, r * 2.6);
  glow.addColorStop(0, rgba(halo, 0.45));
  glow.addColorStop(0.5, rgba(halo, 0.14));
  glow.addColorStop(1, rgba(halo, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(arc.x, arc.y, r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  // Disc
  ctx.fillStyle = rgb(core);
  ctx.beginPath();
  ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
  ctx.fill();
  // Craters
  ctx.save();
  ctx.beginPath();
  ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = `rgba(200, 200, 210, 0.15)`;
  const craters = [
    { dx: -0.25, dy: -0.3, cr: 0.18 },
    { dx: 0.3, dy: 0.15, cr: 0.22 },
    { dx: -0.1, dy: 0.35, cr: 0.14 },
    { dx: 0.15, dy: -0.2, cr: 0.1 },
    { dx: -0.35, dy: 0.1, cr: 0.12 },
    { dx: 0.05, dy: 0.05, cr: 0.08 },
  ];
  for (const c of craters) {
    ctx.beginPath();
    ctx.arc(arc.x + c.dx * r, arc.y + c.dy * r, c.cr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Moon phase terminator
  ctx.save();
  ctx.beginPath();
  ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
  ctx.clip();
  const ph = state.moonPhase;
  const illum = (1 - Math.cos(ph * Math.PI * 2)) / 2;
  if (illum < 0.98) {
    const terminatorX = r * Math.cos(illum * Math.PI);
    const waxing = ph < 0.5;
    ctx.fillStyle = rgba(shadow as [number,number,number], 0.8);
    ctx.beginPath();
    if (waxing) {
      ctx.arc(arc.x, arc.y, r, Math.PI * 0.5, Math.PI * 1.5);
    } else {
      ctx.arc(arc.x, arc.y, r, -Math.PI * 0.5, Math.PI * 0.5);
    }
    ctx.ellipse(
      arc.x, arc.y,
      Math.abs(terminatorX), r, 0,
      waxing ? -Math.PI * 0.5 : Math.PI * 0.5,
      waxing ? Math.PI * 0.5 : -Math.PI * 0.5,
      waxing ? terminatorX > 0 : terminatorX < 0,
    );
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

// ── Sky gradient ────────────────────────────────────────────

export function computeSkyGradient() {
  const skyCanvas = contexts.skyCanvas;
  const skyCtx = contexts.sky;
  if (!skyCanvas || !skyCtx) return;
  const w = state.width;
  const h = state.height;
  if (skyCanvas.width !== w) skyCanvas.width = w;
  if (skyCanvas.height !== h) skyCanvas.height = h;
  const sky = state.currentSky;
  const horizonR = Math.round(sky[0] + (255 - sky[0]) * 0.45);
  const horizonG = Math.round(sky[1] + (255 - sky[1]) * 0.45);
  const horizonB = Math.round(sky[2] + (255 - sky[2]) * 0.45);
  const grad = skyCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, rgb(sky as [number,number,number]));
  grad.addColorStop(1, `rgb(${horizonR}, ${horizonG}, ${horizonB})`);
  skyCtx.fillStyle = grad;
  skyCtx.fillRect(0, 0, w, h);
}
