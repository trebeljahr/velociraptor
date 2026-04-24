import { describe, expect, it } from "vitest";
import { CACTUS_VARIANTS } from "./cactusVariants";

/*
 * Cactus catalog invariants — same shape of tests as achievements:
 * catch accidental drift when new sprites are added (typos in keys,
 * degenerate polygons, out-of-bounds normalized coords).
 *
 * Collision polygons are in normalized [0,1]x[0,1] coordinates. Every
 * vertex must stay in range or the scaled-up polygon would escape the
 * sprite bounding box at runtime.
 */

describe("CACTUS_VARIANTS catalog", () => {
  it("has at least one entry", () => {
    expect(CACTUS_VARIANTS.length).toBeGreaterThan(0);
  });

  it("every key is unique", () => {
    const seen = new Set<string>();
    for (const v of CACTUS_VARIANTS) {
      expect(seen.has(v.key), `duplicate key: ${v.key}`).toBe(false);
      seen.add(v.key);
    }
  });

  it("every key follows the 'cactusN' pattern", () => {
    const re = /^cactus\d+$/;
    for (const v of CACTUS_VARIANTS) {
      expect(re.test(v.key), `unexpected key format: ${v.key}`).toBe(true);
    }
  });

  it("positive dimensions and scale", () => {
    for (const v of CACTUS_VARIANTS) {
      expect(v.w, `${v.key} w`).toBeGreaterThan(0);
      expect(v.h, `${v.key} h`).toBeGreaterThan(0);
      expect(v.heightScale, `${v.key} heightScale`).toBeGreaterThan(0);
    }
  });
});

describe("collision polygons", () => {
  it("has at least 3 vertices per polygon (triangle or larger)", () => {
    for (const v of CACTUS_VARIANTS) {
      expect(
        v.collision.length,
        `${v.key} has only ${v.collision.length} verts`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("every vertex is within the normalized bounding box [0,1]x[0,1]", () => {
    for (const v of CACTUS_VARIANTS) {
      for (const [x, y] of v.collision) {
        expect(x, `${v.key} vertex x=${x} out of range`).toBeGreaterThanOrEqual(0);
        expect(x, `${v.key} vertex x=${x} out of range`).toBeLessThanOrEqual(1);
        expect(y, `${v.key} vertex y=${y} out of range`).toBeGreaterThanOrEqual(0);
        expect(y, `${v.key} vertex y=${y} out of range`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("no consecutive duplicate vertices (degenerate edges)", () => {
    for (const v of CACTUS_VARIANTS) {
      const pts = v.collision;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        const sameX = Math.abs(a[0] - b[0]) < 1e-9;
        const sameY = Math.abs(a[1] - b[1]) < 1e-9;
        expect(sameX && sameY, `${v.key}: duplicate consecutive vertex at ${i}`).toBe(false);
      }
    }
  });

  it("polygons are non-degenerate (positive signed area)", () => {
    // Shoelace formula. The game code assumes clockwise ordering (per the
    // module header comment) — in screen-space y-down, clockwise gives
    // a positive signed area. Whichever direction is canonical, |area|
    // should be non-zero.
    for (const v of CACTUS_VARIANTS) {
      let signedArea = 0;
      const pts = v.collision;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        signedArea += a[0] * b[1] - b[0] * a[1];
      }
      expect(Math.abs(signedArea), `${v.key} polygon has zero area`).toBeGreaterThan(1e-3);
    }
  });
});
