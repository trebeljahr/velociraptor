/*
 * Raptor Runner — bitmap image catalog.
 *
 * IMAGE_SRCS is the source-of-truth key → path mapping. IMAGES is a
 * mutable singleton that gets populated during init() with the loaded
 * HTMLImageElement objects. Modules that draw sprites do `images.raptorSheet`
 * etc. after init — TypeScript marks them `| undefined` because the
 * asynchronous load can only be trusted after the init flow completes.
 *
 * This mutable-object pattern avoids the "imported null before init"
 * trap: there's only one reference anywhere, so every consumer sees
 * the same populated dictionary as soon as init finishes.
 */

import { CACTUS_VARIANTS } from "./cactusVariants";

/** Key → asset path (relative to the served root). */
export const IMAGE_SRCS: { [key: string]: string } = {
  raptorSheet: "assets/raptor-sheet.png",
  partyHat: "assets/party-hat.png",
  thugGlasses: "assets/thug-glasses.png",
  bowTie: "assets/bow-tie.png",
  ufo: "assets/ufo.png",
  santaSleigh: "assets/santa-sleigh.png",
  reindeer: "assets/reindeer.png",
  tumbleweed: "assets/tumbleweed.png",
};

// Cactus variants are registered here so any code that iterates
// IMAGE_SRCS picks them up (the preloader uses this to know what to
// fetch).
for (const v of CACTUS_VARIANTS) IMAGE_SRCS[v.key] = `assets/${v.key}.png`;

/**
 * Runtime image dictionary. Populated lazily during init() — every
 * module that renders sprites should import this object and look up
 * entries by key. Until init completes, entries may be undefined.
 */
export const IMAGES: { [key: string]: HTMLImageElement | undefined } = {};
