/*
 * Raptor Runner — cosmetic registry.
 *
 * Single source of truth for every cosmetic the player can own,
 * buy, and equip. Each CosmeticDef describes:
 *
 *   • Which "slot" on the raptor it occupies (head / eyes / neck).
 *   • How it's obtained — `scoreUnlock` items are granted by the
 *     score-threshold logic in cactus.ts and never appear in the
 *     shop; everything else is for sale at `price` coins.
 *   • Which sprite to draw. spriteKey is optional: the rendering
 *     path in raptor.ts falls back to a coloured placeholder
 *     rectangle when the referenced image hasn't been added yet,
 *     so we can wire the shop and equip menu end-to-end before
 *     the final art lands.
 *
 * Shop UI, equip menu, and raptor rendering all read from this
 * array — add a new entry here and it shows up in all three.
 */

export type CosmeticSlot = "head" | "eyes" | "neck" | "back";

export const COSMETIC_SLOTS: ReadonlyArray<CosmeticSlot> = [
  "head",
  "eyes",
  "neck",
  "back",
];

/** Human-readable slot name used in the equip menu subheadings. */
export const COSMETIC_SLOT_LABELS: Record<CosmeticSlot, string> = {
  head: "Head",
  eyes: "Eyes",
  neck: "Neck",
  back: "Back",
};

export interface CosmeticDef {
  /** Stable id — persisted in localStorage, referenced from the
   *  shop/equip UI. Changing this breaks save compatibility. */
  id: string;
  /** Display name shown in the shop and equip menu. */
  name: string;
  /** Which raptor slot this item occupies. One equipped per slot. */
  slot: CosmeticSlot;
  /** Coin cost to purchase. Score-unlocked items use `price: 0` and
   *  `scoreUnlock: true`; they're granted automatically and don't
   *  appear in the shop. */
  price: number;
  /** Short description shown on the shop card (optional). */
  description?: string;
  /** Key into IMAGES{} for the sprite. Optional — if missing or
   *  the image hasn't loaded, raptor.ts draws a placeholder. */
  spriteKey?: string;
  /** True for the three classic cosmetics that unlock at score
   *  milestones (party hat, thug glasses, bow tie). Filtered out
   *  of the shop grid since you can't "buy" them. */
  scoreUnlock?: boolean;
  /** Optional per-item draw tweaks applied on top of the slot
   *  defaults in raptor.ts. Each field is optional — anything
   *  left undefined falls back to the slot default. Use this to
   *  hand-tune specific cosmetics that look off at the defaults
   *  (a wide cowboy hat doesn't want the party hat's rotation,
   *  wings pre-flipped for a right-running raptor want a nudge
   *  up-and-back from the default back anchor, etc.). */
  draw?: {
    /** Scale override. For head/back this is a fraction of raptor
     *  height; for eyes/neck a fraction of raptor width. */
    scale?: number;
    /** Rotation in radians. Positive = clockwise. */
    rotation?: number;
    /** Extra offset added to the slot's default anchor, as a
     *  fraction of raptor width / height. Positive x nudges
     *  toward the snout, positive y nudges down. */
    offset?: { x?: number; y?: number };
    /** Normalised sprite coordinates (0–1 each axis) of the point
     *  on the sprite that should land on the slot anchor. Defaults
     *  to (0.5, 0.5) for centred draw (eyes / neck) and (0.5, 1)
     *  for head (bottom-centre). Back-slot wings use this to pin
     *  the shoulder / body of the butterfly to the raptor's back
     *  ridge — each wing art has its attachment point in a
     *  different spot so there's no one-size-fits-all default. */
    attachmentPoint?: { x: number; y: number };
  };
}

