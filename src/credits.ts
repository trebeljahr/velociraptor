/*
 * Raptor Runner — shared third-party attribution data.
 *
 * Single source of truth for credits that appear in more than one
 * place. Consumed at BUILD TIME by the creditsBuildInjectPlugin in
 * vite.config.ts, which renders the sections into two places:
 *   • index.html   → #credits-attribution-sections (credits overlay)
 *   • imprint.html → #imprint-attribution-sections ("Credits & Asset Sources")
 * Both pages ship as static HTML — no runtime module has to execute
 * for the attributions to appear.
 *
 * The game-side-only sections (Game / Homage / Writing / Legal) live
 * in index.html directly because they don't appear in the imprint.
 * The legal-scaffolding sections (Service Provider / Liability /
 * Copyright / …) live in imprint.html directly because they don't
 * appear in the game.
 *
 * Only THIRD-PARTY ATTRIBUTIONS live here — everything both files
 * have to show identically, so the two can't drift apart.
 *
 * Keep every URL identical to what Pixabay / Freepik / FMA provided:
 * link attribution with the full utm_source=link-attribution… query
 * strings is what those licenses require.
 */

export interface AttributionSection {
  /** Stable identifier — used only for debug/testing, not rendered. */
  id: string;
  /** Section title ("Music", "Sound effects", "Art", "Engine & code"). */
  title: string;
  /** List of HTML fragments. Each becomes a list item (or a single
   *  paragraph depending on render options). Fragments may contain
   *  <a>, <code>, etc. — treat them as trusted markup authored here. */
  items: string[];
}

/**
 * The shared attribution sections, in their preferred render order.
 * Order matches both the credits overlay and the imprint so the two
 * read consistently.
 */
