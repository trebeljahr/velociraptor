/*
 * Raptor Runner — cactus sprite + collision catalog.
 *
 * Each variant has a `collision` polygon expressed in normalized
 * (0..1) coordinates relative to the cactus bounding box. Polygons
 * roughly trace the opaque silhouette of the main body and exclude
 * thin spikes, small pad arms and pink blooms — shapes that would
 * visually look like "near misses" for the player and shouldn't
 * trigger game-over. Points go clockwise.
 */

/** Raw collision vertex as stored in the catalog: [x, y] in 0..1. */
export type NormalizedPoint = readonly [number, number];

export interface CactusVariant {
  /** Sprite key used to look up the loaded image and to build the asset
   *  path (`assets/${key}.png`). Stable across versions. */
  key: string;
  /** Native PNG width in pixels. */
  w: number;
  /** Native PNG height in pixels. */
  h: number;
  /** Multiplier applied to the default cactus height when rendering. */
  heightScale: number;
  /** Silhouette polygon, clockwise, in normalized (0..1) coords. */
  collision: ReadonlyArray<NormalizedPoint>;
}

export const CACTUS_VARIANTS: ReadonlyArray<CactusVariant> = [
  {
    key: "cactus1",
    w: 371,
    h: 497,
    heightScale: 0.55,
    // Squat barrel with a crown. Side branches excluded.
    collision: [
      [0.38, 0.05],
      [0.58, 0.05],
      [0.68, 0.22],
      [0.82, 0.48],
      [0.82, 0.88],
      [0.62, 1.0],
      [0.38, 1.0],
      [0.18, 0.88],
      [0.2, 0.52],
      [0.32, 0.22],
    ],
  },
  {
    key: "cactus2",
    w: 311,
    h: 463,
    heightScale: 0.5,
    // Rounded rectangle barrel, flower bloom on top excluded.
    collision: [
      [0.25, 0.15],
      [0.75, 0.15],
      [0.92, 0.35],
      [0.92, 0.85],
      [0.78, 1.0],
      [0.22, 1.0],
      [0.08, 0.85],
      [0.08, 0.35],
    ],
  },
  {
    key: "cactus3",
    w: 379,
    h: 521,
    heightScale: 0.55,
    // Three columns that merge at the base. Traces the outer silhouette
    // of the trio, skipping the blooms.
    collision: [
      [0.2, 0.3],
      [0.35, 0.22],
      [0.5, 0.3],
      [0.65, 0.2],
      [0.8, 0.32],
      [0.92, 0.65],
      [0.85, 0.98],
      [0.15, 0.98],
      [0.08, 0.65],
    ],
  },
  {
    key: "cactus4",
    w: 403,
    h: 416,
    heightScale: 0.5,
    // Almost spherical body with pink top and side nub. Bloom excluded.
    collision: [
      [0.3, 0.22],
      [0.7, 0.22],
      [0.92, 0.42],
      [0.92, 0.8],
      [0.78, 0.98],
      [0.22, 0.98],
      [0.08, 0.8],
      [0.08, 0.42],
    ],
  },
  {
    key: "cactus5",
    w: 434,
    h: 937,
    heightScale: 0.95,
    // Classic saguaro with two short arms at about y=0.35.
    collision: [
      [0.38, 0.03],
      [0.6, 0.03],
      [0.66, 0.3],
      [0.85, 0.34],
      [0.86, 0.52],
      [0.66, 0.54],
      [0.66, 0.96],
      [0.34, 0.96],
      [0.34, 0.54],
      [0.14, 0.52],
      [0.15, 0.34],
      [0.34, 0.3],
    ],
  },
  {
    key: "cactus6",
    w: 201,
    h: 899,
    heightScale: 0.9,
    // Tall narrow column with a red flower top. Main column only.
    collision: [
      [0.22, 0.06],
      [0.78, 0.06],
      [0.88, 0.14],
      [0.88, 0.94],
      [0.72, 1.0],
      [0.28, 1.0],
      [0.12, 0.94],
      [0.12, 0.14],
    ],
  },
  {
    key: "cactus7",
    w: 348,
    h: 943,
    heightScale: 0.95,
    // Very thin tall column with small side nubs. Trace only the trunk.
    collision: [
      [0.38, 0.02],
      [0.62, 0.02],
      [0.72, 0.1],
      [0.72, 0.95],
      [0.58, 1.0],
      [0.42, 1.0],
      [0.28, 0.95],
      [0.28, 0.1],
    ],
  },
  {
    key: "cactus8",
    w: 422,
    h: 973,
    heightScale: 1.0,
    // Prickly pear with stacked oval pads. Outer silhouette.
    collision: [
      [0.35, 0.05],
      [0.65, 0.05],
      [0.85, 0.22],
      [0.9, 0.5],
      [0.82, 0.78],
      [0.68, 0.96],
      [0.32, 0.96],
      [0.18, 0.78],
      [0.1, 0.5],
      [0.15, 0.22],
    ],
  },
];