export const COSMETICS: ReadonlyArray<CosmeticDef> = [
  // ── Score-unlock classics (free, not for sale) ─────────
  {
    id: "party-hat",
    name: "Party Hat",
    slot: "head",
    price: 0,
    scoreUnlock: true,
    spriteKey: "partyHat",
    description: "Earned at 100 points. Always a mood.",
  },
  {
    id: "thug-glasses",
    name: "Thug Glasses",
    slot: "eyes",
    price: 0,
    scoreUnlock: true,
    spriteKey: "thugGlasses",
    description: "Earned at 200 points. Deal with it.",
  },
  {
    id: "bow-tie",
    name: "Bow Tie",
    slot: "neck",
    price: 0,
    scoreUnlock: true,
    spriteKey: "bowTie",
    description: "Earned at 150 points. Dressy.",
  },

  // ── Shop: head ────────────────────────────────────────
  {
    id: "cowboy-hat",
    name: "Cowboy Hat",
    slot: "head",
    price: 50,
    spriteKey: "cowboyHat",
    description: "Yeehaw. Fits the desert.",
    draw: { scale: 0.22, rotation: -0.38, offset: { x: 0, y: 0.02 } },
  },
  {
    id: "top-hat",
    name: "Top Hat",
    slot: "head",
    price: 150,
    spriteKey: "topHat",
    description: "Fancy. Pairs with the bow tie.",
    draw: { scale: 0.2, rotation: -0.4, offset: { x: 0, y: 0 } },
  },
  {
    id: "wizard-hat",
    name: "Wizard Hat",
    slot: "head",
    price: 200,
    spriteKey: "wizardHat",
    description: "Pointy and arcane.",
    draw: { scale: 0.32, rotation: -0.12, offset: { x: 0.0, y: 0.04 } },
  },
  {
    id: "pirate-tricorn",
    name: "Pirate Tricorn",
    slot: "head",
    price: 175,
    spriteKey: "pirateTricorn",
    description: "Skull and crossbones, plumed. Pairs with the eye patch.",
    draw: { scale: 0.26, rotation: -0.1, offset: { x: -0.012, y: 0.02 } },
  },
  {
    id: "tiara",
    name: "Diadem",
    slot: "head",
    price: 350,
    spriteKey: "tiara",
    description: "Silver with a sapphire centrepiece.",
    // Tiara sprite has had its right leg cropped so the far band
    // doesn't appear in front of the raptor's face.
    draw: { scale: 0.22, rotation: -0.05, offset: { y: 0.08 } },
  },
  {
    id: "crown",
    name: "Crown",
    slot: "head",
    price: 600,
    spriteKey: "crown",
    description: "Gold, jewelled, and unmistakably regal.",
    // Sprite was cropped down to just the jewelled arches (no
    // decorative band) so it sits higher on the skull.
    draw: { scale: 0.2, rotation: -0.2, offset: { x: -0.0, y: -0.01 } },
  },
  {
    id: "sombrero",
    name: "Sombrero",
    slot: "head",
    price: 75,
    spriteKey: "sombrero",
    description: "Wide-brimmed desert shade.",
    // Massively wide brim — keep small so it doesn't eclipse
    // the head, tilted hard so the brim angles off rather than
    // sitting flat as a disc.
    draw: { scale: 0.26, rotation: -0.5, offset: { x: 0.02, y: 0.03 } },
  },

  // ── Shop: eyes ────────────────────────────────────────
  {
    id: "monocle",
    name: "Monocle",
    slot: "eyes",
    price: 100,
    spriteKey: "monocle",
    description: "Distinguished and a little silly.",
    // Round lens sits at eye level — nudged forward toward the
    // snout so the lens actually covers the eye.
    draw: { scale: 0.05, rotation: 0, offset: { x: 0.01, y: -0.01 } },
  },
  {
    id: "eye-patch",
    name: "Eye Patch",
    slot: "eyes",
    price: 50,
    spriteKey: "eyePatch",
    description: "Arrr.",
    // Centre the patch on the eye — slot-default snout-ridge
    // rotation drapes the small leading strap over the snout.
    draw: { scale: 0.08, offset: { x: -0.005, y: 0 } },
  },

  // ── Shop: neck ────────────────────────────────────────
  {
    id: "bandana",
    name: "Bandana",
    slot: "neck",
    price: 50,
    spriteKey: "bandana",
    description: "Outlaw chic — knot tied at the front.",
    // Tied with the knot at the neck; drapes down over the
    // upper chest.
    draw: { scale: 0.06, rotation: -0.05, offset: { x: -0.02, y: 0.053 } },
  },
  {
    id: "gold-chain",
    name: "Gold Chain",
    slot: "neck",
    price: 200,
    spriteKey: "goldChain",
    description: "Bejewelled bling to match the coin hoard.",
    // Pendant group sits on the neck/chest — scaled down again
    // after the last pass felt too chunky, nudged a touch down
    // and forward so the pendants rest on the throat.
    draw: { scale: 0.063, rotation: -0.3, offset: { x: -0.025, y: 0.05 } },
  },

  // ── Shop: back ────────────────────────────────────────
  // Wings render on top of the raptor body — the back-slot
  // draw pass in raptor.ts runs last so the wings overlay the
  // sprite rather than peeking around it. All wings are
  // pre-flipped so the shoulder/body sits in the sprite's right
  // half; per-wing attachmentPoints pin that actual shoulder
  // pixel to the back anchor.
  {
    id: "angel-wings",
    name: "Angel Wings",
    slot: "back",
    price: 600,
    spriteKey: "angelWings",
    description: "Feathered, luminous. Halo not included.",
    // Shoulder joint where the feathers fan out — centre-right of
    // the (pre-flipped) sprite.
    draw: {
      scale: 0.6,
      rotation: 0.5,
      offset: { x: 0.2, y: 0.09 },
      attachmentPoint: { x: 0.82, y: 0.45 },
    },
  },
  {
    id: "demon-wings",
    name: "Demon Wings",
    slot: "back",
    price: 600,
    spriteKey: "demonWings",
    description: "Boned and membraned. Runic markings optional.",
    // Horned shoulder bones converge at top-right of the sprite.
    draw: {
      scale: 0.7,
      rotation: 0.3,
      offset: { x: 0.15, y: -0.19 },
      attachmentPoint: { x: 0.68, y: 0.12 },
    },
  },
  {
    id: "butterfly-wings-orange",
    name: "Monarch Wings",
    slot: "back",
    price: 300,
    spriteKey: "butterflyWingsOrange",
    description: "Orange monarch — moons and flowers pattern.",
    // Thorax where upper and lower wings meet — middle-right of
    // the sprite.
    draw: {
      scale: 0.55,
      rotation: 0.4,
      offset: { x: 0.14, y: -0.02 },
      attachmentPoint: { x: 0.58, y: 0.45 },
    },
  },
  {
    id: "butterfly-wings-blue",
    name: "Morpho Wings",
    slot: "back",
    price: 300,
    spriteKey: "butterflyWingsBlue",
    description: "Deep-blue morpho — speckled and eyespotted.",
    draw: {
      scale: 0.55,
      rotation: -0.0,
      offset: { x: 0.1, y: 0.09 },
      attachmentPoint: { x: 0.5, y: 0.55 },
    },
  },
  {
    id: "butterfly-wings-purple",
    name: "Twilight Wings",
    slot: "back",
    price: 300,
    spriteKey: "butterflyWingsPurple",
    description: "Magenta with celestial banding.",
    // Twilight has the vertical body band on the LEFT edge.
    draw: {
      scale: 0.55,
      rotation: 0.3,
      offset: { x: 0.13, y: -0.08 },
      attachmentPoint: { x: 0.5, y: 0.35 },
    },
  },
];

