/*
 * Raptor Runner — achievement catalog.
 *
 * This module owns the static catalog data: the list of achievements
 * and the id → definition lookup. It has no runtime state and no
 * dependencies on game state, the DOM, canvas, or localStorage.
 *
 * The actual `unlockAchievement(id)` function lives in src/main.ts for
 * now because it touches state.unlockedAchievements and fires the
 * GameAPI callback registry — both of which still live inside main.ts.
 * Once state and api are split out, unlockAchievement will migrate
 * here and become the complete "achievements module".
 */

/** Stable identifier used for storage and runtime lookup. */
export type AchievementId = string;

/** A single entry in the public catalog. */
export interface AchievementDefinition {
  /** Namespaced storage id, never renamed after ship. */
  id: AchievementId;
  /** Short display title shown in the toast and menu. */
  title: string;
  /** One-line description of the unlock condition. */
  desc: string;
  /** Hidden from the menu until unlocked. */
  secret?: boolean;
  /** Inline SVG fragment (draw on a shared 24×24 viewBox). */
  iconHTML?: string;
  /** Path to a bitmap sprite in /assets — used for cosmetic rewards. */
  iconImage?: string;
}

/**
 * Catalog of every achievement in the game.
 *
 * Each entry carries a stable `id` (used for storage), a short display
 * title, and a one-line description of how to earn it.
 *
 * Icons are inline SVG fragments, drawn at 24×24 inside a shared
 * viewBox. Unlike Lucide-style monochrome line icons, these are
 * multi-colour vector illustrations coloured from the game's own
 * palette — cactus greens, sky blues, sunset golds, moon creams — so
 * the shell can render them directly without a CSS `currentColor`
 * pass.
 *
 * A few entries use `iconImage` to pull an actual sprite from /assets
 * (party hat, thug glasses, bow tie, UFO, santa, tumbleweed) so the
 * reward preview is pixel-accurate to the thing you unlock.
 */
