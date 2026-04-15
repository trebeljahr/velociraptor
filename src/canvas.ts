/*
 * Raptor Runner — canvas context holder.
 *
 * Holds references to the four canvases and their 2D contexts that
 * the game draws into:
 *   • main:  the visible <canvas id="game-canvas"> element (sky,
 *            sun/moon, stars, composited foreground)
 *   • sky:   offscreen canvas for the sky gradient + celestial bodies
 *   • fg:    offscreen canvas for the foreground (clouds, ground,
 *            cacti, raptor) that gets sky-light tinted before
 *            composite
 *   • death: offscreen snapshot of the frame the player died in,
 *            used as the background for the shareable score card
 *
 * The exported `contexts` object is mutable and populated by
 * `initCanvas()` during game init. Until then, every field is null
 * and any attempt to draw will throw — catching the "drew before
 * init" bug loudly at the call site.
 *
 * This pattern keeps canvas.ts a pure data module: no state imports,
 * no side effects at import time, no type tangles with the render
 * code that still lives in main.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GameContexts {
  mainCanvas: HTMLCanvasElement | null;
  main: CanvasRenderingContext2D | null;
  skyCanvas: HTMLCanvasElement | null;
  sky: CanvasRenderingContext2D | null;
  fgCanvas: HTMLCanvasElement | null;
  fg: CanvasRenderingContext2D | null;
  deathCanvas: HTMLCanvasElement | null;
  death: CanvasRenderingContext2D | null;
}

/** The canonical canvas + context bag. Populated by initCanvas(). */
export const contexts: GameContexts = {
  mainCanvas: null,
  main: null,
  skyCanvas: null,
  sky: null,
  fgCanvas: null,
  fg: null,
  deathCanvas: null,
  death: null,
};

/** Populate `contexts` from the main game-canvas element. Must be
 *  called once during init() before any render code runs.
 *
 *  Returns `false` and leaves `contexts` untouched if the DOM lookup
 *  fails (e.g. in a test harness without the game shell present). */
export function initCanvas(gameCanvasId: string): boolean {
  const main = document.getElementById(gameCanvasId) as HTMLCanvasElement | null;
  if (!main) {
    console.error(`${gameCanvasId} element not found`);
    return false;
  }
  contexts.mainCanvas = main;
  contexts.main = main.getContext("2d");

  contexts.skyCanvas = document.createElement("canvas");
  contexts.sky = contexts.skyCanvas.getContext("2d");

  contexts.fgCanvas = document.createElement("canvas");
  contexts.fg = contexts.fgCanvas.getContext("2d");

  contexts.deathCanvas = document.createElement("canvas");
  contexts.death = contexts.deathCanvas.getContext("2d");

  return true;
}