/** O(1) id → def lookup, populated once at module load. */
export const COSMETICS_BY_ID: Record<string, CosmeticDef> = (() => {
  const out: Record<string, CosmeticDef> = Object.create(null);
  for (const c of COSMETICS) out[c.id] = c;
  return out;
})();

/** All cosmetics in a given slot, in the order they're declared
 *  in COSMETICS. Used by the equip menu to render slot subsections. */
export function cosmeticsForSlot(slot: CosmeticSlot): CosmeticDef[] {
  return COSMETICS.filter((c) => c.slot === slot);
}

/** Shop inventory — everything NOT score-unlocked. Grouped by slot
 *  in declaration order. */
export function shopInventory(): CosmeticDef[] {
  return COSMETICS.filter((c) => !c.scoreUnlock);
}

/** Placeholder fill colour per slot. Rendered in raptor.ts when a
 *  cosmetic has no sprite yet — distinct hues so the four slots
 *  stay visually separable while we're testing the equip flow. */
export const PLACEHOLDER_COLORS: Record<CosmeticSlot, string> = {
  head: "#d97706", // amber
  eyes: "#1f2937", // slate
  neck: "#b91c1c", // red
  back: "#7c3aed", // violet
};

// ═════════════════════════════════════════════════════════════
// Mutation helpers (grant, buy, equip, unequip)
//
// These are the ONLY path gameplay code / the shop / the menu
// should use to change owned or equipped cosmetics. Each helper
// persists both the new map-based source of truth and the legacy
// per-item flags (UNLOCKED_PARTY_HAT_KEY etc.) so the existing
// Game API shims stay correct without reading from the new maps.
// ═════════════════════════════════════════════════════════════