export const ACHIEVEMENTS: ReadonlyArray<AchievementDefinition> = [
  {
    id: "first-run",
    title: "First Steps",
    desc: "Complete your first run",
    // Three-toed dinosaur footprint: slender tapered toes with
    // pointed claws, splaying from a small oval base. The earlier
    // "three round pads on a heel" silhouette read as a bear paw;
    // raptor prints are narrow and elongated, with the claws
    // leading the shape — this version keeps that proportion.
    iconHTML:
      // Centre toe + claw.
      '<path d="M10.8 20 Q10.5 12 10.8 8 Q11 3.5 12 2.5 Q13 3.5 13.2 8 Q13.5 12 13.2 20 Z" fill="#2a1d13"/>' +
      '<path d="M11.3 2.8 Q11.8 0.3 12.5 0 Q13.2 0.3 12.8 2.8 Z" fill="#2a1d13"/>' +
      // Left toe + claw, splayed outward around the base point.
      '<g transform="rotate(-28 12 21)">' +
      '<path d="M10.8 20 Q10.5 12 10.8 8 Q11 3.5 12 2.5 Q13 3.5 13.2 8 Q13.5 12 13.2 20 Z" fill="#2a1d13"/>' +
      '<path d="M11.3 2.8 Q11.8 0.3 12.5 0 Q13.2 0.3 12.8 2.8 Z" fill="#2a1d13"/>' +
      "</g>" +
      // Right toe + claw (mirror).
      '<g transform="rotate(28 12 21)">' +
      '<path d="M10.8 20 Q10.5 12 10.8 8 Q11 3.5 12 2.5 Q13 3.5 13.2 8 Q13.5 12 13.2 20 Z" fill="#2a1d13"/>' +
      '<path d="M11.3 2.8 Q11.8 0.3 12.5 0 Q13.2 0.3 12.8 2.8 Z" fill="#2a1d13"/>' +
      "</g>" +
      // Small sole / heel where all three converge.
      '<ellipse cx="12" cy="20" rx="3" ry="1.8" fill="#2a1d13"/>',
  },
  {
    id: "first-jump",
    title: "Up And Over",
    desc: "Clear your first cactus",
    iconHTML:
      '<image href="assets/cactus2.png" x="5" y="10" width="14" height="14" preserveAspectRatio="xMidYMax meet"/>' +
      '<path d="M3 10 A12 12 0 0 1 21 10" fill="none" stroke="#3498db" stroke-width="1.5" stroke-linecap="round"/>' +
      '<polygon points="22,7 22,13 18,10" fill="#3498db"/>',
  },
  {
    // id stays "score-25" for storage compatibility. The condition
    // flipped with the meters-scoring rework: it now fires on cactus
    // count (25 cleared), not meters, so the achievement still reads
    // as a "getting a feel for the jump rhythm" milestone instead of
    // tripping in the first few seconds of any run.
    id: "score-25",
    title: "Getting The Hang Of It",
    desc: "Jump over 25 cacti in a single run",
    iconHTML:
      '<image href="assets/cactus7.png" x="3" y="2" width="13" height="22" preserveAspectRatio="xMidYMax meet"/>' +
      '<circle cx="18" cy="7" r="5" fill="#ffffff" stroke="#3498db" stroke-width="1.2"/>' +
      '<path d="M15.5 7l2 2 3.2-3.4" fill="none" stroke="#2d9d55" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    id: "party-time",
    title: "Party Time",
    desc: "Run 1,000 meters in a single dash",
    iconImage: "assets/party-hat.png",
  },
  {
    id: "dinosaurs-forever",
    title: "Dinosaurs Forever",
    desc: "Run 1,500 meters in a single dash",
    iconImage: "assets/bow-tie.png",
  },
  {
    // id stays "score-250" for storage compatibility — renaming would
    // reset every existing player's unlock. Threshold is 2,000 meters
    // (THUG_GLASSES_SCORE_THRESHOLD in constants).
    id: "score-250",
    title: "Raptor Legend",
    desc: "Run 2,000 meters in a single dash",
    iconImage: "assets/thug-glasses.png",
  },
  {
    id: "stop-and-smell",
    title: "Stop and Smell the Roses",
    desc: "Run through your first flower patch",
    // Uses the real in-game flower sprite so the icon matches the
    // patches the raptor actually runs through. flower-02 is the
    // pink two-tier bloom — on-theme for "roses" and reads cleanly
    // at 48×48 next to the sand background. A grass blade on each
    // side gives the "patch" context without getting busy.
    iconHTML:
      // Grass blades at the sides, anchored at the ground line.
      '<path d="M3 22 Q3.5 17 5 15 Q4.5 18 5 22 Z" fill="#4a7c3a"/>' +
      '<path d="M21 22 Q20.5 17 19 15 Q19.5 18 19 22 Z" fill="#4a7c3a"/>' +
      // The actual flower sprite, centred on the ground line.
      '<image href="assets/flower-02.png" x="4" y="1" width="16" height="21" preserveAspectRatio="xMidYMax meet"/>',
  },
  {
    id: "first-night",
    title: "Night Owl",
    desc: "Survive your first full night",
    iconHTML:
      '<circle cx="12" cy="12" r="12" fill="#1e2a44"/>' +
      '<path d="M16 7a6 6 0 1 0 1 9 5 5 0 0 1-1-9z" fill="#f4f0d6"/>',
  },
  {
    id: "ten-nights",
    title: "Insomniac",
    desc: "Survive 10 nights across all your runs",
    // r=10, centre 12,12, angle = i*36° starting at 0°.
    iconHTML:
      '<circle cx="12" cy="12" r="12" fill="#1e2a44"/>' +
      '<path d="M14 8a4 4 0 1 0 .8 6.5 3.2 3.2 0 0 1-.8-6.5z" fill="#f4f0d6"/>' +
      '<circle cx="22" cy="12" r="0.7" fill="#fff"/>' + // 0°
      '<circle cx="20.1" cy="5.9" r="0.7" fill="#fff"/>' + // 36°
      '<circle cx="15.1" cy="2.2" r="0.7" fill="#fff"/>' + // 72°
      '<circle cx="8.9" cy="2.2" r="0.7" fill="#fff"/>' + // 108°
      '<circle cx="3.9" cy="5.9" r="0.7" fill="#fff"/>' + // 144°
      '<circle cx="2" cy="12" r="0.7" fill="#fff"/>' + // 180°
      '<circle cx="3.9" cy="18.1" r="0.7" fill="#fff"/>' + // 216°
      '<circle cx="8.9" cy="21.8" r="0.7" fill="#fff"/>' + // 252°
      '<circle cx="15.1" cy="21.8" r="0.7" fill="#fff"/>' + // 288°
      '<circle cx="20.1" cy="18.1" r="0.7" fill="#fff"/>', // 324°
  },
  {
    id: "twenty-nights",
    title: "Marathon Sleeper",
    desc: "Survive 5 nights in a single run",
    iconHTML:
      '<circle cx="8" cy="12" r="4" fill="#ffd455" stroke="#c78a12" stroke-width="0.8"/>' +
      '<g stroke="#ffd455" stroke-width="1.2" stroke-linecap="round">' +
      '<line x1="8" y1="4" x2="8" y2="6"/>' +
      '<line x1="8" y1="18" x2="8" y2="20"/>' +
      '<line x1="1.5" y1="12" x2="3.5" y2="12"/>' +
      '<line x1="3.5" y1="7.5" x2="4.9" y2="8.9"/>' +
      '<line x1="3.5" y1="16.5" x2="4.9" y2="15.1"/>' +
      "</g>" +
      '<circle cx="17" cy="12" r="4.5" fill="#1e2a44"/>' +
      '<path d="M18.5 9a3.5 3.5 0 1 0 0 6 3 3 0 0 1 0-6z" fill="#f4f0d6"/>',
  },
  {
    id: "first-shooting-star",
    title: "Make A Wish",
    desc: "See your first shooting star",
    iconHTML:
      '<path d="M3 20l9-9" stroke="#8fd1ff" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M5 18l5-5" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>' +
      '<path d="M16 3l1.6 3.4 3.7.5-2.7 2.6.7 3.7-3.3-1.8-3.3 1.8.7-3.7L9.7 6.9l3.7-.5z" fill="#f7d148" stroke="#c78a12" stroke-width="0.8" stroke-linejoin="round"/>',
  },
  {
    id: "century-runner",
    title: "Century Runner",
    desc: "Complete 100 runs",
    iconHTML:
      '<path d="M8 13l-3 9 4-2 4 2-3-9z" fill="#3498db" stroke="#1e6aa8" stroke-width="0.8" stroke-linejoin="round"/>' +
      '<path d="M16 13l3 9-4-2-4 2 3-9z" fill="#50b4cd" stroke="#1e6aa8" stroke-width="0.8" stroke-linejoin="round"/>' +
      '<circle cx="12" cy="10" r="9" fill="#f7d148" stroke="#c78a12" stroke-width="1"/>' +
      '<text x="12" y="12.8" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="5.5" font-weight="900" fill="#7a4a00">100</text>',
  },
  {
    id: "sound-of-silence",
    title: "The Sound Of Silence",
    desc: "Play muted through an entire run",
    iconHTML:
      '<path d="M10 8L6 11H3v4h3l4 3V8z" fill="#6d7580" stroke="#333" stroke-width="0.8" stroke-linejoin="round"/>' +
      '<line x1="14" y1="9" x2="20" y2="17" stroke="#e53935" stroke-width="2.2" stroke-linecap="round"/>' +
      '<line x1="20" y1="9" x2="14" y2="17" stroke="#e53935" stroke-width="2.2" stroke-linecap="round"/>',
  },
  {
    id: "rainy-day",
    title: "Rainy Day",
    desc: "Survive a rainstorm",
    iconHTML:
      '<path d="M6 10a4 4 0 0 1 7.9-.8A3.5 3.5 0 1 1 17.5 14H6a3 3 0 0 1 0-6z" fill="#90a4ae" stroke="#546e7a" stroke-width="0.8"/>' +
      '<line x1="8" y1="17" x2="7" y2="21" stroke="#42a5f5" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="12" y1="17" x2="11" y2="21" stroke="#42a5f5" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="16" y1="17" x2="15" y2="21" stroke="#42a5f5" stroke-width="1.5" stroke-linecap="round"/>',
  },
  {
    id: "rainbow",
    title: "Over the Rainbow",
    desc: "See a rainbow after a storm",
    iconHTML:
      '<path d="M4 18a8 8 0 0 1 16 0" fill="none" stroke="#e53935" stroke-width="1.2"/>' +
      '<path d="M5 18a7 7 0 0 1 14 0" fill="none" stroke="#ff9800" stroke-width="1.2"/>' +
      '<path d="M6 18a6 6 0 0 1 12 0" fill="none" stroke="#fdd835" stroke-width="1.2"/>' +
      '<path d="M7 18a5 5 0 0 1 10 0" fill="none" stroke="#4caf50" stroke-width="1.2"/>' +
      '<path d="M8 18a4 4 0 0 1 8 0" fill="none" stroke="#2196f3" stroke-width="1.2"/>' +
      '<path d="M9 18a3 3 0 0 1 6 0" fill="none" stroke="#7b1fa2" stroke-width="1.2"/>',
  },
  // Secret achievements — rare background easter eggs
  {
    id: "full-moon",
    title: "Lunar Glory",
    desc: "Witness a full moon",
    secret: true,
    // Full moon on a night-sky disc: dark blue background with a
    // subtle outer halo, a cream moon face with a few crater
    // flecks, and tiny pinpoint stars in the corners so the whole
    // thing reads as "moon at its zenith in the night sky" — which
    // is exactly when the achievement fires.
    iconHTML:
      // Night-sky background.
      '<circle cx="12" cy="12" r="12" fill="#1e2a44"/>' +
      // Soft halo around the moon.
      '<circle cx="12" cy="12" r="8.5" fill="#2a3a5c" opacity="0.5"/>' +
      // Moon disc.
      '<circle cx="12" cy="12" r="7" fill="#f4f0d6" stroke="#c8b888" stroke-width="0.6"/>' +
      // Crater flecks.
      '<circle cx="9.5" cy="10" r="1.1" fill="#d6cfaf" opacity="0.65"/>' +
      '<circle cx="14.5" cy="13.5" r="0.9" fill="#d6cfaf" opacity="0.65"/>' +
      '<circle cx="13" cy="9" r="0.6" fill="#d6cfaf" opacity="0.55"/>' +
      // Corner stars for atmosphere.
      '<circle cx="3" cy="5" r="0.5" fill="#fff"/>' +
      '<circle cx="20" cy="4" r="0.4" fill="#fff"/>' +
      '<circle cx="22" cy="18" r="0.5" fill="#fff"/>' +
      '<circle cx="3" cy="20" r="0.4" fill="#fff"/>',
  },
  {
    id: "ufo-sighting",
    title: "We Are Not Alone",
    desc: "Witness a UFO landing",
    secret: true,
    iconImage: "assets/ufo.png",
  },
  {
    id: "santa-spotted",
    title: "Jurassic Christmas",
    desc: "Spot Santa crossing the night sky",
    secret: true,
    iconImage: "assets/santa-sleigh.png",
  },
  {
    id: "tumbleweed",
    title: "Desert Drifter",
    desc: "See a tumbleweed roll by",
    secret: true,
    iconImage: "assets/tumbleweed.png",
  },
  {
    id: "comet",
    title: "Wish Upon a Comet",
    desc: "See a comet cross the night sky",
    secret: true,
    // Golden comet head + curved tail streaking across a night-sky
    // disc. Two-layer tail (dim outer, bright inner) gives the
    // streak a soft-to-sharp gradient without needing a real
    // gradient. Three pinpoint stars add constellation context.
    iconHTML:
      // Night-sky background.
      '<circle cx="12" cy="12" r="12" fill="#1e2a44"/>' +
      // Outer dim tail — wider, warmer.
      '<path d="M8 16 Q14 10 22 4" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.55"/>' +
      // Inner bright streak — narrower, yellow-cream.
      '<path d="M9 15 Q14 11 22 5" stroke="#fde68a" stroke-width="1" stroke-linecap="round" fill="none" opacity="0.75"/>' +
      // Comet head: gold disc with a brighter core.
      '<circle cx="8" cy="16" r="3.2" fill="#fbbf24" stroke="#2a1d13" stroke-width="0.9"/>' +
      '<circle cx="7.2" cy="15.5" r="1.4" fill="#fde68a"/>' +
      // Pinpoint stars.
      '<circle cx="3" cy="5" r="0.4" fill="#fff"/>' +
      '<circle cx="18" cy="19" r="0.4" fill="#fff"/>' +
      '<circle cx="21" cy="10" r="0.35" fill="#fff"/>',
  },
  {
    id: "meteor-impact",
    title: "Extinction Event",
    desc: "Witness a meteor impact",
    secret: true,
    iconHTML:
      '<circle cx="12" cy="10" r="3" fill="#ffc864"/>' +
      '<path d="M12 13L8 20h8z" fill="#ff8c00" opacity="0.6"/>' +
      '<line x1="15" y1="8" x2="20" y2="4" stroke="#ffa040" stroke-width="1.5"/>',
  },
  // ── Shop + economy achievements ────────────────────────────
  {
    id: "first-purchase",
    title: "Treat Yourself",
    desc: "Buy your first cosmetic from the shop",
    // Sand-coloured shopping bag with dune handles + outline, a
    // single gold coin peeking out of the top. Brand palette all
    // the way through so the icon sits in the shop strip without
    // the old flat-orange jarring against the sand card.
    iconHTML:
      // Bag shadow.
      '<ellipse cx="12" cy="21.8" rx="6" ry="0.7" fill="#2a1d13" opacity="0.25"/>' +
      // Bag body (trapezoid narrower at the bottom).
      '<path d="M5.8 9 L18.2 9 L17.2 20.8 C17.1 21.5 16.6 22 15.9 22 L8.1 22 C7.4 22 6.9 21.5 6.8 20.8 Z" fill="#f5dcaa" stroke="#2a1d13" stroke-width="1.2" stroke-linejoin="round"/>' +
      // Vertical seam accents.
      '<line x1="9.5" y1="9.5" x2="9.2" y2="21.2" stroke="#2a1d13" stroke-width="0.4" opacity="0.35"/>' +
      '<line x1="14.5" y1="9.5" x2="14.8" y2="21.2" stroke="#2a1d13" stroke-width="0.4" opacity="0.35"/>' +
      // Rolled-over top lip.
      '<rect x="5.8" y="8.5" width="12.4" height="1.2" fill="#e8c98e" stroke="#2a1d13" stroke-width="1.1" stroke-linejoin="round"/>' +
      // Handles — rope arcs anchoring to the bag top.
      '<path d="M9 9 C9 4.8 10.5 3.5 12 3.5 C13.5 3.5 15 4.8 15 9" fill="none" stroke="#2a1d13" stroke-width="1.5" stroke-linecap="round"/>' +
      // Gold coin peeking out of the bag.
      '<circle cx="12" cy="13.5" r="3.8" fill="#fbbf24" stroke="#2a1d13" stroke-width="1"/>' +
      // Inner coin rim.
      '<circle cx="12" cy="13.5" r="2.5" fill="none" stroke="#2a1d13" stroke-width="0.7"/>' +
      // Coin star stamp.
      '<path d="M12 11.8 L12.55 13.1 L13.95 13.2 L12.85 14.05 L13.25 15.4 L12 14.6 L10.75 15.4 L11.15 14.05 L10.05 13.2 L11.45 13.1 Z" fill="#2a1d13"/>',
  },
  {
    id: "fully-equipped",
    title: "Jurassic Runway",
    desc: "Equip a cosmetic in every slot at the same time",
    // Vertical trio of the actual cosmetic archetypes — party hat,
    // sunglasses, bow-tie — so the icon reads as "wearing the set"
    // at a glance instead of three abstract tick-marked rectangles.
    iconHTML:
      // ── Party hat (top) ──
      '<path d="M12 2 L16.5 8 L7.5 8 Z" fill="#ec4899" stroke="#2a1d13" stroke-width="1" stroke-linejoin="round"/>' +
      // Hat stripe.
      '<path d="M9 6 L15 6" stroke="#fbebc6" stroke-width="0.7"/>' +
      // Hat pompom.
      '<circle cx="12" cy="2" r="1.2" fill="#fbbf24" stroke="#2a1d13" stroke-width="0.7"/>' +
      // ── Sunglasses (middle) ──
      '<rect x="4.5" y="10.5" width="6" height="4" rx="1" fill="#1f2937" stroke="#2a1d13" stroke-width="0.9"/>' +
      '<rect x="13.5" y="10.5" width="6" height="4" rx="1" fill="#1f2937" stroke="#2a1d13" stroke-width="0.9"/>' +
      // Bridge.
      '<line x1="10.5" y1="12.5" x2="13.5" y2="12.5" stroke="#2a1d13" stroke-width="1.2" stroke-linecap="round"/>' +
      // Lens glare.
      '<line x1="5.5" y1="11.5" x2="7" y2="11.5" stroke="#fbebc6" stroke-width="0.7" stroke-linecap="round" opacity="0.8"/>' +
      '<line x1="14.5" y1="11.5" x2="16" y2="11.5" stroke="#fbebc6" stroke-width="0.7" stroke-linecap="round" opacity="0.8"/>' +
      // ── Bow-tie (bottom) ──
      '<path d="M3 19.5 L10.8 17 L10.8 22 Z" fill="#dc2626" stroke="#2a1d13" stroke-width="0.9" stroke-linejoin="round"/>' +
      '<path d="M21 19.5 L13.2 17 L13.2 22 Z" fill="#dc2626" stroke="#2a1d13" stroke-width="0.9" stroke-linejoin="round"/>' +
      // Centre knot.
      '<rect x="10.5" y="17.5" width="3" height="4" rx="0.4" fill="#991b1b" stroke="#2a1d13" stroke-width="0.8"/>',
  },
  {
    id: "coin-hoarder",
    title: "Scrooge McRaptor",
    desc: "Pick up 1,000 coins across all your runs",
    // Three-deep stack of brand-gold coins with a "1K" stamp, a
    // ground shadow, and a corner sparkle. Top coin is the
    // brightest so the stack reads as dimensional instead of flat.
    iconHTML:
      // Ground shadow.
      '<ellipse cx="12" cy="22" rx="9" ry="0.9" fill="#2a1d13" opacity="0.3"/>' +
      // Bottom coin — sides + disc.
      '<rect x="4" y="17.2" width="16" height="3" fill="#d97706"/>' +
      '<ellipse cx="12" cy="20.2" rx="8" ry="1.8" fill="#d97706"/>' +
      '<ellipse cx="12" cy="17.2" rx="8" ry="1.8" fill="#fbbf24" stroke="#2a1d13" stroke-width="0.9"/>' +
      // Middle coin.
      '<rect x="4" y="11" width="16" height="3" fill="#d97706"/>' +
      '<ellipse cx="12" cy="14" rx="8" ry="1.8" fill="#d97706"/>' +
      '<ellipse cx="12" cy="11" rx="8" ry="1.8" fill="#fbbf24" stroke="#2a1d13" stroke-width="0.9"/>' +
      // Top coin — brightest, carries the "1K" stamp.
      '<rect x="4" y="4.8" width="16" height="3" fill="#d97706"/>' +
      '<ellipse cx="12" cy="7.8" rx="8" ry="1.8" fill="#d97706"/>' +
      '<ellipse cx="12" cy="4.8" rx="8" ry="1.8" fill="#fde68a" stroke="#2a1d13" stroke-width="0.9"/>' +
      // Inner disc outline on the top coin — suggests a milled rim.
      '<ellipse cx="12" cy="4.8" rx="6.2" ry="1.2" fill="none" stroke="#2a1d13" stroke-width="0.4" opacity="0.55"/>' +
      // "1K" stamp.
      '<text x="12" y="5.9" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="2.8" font-weight="900" fill="#2a1d13">1K</text>' +
      // Sparkle on the upper-right to sell the shine.
      '<path d="M21 2.5 L21.4 3.7 L22.5 4.1 L21.4 4.5 L21 5.7 L20.6 4.5 L19.5 4.1 L20.6 3.7 Z" fill="#fbebc6" stroke="#2a1d13" stroke-width="0.4" stroke-linejoin="round"/>',
  },
  {
    id: "shop-cleaned-out",
    title: "Shopkeeper\u2019s Early Retirement",
    desc: "Own every item in the shop",
    // Little storefront — red-striped awning, sand facade with
    // empty shelf lines flanking a dark door, and a tilted
    // "SOLD OUT" banner across the front. Brand palette.
    iconHTML:
      // Awning (striped triangular bunting below the rooftop).
      '<path d="M3 6 L21 6 L19.5 10 L4.5 10 Z" fill="#dc2626" stroke="#2a1d13" stroke-width="1" stroke-linejoin="round"/>' +
      // Awning stripes.
      '<line x1="7.5" y1="6" x2="6.8" y2="10" stroke="#fbebc6" stroke-width="0.7" stroke-linecap="round"/>' +
      '<line x1="12" y1="6" x2="12" y2="10" stroke="#fbebc6" stroke-width="0.7" stroke-linecap="round"/>' +
      '<line x1="16.5" y1="6" x2="17.2" y2="10" stroke="#fbebc6" stroke-width="0.7" stroke-linecap="round"/>' +
      // Shop facade.
      '<rect x="4.5" y="10" width="15" height="11" fill="#f5dcaa" stroke="#2a1d13" stroke-width="1.1"/>' +
      // Door.
      '<rect x="10" y="14" width="4" height="7" fill="#4a3526" stroke="#2a1d13" stroke-width="0.7"/>' +
      // Door handle.
      '<circle cx="13.2" cy="17.8" r="0.4" fill="#fbbf24"/>' +
      // Empty shelf lines flanking the door.
      '<line x1="5.5" y1="14" x2="9.2" y2="14" stroke="#2a1d13" stroke-width="0.9" stroke-linecap="round"/>' +
      '<line x1="5.5" y1="18" x2="9.2" y2="18" stroke="#2a1d13" stroke-width="0.9" stroke-linecap="round"/>' +
      '<line x1="14.8" y1="14" x2="18.5" y2="14" stroke="#2a1d13" stroke-width="0.9" stroke-linecap="round"/>' +
      '<line x1="14.8" y1="18" x2="18.5" y2="18" stroke="#2a1d13" stroke-width="0.9" stroke-linecap="round"/>' +
      // "SOLD OUT" banner, tilted.
      '<g transform="rotate(-10 12 12.5)">' +
      '<rect x="2" y="11" width="20" height="3.3" fill="#fbbf24" stroke="#2a1d13" stroke-width="1"/>' +
      '<text x="12" y="13.4" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="2.6" font-weight="900" fill="#2a1d13">SOLD OUT</text>' +
      "</g>",
  },
];

/** id → definition lookup for fast runtime dispatch. */
export const ACHIEVEMENTS_BY_ID: { [id: string]: AchievementDefinition } = Object.create(null);
for (const a of ACHIEVEMENTS) ACHIEVEMENTS_BY_ID[a.id] = a;
