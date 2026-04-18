/*
 * Raptor Runner — pure math, color, and collision helpers.
 *
 * Everything here is a pure function with no dependencies on game
 * state, the DOM, canvas contexts, localStorage, or anything else.
 * Safe to import from any module.
 */

import { MOON_SYNODIC_CYCLE, MOON_PHASE_OFFSET_DAYS } from "./constants";

// ── Moon phase ─────────────────────────────────────────────

/** Map a day-cycle counter onto a moon phase in [0, 1).
 *
 *   0.00  new moon (invisible)
 *   0.25  first quarter (right half lit)
 *   0.50  full moon
 *   0.75  third quarter (left half lit)
 *
 * The MOON_PHASE_OFFSET_DAYS shift lands the very first night of a
 * fresh save (totalDayCycles=0) on a small waxing crescent instead
 * of new moon, and pulls the first full moon achievement in to
 * day 13 of the save (instead of day 15). The cycle length stays 30
 * days so achievement progression still feels "monthly". */
export function moonPhaseFromCycles(totalDayCycles: number): number {
  const shifted =
    ((totalDayCycles + MOON_PHASE_OFFSET_DAYS) % MOON_SYNODIC_CYCLE +
      MOON_SYNODIC_CYCLE) %
    MOON_SYNODIC_CYCLE;
  return shifted / MOON_SYNODIC_CYCLE;
}

// ── Color / interpolation ──────────────────────────────────

export type RgbTuple = readonly [number, number, number];

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

export const lerpColor = (
  a: RgbTuple,
  b: RgbTuple,
  t: number,
): [number, number, number] => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t)),
];

export const rgb = (c: RgbTuple): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

export const rgba = (c: RgbTuple, a: number): string =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

// ── Numeric ────────────────────────────────────────────────

export const randRange = (min: number, max: number): number =>
  min + Math.random() * (max - min);

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/**
 * In-place array compaction. Mutates `arr` to contain only elements
 * for which `keep` returns true, preserving order. Returns the same
 * array reference with its `.length` adjusted.
 *
 * This is the zero-allocation replacement for `arr = arr.filter(keep)`
 * which we use in per-frame hot paths (particles, clouds, dune cacti).
 * `filter` always allocates a new array even when nothing is removed —
 * this helper walks with read/write indices and reassigns the length
 * at the end. No new array ever gets created.
 *
 * Returns the array so call sites can chain or pretend it's functional.
 */
export function compactInPlace<T>(arr: T[], keep: (t: T) => boolean): T[] {
  let write = 0;
  for (let read = 0; read < arr.length; read++) {
    const item = arr[read]!;
    if (keep(item)) {
      if (write !== read) arr[write] = item;
      write++;
    }
  }
  arr.length = write;
  return arr;
}

// ── 2D collision geometry ──────────────────────────────────

export type Point2D = { x: number; y: number };
export type Polygon = Point2D[];

/**
 * Polygon-vs-polygon overlap test. Handles *concave* polygons on
 * both sides without decomposition. Three checks:
 *   1. Any vertex of A inside B? (fast path for contained shapes)
 *   2. Any vertex of B inside A? (other containment direction)
 *   3. Any edge of A crossing any edge of B? (partial overlap)
 */
export function polygonsOverlap(polyA: Polygon, polyB: Polygon): boolean {
  for (const p of polyA) if (pointInPolygon(p, polyB)) return true;
  for (const p of polyB) if (pointInPolygon(p, polyA)) return true;
  const lenA = polyA.length;
  const lenB = polyB.length;
  for (let i = 0; i < lenA; i++) {
    const a = polyA[i];
    const b = polyA[(i + 1) % lenA];
    for (let j = 0; j < lenB; j++) {
      const c = polyB[j];
      const d = polyB[(j + 1) % lenB];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

/** Ray-casting point-in-polygon test, handles concave polygons. */
export function pointInPolygon(p: Point2D, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Do segments (a,b) and (c,d) strictly intersect? */
export function segmentsIntersect(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

export const cross = (a: Point2D, b: Point2D, c: Point2D): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/**
 * Shrink a polygon inward by `inset` pixels, by pulling each vertex
 * toward the polygon's centroid along the line joining them. Not a
 * geometrically perfect polygon offset, but close enough for a small
 * forgiving collision buffer on an ~28-vertex silhouette.
 */
export function shrinkPolygon(poly: Polygon, inset: number): Polygon {
  if (inset <= 0 || poly.length === 0) return poly;
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  return poly.map((p) => {
    const dx = cx - p.x;
    const dy = cy - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x: p.x, y: p.y };
    const t = Math.min(1, inset / len);
    return { x: p.x + dx * t, y: p.y + dy * t };
  });
}