import { state } from "./state";
import {
  saveOwnedCosmetics,
  saveEquippedCosmetics,
  saveCoinsBalance,
  saveBoolFlag,
} from "./persistence";
import {
  UNLOCKED_PARTY_HAT_KEY,
  UNLOCKED_THUG_GLASSES_KEY,
  UNLOCKED_BOW_TIE_KEY,
  WEAR_PARTY_HAT_KEY,
  WEAR_THUG_GLASSES_KEY,
  WEAR_BOW_TIE_KEY,
} from "./constants";

/** Map cosmetic id → localStorage key for the legacy "unlocked"
 *  flag. Only the three score-unlock classics have legacy flags —
 *  new shop items live entirely in the new maps. */
const LEGACY_UNLOCK_KEY: Record<string, string> = {
  "party-hat": UNLOCKED_PARTY_HAT_KEY,
  "thug-glasses": UNLOCKED_THUG_GLASSES_KEY,
  "bow-tie": UNLOCKED_BOW_TIE_KEY,
};

/** Map cosmetic id → localStorage key for the legacy "wearing"
 *  flag, parallel structure to LEGACY_UNLOCK_KEY. */
const LEGACY_WEAR_KEY: Record<string, string> = {
  "party-hat": WEAR_PARTY_HAT_KEY,
  "thug-glasses": WEAR_THUG_GLASSES_KEY,
  "bow-tie": WEAR_BOW_TIE_KEY,
};

/** The parallel field name on the mutable `state` object for each
 *  legacy flag. Used by the bridging logic in grant/equip/unequip
 *  so state readers and the persistence layer stay in lockstep. */
const LEGACY_UNLOCK_STATE: Record<string, keyof typeof state> = {
  "party-hat": "unlockedPartyHat",
  "thug-glasses": "unlockedThugGlasses",
  "bow-tie": "unlockedBowTie",
};
const LEGACY_WEAR_STATE: Record<string, keyof typeof state> = {
  "party-hat": "wearPartyHat",
  "thug-glasses": "wearThugGlasses",
  "bow-tie": "wearBowTie",
};

/**
 * Add a cosmetic to the player's inventory. Auto-equips it in its
 * slot if that slot is currently empty — nice first-impression for
 * score unlocks and shop buys alike. No-op if already owned.
 * Persists both the new map and the legacy flag bridge.
 *
 * `forceEquip` overrides the "only if slot is empty" guard and
 * displaces whatever is currently equipped. Used for score / jump
 * achievement unlocks (party hat, thug glasses, bow tie) where the
 * newly-earned item IS the reward — showing it on the raptor
 * immediately is the celebratory moment. Purchases stay on the
 * default behaviour so buying a second hat doesn't silently swap
 * out the one the player is wearing.
 */
export function grantCosmetic(
  id: string,
  { forceEquip = false }: { forceEquip?: boolean } = {},
): void {
  const def = COSMETICS_BY_ID[id];
  if (!def) return;
  if (!state.ownedCosmetics[id]) {
    state.ownedCosmetics[id] = true;
    saveOwnedCosmetics(state.ownedCosmetics);
    const stateKey = LEGACY_UNLOCK_STATE[id];
    const storageKey = LEGACY_UNLOCK_KEY[id];
    if (stateKey && storageKey) {
      (state as unknown as Record<string, unknown>)[stateKey] = true;
      saveBoolFlag(storageKey, true);
    }
  }
  if (forceEquip || state.equippedCosmetics[def.slot] == null) {
    equipCosmetic(id);
  }
}

