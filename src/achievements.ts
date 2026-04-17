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
    // Classic 3-toed dinosaur footprint — wide splaying toes
    // with pointed claw tips from a teardrop heel.
    iconHTML:
      '<path d="M12 22 C9.5 22 8.5 20.5 9 18.5 L10.5 14 C9 13.5 6.5 12 5.5 9 C4.8 6.8 6 5.5 7.5 6.2 C8.8 6.8 9.5 9 10.5 12 L11.5 14.5 L11.5 9.5 C11 7 11.2 3.5 12 2 C12.8 3.5 13 7 12.5 9.5 L12.5 14.5 L13.5 12 C14.5 9 15.2 6.8 16.5 6.2 C18 5.5 19.2 6.8 18.5 9 C17.5 12 15 13.5 13.5 14 L15 18.5 C15.5 20.5 14.5 22 12 22Z" fill="#6d7580"/>',
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
    id: "score-25",
    title: "Getting The Hang Of It",
    desc: "Score 25 points in a single run",
    iconHTML:
      '<image href="assets/cactus7.png" x="3" y="2" width="13" height="22" preserveAspectRatio="xMidYMax meet"/>' +
      '<circle cx="18" cy="7" r="5" fill="#ffffff" stroke="#3498db" stroke-width="1.2"/>' +
      '<path d="M15.5 7l2 2 3.2-3.4" fill="none" stroke="#2d9d55" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    id: "party-time",
    title: "Party Time",
    desc: "Score 100 points in a single run",
    iconImage: "assets/party-hat.png",
  },
  {
    id: "dinosaurs-forever",
    title: "Dinosaurs Forever",
    desc: "Score 150 points in a single run",
    iconImage: "assets/bow-tie.png",
  },
  {
    // id stays "score-250" for storage compatibility — renaming would
    // reset every existing player's unlock. The threshold moved from
    // 500 to 200 as part of the ladder rebalance.
    id: "score-250",
    title: "Raptor Legend",
    desc: "Score 200 points in a single run",
    iconImage: "assets/thug-glasses.png",
  },
  {
    id: "stop-and-smell",
    title: "Stop and Smell the Roses",
    desc: "Run through your first flower patch",
    // Simple SVG: a pink five-petal bloom on a green stem + leaves.
    iconHTML:
      '<circle cx="12" cy="12" r="12" fill="#eef4e2"/>' +
      '<path d="M12 17 L12 22" stroke="#4a7f2f" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M12 19 Q10 20 8.5 19 Q10 19.2 12 18.5 Z" fill="#4a7f2f"/>' +
      '<path d="M12 20 Q14 21 15.5 20 Q14 20.2 12 19.5 Z" fill="#4a7f2f"/>' +
      '<circle cx="12" cy="9" r="2.6" fill="#e85f8a"/>' +
      '<circle cx="8.4" cy="10.8" r="2.2" fill="#f08ab0"/>' +
      '<circle cx="15.6" cy="10.8" r="2.2" fill="#f08ab0"/>' +
      '<circle cx="9.7" cy="14.2" r="2.2" fill="#f08ab0"/>' +
      '<circle cx="14.3" cy="14.2" r="2.2" fill="#f08ab0"/>' +
      '<circle cx="12" cy="11.5" r="1.1" fill="#f7e26b"/>',
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
    desc: "Survive 10 nights in a single run",
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
    desc: "Survive 20 nights in a single run",
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
    iconHTML:
      '<circle cx="12" cy="12" r="8" fill="#f0e8c0" stroke="#c8b888" stroke-width="0.8"/>',
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
    iconHTML:
      '<circle cx="8" cy="12" r="3" fill="#fffae0"/>' +
      '<line x1="11" y1="11" x2="22" y2="8" stroke="#fffae0" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="10" y1="13" x2="20" y2="12" stroke="rgba(255,250,200,0.4)" stroke-width="1"/>',
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
];

/** id → definition lookup for fast runtime dispatch. */
export const ACHIEVEMENTS_BY_ID: { [id: string]: AchievementDefinition } =
  Object.create(null);
for (const a of ACHIEVEMENTS) ACHIEVEMENTS_BY_ID[a.id] = a;