export const ATTRIBUTION_SECTIONS: ReadonlyArray<AttributionSection> = [
  {
    id: "art",
    title: "Art",
    items: [
      `Raptor sprite + running animation by
        <a href="https://www.deviantart.com/chrismasna/art/Run-Forrest-Run-317351694" target="_blank" rel="noopener">Chris Masna</a>
        ("Run Forrest Run" on DeviantArt), used with explicit permission.`,
      `Cactus illustrations (<code>cactus1.png</code> – <code>cactus8.png</code>) extracted from
        <a href="https://www.freepik.com/free-vector/big-small-cactuses-illustrations-set-collection-cacti-spiny-tropical-plants-with-flowers-blossoms-arizona-mexico-succulents-isolated-white_20827544.htm" target="_blank" rel="noopener">"Big and small cactuses vector illustrations set"</a>
        by <a href="https://www.freepik.com" target="_blank" rel="noopener">Freepik</a>, used under the Freepik Free License (attribution required).`,
      `Party hat (<code>party-hat.png</code>) from
        <a href="https://www.freepik.com/free-vector/party-hat-icon-isolated-design_89158498.htm" target="_blank" rel="noopener">"Party hat icon isolated design"</a>
        on Freepik. Background removed locally for in-game compositing.`,
      `Red bow tie (<code>bow-tie.png</code>) from
        <a href="https://www.freepik.com/free-vector/black-white-red-bow-tie-set-gentleman-formal-luxury-fashion-element-costume-ceremony-wedding-party_22676468.htm" target="_blank" rel="noopener">"Black white red bow tie set"</a>
        on Freepik. Cropped and background removed locally.`,
      `"Thug life" sunglasses (<code>thug-glasses.png</code>) from
        <a href="https://commons.wikimedia.org/wiki/File:Thug_Life_Glasses.png" target="_blank" rel="noopener">File:Thug_Life_Glasses.png</a>
        on Wikimedia Commons, by user Aboulharakat (2016). Licensed
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
        Background flood-filled to transparent locally so the lens highlights survive.`,
      `Flower sprites (<code>flower-01.png</code> – <code>flower-12.png</code>) cropped from
        <a href="https://www.freepik.com/free-vector/organic-flat-flower-collection_13398452.htm" target="_blank" rel="noopener">"Organic flat flower collection"</a>
        by <a href="https://www.freepik.com" target="_blank" rel="noopener">Freepik</a>, used under the Freepik Free License. Backgrounds keyed to transparent and each flower trimmed to a standalone sprite locally.`,
      `Coin collectible (<code>coin.png</code>) from
        <a href="https://www.freepik.com/free-vector/golden-cryptocurrency-coin-vector-illustration_414135258.htm" target="_blank" rel="noopener">"Golden cryptocurrency coin vector illustration"</a>
        by <a href="https://www.freepik.com/author/brgfx" target="_blank" rel="noopener">brgfx</a>
        on <a href="https://www.freepik.com" target="_blank" rel="noopener">Freepik</a>, used under the Freepik Free License. Converted from EPS to a transparent PNG and resized locally.`,
    ],
  },
  {
    id: "music",
    title: "Music",
    items: [
      `Background loop — "L'Etoile danse (Pt. 1)" by
        <a href="https://freemusicarchive.org/music/Meydan/Havor/6-_LEtoile_danse_Pt_1_1738/" target="_blank" rel="noopener">Meydän</a>,
        from the album
        <a href="https://freemusicarchive.org/music/Meydan/Havor" target="_blank" rel="noopener">Havor</a>
        (2018), licensed
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>
        via Free Music Archive.`,
    ],
  },
  {
    id: "sfx",
    title: "Sound effects",
    items: [
      `Jump — "SFX_Jump_22" from the
        <a href="https://jalastram.itch.io/8-bit-jump-sound-effects" target="_blank" rel="noopener">8-bit Jump Sound Effects</a>
        pack by Jesús Lastra (jalastram), licensed
        <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>.`,
      `Raptor footsteps — excerpted from
        <a href="https://pixabay.com/sound-effects/running-in-grass-6237/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=6237" target="_blank" rel="noopener">"Running in grass"</a>
        by
        <a href="https://pixabay.com/users/freesound_community-46691455/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=6237" target="_blank" rel="noopener">freesound_community</a>
        from
        <a href="https://pixabay.com/sound-effects/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=6237" target="_blank" rel="noopener">Pixabay</a>.`,
      `Game over (cactus impact) — sound effect by
        <a href="https://pixabay.com/users/freesound_community-46691455/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=45430" target="_blank" rel="noopener">freesound_community</a>
        from
        <a href="https://pixabay.com/sound-effects/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=45430" target="_blank" rel="noopener">Pixabay</a>.`,
      `Rain ambience — sound effect by
        <a href="https://pixabay.com/users/boons_freak-39857343/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=188158" target="_blank" rel="noopener">Pig Bank - Mood</a>
        from
        <a href="https://pixabay.com/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=188158" target="_blank" rel="noopener">Pixabay</a>.`,
      `Thunder clap — sound effect by
        <a href="https://pixabay.com/users/soundmarker33-55268643/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=512544" target="_blank" rel="noopener">soundmarker33</a>
        from
        <a href="https://pixabay.com/sound-effects/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=512544" target="_blank" rel="noopener">Pixabay</a>.`,
      `UFO hover — sound effect by
        <a href="https://pixabay.com/users/soundreality-31074404/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=177355" target="_blank" rel="noopener">SoundReality</a>
        from
        <a href="https://pixabay.com/sound-effects/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=177355" target="_blank" rel="noopener">Pixabay</a>.`,
      `Santa sleigh bells — sound effect by
        <a href="https://pixabay.com/users/dragon-studio-38165424/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=439597" target="_blank" rel="noopener">DRAGON-STUDIO</a>
        from
        <a href="https://pixabay.com/sound-effects/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=439597" target="_blank" rel="noopener">Pixabay</a>.`,
      `Meteor impact — sound effect by
        <a href="https://pixabay.com/users/dragon-studio-38165424/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=386181" target="_blank" rel="noopener">DRAGON-STUDIO</a>
        from
        <a href="https://pixabay.com/sound-effects/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=386181" target="_blank" rel="noopener">Pixabay</a>.`,
      `Comet sparkle — sound effect by
        <a href="https://pixabay.com/users/alice_soundz-44907632/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=224184" target="_blank" rel="noopener">Alice_soundz</a>
        from
        <a href="https://pixabay.com/sound-effects/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=224184" target="_blank" rel="noopener">Pixabay</a>.`,
      `Coin pickup — "Pause Piano Sound" sound effect by
        <a href="https://pixabay.com/users/freesound_community-46691455/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=40579" target="_blank" rel="noopener">freesound_community</a>
        from
        <a href="https://pixabay.com/sound-effects/pause-piano-sound-40579/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=40579" target="_blank" rel="noopener">Pixabay</a>.`,
      `Coin chain-end chord — "Diamond found" sound effect by
        <a href="https://pixabay.com/users/liecio-3298866/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=190255" target="_blank" rel="noopener">Liecio</a>
        from
        <a href="https://pixabay.com/sound-effects/diamond-found-190255/?utm_source=link-attribution&amp;utm_medium=referral&amp;utm_campaign=music&amp;utm_content=190255" target="_blank" rel="noopener">Pixabay</a>.`,
    ],
  },
  {
    id: "engine",
    title: "Engine & code",
    items: [
      `Vanilla HTML5 canvas, <code>requestAnimationFrame</code>, and the
        native <code>&lt;audio&gt;</code> element — no external game engine
        or library.`,
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Heading level for the section titles. Default "h2". */
  headingLevel?: "h2" | "h3";
  /** Wrap each section in <section class="…"> (credits overlay style).
   *  When false, emits just `<hN>title</hN><ul>…</ul>` (imprint style). */
  sectionWrap?: boolean;
  /** Class for the section wrapper. Only used when sectionWrap=true. */
  sectionClass?: string;
  /** Class for the <ul> bullet list. Pass null to emit <ul> with no class. */
  listClass?: string | null;
  /** Inline style string applied to every section heading — used by the
   *  imprint to match its existing style="font-size: 1rem; …" pattern. */
  headingInlineStyle?: string;
  /** If true, single-item sections render as <ul><li> anyway. Default:
   *  render single items as <p> (credits overlay style). Imprint sets
   *  this to true so its "Engine & code" section stays a bulleted list. */
  listAlways?: boolean;
}

/** Render the given attribution sections as an HTML string. */
export function renderAttributionHTML(
  sections: readonly AttributionSection[],
  opts: RenderOptions = {},
): string {
  const H = opts.headingLevel ?? "h2";
  const wrap = opts.sectionWrap ?? true;
  const sectionClass = opts.sectionClass ?? "credits-section";
  const listClass =
    opts.listClass === null ? "" : (opts.listClass ?? "credits-links");
  const listClassAttr = listClass ? ` class="${listClass}"` : "";
  const headingStyle = opts.headingInlineStyle
    ? ` style="${opts.headingInlineStyle}"`
    : "";
  const listAlways = opts.listAlways ?? false;

  return sections
    .map((s) => {
      const body =
        !listAlways && s.items.length === 1
          ? `<p>${s.items[0]}</p>`
          : `<ul${listClassAttr}>${s.items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
      const heading = `<${H}${headingStyle}>${s.title}</${H}>`;
      return wrap
        ? `<section class="${sectionClass}">${heading}${body}</section>`
        : `${heading}${body}`;
    })
    .join("\n");
}