/**
 * Attempt to buy a cosmetic with the current coin balance. Returns
 * a status the shop UI can use to render feedback:
 *   • "ok"          — purchased, balance deducted, item granted
 *   • "owned"       — already in inventory
 *   • "poor"        — not enough coins
 *   • "unknown"     — no cosmetic with that id (shouldn't happen
 *                     for UI-generated clicks, but defensive)
 */
export type PurchaseResult = "ok" | "owned" | "poor" | "unknown";
export function purchaseCosmetic(id: string): PurchaseResult {
  const def = COSMETICS_BY_ID[id];
  if (!def) return "unknown";
  if (state.ownedCosmetics[id]) return "owned";
  if (state.coinsBalance < def.price) return "poor";
  state.coinsBalance -= def.price;
  saveCoinsBalance(state.coinsBalance);
  grantCosmetic(id);
  return "ok";
}

/**
 * Equip a cosmetic in its slot, displacing whatever was there. The
 * displaced item stays owned — the player just isn't wearing it.
 * No-op if the cosmetic isn't in inventory.
 */
export function equipCosmetic(id: string): void {
  const def = COSMETICS_BY_ID[id];
  if (!def) return;
  if (!state.ownedCosmetics[id]) return;
  const prev = state.equippedCosmetics[def.slot];
  if (prev === id) return;
  // Clear the legacy "wear" bit for whatever was previously in
  // this slot so the old flag doesn't outlive the swap.
  if (prev) _clearLegacyWear(prev);
  state.equippedCosmetics[def.slot] = id;
  saveEquippedCosmetics(state.equippedCosmetics);
  _setLegacyWear(id, true);
}

/** Remove whatever is equipped in the given slot; slot becomes empty. */
export function unequipSlot(slot: CosmeticSlot): void {
  const prev = state.equippedCosmetics[slot];
  if (prev == null) return;
  _clearLegacyWear(prev);
  state.equippedCosmetics[slot] = null;
  saveEquippedCosmetics(state.equippedCosmetics);
}

function _setLegacyWear(id: string, on: boolean): void {
  const stateKey = LEGACY_WEAR_STATE[id];
  const storageKey = LEGACY_WEAR_KEY[id];
  if (!stateKey || !storageKey) return;
  (state as unknown as Record<string, unknown>)[stateKey] = on;
  saveBoolFlag(storageKey, on);
}
function _clearLegacyWear(id: string): void {
  _setLegacyWear(id, false);
}

/**
 * Bridge legacy unlock/wear flags into the new maps on boot. Called
 * from init() after persistence is hydrated. Idempotent: rerunning
 * it on an already-migrated save is a no-op. Without this a player
 * who earned cosmetics before the shop landed would see an empty
 * Cosmetics section.
 */
export function migrateLegacyCosmetics(): void {
  const pairs: Array<[string, boolean, boolean]> = [
    ["party-hat", state.unlockedPartyHat, state.wearPartyHat],
    ["thug-glasses", state.unlockedThugGlasses, state.wearThugGlasses],
    ["bow-tie", state.unlockedBowTie, state.wearBowTie],
  ];
  let changed = false;
  for (const [id, unlocked, worn] of pairs) {
    if (!unlocked) continue;
    if (!state.ownedCosmetics[id]) {
      state.ownedCosmetics[id] = true;
      changed = true;
    }
    const def = COSMETICS_BY_ID[id];
    if (!def) continue;
    // Only fill an empty slot — don't overwrite a new shop item the
    // player has explicitly equipped since the migration.
    if (worn && state.equippedCosmetics[def.slot] == null) {
      state.equippedCosmetics[def.slot] = id;
      changed = true;
    }
  }
  if (changed) {
    saveOwnedCosmetics(state.ownedCosmetics);
    saveEquippedCosmetics(state.equippedCosmetics);
  }
}
