/*
 * Build build/icon.ico from build/icon.png.
 *
 * Uses the Vista+ "ICO with PNG payload" format: a single 256×256 PNG
 * wrapped in an ICO header. No image-processing dependencies needed —
 * ICO is a thin wrapper around whatever size we hand it.
 *
 * We ship a 256×256 PNG chunk (which the PNG header declares as 0×0
 * dimensions in the ICO directory entry — 0 means "256"). Windows
 * handles multiple sizes natively by scaling from this one entry; for
 * most cases this is indistinguishable from a multi-res .ico in practice.
 *
 * To regenerate after changing public/assets/icon-512.png:
 *   1. sips -z 256 256 public/assets/icon-512.png --out build/icon-256.png
 *   2. node scripts/make-ico.mjs build/icon-256.png build/icon.ico
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node make-ico.mjs <input.png> <output.ico>");
  process.exit(1);
}

const png = readFileSync(inPath);

// ICONDIR (6 bytes): reserved, type, count
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); // reserved = 0
dir.writeUInt16LE(1, 2); // type = 1 (icon)
dir.writeUInt16LE(1, 4); // count = 1 entry

// ICONDIRENTRY (16 bytes): width, height, colorCount, reserved,
// planes, bitCount, bytesInRes, imageOffset
const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0);  // width 0 = 256
entry.writeUInt8(0, 1);  // height 0 = 256
entry.writeUInt8(0, 2);  // colorCount 0 = 256+
entry.writeUInt8(0, 3);  // reserved
entry.writeUInt16LE(1, 4);  // planes
entry.writeUInt16LE(32, 6); // bitCount
entry.writeUInt32LE(png.length, 8);   // bytesInRes
entry.writeUInt32LE(6 + 16, 12);      // imageOffset (after dir+entry)

writeFileSync(outPath, Buffer.concat([dir, entry, png]));
console.log(`wrote ${outPath} (${dir.length + entry.length + png.length} bytes)`);
