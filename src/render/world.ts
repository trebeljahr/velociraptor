/*
 * Raptor Runner — dune parallax and procedural background cacti.
 *
 * Rolling sin-wave dune ridges with small decorative cacti that
 * scroll at a parallax rate slower than the gameplay foreground.
 */

import { CACTUS_VARIANTS } from "../cactusVariants";
import {
  DUNE_BASE_HEIGHT_RATIO,
  DUNE_CACTUS_HEIGHT_RANGE_PX,
  DUNE_CACTUS_MIN_HEIGHT_PX,
  DUNE_CACTUS_MIN_SPACING_PX,
  DUNE_CACTUS_SPACING_RANGE_PX,
} from "../constants";
import { state } from "../state";

/** Dune ridge height above ground — gentle rolling sin waves.
 *  Frequencies are relative to viewport width for consistent look. */
export function duneHeight(screenX: number, offset: number) {
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
export function spawnDuneCactus(worldX: number) {
  const variant = CACTUS_VARIANTS[Math.floor(Math.random() * CACTUS_VARIANTS.length)];
  const ch =
    (DUNE_CACTUS_MIN_HEIGHT_PX + Math.random() * DUNE_CACTUS_HEIGHT_RANGE_PX) * variant.heightScale;
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
  // Spawn range must be anchored to the CURRENT duneOffset, not the
  // absolute world origin. `duneOffset` is never reset — it keeps
  // growing across runs so the dune silhouette remains continuous.
  // Rendering draws a cactus at screen x = wx - duneOffset, so a
  // fresh cactus at absolute wx=0 on a run that starts with
  // duneOffset=50000 ends up at screen x=-50000 (far off-screen),
  // leaving the background empty while the update-loop spawner
  // slowly catches up at one cactus per frame. That's the
  // "cacti pop into existence" effect — when the spawner finally
  // reaches the real right edge, cacti start materialising there
  // instead of having been there from frame zero.
  //
  // Re-anchoring to duneOffset guarantees the first render of a
  // new run has cacti in their correct screen positions.
  state.duneCacti = [];
  const base = state.duneOffset;
  let wx = base - state.width * 0.5;
  while (wx < base + state.width * 2) {
    state.duneCacti.push(spawnDuneCactus(wx));
    wx += DUNE_CACTUS_MIN_SPACING_PX + Math.random() * DUNE_CACTUS_SPACING_RANGE_PX;
  }
  state._nextDuneCactusX = wx;
}
