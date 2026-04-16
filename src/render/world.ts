// @ts-nocheck
/*
 * Raptor Runner — dune parallax and procedural background cacti.
 *
 * Rolling sin-wave dune ridges with small decorative cacti that
 * scroll at a parallax rate slower than the gameplay foreground.
 */

import {
  DUNE_BASE_HEIGHT_RATIO,
  DUNE_CACTUS_MIN_HEIGHT_PX,
  DUNE_CACTUS_HEIGHT_RANGE_PX,
  DUNE_CACTUS_MIN_SPACING_PX,
  DUNE_CACTUS_SPACING_RANGE_PX,
} from "../constants";
import { state } from "../state";
import { CACTUS_VARIANTS } from "../cactusVariants";

/** Dune ridge height above ground — gentle rolling sin waves.
 *  Frequencies are relative to viewport width for consistent look. */
export function duneHeight(screenX, offset) {
  const wx = screenX + offset;
  const h = state.height;
  const f = (Math.PI * 2) / (state.width * 2);
  return (
    h * 0.04 * Math.sin(wx * f * 3 + 1.2) +
    h * 0.025 * Math.sin(wx * f * 5 + 0.7) +
    h * 0.015 * Math.sin(wx * f * 8 + 2.1) +
    h * DUNE_BASE_HEIGHT_RATIO
  );
}

/** Spawn a dune cactus at the given world-space x. */
export function spawnDuneCactus(worldX) {
  const variant =
    CACTUS_VARIANTS[Math.floor(Math.random() * CACTUS_VARIANTS.length)];
  const ch = (DUNE_CACTUS_MIN_HEIGHT_PX + Math.random() * DUNE_CACTUS_HEIGHT_RANGE_PX) * variant.heightScale;
  const cw = ch * (variant.w / variant.h);
  return {
    wx: worldX,
    h: ch,
    w: cw,
    key: variant.key,
    struck: false,
    depth: Math.random() < 0.5 ? 1 : 3,
  };
}

export function initDunes() {
  state.duneCacti = [];
  state._nextDuneCactusX = 0;
  let wx = -state.width * 0.5;
  while (wx < state.width * 2) {
    state.duneCacti.push(spawnDuneCactus(wx));
    wx += DUNE_CACTUS_MIN_SPACING_PX + Math.random() * DUNE_CACTUS_SPACING_RANGE_PX;
  }
  state._nextDuneCactusX = wx;
}
