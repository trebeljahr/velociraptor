/*
 * Raptor Runner — vanilla canvas + requestAnimationFrame rewrite.
 *
 * Architecture:
 *   • All drawing is done on a single <canvas id="game-canvas"> that
 *     sits behind the UI overlays (start screen, menu, imprint, cog).
 *   • The raptor sprite is a separate <img id="raptor-sprite"> positioned
 *     absolutely over the canvas. The browser handles GIF animation for
 *     free — we just translate the element each frame.
 *   • Music and jump SFX are native <audio> elements controlled directly
 *     from the HTML layer via the Game API. No p5.sound.
 *   • Input: pointerdown on canvas (covers mouse + touch + pen),
 *     keydown on window (Space/W/Up to jump, Enter to restart).
 *   • The game loop is a plain requestAnimationFrame. `state.paused` is
 *     used to gate update() without stopping render() so the canvas
 *     stays visible while the menu/start-screen is open.
 *
 * Public API (exposed on window.Game):
 *   Game.onReady(cb)         – invoked once assets are loaded
 *   Game.start()             – unpauses the game (call after the user
 *                              clicks the Start Game button)
 *   Game.pause() / resume()  – called when menus open/close
 *   Game.isStarted()         – true after Game.start() has been called
 *   Game.setMuted(muted)     – controls both music and jump SFX
 *   Game.isMuted()
 */
(function () {
  "use strict";

  // ══════════════════════════════════════════════════════════════════
  // Constants
  // ══════════════════════════════════════════════════════════════════

  const INITIAL_BG_VELOCITY = 7;
  const GRAVITY = 0.1;
  const JUMP_CLEARANCE_MULTIPLIER = 1.65;
  const SKY_CYCLE_SCORE = 60;
  const SKY_UPDATE_INTERVAL_FRAMES = 10;

  // localStorage key for the player's personal best. Namespaced so it
  // doesn't collide with anything else on the same origin.
  const HIGH_SCORE_KEY = "raptor-runner:highScore";
  // localStorage key for the mute preference. Persisted across
  // sessions so players who mute the music don't get blasted every
  // time they reopen the tab.
  const MUTED_KEY = "raptor-runner:muted";
  const MUSIC_MUTED_KEY = "raptor-runner:musicMuted";
  const JUMP_MUTED_KEY = "raptor-runner:jumpMuted";
  // localStorage key for the cumulative jump count. Kept for
  // backwards-compatibility with earlier versions that gated the
  // cosmetic unlocks on total jumps.
  const TOTAL_JUMPS_KEY = "raptor-runner:totalJumps";
  // Cosmetic unlocks are earned by scoring this many points (i.e.
  // cleared cacti) in a SINGLE run. Score is the honest measure of
  // skill — a player can pad their jump count by tapping in place,
  // but they can't fake clearing actual obstacles.
  const PARTY_HAT_SCORE_THRESHOLD = 100;
  const THUG_GLASSES_SCORE_THRESHOLD = 500;
  const BOW_TIE_SCORE_THRESHOLD = 200;
  // Per-accessory unlock + wear flags in localStorage. "unlocked"
  // is a sticky bit set when the player first crosses the jump
  // threshold; "wear" is the player's current on/off cosmetic
  // preference, defaults to true the moment the accessory is
  // earned. Both persist across sessions.
  const UNLOCKED_PARTY_HAT_KEY = "raptor-runner:unlocked:partyHat";
  const UNLOCKED_THUG_GLASSES_KEY = "raptor-runner:unlocked:thugGlasses";
  const WEAR_PARTY_HAT_KEY = "raptor-runner:wear:partyHat";
  const WEAR_THUG_GLASSES_KEY = "raptor-runner:wear:thugGlasses";
  const UNLOCKED_BOW_TIE_KEY = "raptor-runner:unlocked:bowTie";
  const WEAR_BOW_TIE_KEY = "raptor-runner:wear:bowTie";
  // Career-wide run counter + unlocked achievement IDs live
  // under their own keys so storage is namespaced and easy to
  // wipe independently of the jump / mute preferences.
  const CAREER_RUNS_KEY = "raptor-runner:careerRuns";
  const ACHIEVEMENTS_KEY = "raptor-runner:achievements";
  const TOTAL_DAY_CYCLES_KEY = "raptor-runner:totalDayCycles";
  const RARE_EVENTS_SEEN_KEY = "raptor-runner:rareEventsSeen";

  // ── Achievement catalog ────────────────────────────────────
  // Each entry carries a stable `id` (used for storage), a
  // short display title, and a one-line description of how to
  // earn it.
  //
  // Icons are inline SVG fragments, drawn at 24×24 inside a
  // shared viewBox. Unlike Lucide-style monochrome line icons,
  // these are multi-colour vector illustrations coloured from
  // the game's own palette — cactus greens, sky blues, sunset
  // golds, moon creams — so the shell can render them directly
  // without a CSS `currentColor` pass.
  //
  // A few entries use `iconImage` to pull an actual sprite from
  // /assets (the party hat and thug glasses cosmetics) so the
  // reward preview is pixel-accurate to the thing you unlock.
  const ACHIEVEMENTS = [
    {
      id: "first-run",
      title: "First Steps",
      desc: "Complete your first run",
      // Classic 3-toed dinosaur footprint — wide splaying toes
      // with pointed claw tips from a teardrop heel. Matches the
      // top-left silhouette from the reference image.
      iconHTML:
        '<path d="M12 22 C9.5 22 8.5 20.5 9 18.5 L10.5 14 C9 13.5 6.5 12 5.5 9 C4.8 6.8 6 5.5 7.5 6.2 C8.8 6.8 9.5 9 10.5 12 L11.5 14.5 L11.5 9.5 C11 7 11.2 3.5 12 2 C12.8 3.5 13 7 12.5 9.5 L12.5 14.5 L13.5 12 C14.5 9 15.2 6.8 16.5 6.2 C18 5.5 19.2 6.8 18.5 9 C17.5 12 15 13.5 13.5 14 L15 18.5 C15.5 20.5 14.5 22 12 22Z" fill="#6d7580"/>',
    },
    {
      id: "first-jump",
      title: "Up And Over",
      desc: "Clear your first cactus",
      // The small flowering cactus sprite with a solid curved
      // arrow arcing high above it, ending in an arrowhead on the
      // right — reads as "jumped clean over the obstacle".
      iconHTML:
        '<image href="assets/cactus2.png" x="5" y="10" width="14" height="14" preserveAspectRatio="xMidYMax meet"/>' +
        '<path d="M3 10 A12 12 0 0 1 21 10" fill="none" stroke="#3498db" stroke-width="1.5" stroke-linecap="round"/>' +
        '<polygon points="22,7 22,13 18,10" fill="#3498db"/>',
    },
    {
      id: "score-25",
      title: "Getting The Hang Of It",
      desc: "Score 25 points in a single run",
      // The tall saguaro cactus sprite with a green check badge
      // — same design language as the first-jump icon but with a
      // "you've got this" confirmation overlay.
      iconHTML:
        '<image href="assets/cactus7.png" x="3" y="2" width="13" height="22" preserveAspectRatio="xMidYMax meet"/>' +
        '<circle cx="18" cy="7" r="5" fill="#ffffff" stroke="#3498db" stroke-width="1.2"/>' +
        '<path d="M15.5 7l2 2 3.2-3.4" fill="none" stroke="#2d9d55" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    {
      id: "party-time",
      title: "Party Time",
      desc: "Score 100 points in a single run",
      // The actual party hat cosmetic sprite.
      iconImage: "assets/party-hat.png",
    },
    {
      id: "dinosaurs-forever",
      title: "Dinosaurs Forever",
      desc: "Score 200 points in a single run",
      iconImage: "assets/bow-tie.png",
    },
    {
      id: "score-250",
      title: "Raptor Legend",
      desc: "Score 500 points in a single run",
      iconImage: "assets/thug-glasses.png",
    },
    {
      id: "first-night",
      title: "Night Owl",
      desc: "Survive your first full night",
      // Full night-sky circle with a crescent moon — no loose
      // stars, just a clean moon on the dark field.
      iconHTML:
        '<circle cx="12" cy="12" r="12" fill="#1e2a44"/>' +
        '<path d="M16 7a6 6 0 1 0 1 9 5 5 0 0 1-1-9z" fill="#f4f0d6"/>',
    },
    {
      id: "ten-nights",
      title: "Insomniac",
      desc: "Survive 10 nights in a single run",
      // Full night-sky circle with a smaller crescent moon and
      // ten stars equally spaced in a ring around the centre.
      // r=10, centre 12,12, angle = i*36° starting at 0°.
      iconHTML:
        '<circle cx="12" cy="12" r="12" fill="#1e2a44"/>' +
        '<path d="M14 8a4 4 0 1 0 .8 6.5 3.2 3.2 0 0 1-.8-6.5z" fill="#f4f0d6"/>' +
        '<circle cx="22" cy="12" r="0.7" fill="#fff"/>' +     // 0°
        '<circle cx="20.1" cy="5.9" r="0.7" fill="#fff"/>' +  // 36°
        '<circle cx="15.1" cy="2.2" r="0.7" fill="#fff"/>' +  // 72°
        '<circle cx="8.9" cy="2.2" r="0.7" fill="#fff"/>' +   // 108°
        '<circle cx="3.9" cy="5.9" r="0.7" fill="#fff"/>' +   // 144°
        '<circle cx="2" cy="12" r="0.7" fill="#fff"/>' +      // 180°
        '<circle cx="3.9" cy="18.1" r="0.7" fill="#fff"/>' +  // 216°
        '<circle cx="8.9" cy="21.8" r="0.7" fill="#fff"/>' +  // 252°
        '<circle cx="15.1" cy="21.8" r="0.7" fill="#fff"/>' + // 288°
        '<circle cx="20.1" cy="18.1" r="0.7" fill="#fff"/>',  // 324°
    },
    {
      id: "twenty-nights",
      title: "Marathon Sleeper",
      desc: "Survive 20 nights in a single run",
      // Sun + moon pair — you've lived through the full cycle a
      // lot of times.
      iconHTML:
        '<circle cx="8" cy="12" r="4" fill="#ffd455" stroke="#c78a12" stroke-width="0.8"/>' +
        '<g stroke="#ffd455" stroke-width="1.2" stroke-linecap="round">' +
        '<line x1="8" y1="4" x2="8" y2="6"/>' +
        '<line x1="8" y1="18" x2="8" y2="20"/>' +
        '<line x1="1.5" y1="12" x2="3.5" y2="12"/>' +
        '<line x1="3.5" y1="7.5" x2="4.9" y2="8.9"/>' +
        '<line x1="3.5" y1="16.5" x2="4.9" y2="15.1"/>' +
        '</g>' +
        '<circle cx="17" cy="12" r="4.5" fill="#1e2a44"/>' +
        '<path d="M18.5 9a3.5 3.5 0 1 0 0 6 3 3 0 0 1 0-6z" fill="#f4f0d6"/>',
    },
    {
      id: "first-shooting-star",
      title: "Make A Wish",
      desc: "See your first shooting star",
      // Gold star with a trailing streak fading into sky blue.
      iconHTML:
        '<path d="M3 20l9-9" stroke="#8fd1ff" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M5 18l5-5" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>' +
        '<path d="M16 3l1.6 3.4 3.7.5-2.7 2.6.7 3.7-3.3-1.8-3.3 1.8.7-3.7L9.7 6.9l3.7-.5z" fill="#f7d148" stroke="#c78a12" stroke-width="0.8" stroke-linejoin="round"/>',
    },
    {
      id: "century-runner",
      title: "Century Runner",
      desc: "Complete 100 runs",
      // Ribbon medal: gold disc + two ribbon tails. Larger disc
      // with compact text so "100" has room to breathe.
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
      // Speaker with a diagonal slash — same visual language as
      // the game's own mute button up in the top-right cluster.
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
  const ACHIEVEMENTS_BY_ID = Object.create(null);
  for (const a of ACHIEVEMENTS) ACHIEVEMENTS_BY_ID[a.id] = a;

  const RAPTOR_NATIVE_W = 578;
  const RAPTOR_NATIVE_H = 212;
  const RAPTOR_ASPECT = RAPTOR_NATIVE_H / RAPTOR_NATIVE_W;
  // Sprite sheet is the 12 GIF frames stacked vertically (578 × 2544).
  const RAPTOR_FRAMES = 12;
  const RAPTOR_IDLE_FRAME = 11; // pose used when airborne (legs tucked)

  // Per-frame head reference points, extracted by scanning each
  // frame of assets/raptor-sheet.png for the topmost opaque pixel
  // (the "crown") and the rightmost opaque pixel in the upper head
  // band (the "snout tip"). Values are normalized to the native
  // 578×212 frame dimensions so the game can multiply them by the
  // current raptor w/h to get exact anchor positions. Used to bob
  // head-mounted accessories (party hat, thug glasses) so they
  // track the run cycle animation instead of floating.
  const RAPTOR_CROWN = [
    [0.86332, 0.16038], // frame 0
    [0.86678, 0.16509], // frame 1
    [0.88062, 0.17925], // frame 2
    [0.87370, 0.17453], // frame 3
    [0.86851, 0.16038], // frame 4
    [0.86851, 0.15566], // frame 5
    [0.86505, 0.16509], // frame 6
    [0.86851, 0.16981], // frame 7
    [0.87024, 0.17925], // frame 8
    [0.87543, 0.16981], // frame 9
    [0.87197, 0.16509], // frame 10
    [0.86851, 0.15566], // frame 11
  ];
  const RAPTOR_SNOUT = [
    [0.98097, 0.25943], // frame 0
    [0.98616, 0.26415], // frame 1
    [0.99135, 0.27358], // frame 2
    [0.99827, 0.26415], // frame 3
    [0.99135, 0.25943], // frame 4
    [0.98789, 0.25472], // frame 5
    [0.98097, 0.25943], // frame 6
    [0.98616, 0.26887], // frame 7
    [0.99135, 0.27358], // frame 8
    [0.99827, 0.26415], // frame 9
    [0.99135, 0.25943], // frame 10
    [0.98616, 0.25472], // frame 11
  ];
  // Frame delay in milliseconds at the initial background velocity.
  // Decreases as the game speeds up, mirroring the old p5 `img.delay(...)`
  // speed-ramp from 70 ms down to 40 ms.
  const RAPTOR_FRAME_DELAY_MIN = 40;
  const RAPTOR_FRAME_DELAY_MAX = 70;
  // Pixels to shrink the raptor's collision polygon inward, so the
  // hitbox is slightly smaller than the visible silhouette. Makes
  // collisions feel fair rather than punishing near-misses.
  const RAPTOR_COLLISION_INSET = 4;

  // Each variant has a `collision` polygon expressed in normalized
  // (0..1) coordinates relative to the cactus bounding box. Polygons
  // roughly trace the opaque silhouette of the main body and exclude
  // thin spikes, small pad arms and pink blooms — shapes that would
  // visually look like "near misses" for the player and shouldn't
  // trigger game-over. Points go clockwise.
  const CACTUS_VARIANTS = [
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

  // 12-band day/night cycle. Day and night are roughly equal, with
  // shorter sunset/sunrise transitions in between.
  //   bands 0–1 → solid blue (early day, wraps from end of cycle)
  //   band 2   → blue → magenta-pink (sunset color shift)
  //   band 3   → magenta-pink → night (twilight darkening)
  //   bands 4–6 → solid night (when stars and moon are out)
  //   band 7   → night → magenta-pink (pre-dawn glow)
  //   band 8   → magenta-pink → blue (sunrise color shift)
  //   bands 9–11 → solid blue (long sunny day)
  //
  // The transition color is magenta-pink rather than orange because
  // a linear RGB lerp from blue→orange passes through an ugly
  // desaturated grey-green midpoint. Blue→magenta passes through
  // light purple, and magenta→night through deep twilight purple —
  // both pleasant intermediate colors.
  const SKY_COLORS = [
    [80, 180, 205],  // 0  blue
    [80, 180, 205],  // 1  blue
    [80, 180, 205],  // 2  blue
    [80, 180, 205],  // 3  blue
    [80, 180, 205],  // 4  blue
    [220, 90, 120],  // 5  magenta-pink (sunset)
    [21, 34, 56],    // 6  night
    [21, 34, 56],    // 7  night
    [21, 34, 56],    // 8  night
    [21, 34, 56],    // 9  night
    [21, 34, 56],    // 10 night
    [220, 90, 120],  // 11 magenta-pink (sunrise)
  ];

  // Night detection derived from SKY_COLORS so it adapts
  // automatically if bands are added, removed, or reordered.
  const NIGHT_COLOR = [21, 34, 56];
  const _isNightBand = SKY_COLORS.map(
    (c) => c[0] === NIGHT_COLOR[0] && c[1] === NIGHT_COLOR[1] && c[2] === NIGHT_COLOR[2]
  );
  /** True when bandIndex (+ fractional bandT) is in the dark zone:
   *  solid-night bands, plus the dark half of each adjacent twilight. */
  function isNightPhase(bandIndex, bandT) {
    if (_isNightBand[bandIndex]) return true;
    // Transitioning INTO night (next band is night): dark half = bandT > 0.5
    const next = (bandIndex + 1) % SKY_COLORS.length;
    if (_isNightBand[next] && bandT > 0.5) return true;
    // Transitioning OUT OF night (prev band is night): dark half = bandT < 0.5
    const prev = (bandIndex - 1 + SKY_COLORS.length) % SKY_COLORS.length;
    if (_isNightBand[prev] && bandT < 0.5) return true;
    return false;
  }
  // Daytime band indices (for night-survival tracking: count the
  // night as survived once the sky is solidly in a day band).
  const _isDayBand = _isNightBand.map((night, i) => {
    if (night) return false;
    // Exclude twilight/transition bands (adjacent to a night band).
    const prev = (i - 1 + SKY_COLORS.length) % SKY_COLORS.length;
    const next = (i + 1) % SKY_COLORS.length;
    return !_isNightBand[prev] && !_isNightBand[next];
  });

  const IMAGE_SRCS = {
    raptorSheet: "assets/raptor-sheet.png",
    partyHat: "assets/party-hat.png",
    thugGlasses: "assets/thug-glasses.png",
    bowTie: "assets/bow-tie.png",
    ufo: "assets/ufo.png",
    santaSleigh: "assets/santa-sleigh.png",
    reindeer: "assets/reindeer.png",
    tumbleweed: "assets/tumbleweed.png",
  };
  for (const v of CACTUS_VARIANTS) IMAGE_SRCS[v.key] = `assets/${v.key}.png`;
  const IMAGES = {};

  // ══════════════════════════════════════════════════════════════════
  // Math + collision helpers
  // ══════════════════════════════════════════════════════════════════

  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpColor = (a, b, t) => [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

  /** Strength of the foreground sky-light tint applied in render().
   *  Continuous: 0.05 at midday under a clean blue sky (so the
   *  foreground reads as neutral, not blue-cast), rising through
   *  ~0.21 at the peak of a magenta-pink twilight, and up to ~0.37
   *  at full night. The ramp is quadratic in `t` so twilight stays
   *  subtle — roughly half of what a linear ramp would give — while
   *  night still lands at ~2/3 of the "full strength" tint. */
  function tintStrength() {
    const sky = state.currentSky;
    const dayBlue = SKY_COLORS[0];
    const dx = sky[0] - dayBlue[0];
    const dy = sky[1] - dayBlue[1];
    const dz = sky[2] - dayBlue[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Maximum sensible distance is from blue to night (~258).
    const t = Math.min(1, distance / 250);
    return 0.05 + t * t * 0.32;
  }
  /** Per-channel multiply factor that the global tint applies. */
  function tintFactor() {
    const sky = state.currentSky;
    const s = tintStrength();
    return [
      255 + (sky[0] - 255) * s,
      255 + (sky[1] - 255) * s,
      255 + (sky[2] - 255) * s,
    ];
  }
  /** Brighten `target` so that, after the global multiply-tint, it
   *  ends up reading as `target` again. Clamped to [0, 255]; for very
   *  bright targets through a strong tint the result clips at 255 and
   *  the visible color is darker than the target — that's the best
   *  we can do without using a different blend mode. */
  function preCompensate(target) {
    const f = tintFactor();
    return [
      Math.max(0, Math.min(255, Math.round((target[0] * 255) / f[0]))),
      Math.max(0, Math.min(255, Math.round((target[1] * 255) / f[1]))),
      Math.max(0, Math.min(255, Math.round((target[2] * 255) / f[2]))),
    ];
  }
  const randRange = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /**
   * Polygon-vs-polygon overlap test. Handles *concave* polygons on
   * both sides without decomposition. Three checks:
   *   1. Any vertex of A inside B? (fast path for contained shapes)
   *   2. Any vertex of B inside A? (other containment direction)
   *   3. Any edge of A crossing any edge of B? (partial overlap)
   */
  function polygonsOverlap(polyA, polyB) {
    // 1. Any vertex of A inside B?
    for (const p of polyA) if (pointInPolygon(p, polyB)) return true;
    // 2. Any vertex of B inside A?
    for (const p of polyB) if (pointInPolygon(p, polyA)) return true;
    // 3. Any edge of A crosses any edge of B?
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
  function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x,
        yi = poly[i].y;
      const xj = poly[j].x,
        yj = poly[j].y;
      const intersect =
        yi > p.y !== yj > p.y &&
        p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /** Do segments (a,b) and (c,d) strictly intersect? */
  function segmentsIntersect(a, b, c, d) {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return (
      ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    );
  }

  const cross = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  /**
   * Shrink a polygon inward by `inset` pixels, by pulling each vertex
   * toward the polygon's centroid along the line joining them. Not a
   * geometrically perfect polygon offset, but close enough for a small
   * forgiving collision buffer on an ~28-vertex silhouette.
   */
  function shrinkPolygon(poly, inset) {
    if (inset <= 0 || poly.length === 0) return poly;
    let cx = 0,
      cy = 0;
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

  // ══════════════════════════════════════════════════════════════════
  // Audio (native HTMLAudioElement — no p5.sound)
  // ══════════════════════════════════════════════════════════════════

  const audio = {
    // Default to muted so autoplay policies don't complain; the
    // saved preference (if any) is applied later in init() once the
    // music element is in the DOM.
    muted: true,
    // True once the player has explicitly saved a mute/unmute
    // preference (either by clicking the sound toggle, or by having
    // done so in a previous session). Used to decide whether the
    // Start Game button should auto-unmute (never touched before) or
    // honour the saved value (returning visitor).
    hasSavedPreference: false,
    music: null,
    // Jump SFX uses the Web Audio API instead of a second <audio>
    // element. Mobile browsers (Chrome Android in particular) only
    // allow one HTMLAudioElement to play at a time — calling
    // jump.play() would pause the music. Web Audio runs through a
    // separate pipeline and can layer any number of sounds on top
    // of the <audio> music without interference.
    musicMuted: false,
    jumpMuted: false,
    _audioCtx: null,
    _jumpBuffer: null,
    _jumpVolume: 0.67,

    init() {
      this.music = document.getElementById("game-music");
      if (this.music) this.music.volume = 0.5;
      // Load per-channel mute preferences from localStorage.
      this._loadChannelPrefs();
      // Pre-decode the jump SFX into a Web Audio buffer. The
      // AudioContext is created lazily on the first user gesture
      // (required by autoplay policy), but we fetch + decode the
      // file eagerly so the first jump has zero latency.
      this._preloadJumpBuffer();
      this._preloadThunderBuffer();
      this.initRain();
    },

    _loadChannelPrefs() {
      try {
        const m = window.localStorage.getItem(MUSIC_MUTED_KEY);
        if (m != null) this.musicMuted = m === "1";
        const j = window.localStorage.getItem(JUMP_MUTED_KEY);
        if (j != null) this.jumpMuted = j === "1";
      } catch (e) { /* ignored */ }
    },

    /** Fetch jump.mp3, decode it into an AudioBuffer, and stash it
     *  for instant playback via Web Audio. Falls back gracefully if
     *  Web Audio isn't available (old browsers). */
    _preloadJumpBuffer() {
      if (typeof AudioContext === "undefined" &&
          typeof webkitAudioContext === "undefined") return;
      fetch("assets/jump.mp3")
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          // AudioContext may not exist yet (needs user gesture on
          // some browsers). Create it now — decodeAudioData doesn't
          // require a running context, just an instance.
          this._ensureAudioCtx();
          if (!this._audioCtx) return;
          return this._audioCtx.decodeAudioData(buf);
        })
        .then((decoded) => {
          if (decoded) this._jumpBuffer = decoded;
        })
        .catch(() => {
          /* no-op — jump SFX simply won't play */
        });
    },

    _ensureAudioCtx() {
      if (this._audioCtx) return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) this._audioCtx = new Ctx();
      } catch (e) {
        /* Web Audio not available */
      }
    },

    setMuted(muted, persist = true) {
      this.muted = !!muted;
      // If the player unmutes during a live run, they broke the
      // "muted the whole way through" streak for Sound of Silence.
      if (!this.muted && state && state.started && !state.gameOver) {
        state._runMutedThroughout = false;
      }
      if (persist) {
        try {
          window.localStorage.setItem(
            MUTED_KEY,
            this.muted ? "1" : "0"
          );
          this.hasSavedPreference = true;
        } catch (e) {
          /* ignored — storage may be unavailable */
        }
      }
      if (!this.music) return;
      if (this.muted || this.musicMuted) {
        this.music.pause();
        if (this.rain && this._isRainPlaying) this.rain.pause();
      } else {
        // Resume the Web Audio context on the first unmute — mobile
        // browsers suspend it until a user gesture unblocks it.
        this._ensureAudioCtx();
        if (this._audioCtx && this._audioCtx.state === "suspended") {
          this._audioCtx.resume().catch(() => {});
        }
        // .play() returns a Promise that can reject (autoplay policy,
        // user-gesture required). Swallow the rejection — the next
        // user interaction will succeed.
        const p = this.music.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
        // Resume rain if it was playing
        if (this.rain && this._isRainPlaying) {
          const rp = this.rain.play();
          if (rp && typeof rp.catch === "function") rp.catch(() => {});
        }
      }
    },

    /** Read the saved mute preference (true/false) from localStorage.
     *  Returns `null` if no preference has ever been saved, so callers
     *  can distinguish "never set" (stay muted for autoplay) from an
     *  explicit previous "unmute" choice (which we honour). */
    loadSavedMuted() {
      try {
        const raw = window.localStorage.getItem(MUTED_KEY);
        if (raw == null) return null;
        return raw === "1";
      } catch (e) {
        return null;
      }
    },

    toggleMuted() {
      this.setMuted(!this.muted);
      return this.muted;
    },

    playJump() {
      if (this.muted || this.jumpMuted) return;
      if (!this._audioCtx || !this._jumpBuffer) return;
      // Resume context if it was suspended (e.g. after a tab switch).
      if (this._audioCtx.state === "suspended") {
        this._audioCtx.resume().catch(() => {});
      }
      try {
        // Each play creates a fresh source node — they're cheap,
        // single-use objects designed for this pattern. A gain node
        // controls volume without touching the global output.
        const src = this._audioCtx.createBufferSource();
        src.buffer = this._jumpBuffer;
        const gain = this._audioCtx.createGain();
        gain.gain.value = this._jumpVolume;
        src.connect(gain);
        gain.connect(this._audioCtx.destination);
        src.start(0);
      } catch (e) {
        /* swallow — SFX is non-critical */
      }
    },

    /** Unlock the Web Audio context (requires a user gesture). Called
     *  from the Start Game handler so the first jump SFX plays
     *  without delay, regardless of mute state. */
    unlockAudio() {
      this._ensureAudioCtx();
      if (this._audioCtx && this._audioCtx.state === "suspended") {
        this._audioCtx.resume().catch(() => {});
      }
    },

    setMusicMuted(muted) {
      this.musicMuted = !!muted;
      try {
        window.localStorage.setItem(MUSIC_MUTED_KEY, this.musicMuted ? "1" : "0");
      } catch (e) { /* ignored */ }
      if (!this.music || this.muted) return;
      if (this.musicMuted) {
        this.music.pause();
        if (this.rain && this._isRainPlaying) this.rain.pause();
      } else {
        const p = this.music.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
        if (this.rain && this._isRainPlaying) {
          const rp = this.rain.play();
          if (rp && typeof rp.catch === "function") rp.catch(() => {});
        }
      }
    },

    setJumpMuted(muted) {
      this.jumpMuted = !!muted;
      try {
        window.localStorage.setItem(JUMP_MUTED_KEY, this.jumpMuted ? "1" : "0");
      } catch (e) { /* ignored */ }
    },

    // ── Rain ambience (file-based <audio> element) ──────────────
    rain: null,
    _isRainPlaying: false,

    initRain() {
      this.rain = document.getElementById("rain-audio");
      if (this.rain) {
        this.rain.volume = 0.2;
        this.rain.loop = true;
      }
    },

    startRain() {
      if (this._isRainPlaying) return;
      if (this.muted || this.musicMuted) return;
      if (!this.rain) return;
      const p = this.rain.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
      this._isRainPlaying = true;
    },

    stopRain() {
      if (!this._isRainPlaying) return;
      if (this.rain) this.rain.pause();
      this._isRainPlaying = false;
    },

    _thunderBuffer: null,

    _preloadThunderBuffer() {
      if (typeof AudioContext === "undefined" &&
          typeof webkitAudioContext === "undefined") return;
      fetch("assets/thunder.mp3")
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          this._ensureAudioCtx();
          if (!this._audioCtx) return;
          return this._audioCtx.decodeAudioData(buf);
        })
        .then((decoded) => {
          if (decoded) this._thunderBuffer = decoded;
        })
        .catch(() => { /* thunder SFX simply won't play */ });
    },

    playThunder() {
      if (this.muted || this.musicMuted) return;
      if (!this._audioCtx || !this._thunderBuffer) return;
      if (this._audioCtx.state === "suspended") {
        this._audioCtx.resume().catch(() => {});
      }
      try {
        const src = this._audioCtx.createBufferSource();
        src.buffer = this._thunderBuffer;
        const gain = this._audioCtx.createGain();
        gain.gain.value = 0.5;
        src.connect(gain);
        gain.connect(this._audioCtx.destination);
        src.start(0);
      } catch (e) { /* non-critical */ }
    },
  };

  // ══════════════════════════════════════════════════════════════════
  // Game state
  // ══════════════════════════════════════════════════════════════════

  const state = {
    width: 0,
    height: 0,
    groundHeight: 0,
    ground: 0,
    bgVelocity: INITIAL_BG_VELOCITY,
    score: 0,
    // Personal best, persisted to localStorage under HIGH_SCORE_KEY.
    // Loaded once at init, updated on game-over if the current run
    // beat it. `newHighScore` is set true for the run that just broke
    // the previous record, so the game-over overlay can celebrate it.
    highScore: 0,
    newHighScore: false,
    gameOver: false,
    gameOverFade: 0,
    gameOverFrame: 0,
    started: false,
    paused: true,
    frame: 0,
    currentSky: [...SKY_COLORS[0]],
    lastSkyScore: -1,
    isNight: false,
    // Continuous version of (state.score / SKY_CYCLE_SCORE), smoothed
    // every frame so the sun/moon arc and star rotation move smoothly
    // even though score is integer-stepped.
    smoothPhase: 0,
    // Monotonic frame-based angle used to rotate the night-sky dome
    // (stars + Milky Way) gently across the screen.
    starRotation: 0,
    // Timestamp of the previous update() call, used to derive the
    // per-frame delta-time for frame-rate independence. Reset to
    // null on pause/reset so the first post-resume frame doesn't
    // see a huge stale delta.
    lastNow: null,
    // Total jumps the player has ever performed. Persists across
    // sessions via localStorage (see TOTAL_JUMPS_KEY).
    totalJumps: 0,
    // Jumps performed within the current run only. Resets on
    // every resetGame(). Drives the per-run cosmetic unlocks
    // (party hat at 100, thug glasses at 200) so the player
    // has to actually earn them in a single go.
    runJumps: 0,
    // Nights fully survived within the current run. Incremented
    // when state.isNight goes from true → false (i.e. dawn
    // arrives while the raptor is still alive). Used for the
    // "survive N nights" achievements.
    runNightsSurvived: 0,
    // Was the raptor in the night portion of the cycle on the
    // previous frame? Tracked so we can detect the night → day
    // transition without double-counting.
    _wasInNight: false,
    // Shooting stars seen during the current run. Used for the
    // "first shooting star" achievement.
    runShootingStars: 0,
    // Total career stats, persisted across sessions.
    careerRuns: 0,
    // Set of unlocked achievement IDs. Serialized as a JSON
    // array in localStorage so the player keeps their trophies
    // across visits.
    unlockedAchievements: {},
    // Was the player muted for the entire current run? Set to
    // the audio mute state the moment the run actually starts,
    // and flipped to false the instant the player touches the
    // mute toggle mid-run (either direction — any audio change
    // invalidates the "silent the whole way through" claim).
    // Drives the "Sound of Silence" achievement.
    _runMutedThroughout: false,
    // Accessory unlocks. Each pair is:
    //   unlockedX — sticky bit, true once the player has crossed
    //               the jump threshold for this cosmetic. Never
    //               flips back to false on its own; cleared only
    //               by the debug "Reset total jumps" button.
    //   wearX     — player's on/off preference. Defaults to true
    //               the instant the accessory unlocks, and is
    //               freely togglable from the menu.
    unlockedPartyHat: false,
    wearPartyHat: true,
    unlockedThugGlasses: false,
    wearThugGlasses: true,
    unlockedBowTie: false,
    wearBowTie: true,
    // Active shooting-star flashes. Each entry is {x, y, vx, vy,
    // age, life}. Populated only from the second night onward so
    // the first night feels clean and the easter egg reads as a
    // reward for surviving longer.
    shootingStars: [],
    // Confetti particles, spawned in bursts when a cosmetic
    // unlocks so the moment reads as a celebration. Drawn over
    // the foreground tint so the colors pop at any time of day.
    confetti: [],
    dust: [],
    ash: [],
    activeRareEvent: null,
    _rareEventsSeen: {},
    moonPhase: 0, // 0-1, advances each night cycle
    clouds: [],
    duneOffset: 0,
    // Rain weather
    totalDayCycles: 0,
    lastCycleIndex: -1,
    isRaining: false,
    rainIntensity: 0,
    rainEndPhase: 0,
    rainParticles: [],
    lightning: { alpha: 0, nextAt: 0 },
    rainbow: null,
    _cloudDensity: 1,
    // Debug mode — toggled on by `?debug=true` query param. When on,
    // the menu grows a "Show hitboxes" toggle and the game draws the
    // raptor and cactus collision polygons on top of everything.
    debug: false,
    showHitboxes: false,
    noCollisions: false,
  };

  let canvas, ctx;
  let skyCanvas, skyCtx;
  // Offscreen canvas for the foreground layer (clouds, ground,
  // cacti, raptor). We tint just this canvas with the sky color and
  // then composite it over the main canvas — that way the sky and
  // light sources (stars, sun, moon) keep their full brightness
  // while the foreground gets a uniform sky-light wash.
  let fgCanvas, fgCtx;
  // Offscreen canvas that captures the main game canvas at the
  // exact moment of death (before the game-over overlay is drawn).
  // Used as the background for the shareable score card so the
  // card literally shows the scene the player just died in.
  let deathCanvas, deathCtx;
  let deathSnapshotReady = false;
  let _rafId = 0;
  let raptor, cactuses, stars;

  // ══════════════════════════════════════════════════════════════════
  // Entities
  // ══════════════════════════════════════════════════════════════════

  class Raptor {
    constructor() {
      this.x = 0;
      this.velocity = 0;
      this.gravity = GRAVITY;
      this.sheet = IMAGES.raptorSheet;
      this.frame = 0;
      this.lastFrameAdvanceAt = 0;
      // Cached collision polygon — rebuilt once per update() call
      // rather than each time the collision code asks for it, and
      // reused across the two callsites (collision test + debug draw).
      this._polyCache = null;
      this._jumpBufferedAt = 0;
      this._wasAirborne = false;
      this.resize();
    }

    resize() {
      this.w = state.width / 3;
      this.h = this.w * RAPTOR_ASPECT;
      this.x = 0;
      this.ground = state.ground - this.h;
      this.y = this.ground;
    }

    get downwardAcceleration() {
      return (
        (this.gravity *
          state.bgVelocity *
          state.bgVelocity *
          (state.width / 1000)) /
        10
      );
    }

    jump() {
      if (this.y !== this.ground || state.gameOver) return false;
      const targetRise = this.h * JUMP_CLEARANCE_MULTIPLIER;
      const a = this.downwardAcceleration;
      const v = Math.sqrt(2 * a * targetRise);
      this.velocity = -v;
      this._jumpBufferedAt = 0;
      audio.playJump();
      if (!audio.muted && navigator.vibrate) navigator.vibrate(15);
      // Bump both the career-wide total and the per-run counter.
      state.totalJumps += 1;
      state.runJumps += 1;
      saveTotalJumps(state.totalJumps);
      maybeSpawnRareEvent();
      return true;
    }

    /**
     * Frame delay scales inversely with the background velocity, so the
     * raptor visibly runs faster as the game speeds up. Mirrors the old
     * `img.delay(...)` speed-ramp from the p5 version.
     */
    get frameDelay() {
      const t = clamp(
        (state.bgVelocity - INITIAL_BG_VELOCITY) / 15,
        0,
        1
      );
      return lerp(RAPTOR_FRAME_DELAY_MAX, RAPTOR_FRAME_DELAY_MIN, t);
    }

    update(now, frameScale = 1) {
      // Semi-implicit Euler, scaled by frameScale so the trajectory
      // stays the same at any frame rate. downwardAcceleration and
      // jump velocity are already in "pixels per 60fps-frame" units.
      this.velocity += this.downwardAcceleration * frameScale;
      this.y += this.velocity * frameScale;
      if (this.y < this.ground) {
        this._wasAirborne = true;
      }
      if (this.y > this.ground) {
        this.y = this.ground;
        this.velocity = 0;
        if (this._wasAirborne) {
          spawnDust(this.x + this.w * 0.51, state.ground);
          spawnDust(this.x + this.w * 0.73, state.ground);
          this._wasAirborne = false;
        }
        // Input buffer: if the player pressed jump while airborne
        // (within 100ms), fire the jump now that we've landed.
        if (this._jumpBufferedAt &&
            now - this._jumpBufferedAt < 100) {
          this.jump();
        }
        this._jumpBufferedAt = 0;
      }

      // Frame animation: running while on the ground, locked to the
      // idle pose (frame 11) while airborne. Uses real wall-clock
      // time (ms) already, so it's frame-rate independent for free.
      if (this.y === this.ground) {
        if (now - this.lastFrameAdvanceAt > this.frameDelay) {
          this.frame = (this.frame + 1) % RAPTOR_FRAMES;
          this.lastFrameAdvanceAt = now;
        }
      } else {
        this.frame = RAPTOR_IDLE_FRAME;
        this.lastFrameAdvanceAt = now;
      }

      // Invalidate the cached collision polygon — it'll be rebuilt on
      // the next call to collisionPolygon() if anything needs it.
      this._polyCache = null;
    }

    draw(ctx) {
      if (!this.sheet) return;
      const srcY = this.frame * RAPTOR_NATIVE_H;
      ctx.drawImage(
        this.sheet,
        0,
        srcY,
        RAPTOR_NATIVE_W,
        RAPTOR_NATIVE_H,
        this.x,
        this.y,
        this.w,
        this.h
      );
      // Accessories are drawn when they're unlocked AND the player
      // has the cosmetic toggled on.
      if (state.unlockedThugGlasses && state.wearThugGlasses) {
        this.drawThugGlasses(ctx);
      }
      if (state.unlockedPartyHat && state.wearPartyHat) {
        this.drawPartyHat(ctx);
      }
      if (state.unlockedBowTie && state.wearBowTie) {
        this.drawBowTie(ctx);
      }
    }

    /**
     * Crown and snout reference points for the current animation
     * frame, converted to world coords. These come straight out of
     * the per-frame scan of the sprite sheet (RAPTOR_CROWN /
     * RAPTOR_SNOUT) so they track the run cycle exactly. While
     * airborne we lock to the idle frame.
     */
    currentCrownPoint() {
      const f = this.y === this.ground ? this.frame : RAPTOR_IDLE_FRAME;
      const [nx, ny] = RAPTOR_CROWN[f];
      return { x: this.x + nx * this.w, y: this.y + ny * this.h };
    }
    currentSnoutPoint() {
      const f = this.y === this.ground ? this.frame : RAPTOR_IDLE_FRAME;
      const [nx, ny] = RAPTOR_SNOUT[f];
      return { x: this.x + nx * this.w, y: this.y + ny * this.h };
    }

    /**
     * Thug-life glasses sprite (Wikimedia Commons, Aboulharakat —
     * CC BY-SA 4.0; see imprint) composited across the raptor's
     * nose. Anchor = interpolation between the crown and snout so
     * the glasses sit flat across the top of the snout ridge, and
     * the position follows the head's motion every frame.
     */
    drawThugGlasses(ctx) {
      const sprite = IMAGES.thugGlasses;
      if (!sprite) return;
      const crown = this.currentCrownPoint();
      const snout = this.currentSnoutPoint();
      // 0.5 along from crown toward snout = back a bit from the
      // snout tip, on the upper half of the nose ridge. Far enough
      // from the tip to look like glasses, not a muzzle.
      // Additional tiny offset — back by 5px-ish (scaled to raptor
      // width) and down by 2px — so the lenses settle onto the
      // ridge at the native viewport.
      const t = 0.5;
      const cx = crown.x + (snout.x - crown.x) * t - this.w * 0.012;
      const cy = crown.y + (snout.y - crown.y) * t + this.h * 0.013;
      // Small: 7% of raptor width.
      const gW = this.w * 0.07;
      const gH = gW * (sprite.height / sprite.width);
      ctx.save();
      ctx.translate(cx, cy);
      // Base angle = direction of the nose ridge (crown → snout),
      // minus a small CCW nudge so the glasses tilt back above the
      // nose line rather than following it exactly.
      const rideAngle = Math.atan2(snout.y - crown.y, snout.x - crown.x);
      ctx.rotate(rideAngle - 0.25);
      ctx.drawImage(sprite, -gW / 2, -gH / 2, gW, gH);
      ctx.restore();
    }

    /**
     * Party hat sprite (Freepik, see imprint) composited on top
     * of the raptor's head. The sprite is drawn with its bottom
     * center sitting on the crown of the head, then rotated
     * slightly backwards and to the left for a casual "just put
     * it on" tilt.
     */
    drawPartyHat(ctx) {
      const sprite = IMAGES.partyHat;
      if (!sprite) return;
      const crown = this.currentCrownPoint();
      // Anchor the hat's BASE a little below the exact crown so
      // it sits snug on the head instead of teetering on the very
      // top point. Still nudged slightly left (toward the tail) so
      // it doesn't balance right on the tip.
      const anchorX = crown.x - this.w * 0.01;
      const anchorY = crown.y + this.h * 0.04;
      // Hat ~25% of raptor height — small, sits as a hat on top
      // without covering the head. Width follows the source aspect
      // ratio so the pom-pom stays round.
      const hatH = this.h * 0.25;
      const hatW = hatH * (sprite.width / sprite.height);
      // Tilt backwards and to the LEFT — i.e. rotate counter
      // clockwise in canvas coords (negative angle), so the apex
      // leans toward the raptor's tail.
      const tiltRad = -0.35;
      ctx.save();
      ctx.translate(anchorX, anchorY);
      ctx.rotate(tiltRad);
      // Draw the sprite so its bottom-center is at the anchor: the
      // base of the hat sits on the crown and the tip extends up.
      ctx.drawImage(sprite, -hatW / 2, -hatH, hatW, hatH);
      ctx.restore();
    }

    drawBowTie(ctx) {
      const sprite = IMAGES.bowTie;
      if (!sprite) return;
      const crown = this.currentCrownPoint();
      // The neck is below and behind the crown — offset downward
      // and slightly toward the body center.
      const neckX = crown.x - this.w * 0.02;
      const neckY = crown.y + this.h * 0.20;
      // Bow tie ~6% of raptor width, aspect ratio from source.
      const btW = this.w * 0.06;
      const btH = btW * (sprite.height / sprite.width);
      ctx.save();
      ctx.translate(neckX, neckY);
      ctx.rotate(-0.15); // slight CCW tilt to match body angle
      ctx.drawImage(sprite, -btW / 2, -btH / 2, btW, btH);
      ctx.restore();
    }

    /**
     * Concave silhouette following the running raptor's body outline,
     * shrunk inward by RAPTOR_COLLISION_INSET pixels so the collision
     * feels forgiving. Cached per update() call — see _polyCache above.
     */
    collisionPolygon() {
      if (this._polyCache) return this._polyCache;
      const x = this.x,
        y = this.y,
        w = this.w,
        h = this.h;
      const raw = [
        { x: x + w * 0.5, y: y + h * 0.27 },
        { x: x + w * 0.5, y: y + h * 0.4 },
        { x: x + w * 0.6, y: y + h * 0.6 },
        { x: x + w * 0.5, y: y + h * 0.82 },
        { x: x + w * 0.48, y: y + h },
        { x: x + w * 0.55, y: y + h },
        { x: x + w * 0.51, y: y + h * 0.955 },
        { x: x + w * 0.53, y: y + h * 0.9 },
        { x: x + w * 0.55, y: y + h * 0.9 },
        { x: x + w * 0.55, y: y + h * 0.86 },
        { x: x + w * 0.51, y: y + h * 0.86 },
        { x: x + w * 0.53, y: y + h * 0.8 },
        { x: x + w * 0.62, y: y + h * 0.65 },
        { x: x + w * 0.63, y: y + h * 0.6 },
        { x: x + w * 0.67, y: y + h * 0.6 },
        { x: x + w * 0.67, y: y + h * 0.85 },
        { x: x + w * 0.72, y: y + h * 0.95 },
        { x: x + w * 0.78, y: y + h * 0.95 },
        { x: x + w * 0.7, y: y + h * 0.8 },
        { x: x + w * 0.75, y: y + h * 0.8 },
        { x: x + w * 0.8, y: y + h * 0.6 },
        { x: x + w * 0.78, y: y + h * 0.55 },
        { x: x + w * 0.9, y: y + h * 0.3 },
        { x: x + w, y: y + h * 0.3 },
        { x: x + w, y: y + h * 0.23 },
        { x: x + w * 0.9, y: y + h * 0.15 },
        { x: x + w * 0.85, y: y + h * 0.15 },
        { x: x + w * 0.8, y: y + h * 0.35 },
      ];
      this._polyCache = shrinkPolygon(raw, RAPTOR_COLLISION_INSET);
      return this._polyCache;
    }
  }

  class Cactus {
    constructor(variant) {
      this.variant = variant;
      this.img = IMAGES[variant.key];
      this.aspectRatio = variant.w / variant.h;
      this.h = raptor.h * variant.heightScale;
      this.w = this.h * this.aspectRatio;
      this.x = state.width;
      this.y = state.ground - this.h;
      this._polyCache = null;
    }

    /**
     * Recompute this cactus's height / width / y-anchor after a
     * viewport resize (e.g. entering or leaving fullscreen). The
     * horizontal world position stays the same, but the bottom of
     * the cactus has to re-bind to the NEW state.ground so it
     * doesn't visibly jump when the viewport dimensions change.
     */
    resize() {
      this.h = raptor.h * this.variant.heightScale;
      this.w = this.h * this.aspectRatio;
      this.y = state.ground - this.h;
      this._polyCache = null;
    }

    update(frameScale = 1) {
      this.x -= state.bgVelocity * (state.width / 1000) * frameScale;
      // Position changed, invalidate cached polygon.
      this._polyCache = null;
    }

    collisionPolygon() {
      if (this._polyCache) return this._polyCache;
      const norm = this.variant.collision;
      const x = this.x,
        y = this.y,
        w = this.w,
        h = this.h;
      const poly = new Array(norm.length);
      for (let i = 0; i < norm.length; i++) {
        poly[i] = { x: x + norm[i][0] * w, y: y + norm[i][1] * h };
      }
      this._polyCache = poly;
      return poly;
    }

    draw(ctx) {
      if (this.img)
        ctx.drawImage(
          this.img,
          Math.round(this.x), Math.round(this.y),
          Math.round(this.w), Math.round(this.h)
        );
    }
  }

  class Cactuses {
    constructor() {
      this.cacti = [];
    }

    get minSpawnDistance() {
      // At higher speeds, increase the minimum gap so tight doubles
      // don't appear — keeps the game humanly playable.
      const speedFactor = Math.max(1, state.bgVelocity / INITIAL_BG_VELOCITY);
      const minGap = raptor.w * (1.5 + speedFactor * 0.3);
      return minGap + Math.floor(Math.random() * raptor.w * 10);
    }

    spawn() {
      const variant =
        CACTUS_VARIANTS[Math.floor(Math.random() * CACTUS_VARIANTS.length)];
      this.cacti.push(new Cactus(variant));
    }

    update(frameScale = 1) {
      const last = this.cacti[this.cacti.length - 1];
      if (!last) {
        this.spawn();
      } else if (state.width - last.x >= this.minSpawnDistance) {
        this.spawn();
        state.bgVelocity = Math.min(state.bgVelocity + 0.1, 17);
      }

      for (const c of this.cacti) c.update(frameScale);

      this.cacti = this.cacti.filter((c) => {
        if (c.x < -c.w) {
          state.score++;
          // Score-threshold achievements.
          if (state.score === 1) unlockAchievement("first-jump");
          if (state.score === 25) unlockAchievement("score-25");
          if (state.score === 100) unlockAchievement("party-time");
          if (state.score === BOW_TIE_SCORE_THRESHOLD) unlockAchievement("dinosaurs-forever");
          if (state.score === THUG_GLASSES_SCORE_THRESHOLD) unlockAchievement("score-250");
          // Cosmetic unlocks — party hat at 100 points, thug
          // glasses at 200. Both fire at most once per save and
          // burst a little confetti off the raptor's head so the
          // player actually notices. The achievement toasts fire
          // from the score-threshold block above (not here) so
          // they trigger on every qualifying run, even if the
          // cosmetic was already earned.
          if (
            !state.unlockedPartyHat &&
            state.score >= PARTY_HAT_SCORE_THRESHOLD
          ) {
            state.unlockedPartyHat = true;
            state.wearPartyHat = true;
            saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, true);
            saveBoolFlag(WEAR_PARTY_HAT_KEY, true);
            if (raptor) {
              const crown = raptor.currentCrownPoint();
              spawnConfettiBurst(crown.x, crown.y);
            }
          }
          if (
            !state.unlockedThugGlasses &&
            state.score >= THUG_GLASSES_SCORE_THRESHOLD
          ) {
            state.unlockedThugGlasses = true;
            state.wearThugGlasses = true;
            saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, true);
            saveBoolFlag(WEAR_THUG_GLASSES_KEY, true);
            if (raptor) {
              const crown = raptor.currentCrownPoint();
              spawnConfettiBurst(crown.x, crown.y);
            }
          }
          if (
            !state.unlockedBowTie &&
            state.score >= BOW_TIE_SCORE_THRESHOLD
          ) {
            state.unlockedBowTie = true;
            state.wearBowTie = true;
            saveBoolFlag(UNLOCKED_BOW_TIE_KEY, true);
            saveBoolFlag(WEAR_BOW_TIE_KEY, true);
            if (raptor) {
              const crown = raptor.currentCrownPoint();
              spawnConfettiBurst(crown.x, crown.y);
            }
          }
          return false;
        }
        return true;
      });
    }

    draw(ctx) {
      for (const c of this.cacti) c.draw(ctx);
    }

    clear() {
      this.cacti = [];
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Stars + Milky Way
  //
  // The night sky is a "dome" that we rotate around a pivot point
  // far above the visible viewport. Star positions are generated
  // once across an area wider/taller than the viewport so that as
  // the dome rotates, stars enter from one edge and exit the other
  // without empty patches appearing at the corners.
  //
  // The Milky Way is a denser band of small stars + a soft haze
  // strip drawn along a tilted line. It lives in the same rotated
  // frame so it drifts in/out with the rest of the sky.
  // ════════════════════════════════════════════════════════════════

  class Stars {
    constructor() {
      this.opacity = 0;
      this.field = [];
      this.milkyWay = [];

      // Generate stars over an area much larger than the viewport so
      // the rotation transform never sweeps the visible area empty.
      // The rotation pivot sits 1.5 screen-heights above the viewport,
      // so even small rotation angles move stars along long arcs —
      // the field needs to extend far enough in every direction to
      // cover where stars rotate in from.
      const w = state.width;
      const h = state.height;
      const padX = w * 1.2;
      const padY = h * 1.2;
      const fieldW = w + padX * 2;
      const fieldH = h * 0.8 + padY * 2;
      // Density: roughly one star per 8000 px² of star-field area —
      // lower density than before because the field is much larger
      // and we don't want to overwhelm the sky with pinpricks.
      const count = Math.max(80, Math.floor((fieldW * fieldH) / 8000));
      for (let i = 0; i < count; i++) {
        // ~15% of stars are "bright" — noticeably bigger and at full
        // brightness. The rest are background dimmer pinpricks.
        const bright = Math.random() < 0.15;
        // ~65% of stars twinkle. Dimmer ones twinkle more so the
        // pulsing reads against the dark sky.
        const twinkles = Math.random() < 0.65;
        // Color variation: 85% white, 10% warm, 5% cool
        const colorRoll = Math.random();
        const color = colorRoll < 0.85
          ? [255, 255, 255]
          : colorRoll < 0.95
            ? [255, 240, 220]
            : [220, 230, 255];
        // ~5% of twinkling stars get sharp "flash" spikes
        const flash = twinkles && Math.random() < 0.05;
        this.field.push({
          x: -padX + Math.random() * fieldW,
          y: -padY + Math.random() * fieldH,
          size: bright ? randRange(4, 6.5) : randRange(1.6, 3.5),
          brightness: bright ? randRange(0.92, 1.0) : randRange(0.45, 0.85),
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleRate: twinkles ? randRange(0.02, 0.06) : 0,
          twinkleDepth: twinkles ? randRange(0.3, 0.7) : 0,
          color,
          flash,
        });
      }

      // Milky Way: a tilted band of small stars + a few soft "puffs"
      // of haze along the band. Stars are distributed with a Gaussian
      // density across the band so the edges fade naturally rather
      // than ending in a hard rectangle.
      this.mwTilt = -Math.PI / 7;
      this.mwCenterX = w * 0.55;
      this.mwCenterY = h * 0.28;
      this.mwLength = Math.max(w, h) * 1.6;
      this.mwThickness = h * 0.22;
      const mwCos = Math.cos(this.mwTilt);
      const mwSin = Math.sin(this.mwTilt);
      const mwStarCount = 220;
      for (let i = 0; i < mwStarCount; i++) {
        const along = (Math.random() - 0.5) * this.mwLength;
        // Box-Muller-ish: average two uniforms for a roughly Gaussian
        // distribution across the band's thickness, so star density
        // peaks in the middle and tapers smoothly to nothing at the
        // edges. Squared bias toward the center.
        const u = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
        const across = u * (this.mwThickness * 0.5);
        // Long-axis intensity also tapers off toward the band ends.
        const endFade = 1 - Math.pow(Math.abs(along) / (this.mwLength / 2), 2);
        if (endFade < 0.05) continue;
        const x = this.mwCenterX + along * mwCos - across * mwSin;
        const y = this.mwCenterY + along * mwSin + across * mwCos;
        this.milkyWay.push({
          x,
          y,
          size: randRange(0.5, 1.6),
          brightness: randRange(0.35, 0.8) * endFade,
        });
      }

      // A few soft haze "puffs" placed along the band — drawn as
      // radial gradients in draw(). Position them at evenly spaced
      // points along the centerline with small random jitter so the
      // glow looks irregular instead of beaded.
      this.mwHazePuffs = [];
      const puffCount = 7;
      for (let i = 0; i < puffCount; i++) {
        const t = (i + 0.5) / puffCount - 0.5;
        const along = t * this.mwLength * 0.95 + (Math.random() - 0.5) * this.mwLength * 0.05;
        const across = (Math.random() - 0.5) * this.mwThickness * 0.15;
        const x = this.mwCenterX + along * mwCos - across * mwSin;
        const y = this.mwCenterY + along * mwSin + across * mwCos;
        const endFade = 1 - Math.pow(Math.abs(along) / (this.mwLength / 2), 2);
        this.mwHazePuffs.push({
          x,
          y,
          radius: this.mwThickness * randRange(0.55, 0.9),
          brightness: 0.10 * endFade,
        });
      }
    }

    update(isNight, frameScale = 1) {
      if (isNight)
        this.opacity = Math.min(1, this.opacity + 0.005 * frameScale);
      else this.opacity = Math.max(0, this.opacity - 0.005 * frameScale);
    }

    /**
     * Apply the rotation transform around the celestial pivot. The
     * pivot sits well above the visible viewport so that on-screen
     * stars all trace gentle, near-parallel arcs (rather than
     * spinning around a visible center point).
     */
    _applyRotation(ctx) {
      const px = state.width * 0.5;
      const py = -state.height * 1.5;
      ctx.translate(px, py);
      ctx.rotate(state.starRotation);
      ctx.translate(-px, -py);
    }

    draw(ctx) {
      if (this.opacity <= 0) return;
      const starWhite = [255, 255, 255];
      const mwStar = [235, 235, 255];
      const mwHaze1 = [220, 225, 255];
      const mwHaze2 = [200, 210, 245];
      const mwHazeOuter = [180, 190, 230];

      ctx.save();
      this._applyRotation(ctx);

      // Soft Milky Way haze: a few overlapping radial-gradient puffs
      // along the band. Radial gradients fade smoothly to transparent
      // at their edge so the band feels diffuse rather than rectangular.
      for (const puff of this.mwHazePuffs) {
        const a = puff.brightness * this.opacity;
        if (a <= 0.001) continue;
        const grad = ctx.createRadialGradient(puff.x, puff.y, 0, puff.x, puff.y, puff.radius);
        grad.addColorStop(0, rgba(mwHaze1, a));
        grad.addColorStop(0.6, rgba(mwHaze2, a * 0.4));
        grad.addColorStop(1, rgba(mwHazeOuter, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(puff.x, puff.y, puff.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Milky Way star points.
      for (const s of this.milkyWay) {
        ctx.fillStyle = rgba(mwStar, s.brightness * this.opacity);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Foreground star field. Stars with a non-zero twinkleDepth
      // pulse softly via a sin wave; flash stars spike sharply.
      for (const s of this.field) {
        let twinkle = 1;
        if (s.twinkleDepth) {
          const raw = 0.5 + 0.5 * Math.sin(s.twinklePhase + state.frame * s.twinkleRate);
          twinkle = s.flash
            ? 0.4 + 1.1 * Math.pow(raw, 8) // sharp bright spikes
            : 1 - s.twinkleDepth * raw;
        }
        const a = s.brightness * twinkle * this.opacity;
        // Size pulsing: ±20% modulated by twinkle
        const r = (s.size / 2) * (1 + 0.2 * (twinkle - 0.5));
        ctx.fillStyle = rgba(s.color || starWhite, Math.min(a, 1));
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Shooting stars (easter egg)
  //
  // Spawned only from the SECOND night onward. Each shooting star
  // is a pre-rendered trail sprite (baked once into an offscreen
  // canvas) that we translate + rotate + drawImage per frame —
  // avoids any per-frame gradient compile or path building, so
  // the first shooting star doesn't stall the frame.
  // ════════════════════════════════════════════════════════════════

  const SHOOTING_STAR_TRAIL_LEN = 140;
  const SHOOTING_STAR_TRAIL_H = 8;
  // Baked trail sprite. Populated ONCE at init time (see
  // bakeShootingStarSprite below) so the first shooting star
  // doesn't trigger any lazy canvas/context/gradient setup on
  // the hot path. Prefer an ImageBitmap (GPU-backed, fast
  // drawImage) when available, fall back to the canvas element.
  let shootingStarSprite = null;

  function bakeShootingStarSprite() {
    const c = document.createElement("canvas");
    // Internal 2× resolution for crisp rendering at any scale.
    const sc = 2;
    c.width = SHOOTING_STAR_TRAIL_LEN * sc;
    c.height = SHOOTING_STAR_TRAIL_H * sc;
    const sctx = c.getContext("2d");
    sctx.scale(sc, sc);
    sctx.imageSmoothingEnabled = true;
    // Trail: head at the RIGHT edge, fading toward the LEFT.
    const grad = sctx.createLinearGradient(
      SHOOTING_STAR_TRAIL_LEN,
      0,
      0,
      0
    );
    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
    grad.addColorStop(0.25, "rgba(255, 255, 255, 0.75)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    sctx.strokeStyle = grad;
    sctx.lineCap = "round";
    sctx.lineWidth = 3;
    sctx.beginPath();
    sctx.moveTo(SHOOTING_STAR_TRAIL_LEN - 2, SHOOTING_STAR_TRAIL_H / 2);
    sctx.lineTo(4, SHOOTING_STAR_TRAIL_H / 2);
    sctx.stroke();
    // Bright head dot.
    sctx.fillStyle = "#ffffff";
    sctx.beginPath();
    sctx.arc(
      SHOOTING_STAR_TRAIL_LEN - 2,
      SHOOTING_STAR_TRAIL_H / 2,
      3,
      0,
      Math.PI * 2
    );
    sctx.fill();
    // Start with the canvas as the sprite so the game can draw
    // immediately. Upgrade to an ImageBitmap (faster drawImage)
    // as soon as createImageBitmap resolves.
    shootingStarSprite = c;
    if (typeof createImageBitmap === "function") {
      createImageBitmap(c).then(
        (bitmap) => {
          shootingStarSprite = bitmap;
        },
        () => {
          /* keep the canvas fallback */
        }
      );
    }
  }

  function maybeSpawnShootingStar(frameScale) {
    if (Math.floor(state.smoothPhase) < 1) return;
    if (!state.isNight) return;
    if (state.rainIntensity > 0.1) return; // no shooting stars in overcast
    // Per-frame spawn chance — averaged roughly one new shooting
    // star per second of real-time night.
    const chance = 0.018 * frameScale;
    if (Math.random() > chance) return;
    const w = state.width;
    const h = state.height;
    // Spawn in the upper-right corner, flying diagonally toward
    // the bottom-left. In canvas coords (y-down) that's angles
    // between 3π/4 (straight down-left) and a bit shallower.
    const startX = w * randRange(0.6, 1.08);
    const startY = h * randRange(-0.05, 0.3);
    const speed = Math.max(w, h) * 0.9; // px/sec
    const angle = randRange(Math.PI * 0.68, Math.PI * 0.82);
    state.shootingStars.push({
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: randRange(0.9, 1.5),
    });
    state.runShootingStars += 1;
    if (state.runShootingStars === 1) {
      unlockAchievement("first-shooting-star");
    }
  }

  function updateShootingStars(dtSec) {
    if (state.shootingStars.length === 0) return;
    // Walk once — update each star, rebuild the array only if
    // something actually expires. Keeps the hot path GC-free in
    // the common case.
    let expired = 0;
    for (const s of state.shootingStars) {
      s.x += s.vx * dtSec;
      s.y += s.vy * dtSec;
      s.age += dtSec;
      if (
        s.age >= s.life ||
        s.x < -120 ||
        s.y > state.height + 120
      ) {
        s.dead = true;
        expired += 1;
      }
    }
    if (expired > 0) {
      state.shootingStars = state.shootingStars.filter((s) => !s.dead);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Confetti burst
  //
  // Fires when a cosmetic unlocks (party hat, thug glasses). Each
  // burst spawns ~60 pieces at the raptor's head, each with a
  // short random-direction velocity + gentle gravity and a
  // tumbling rotation. Cheap per-piece: a single fillRect /
  // ellipse per frame. Particles auto-expire after ~1.5s.
  // ════════════════════════════════════════════════════════════════

  const CONFETTI_COLORS = [
    "#ff4d6d",
    "#ffb703",
    "#06d6a0",
    "#118ab2",
    "#8338ec",
    "#ffd60a",
    "#ff7b00",
    "#ef476f",
  ];

  function spawnConfettiBurst(worldX, worldY) {
    const count = 70;
    for (let i = 0; i < count; i++) {
      const angle = randRange(-Math.PI, 0); // upward hemisphere
      const speed = randRange(180, 520);
      state.confetti.push({
        x: worldX,
        y: worldY,
        vx: Math.cos(angle) * speed + randRange(-40, 40),
        vy: Math.sin(angle) * speed,
        rot: randRange(0, Math.PI * 2),
        vrot: randRange(-8, 8),
        size: randRange(6, 11),
        color:
          CONFETTI_COLORS[
            Math.floor(Math.random() * CONFETTI_COLORS.length)
          ],
        age: 0,
        life: randRange(1.1, 1.9),
      });
    }
  }

  function updateConfetti(dtSec) {
    if (state.confetti.length === 0) return;
    let expired = 0;
    const GRAV = 900; // px/sec² downward
    const DRAG = 0.985;
    for (const p of state.confetti) {
      p.vx *= DRAG;
      p.vy += GRAV * dtSec;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.rot += p.vrot * dtSec;
      p.age += dtSec;
      if (p.age >= p.life || p.y > state.height + 40) {
        p.dead = true;
        expired += 1;
      }
    }
    if (expired > 0) {
      state.confetti = state.confetti.filter((p) => !p.dead);
    }
  }

  function drawConfetti(ctx) {
    if (state.confetti.length === 0) return;
    for (const p of state.confetti) {
      const t = p.age / p.life;
      const alpha = t < 0.85 ? 1 : Math.max(0, 1 - (t - 0.85) / 0.15);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      // Rectangular confetti piece, slightly taller than wide.
      ctx.fillRect(
        -p.size / 2,
        -p.size / 3,
        p.size,
        (p.size * 2) / 3
      );
      ctx.restore();
    }
  }

  // ── Dust particles (landing puff) ──────────────────────────────
  function spawnDust(x, y) {
    const count = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const angle = Math.PI + Math.random() * Math.PI; // upper hemisphere fan
      const speed = 30 + Math.random() * 70;
      state.dust.push({
        x: x + (Math.random() - 0.5) * 12,
        y,
        vx: Math.cos(angle) * speed,
        vy: -Math.abs(Math.sin(angle)) * speed * 0.5,
        size: 3 + Math.random() * 4,
        age: 0,
        life: 0.2 + Math.random() * 0.15,
      });
    }
  }

  function updateDust(dtSec) {
    if (state.dust.length === 0) return;
    let expired = 0;
    for (const p of state.dust) {
      p.vy += 200 * dtSec; // light gravity
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.age += dtSec;
      if (p.age >= p.life) { p.dead = true; expired++; }
    }
    if (expired > 0) {
      state.dust = state.dust.filter((p) => !p.dead);
    }
  }

  function drawDust(ctx) {
    if (state.dust.length === 0) return;
    for (const p of state.dust) {
      const t = p.age / p.life;
      const a = 1 - t;
      ctx.fillStyle = `rgba(220, 200, 160, ${a * 0.8})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Ash particles (lightning-struck dune cactus dissolution) ────
  function spawnAsh(screenX, screenY, w, h) {
    const count = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      state.ash.push({
        x: screenX + (Math.random() - 0.5) * w,
        y: screenY - Math.random() * h,
        vx: 2 + Math.random() * 5,
        vy: -3 + Math.random() * 6,
        size: 0.8 + Math.random() * 1.2,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 1,
        age: 0,
        life: 0.4 + Math.random() * 0.3,
        ember: Math.random() < 0.25, // 25% glow as embers
      });
    }
  }

  function updateAsh(dtSec) {
    if (state.ash.length === 0) return;
    let expired = 0;
    for (const p of state.ash) {
      p.vx *= 0.99;
      p.vy += 15 * dtSec; // light gravity
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.rot += p.vrot * dtSec;
      p.age += dtSec;
      if (p.age >= p.life) { p.dead = true; expired++; }
    }
    if (expired > 0) state.ash = state.ash.filter((p) => !p.dead);
  }

  function drawAsh(ctx) {
    if (state.ash.length === 0) return;
    for (const p of state.ash) {
      const t = p.age / p.life;
      const a = 1 - t;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.ember) {
        const glow = t < 0.5 ? 1 : 1 - (t - 0.5) * 2; // bright then fade
        ctx.fillStyle = `rgba(${200 + Math.round(55 * glow)}, ${100 + Math.round(80 * glow)}, 20, ${a * 0.9})`;
      } else {
        ctx.fillStyle = `rgba(25, 20, 15, ${a * 0.8})`;
      }
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
  }

  // ── Rare background events (easter eggs) ───────────────────────
  // Each event has an average interval in career jumps, a condition
  // function, and a spawn function. Events are checked once per jump
  // against the career total. Each event type can only be active once.

  const RARE_EVENTS = [
    {
      id: "ufo",
      achievement: "ufo-sighting",
      avgInterval: 400,
      condition: () => !state.isRaining && state.rainIntensity < 0.1,
      duration: 20,
    },
    {
      id: "santa",
      achievement: "santa-spotted",
      avgInterval: 500,
      condition: () => state.isNight && state.rainIntensity < 0.1,
      duration: 6,
    },
    {
      id: "tumbleweed",
      achievement: "tumbleweed",
      avgInterval: 300,
      condition: () => !state.isNight && state.rainIntensity < 0.1,
      duration: 25,
    },
    {
      id: "comet",
      achievement: "comet",
      avgInterval: 600,
      condition: () => state.isNight && state.rainIntensity < 0.1,
      duration: 8,
    },
    {
      id: "meteor",
      achievement: "meteor-impact",
      avgInterval: 500,
      condition: () => state.isNight && state.rainIntensity < 0.1,
      duration: 5,
    },
  ];

  function loadRareEventsSeen() {
    try {
      const raw = window.localStorage.getItem(RARE_EVENTS_SEEN_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveRareEventsSeen(seen) {
    try { window.localStorage.setItem(RARE_EVENTS_SEEN_KEY, JSON.stringify(seen)); }
    catch (e) { /* ignored */ }
  }

  /** Check whether to trigger a rare event on this jump. Called from
   *  the jump counter increment path. */
  function maybeSpawnRareEvent() {
    if (state.activeRareEvent) return; // one at a time
    // Build candidate list: prefer unseen events, then allow repeats.
    // On shooting star nights (phase >= 1, night), only comet/meteor allowed.
    const shootingStarNight = state.isNight && Math.floor(state.smoothPhase) >= 1;
    const eligible = RARE_EVENTS.filter(
      (e) => e.avgInterval > 0 && e.condition() &&
             (!shootingStarNight || e.id === "comet" || e.id === "meteor")
    );
    if (eligible.length === 0) return;
    const unseen = eligible.filter((e) => !state._rareEventsSeen[e.id]);
    const pool = unseen.length > 0 ? unseen : eligible;
    // Single roll against the average interval of a random candidate
    const evt = pool[Math.floor(Math.random() * pool.length)];
    if (Math.random() >= 1 / evt.avgInterval) return;
    state.activeRareEvent = {
      id: evt.id,
      age: 0,
      life: evt.duration,
      x: state.width + 50,
      y: state.height * (0.1 + Math.random() * 0.3),
    };
    // Unlock achievement on first sighting
    if (!state._rareEventsSeen[evt.id]) {
      state._rareEventsSeen[evt.id] = true;
      saveRareEventsSeen(state._rareEventsSeen);
      unlockAchievement(evt.achievement);
    }
  }

  function updateRareEvent(dtSec) {
    if (!state.activeRareEvent) return;
    const e = state.activeRareEvent;
    e.age += dtSec;
    // Move event across the screen (right to left for most)
    const speed = state.width / e.life;
    if (e.id === "tumbleweed") {
      // Tumbleweed rolls left along the dune surface, bouncing above it
      e.x -= state.width * 0.06 * dtSec; // gentle roll, crosses screen in ~18s
      const duneY = state.ground - _duneHeight(e.x, state.duneOffset);
      const bounce = Math.abs(Math.sin(e.age * 3.5)) * 12;
      e.y = duneY - 10 - bounce;
      // End when fully off-screen left
      if (e.x < -30) e.age = e.life;
      e.rot = (e.rot || 0) - dtSec * 4; // counter-clockwise (rolling left)
    } else if (e.id === "ufo") {
      const t = e.age / e.life;
      const hoverX = state.width * 0.6;
      const hoverY = state.height * 0.35;
      if (t < 0.08) {
        // Phase 1: Fast descent
        e.x = hoverX;
        e.y = -30 + (t / 0.08) * (hoverY + 30);
        e.beam = false;
        e.phase = "descend";
      } else if (!e.targetCactus) {
        // Phase 2: Hover + beam on — wait for a cactus to scroll into the beam
        e.x = hoverX + Math.sin(e.age * 2) * 10;
        e.y = hoverY + Math.sin(e.age * 3) * 5;
        e.beam = true;
        e.phase = "search";
        // Check if any cactus is under the beam footprint (e.x ± 30)
        if (state.duneCacti) {
          const off = state.duneOffset;
          for (const dc of state.duneCacti) {
            if (dc.dead || dc.struck) continue;
            const sx = dc.wx - off;
            if (sx > e.x - 28 && sx < e.x + 28) {
              e.targetCactus = dc;
              e.abductStartAge = e.age;
              // Store position and hide original immediately
              e.abductSx = sx;
              e.abductDuneY = state.ground - _duneHeight(sx, state.duneOffset);
              dc.dead = true;
              break;
            }
          }
        }
      } else if (e.cactusLift == null || e.cactusLift < 1) {
        // Phase 3: Beam up the cactus
        e.x = hoverX + Math.sin(e.age * 2) * 5;
        e.y = hoverY + Math.sin(e.age * 3) * 3;
        e.beam = true;
        e.phase = "abduct";
        const liftTime = 3; // seconds to beam up
        const elapsed = e.age - (e.abductStartAge || e.age);
        e.cactusLift = Math.min(1, elapsed / liftTime);
      } else if (!e._absorbed) {
        // Phase 4: Cactus absorbed, brief pause
        e.beam = false;
        e.phase = "absorbed";
        e.x = hoverX;
        e.y = hoverY;
        // Cactus already marked dead when grabbed
        e._absorbed = true;
        e._absorbedAt = e.age;
      } else {
        // Phase 5: Fly away upward-right after a brief pause
        const pauseTime = 0.5;
        const flyElapsed = e.age - (e._absorbedAt || e.age) - pauseTime;
        if (flyElapsed < 0) {
          e.x = hoverX;
          e.y = hoverY;
        } else {
          e.beam = false;
          e.phase = "flyaway";
          e.x = hoverX + flyElapsed * state.width * 0.15;
          e.y = hoverY - flyElapsed * state.height * 0.15;
          if (e.y < -60 || e.x > state.width + 60) e.age = e.life;
        }
      }
    } else if (e.id === "santa") {
      // Santa flies across the night sky left to right
      e.x = -50 + (e.age / e.life) * (state.width + 100);
      e.y = state.height * 0.12 + Math.sin(e.age * 1.5) * 8;
    } else if (e.id === "comet") {
      // Slow arc across night sky — enters right, exits left
      const ct = e.age / e.life;
      e.x = state.width * 1.3 - ct * state.width * 1.6;
      e.y = state.height * 0.05 + ct * state.height * 0.25;
    } else if (e.id === "meteor") {
      // Streak from upper-right to a specific impact point on/behind dunes.
      if (!e.startX) {
        e.startX = state.width * (0.7 + Math.random() * 0.3);
        e.startY = -10;
        e.targetX = state.width * (0.3 + Math.random() * 0.4);
        e.targetY = state.ground - _duneHeight(e.targetX, state.duneOffset) + 3;
      }
      const mt = e.age / e.life;
      const flightT = 0.5; // first 50% is the streak, rest is impact
      if (mt < flightT) {
        const ft = mt / flightT;
        e.x = e.startX + (e.targetX - e.startX) * ft;
        e.y = e.startY + (e.targetY - e.startY) * ft;
        e.vx = (e.targetX - e.startX) / (e.life * flightT);
        e.vy = (e.targetY - e.startY) / (e.life * flightT);
      } else {
        e.impact = true;
        e.impactX = e.impactX || e.targetX;
        // Recalculate impact Y from current dune position (dunes scroll)
        e.impactY = e.impactY || (state.ground - _duneHeight(e.impactX || e.targetX, state.duneOffset) + 3);
      }
    }
    if (e.age >= e.life) state.activeRareEvent = null;
  }

  /** Draw sky-layer rare events (comet, meteor) — on main canvas, no tint. */
  function drawRareEventSky(ctx) {
    if (!state.activeRareEvent) return;
    const e = state.activeRareEvent;
    if (e.id !== "comet" && e.id !== "meteor") return;
    drawRareEvent(ctx);
  }

  /** Draw foreground rare events (UFO, Santa, tumbleweed) — on fgCtx, gets tint. */
  /** Draw the UFO beam on the background canvas so dunes paint over it. */
  function drawUfoBeam(ctx) {
    if (!state.activeRareEvent || state.activeRareEvent.id !== "ufo") return;
    const e = state.activeRareEvent;
    if (!e.beam) return;
    const ufoH = IMAGES.ufo ? 60 * (IMAGES.ufo.height / IMAGES.ufo.width) : 35;
    const scan = 0.4 + 0.2 * Math.sin(e.age * 4.5) + 0.1 * Math.sin(e.age * 7.3);
    const beamBottomL = e.x - 30, beamBottomR = e.x + 30;
    ctx.save();
    ctx.fillStyle = `rgba(245, 250, 255, ${scan})`;
    ctx.beginPath();
    ctx.moveTo(e.x - 12, e.y + ufoH / 2);
    ctx.lineTo(e.x + 12, e.y + ufoH / 2);
    ctx.lineTo(beamBottomR, state.ground);
    ctx.lineTo(beamBottomL, state.ground);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawRareEventFg(ctx) {
    if (!state.activeRareEvent) return;
    const e = state.activeRareEvent;
    // Comet/meteor on sky canvas, tumbleweed in dune layer
    if (e.id === "comet" || e.id === "meteor" || e.id === "tumbleweed") return;
    drawRareEvent(ctx);
  }

  function drawRareEvent(ctx) {
    if (!state.activeRareEvent) return;
    const e = state.activeRareEvent;
    const t = e.age / e.life;
    let alpha = 1;
    // These events enter/exit the screen naturally — no fade
    if (e.id !== "comet" && e.id !== "meteor" && e.id !== "tumbleweed") {
      if (t < 0.1) alpha = t / 0.1;
      else if (t > 0.9) alpha = (1 - t) / 0.1;
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    if (e.id === "ufo") {
      const img = IMAGES.ufo;
      const ufoW = 60, ufoH = img ? 60 * (img.height / img.width) : 35;
      if (img) {
        ctx.drawImage(img, e.x - ufoW / 2, e.y - ufoH / 2, ufoW, ufoH);
      }
      // Draw abducted cactus spiraling up in the beam
      if (e.phase === "abduct" && e.targetCactus && e.cactusLift != null) {
        const dc = e.targetCactus;
        const cImg = IMAGES[dc.key];
        if (cImg) {
          // Use stored grab position (cactus is already dead/hidden)
          const grabX = e.abductSx || e.x;
          const grabY = e.abductDuneY || state.ground;
          const liftT = e.cactusLift;
          const cx = grabX + (e.x - grabX) * liftT + Math.sin(e.age * 6) * 8 * (1 - liftT);
          const cy = grabY + (e.y + ufoH / 2 - grabY) * liftT;
          const cScale = 1 - liftT * 0.5; // shrinks as it gets "further"
          const cw = dc.w * cScale;
          const ch = dc.h * cScale;
          const rot = e.age * 3; // spinning
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(rot);
          ctx.drawImage(cImg, -cw / 2, -ch, cw, ch);
          ctx.restore();
        }
      }

    } else if (e.id === "santa") {
      const sleighImg = IMAGES.santaSleigh;
      const deerImg = IMAGES.reindeer;
      const sleighW = 55, sleighH = sleighImg ? 55 * (sleighImg.height / sleighImg.width) : 30;
      const deerW = 22, deerH = deerImg ? 22 * (deerImg.height / deerImg.width) : 25;
      // Sleigh harness attachment — measured from sprite (165/200, 55/128)
      const harnessX = e.x + sleighW * 0.325;
      const harnessY = e.y - sleighH * 0.07;
      // Draw 2 reindeer in front, connected by curved harness lines
      const deerPositions = [];
      for (let i = 0; i < 2; i++) {
        const dx = 40 + i * 30;
        const bobY = Math.sin(e.age * 3 + i * 1.5) * 4;
        const deerX = e.x + dx;
        const deerY = e.y - 5 + bobY;
        // Collar attachment — measured from sprite (185/200, 88/274)
        const collarX = deerX + deerW * 0.425;
        const collarY = deerY - deerH * 0.179;
        deerPositions.push({ deerX, deerY, collarX, collarY, bobY });
        // Curved harness line — droops slightly between sleigh and collar
        ctx.strokeStyle = `rgba(90, 60, 35, ${0.6 * alpha})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(harnessX, harnessY);
        const midX = (harnessX + collarX) / 2;
        const midY = Math.max(harnessY, collarY) + 6; // droop below both points
        ctx.quadraticCurveTo(midX, midY, collarX, collarY);
        ctx.stroke();
        if (deerImg) {
          ctx.drawImage(deerImg, deerX - deerW / 2, deerY - deerH / 2, deerW, deerH);
        }
      }
      // Draw sleigh (on top of harness lines)
      if (sleighImg) {
        ctx.drawImage(sleighImg, e.x - sleighW / 2, e.y - sleighH / 2, sleighW, sleighH);
      }
      // Rudolph's red nose on the lead reindeer
      if (Math.sin(e.age * 8) > 0 && deerPositions[1]) {
        const lead = deerPositions[1];
        const noseX = lead.deerX + deerW * 0.4;
        const noseY = lead.deerY - deerH * 0.15;
        ctx.fillStyle = `rgba(255, 40, 20, ${alpha})`;
        ctx.beginPath();
        ctx.arc(noseX, noseY, 2, 0, Math.PI * 2);
        ctx.fill();
      }

    } else if (e.id === "tumbleweed") {
      const twImg = IMAGES.tumbleweed;
      const twSize = 20;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.rot || 0);
      if (twImg) {
        ctx.drawImage(twImg, -twSize / 2, -twSize / 2, twSize, twSize);
      }
      ctx.restore();

    } else if (e.id === "comet") {
      // "Your Name" style comet — very bright, multi-tailed, sparkly.
      const tailAngle = Math.atan2(state.height * 0.25, state.width * 1.6);
      const tailLen = state.width * 0.3;
      const headR = 10;
      const a = alpha;

      // Double-layered glow halo for extra brightness
      const outerR = headR * 14;
      const g1 = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, outerR);
      g1.addColorStop(0, `rgba(240, 248, 255, ${0.7 * a})`);
      g1.addColorStop(0.1, `rgba(200, 225, 255, ${0.35 * a})`);
      g1.addColorStop(0.3, `rgba(130, 180, 250, ${0.12 * a})`);
      g1.addColorStop(1, "rgba(60,100,200,0)");
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.arc(e.x, e.y, outerR, 0, Math.PI * 2);
      ctx.fill();
      // Inner glow — tighter, brighter
      const g2 = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, headR * 4);
      g2.addColorStop(0, `rgba(255, 255, 255, ${0.6 * a})`);
      g2.addColorStop(0.4, `rgba(200, 230, 255, ${0.25 * a})`);
      g2.addColorStop(1, "rgba(150,200,255,0)");
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, headR * 4, 0, Math.PI * 2);
      ctx.fill();

      // Bright core
      const core = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, headR);
      core.addColorStop(0, `rgba(255,255,255,${a})`);
      core.addColorStop(0.3, `rgba(230,245,255,${0.95 * a})`);
      core.addColorStop(1, `rgba(160,210,255,${0.65 * a})`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(e.x, e.y, headR, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(tailAngle);

      // Tail helper
      const _ct = (c0, c1, c2, w, x1, y1, x2, y2, ex, ey) => {
        const g = ctx.createLinearGradient(0, 0, ex, 0);
        g.addColorStop(0, c0); g.addColorStop(0.35, c1); g.addColorStop(1, c2);
        ctx.strokeStyle = g; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.bezierCurveTo(x1, y1, x2, y2, ex, ey);
        ctx.stroke();
      };
      const L = tailLen;
      // Main blue-white dust tail
      _ct(`rgba(200,225,255,${0.75*a})`,`rgba(130,180,250,${0.3*a})`,"rgba(70,120,210,0)",
        9, L*0.3,-10, L*0.6,-18, L,-30);
      // Cyan ion tail
      _ct(`rgba(0,250,255,${0.6*a})`,`rgba(50,210,250,${0.25*a})`,"rgba(30,140,230,0)",
        3, L*0.4,5, L*0.9,8, L*1.4,6);
      // Bright crimson
      _ct(`rgba(255,60,35,${0.5*a})`,`rgba(230,35,20,${0.18*a})`,"rgba(150,10,5,0)",
        5, L*0.2,-20, L*0.55,-38, L*1.15,-55);
      // Deep red
      _ct(`rgba(190,25,12,${0.3*a})`,`rgba(140,12,8,${0.1*a})`,"rgba(80,5,5,0)",
        3, L*0.15,-28, L*0.4,-50, L*0.85,-70);
      // Warm orange wisp
      _ct(`rgba(255,170,60,${0.3*a})`,`rgba(230,110,30,${0.1*a})`,"rgba(180,60,10,0)",
        2.5, L*0.35,-6, L*0.65,-14, L,-22);

      // Sparkles — cover the full x/y extent of all tails,
      // similar blink frequency but very different phase offsets,
      // some detaching and lingering in the sky.
      for (let i = 0; i < 30; i++) {
        const h1 = Math.sin(i * 73.1 + 3.7) * 0.5 + 0.5;
        const h2 = Math.sin(i * 127.3 + 17.1) * 0.5 + 0.5;
        const h3 = Math.sin(i * 31.7 + 91.3) * 0.5 + 0.5;
        const h4 = Math.sin(i * 211.9 + 47.3) * 0.5 + 0.5;

        // Position along the tail (0-1)
        const along = h1 * 0.95 + 0.03;
        const baseX = along * L;
        // Y range covers the full tail fan: from +8 (ion tail)
        // down to -70 (deep red tail), scattered by h2
        const yTop = 8 * along;                    // ion tail top
        const yBot = -15 * along - 55 * along * along; // deep red bottom
        const sy0 = yTop + (yBot - yTop) * h2;     // spread across full fan
        let sx = baseX + (h3 - 0.5) * 15;
        let sy = sy0;

        // 30% detach and drift away
        const detaches = h3 > 0.7;
        if (detaches) {
          const driftAge = Math.max(0, e.age - h4 * e.life * 0.5);
          sx += driftAge * 6 * (h2 - 0.4);
          sy += driftAge * 4 * (h4 - 0.5);
          const driftFade = Math.max(0, 1 - driftAge * 0.7);
          if (driftFade < 0.05) continue;
        }

        // Similar blink speed (4.5-6 Hz) but wildly different offsets
        const blinkSpeed = 4.5 + h4 * 1.5;
        const blinkPhase = h1 * 17.3 + h2 * 11.7; // large spread
        const blink = Math.pow(Math.max(0, Math.sin(e.age * blinkSpeed + blinkPhase)), 5);
        const baseBright = detaches ? 0.6 : 1;
        const sa = (1 - along * 0.5) * blink * a * baseBright;
        if (sa < 0.05) continue;

        const sr = 1.5 + (1 - along) * 2.5 + h4 * 1.5;
        const ci = i % 5;
        const sC = ["255,255,255","200,240,255","255,180,170","255,230,200","160,250,255"][ci];
        ctx.strokeStyle = `rgba(${sC},${sa})`;
        ctx.fillStyle = `rgba(${sC},${sa})`;
        const shape = Math.floor(h4 * 3);
        if (shape === 0) {
          // 4-pointed cross
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, sy - sr * 1.3); ctx.lineTo(sx, sy + sr * 1.3);
          ctx.moveTo(sx - sr * 1.3, sy); ctx.lineTo(sx + sr * 1.3, sy);
          ctx.stroke();
        } else if (shape === 1) {
          // 6-pointed star
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(sx, sy - sr); ctx.lineTo(sx, sy + sr);
          ctx.moveTo(sx - sr * 0.87, sy - sr * 0.5); ctx.lineTo(sx + sr * 0.87, sy + sr * 0.5);
          ctx.moveTo(sx - sr * 0.87, sy + sr * 0.5); ctx.lineTo(sx + sr * 0.87, sy - sr * 0.5);
          ctx.stroke();
        } else {
          // Bright dot
          ctx.beginPath();
          ctx.arc(sx, sy, sr * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Soft glow around each sparkle
        ctx.fillStyle = `rgba(${sC},${sa * 0.25})`;
        ctx.beginPath();
        ctx.arc(sx, sy, sr * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

    } else if (e.id === "meteor") {
      if (!e.impact) {
        const streakLen = 50;
        const angle = Math.atan2(e.vy || 1, e.vx || -0.5);
        // Head glow — bigger, brighter
        const glow = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 12);
        glow.addColorStop(0, `rgba(255, 255, 220, ${alpha})`);
        glow.addColorStop(0.4, `rgba(255, 180, 50, ${0.6 * alpha})`);
        glow.addColorStop(1, `rgba(255, 80, 0, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 12, 0, Math.PI * 2);
        ctx.fill();
        // Trail
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(angle + Math.PI);
        const tg = ctx.createLinearGradient(0, 0, streakLen, 0);
        tg.addColorStop(0, `rgba(255, 220, 80, ${0.8 * alpha})`);
        tg.addColorStop(0.3, `rgba(255, 120, 20, ${0.4 * alpha})`);
        tg.addColorStop(0.7, `rgba(220, 50, 0, ${0.15 * alpha})`);
        tg.addColorStop(1, `rgba(150, 30, 0, 0)`);
        ctx.strokeStyle = tg;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(streakLen, 0);
        ctx.stroke();
        // Sparks flying off
        for (let i = 0; i < 6; i++) {
          const sx = Math.random() * streakLen * 0.7;
          const sy = (Math.random() - 0.5) * 10;
          ctx.fillStyle = `rgba(255, ${120 + Math.random() * 135}, ${Math.random() * 40}, ${0.7 * alpha})`;
          ctx.beginPath();
          ctx.arc(sx, sy, 0.8 + Math.random() * 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else {
        // Impact — particle-based fireball + mushroom cloud
        const it = (e.age / e.life - 0.5) / 0.5;
        const ix = e.impactX, iy = e.impactY;
        const S = 1.3; // scale factor

        // Initial flash (first 15% of impact)
        if (it < 0.2) {
          const fa = (1 - it / 0.2) * alpha;
          ctx.fillStyle = `rgba(255, 255, 200, ${fa * 0.4})`;
          ctx.beginPath();
          ctx.arc(ix, iy, (40 + it * 100) * S, 0, Math.PI * 2);
          ctx.fill();
        }

        // Fireball particles — many small circles rising and expanding
        const particleCount = 20;
        for (let i = 0; i < particleCount; i++) {
          const pt = Math.min(1, it * 1.5 + i * 0.02);
          if (pt < 0 || pt > 1) continue;
          // Each particle rises and expands
          const seed = Math.sin(i * 73.7 + 31.1) * 0.5 + 0.5;
          const seed2 = Math.sin(i * 127.3 + 89.9) * 0.5 + 0.5;
          const px = ix + (seed - 0.5) * 40 * S * pt;
          const py = iy - pt * (30 + seed2 * 50) * S;
          const pr = (3 + pt * (4 + seed * 6)) * S;
          const pa = Math.max(0, 1 - pt * 1.2) * alpha;
          if (pa < 0.02) continue;
          // Color: white→yellow→orange→dark as particle ages
          let r, g, b;
          if (pt < 0.2) {
            r = 255; g = 240; b = 200;
          } else if (pt < 0.5) {
            const k = (pt - 0.2) / 0.3;
            r = 255; g = Math.round(240 - k * 120); b = Math.round(200 - k * 170);
          } else {
            const k = (pt - 0.5) / 0.5;
            r = Math.round(255 - k * 155); g = Math.round(120 - k * 80); b = Math.round(30 - k * 20);
          }
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pa})`;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.fill();
        }

        // Smoke column — darker particles rising higher, slower
        const smokeCount = 12;
        for (let i = 0; i < smokeCount; i++) {
          const st = Math.min(1, it * 1.2 - 0.1 + i * 0.03);
          if (st < 0 || st > 1) continue;
          const seed = Math.sin(i * 47.3 + 17.7) * 0.5 + 0.5;
          const spx = ix + (seed - 0.5) * 20 * S * st;
          const spy = iy - st * (60 + seed * 40) * S;
          const spr = (4 + st * 8) * S;
          const spa = Math.max(0, 0.8 - st) * alpha * 0.35;
          if (spa < 0.02) continue;
          ctx.fillStyle = `rgba(60, 50, 40, ${spa})`;
          ctx.beginPath();
          ctx.arc(spx, spy, spr, 0, Math.PI * 2);
          ctx.fill();
        }

        // Mushroom cap — cluster of overlapping smoke puffs at the top
        const capY = iy - (60 * Math.min(1, it * 1.3) + 30) * S;
        const capA = Math.max(0, 1 - it * 1.8) * alpha * 0.3;
        if (capA > 0.02) {
          for (let i = 0; i < 7; i++) {
            const seed = Math.sin(i * 31.7 + 5.3) * 0.5 + 0.5;
            const cpx = ix + (seed - 0.5) * 40 * S;
            const cpy = capY + (Math.sin(i * 2.1) * 6);
            ctx.fillStyle = `rgba(70, 55, 40, ${capA})`;
            ctx.beginPath();
            ctx.arc(cpx, cpy, (10 + seed * 8) * S, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    ctx.restore();
  }

  // ── Rain weather system ────────────────────────────────────────

  function loadTotalDayCycles() {
    try {
      const raw = window.localStorage.getItem(TOTAL_DAY_CYCLES_KEY);
      return raw != null ? parseInt(raw, 10) || 0 : 0;
    } catch (e) { return 0; }
  }

  function saveTotalDayCycles(n) {
    try { window.localStorage.setItem(TOTAL_DAY_CYCLES_KEY, String(n)); }
    catch (e) { /* ignored */ }
  }

  /** Deterministic rain check: within each block of 10 cycles,
   *  exactly 1 cycle is rainy. Every 50th is guaranteed rainy. */
  function shouldRainForCycle(cycleIndex) {
    if (cycleIndex % 50 === 0 && cycleIndex > 0) return true;
    const block = Math.floor(cycleIndex / 10);
    // Simple hash to pick which cycle in the block rains
    const rainSlot = ((block * 7 + 3) % 10);
    return (cycleIndex % 10) === rainSlot;
  }

  function spawnRain(frameScale) {
    const count = Math.ceil((state.width / 300) * frameScale * state.rainIntensity);
    for (let i = 0; i < count; i++) {
      const layer = Math.random();
      let len, opacity, vy, vx, lw;
      if (layer < 0.3) {
        // Far — small, faint, slow
        len = 5 + Math.random() * 3;
        opacity = 0.08 + Math.random() * 0.1;
        vy = 400 + Math.random() * 100;
        vx = -40 - Math.random() * 20;
        lw = 0.6;
      } else if (layer < 0.7) {
        // Mid — medium
        len = 10 + Math.random() * 5;
        opacity = 0.18 + Math.random() * 0.12;
        vy = 600 + Math.random() * 200;
        vx = -60 - Math.random() * 30;
        lw = 1.0;
      } else {
        // Near — large, bright, fast
        len = 15 + Math.random() * 10;
        opacity = 0.3 + Math.random() * 0.2;
        vy = 800 + Math.random() * 300;
        vx = -80 - Math.random() * 40;
        lw = 1.8;
      }
      state.rainParticles.push({
        x: Math.random() * (state.width + 100) - 50,
        y: -10 - Math.random() * 30,
        vx, vy, len, opacity, lw,
      });
    }
  }

  function updateRain(dtSec) {
    if (state.rainParticles.length === 0) return;
    let expired = 0;
    for (const p of state.rainParticles) {
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      if (p.y > state.ground) { p.dead = true; expired++; }
    }
    if (expired > 0) {
      state.rainParticles = state.rainParticles.filter((p) => !p.dead);
    }
  }

  function drawRain(ctx) {
    if (state.rainParticles.length === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    const gnd = state.ground;
    for (const p of state.rainParticles) {
      ctx.lineWidth = p.lw || 1;
      ctx.strokeStyle = `rgba(180, 210, 240, ${p.opacity})`;
      ctx.beginPath();
      const angle = Math.atan2(p.vy, p.vx);
      let endX = p.x + Math.cos(angle) * p.len;
      let endY = p.y + Math.sin(angle) * p.len;
      // Clip streak at ground level
      if (endY > gnd) {
        const t = (gnd - p.y) / (endY - p.y);
        endX = p.x + (endX - p.x) * t;
        endY = gnd;
      }
      if (p.y < gnd) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function updateLightning(frameScale, now) {
    if (state.lightning.alpha > 0) {
      state.lightning.alpha = Math.max(0, state.lightning.alpha - 0.015 * frameScale);
    }
    // Random chance for new flash — only at full intensity, not during transitions
    if (state.rainIntensity > 0.8 && now > state.lightning.nextAt && Math.random() < 0.002 * frameScale) {
      state.lightning.alpha = 0.7 + Math.random() * 0.2;
      state.lightning.nextAt = now + 5000 + Math.random() * 5000;
      // Generate a jagged bolt path — preferring cacti as targets
      const result = _generateBoltPath();
      state.lightning.bolt = result.path;
      // If the bolt struck a cactus, blacken it
      // Blacken the struck dune cactus (they scroll slowly enough
      // for the visual to read).
      if (result.struckDuneCactus) {
        result.struckDuneCactus.struck = true;
        result.struckDuneCactus.struckAge = 0;
      }
      // Delay thunder after the flash — random 0.1–0.6s simulating
      // varying strike distances (~35–200m away).
      const thunderDelay = 100 + Math.random() * 500;
      setTimeout(() => audio.playThunder(), thunderDelay);
      if (!audio.muted && navigator.vibrate) navigator.vibrate(30);
    }
  }

  function _generateBoltPath() {
    // Always target a visible dune cactus if one exists.
    let targetX;
    let struckDuneCactus = null;
    const off = state.duneOffset || 0;
    const visibleDuneCacti = (state.duneCacti || []).filter((dc) => {
      const sx = dc.wx - off;
      return sx > 20 && sx < state.width - 20 && !dc.struck;
    });
    if (visibleDuneCacti.length > 0) {
      const dc = visibleDuneCacti[Math.floor(Math.random() * visibleDuneCacti.length)];
      targetX = dc.wx - off;
      struckDuneCactus = dc;
    } else {
      targetX = state.width * (0.35 + Math.random() * 0.55);
    }
    // If targeting a dune cactus, end at the cactus top; otherwise ground.
    const endY = struckDuneCactus
      ? (state.ground - _duneHeight(targetX, state.duneOffset)) - struckDuneCactus.h * 0.85
      : state.ground;
    const startX = targetX + (Math.random() - 0.5) * state.width * 0.15;
    const segments = 8 + Math.floor(Math.random() * 6);
    const points = [{ x: startX, y: -10 }];
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const isLast = i === segments;
      // Converge toward targetX; final point lands exactly on target
      const baseX = startX + (targetX - startX) * t;
      const jitter = isLast ? 0 : (Math.random() - 0.5) * state.width * 0.08 * (1 - t);
      const x = baseX + jitter;
      const y = isLast ? endY : Math.min(t * endY, endY);
      points.push({ x, y });
      // 35% chance of a branch
      if (i > 2 && i < segments - 1 && Math.random() < 0.35) {
        const branchLen = 2 + Math.floor(Math.random() * 4);
        const branch = [];
        let bx = x, by = y;
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (let j = 0; j < branchLen; j++) {
          bx += dir * (15 + Math.random() * 30);
          by += 10 + Math.random() * 25;
          if (by > endY) by = endY; // clamp to ground
          branch.push({ x: bx, y: by });
        }
        points[points.length - 1].branch = branch;
      }
    }
    return { path: points, struckDuneCactus };
  }

  function _drawBolt(ctx, points, lineWidth, alpha) {
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = `rgba(180, 200, 255, ${alpha * 0.8})`;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    // Draw branches
    for (const p of points) {
      if (p.branch) {
        ctx.beginPath();
        ctx.lineWidth = lineWidth * 0.5;
        ctx.moveTo(p.x, p.y);
        for (const bp of p.branch) ctx.lineTo(bp.x, bp.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawLightning(ctx) {
    if (state.lightning.alpha <= 0) return;
    // White flash overlay (dims faster than bolt)
    const flashAlpha = Math.max(0, state.lightning.alpha - 0.3) * 0.5;
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
      ctx.fillRect(0, 0, state.width, state.height);
    }
    // Draw the bolt arc
    if (state.lightning.bolt) {
      _drawBolt(ctx, state.lightning.bolt, 3, state.lightning.alpha);
      // Draw a second thinner bright core
      _drawBolt(ctx, state.lightning.bolt, 1.2, Math.min(1, state.lightning.alpha * 1.5));
    }
  }

  function drawShootingStars(ctx) {
    if (state.shootingStars.length === 0) return;
    const sprite = shootingStarSprite;
    if (!sprite) return;
    for (const s of state.shootingStars) {
      const t = s.age / s.life;
      const alpha = Math.sin(Math.PI * t);
      if (alpha <= 0) continue;
      const angle = Math.atan2(s.vy, s.vx);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(s.x, s.y);
      ctx.rotate(angle);
      // Sprite's RIGHT edge is the head — draw it so that edge
      // lands at the translated origin (the star's world pos).
      ctx.drawImage(
        sprite,
        -SHOOTING_STAR_TRAIL_LEN,
        -SHOOTING_STAR_TRAIL_H / 2,
        SHOOTING_STAR_TRAIL_LEN,
        SHOOTING_STAR_TRAIL_H
      );
      ctx.restore();
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Sun + Moon
  //
  // Both bodies travel along a parabolic arc across the visible sky
  // tied to `state.smoothPhase`. The sun is visible during the day
  // half of the cycle (centered on phase 0 = blue daytime), the moon
  // during the night half (centered on phase 0.5 = night).
  // ════════════════════════════════════════════════════════════════

  /**
   * Returns {visible, x, y, t} for a celestial body whose visible arc
   * is centered on cycle `phaseCenter` and lasts half a cycle. `t` is
   * 0 at rise (right edge) and 1 at set (left edge), or null if not
   * visible.
   */
  function celestialArc(phaseCenter, halfWidth) {
    // Wrap so that `rel` is in [-0.5, 0.5] around phaseCenter.
    let rel = (state.smoothPhase % 1 + 1) % 1 - phaseCenter;
    if (rel > 0.5) rel -= 1;
    if (rel < -0.5) rel += 1;
    // The "above-horizon" arc spans rel ∈ [-halfWidth, +halfWidth].
    // We extend the computed range a bit past those bounds so the
    // body actually travels below the horizon (and off-screen at the
    // left/right edge) rather than stopping at the horizon and
    // fading out — that's how a real sun sets. The ground bands
    // drawn over the top of the canvas naturally occlude the disc
    // once it dips below.
    const extension = halfWidth * 0.18;
    if (rel < -halfWidth - extension || rel > halfWidth + extension) {
      return { visible: false, x: 0, y: 0, t: 0, alpha: 0 };
    }
    // No clamp on t — beyond [0, 1] the parabola pushes y below the
    // ground (sun has already dipped below the horizon) and x off
    // the screen edge.
    const t = (rel + halfWidth) / (halfWidth * 2);
    const x = state.width * (1 - t);
    const arcH = state.height * 0.7;
    const y = state.ground - 4 * arcH * t * (1 - t);
    return { visible: true, x, y, t, alpha: 1 };
  }

  function drawSun(ctx) {
    // Sun is visible during the entire day half (solid blue + half
    // of each twilight transition). Its peak sits at the middle of
    // the solid-blue stretch.
    const arc = celestialArc(0.167, 0.25);
    if (!arc.visible) return;
    const r = Math.max(21, state.width * 0.03);
    // Elevation = 1 at the zenith, 0 at the horizon. We bend the
    // curve hard with a high exponent so the disc stays bright white
    // across almost the entire arc, only shifting to yellow in the
    // final stretch and to red right at the horizon. The lerp logic
    // below splits the elevation range into "white half" (near
    // zenith) and "warm half" (near horizon) — with this curve, the
    // warm half only kicks in for the last ~10% of the arc on each
    // side, so red is a brief sunset/sunrise moment, not the norm.
    // Clamp to [0, 1] — t can extend slightly below 0 / above 1
    // when the sun is dipping below the horizon, which would
    // otherwise produce a negative elevation.
    const elevation = Math.max(0, 1 - Math.pow(Math.abs(arc.t - 0.5) * 2, 4));
    const cZenith = [255, 250, 235];
    const cMid = [255, 200, 110];
    const cHorizon = [220, 60, 25];
    let core, halo;
    if (elevation > 0.5) {
      const k = (elevation - 0.5) * 2; // 0..1 across upper half
      core = lerpColor(cMid, cZenith, k);
      halo = lerpColor([255, 180, 100], [255, 230, 170], k);
    } else {
      const k = elevation * 2; // 0..1 across lower half
      core = lerpColor(cHorizon, cMid, k);
      halo = lerpColor([225, 70, 30], [255, 180, 100], k);
    }

    ctx.save();
    const ri = state.rainIntensity;
    if (ri > 0.05) {
      // Overcast sun: diffuse halo glow, dim disc proportional to intensity
      const haloR = r * 3;
      const ha = 0.18 * ri;
      const glow = ctx.createRadialGradient(arc.x, arc.y, r * 0.5, arc.x, arc.y, haloR);
      glow.addColorStop(0, `rgba(255, 240, 200, ${ha})`);
      glow.addColorStop(0.5, `rgba(255, 230, 180, ${ha * 0.45})`);
      glow.addColorStop(1, `rgba(255, 220, 160, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.2 + 0.8 * (1 - ri);
      ctx.fillStyle = rgb(core);
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Clear sky: solid disc, no halo
      ctx.fillStyle = rgb(core);
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMoon(ctx) {
    // Moon mirrors the sun: visible during the entire night half
    // (solid night + half of each twilight transition), with the
    // same arc width so it traces a matching gentle parabola.
    const arc = celestialArc(0.667, 0.25);
    if (!arc.visible) return;
    const r = Math.max(13, state.width * 0.0192);
    // Bright near-white moon. The shadow is the sky color so it
    // reads as the dark side of the disc.
    const core = [250, 250, 252];
    const halo = [220, 230, 250];
    const shadow = [
      Math.round(state.currentSky[0] * 0.5),
      Math.round(state.currentSky[1] * 0.5),
      Math.round(state.currentSky[2] * 0.5),
    ];

    ctx.save();
    ctx.globalAlpha = arc.alpha * (0.2 + 0.8 * (1 - state.rainIntensity));
    // Halo.
    const glow = ctx.createRadialGradient(arc.x, arc.y, r * 0.3, arc.x, arc.y, r * 2.6);
    glow.addColorStop(0, rgba(halo, 0.45));
    glow.addColorStop(0.5, rgba(halo, 0.14));
    glow.addColorStop(1, rgba(halo, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    // Disc.
    ctx.fillStyle = rgb(core);
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Subtle craters — clipped to the moon disc.
    ctx.save();
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = `rgba(200, 200, 210, 0.15)`;
    const craters = [
      { dx: -0.25, dy: -0.3, cr: 0.18 },
      { dx: 0.3, dy: 0.15, cr: 0.22 },
      { dx: -0.1, dy: 0.35, cr: 0.14 },
      { dx: 0.15, dy: -0.2, cr: 0.1 },
      { dx: -0.35, dy: 0.1, cr: 0.12 },
      { dx: 0.05, dy: 0.05, cr: 0.08 },
    ];
    for (const c of craters) {
      ctx.beginPath();
      ctx.arc(arc.x + c.dx * r, arc.y + c.dy * r, c.cr * r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Realistic moon phase using terminator ellipse.
    // Phase 0 = new moon (dark), 0.25 = first quarter,
    // 0.5 = full moon (bright), 0.75 = last quarter.
    ctx.save();
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.clip();
    const ph = state.moonPhase;
    // Illumination fraction: 0 at new, 1 at full
    const illum = (1 - Math.cos(ph * Math.PI * 2)) / 2;
    if (illum < 0.98) {
      // Terminator x-radius: how far the shadow ellipse extends.
      // cos maps illumination to the terminator position on the disc.
      const terminatorX = r * Math.cos(illum * Math.PI);
      // Waxing (ph < 0.5): shadow on the left, light on right
      // Waning (ph > 0.5): shadow on the right, light on left
      const waxing = ph < 0.5;
      // Draw shadow on the dark side
      ctx.fillStyle = rgba(shadow, 0.8);
      ctx.beginPath();
      // Dark half: semicircle on shadow side
      if (waxing) {
        ctx.arc(arc.x, arc.y, r, Math.PI * 0.5, Math.PI * 1.5);
      } else {
        ctx.arc(arc.x, arc.y, r, -Math.PI * 0.5, Math.PI * 0.5);
      }
      // Terminator edge: ellipse connecting top and bottom
      ctx.ellipse(arc.x, arc.y, Math.abs(terminatorX), r, 0,
        waxing ? -Math.PI * 0.5 : Math.PI * 0.5,
        waxing ? Math.PI * 0.5 : -Math.PI * 0.5,
        waxing ? (terminatorX > 0) : (terminatorX < 0));
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════
  // Clouds — drawn with four overlapping top-half ellipses to match
  // the original game's four-arc cloud shape.
  // ══════════════════════════════════════════════════════════════════

  const CLOUD_BUMPS = [
    { dx: 0, rx: 12.5, ry: 10 },
    { dx: 10, rx: 12.5, ry: 22.5 },
    { dx: 25, rx: 12.5, ry: 17.5 },
    { dx: 40, rx: 15, ry: 10 },
  ];

  function drawPolygon(ctx, poly, opts) {
    if (!poly || poly.length === 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    if (opts.fill) {
      ctx.fillStyle = opts.fill;
      ctx.fill();
    }
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = opts.lineWidth || 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCloud(ctx, x, y, size) {
    // Canvas angle convention (y-down): 0 = right, PI/2 = down,
    // PI = left, 3*PI/2 = up. Going CW (counterclockwise=false) from
    // PI to 0 traces: left → up → right, giving the TOP half of the
    // ellipse — a dome pointing upward, matching the original p5 shape.
    //
    // Drawn pure white — the global multiply tint applied at the end
    // of render() picks up the sky color and tints clouds to match
    // (peachy at sunset, blue-grey at night, white at midday).
    ctx.fillStyle = "#ffffff";
    for (const b of CLOUD_BUMPS) {
      ctx.beginPath();
      ctx.ellipse(
        x + b.dx * size,
        y,
        b.rx * size,
        b.ry * size,
        0,
        Math.PI,
        0,
        false
      );
      ctx.fill();
    }
  }

  /** Draw a rain cloud — long, flat, hazy streak instead of puffy bumps.
   *  Multiple overlapping ellipses create a layered overcast look. */
  /** Draw a persistent overcast layer across the entire sky.
   *  Called once per frame (not per cloud) when rain intensity > 0.
   *  Uses wide, flat, band-like rectangles at varying heights. */
  function drawOvercastBands(ctx, intensity) {
    if (intensity <= 0) return;
    const w = state.width;
    const coverH = state.height * 0.55;
    // Thick impermeable cover at the top, gradually thinning downward.
    const a = intensity;
    const mainGrad = ctx.createLinearGradient(0, 0, 0, coverH);
    mainGrad.addColorStop(0, `rgba(55, 60, 65, ${0.98 * a})`);
    mainGrad.addColorStop(0.1, `rgba(60, 65, 70, ${0.95 * a})`);
    mainGrad.addColorStop(0.25, `rgba(70, 75, 80, ${0.8 * a})`);
    mainGrad.addColorStop(0.45, `rgba(85, 90, 95, ${0.5 * a})`);
    mainGrad.addColorStop(0.7, `rgba(100, 105, 110, ${0.2 * a})`);
    mainGrad.addColorStop(1, `rgba(115, 120, 125, 0)`);
    ctx.fillStyle = mainGrad;
    ctx.fillRect(0, 0, w, coverH);
    // Thicker sub-bands for visible layering at the top
    const bands = [
      { y: 0,             h: coverH * 0.15, alpha: 0.25 },
      { y: coverH * 0.12, h: coverH * 0.2,  alpha: 0.18 },
      { y: coverH * 0.28, h: coverH * 0.25, alpha: 0.12 },
      { y: coverH * 0.45, h: coverH * 0.2,  alpha: 0.08 },
    ];
    for (const b of bands) {
      const ba = b.alpha * a;
      const grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      grad.addColorStop(0, `rgba(80, 85, 90, ${ba})`);
      grad.addColorStop(1, `rgba(100, 105, 110, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, b.y, w, b.h);
    }
  }

  /** Draw a cloud that morphs from puffy (ri=0) to flat overcast band (ri=1).
   *  Uses the same ellipse geometry but interpolates radii and color. */
  function drawCloudMorphed(ctx, x, y, size, ri) {
    // Interpolate between white puffy and gray flat
    const r = Math.round(255 - ri * 135);
    const g = Math.round(255 - ri * 130);
    const b = Math.round(255 - ri * 125);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

    if (ri < 0.01) {
      // Pure puffy cloud — use CLOUD_BUMPS directly
      for (const bmp of CLOUD_BUMPS) {
        ctx.beginPath();
        ctx.ellipse(x + bmp.dx * size, y, bmp.rx * size, bmp.ry * size,
          0, Math.PI, 0, false);
        ctx.fill();
      }
      return;
    }

    // Morph: each bump stretches wider and flatter with intensity.
    // At ri=1, bumps merge into one wide flat band.
    for (const bmp of CLOUD_BUMPS) {
      const rx = bmp.rx * (1 + ri * 7) * size;   // much wider
      const ry = bmp.ry * (1 - ri * 0.7) * size; // much flatter
      // Shift bumps toward center x as they merge
      const dx = bmp.dx * (1 - ri * 0.6) * size;
      ctx.beginPath();
      ctx.ellipse(x + dx, y, rx, Math.max(ry, 3 * size), 0, Math.PI, 0, false);
      ctx.fill();
    }

    // At high intensity, add a wider semi-transparent band on top
    if (ri > 0.3) {
      const bandAlpha = (ri - 0.3) * 0.5;
      ctx.fillStyle = `rgba(${r - 10}, ${g - 10}, ${b - 10}, ${bandAlpha})`;
      const bandW = 100 * size * ri;
      const bandH = 6 * size;
      ctx.beginPath();
      ctx.ellipse(x, y - bandH * 0.3, bandW, bandH, 0, Math.PI, 0, false);
      ctx.fill();
    }
  }

  /** Approximate pixel width of a cloud at the given size+scale, used
   *  to spawn each cloud just past the right edge so it drifts into
   *  view smoothly instead of popping in. Based on the CLOUD_BUMPS
   *  footprint: leftmost bump at dx=-12.5 to rightmost at dx=55. */
  function cloudVisualWidth(size, scale) {
    // Rain clouds are wider streaks (~240px base vs 70px for puffy clouds)
    const base = state.rainIntensity > 0.3 ? 240 : 70;
    return base * size * scale;
  }

  /** Target cloud count for the current viewport — tuned so a typical
   *  desktop gets ~5-7 clouds and mobile gets ~3-4. The update loop
   *  maintains this density by spawning a new cloud whenever one
   *  drifts off-screen, so the sky never clusters or empties. */
  function targetCloudCount() {
    const base = Math.max(3, Math.round(state.width / 380));
    const density = state._cloudDensity || 1;
    // Smoothly interpolate cloud count with rain intensity
    const rainMult = 1 + state.rainIntensity * 2; // 1× to 3×
    return Math.round(base * Math.max(density, rainMult));
  }

  /** Minimum horizontal distance between a newly-spawned cloud and the
   *  previous rightmost cloud, to avoid visual stacking. */
  function minCloudSpacing() {
    const base = Math.max(220, state.width * 0.22);
    return state.rainIntensity > 0.3 ? base * 0.3 : base;
  }

  function makeCloudObject(xAbsolute) {
    // Y range spans from the top of the screen down to roughly half
    // of the play area so some clouds hang low over the horizon.
    const yMin = 40;
    const yMax = Math.max(180, state.ground * 0.55);
    const size = randRange(0.55, 1.2) * (state.width / 1000);
    const scale = 2;
    return {
      x: xAbsolute,
      y: yMin + Math.random() * (yMax - yMin),
      size,
      scale,
    };
  }

  /** Spawn a single new cloud just past the right edge, but only if
   *  it won't sit on top of the rightmost existing cloud. Returns
   *  true if the cloud was added. */
  function trySpawnCloud() {
    const candidate = makeCloudObject(0);
    const visualWidth = cloudVisualWidth(candidate.size, candidate.scale);
    // Find the rightmost existing cloud.
    let rightmost = -Infinity;
    for (const c of state.clouds) {
      if (c.x > rightmost) rightmost = c.x;
    }
    const spawnX = state.width + visualWidth * 0.5;
    if (rightmost > -Infinity && spawnX - rightmost < minCloudSpacing()) {
      return false;
    }
    candidate.x = spawnX;
    state.clouds.push(candidate);
    return true;
  }

  /** Pre-populate the sky with a balanced handful of clouds so the
   *  game doesn't start with an empty background. Positions are
   *  deterministically spaced across the full width so no two seed
   *  clouds collide. */
  function seedClouds() {
    state.clouds = [];
    const count = targetCloudCount();
    const gap = state.width / count;
    for (let i = 0; i < count; i++) {
      // Base position evenly spaced, plus a small random jitter so
      // it doesn't look mechanical.
      const baseX = gap * (i + 0.5);
      const jitter = (Math.random() - 0.5) * gap * 0.4;
      const cloud = makeCloudObject(baseX + jitter);
      state.clouds.push(cloud);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Parallax background layers (dunes, procedural)
  // ══════════════════════════════════════════════════════════════════

  /** Dune ridge height above ground — gentle rolling sin waves.
   *  Frequencies are relative to viewport width for consistent look. */
  function _duneHeight(screenX, offset) {
    const wx = screenX + offset;
    const h = state.height;
    const f = Math.PI * 2 / (state.width * 2);
    return h * 0.04  * Math.sin(wx * f * 3 + 1.2)
         + h * 0.025 * Math.sin(wx * f * 5 + 0.7)
         + h * 0.015 * Math.sin(wx * f * 8 + 2.1)
         + h * 0.09;
  }

  /** Spawn a dune cactus at the given world-space x. */
  function _spawnDuneCactus(worldX) {
    const variant = CACTUS_VARIANTS[Math.floor(Math.random() * CACTUS_VARIANTS.length)];
    const ch = (18 + Math.random() * 20) * variant.heightScale;
    const cw = ch * (variant.w / variant.h);
    return {
      wx: worldX,
      h: ch, w: cw,
      key: variant.key,
      struck: false,
      depth: Math.random() < 0.5 ? 1 : 3, // tumbleweed draws at depth 2
    };
  }

  function initDunes() {
    state.duneCacti = [];
    state._nextDuneCactusX = 0;
    // Pre-populate cacti across the initial visible area + buffer
    let wx = -state.width * 0.5;
    while (wx < state.width * 2) {
      state.duneCacti.push(_spawnDuneCactus(wx));
      wx += 80 + Math.random() * 200;
    }
    state._nextDuneCactusX = wx;
  }

  // ══════════════════════════════════════════════════════════════════
  // Sky gradient (cached in an off-screen canvas, repainted only when
  // the current sky color changes)
  // ══════════════════════════════════════════════════════════════════

  function computeSkyGradient() {
    if (!skyCanvas || !skyCtx) return;
    const w = state.width;
    const h = state.height;
    if (skyCanvas.width !== w) skyCanvas.width = w;
    if (skyCanvas.height !== h) skyCanvas.height = h;
    // Fade from the current sky color at the top to a slightly
    // brighter, desaturated version at the horizon for atmospheric
    // depth. Both stops are pre-divided by the foreground multiply
    // tint that gets applied over the whole canvas in render(), so
    // that AFTER the multiply, the visible sky still looks like
    // `currentSky` rather than darkened. Without this compensation
    // the sky reads too dark, especially at night where the multiply
    // factor is highest.
    const sky = state.currentSky;
    const horizonR = Math.round(sky[0] + (255 - sky[0]) * 0.45);
    const horizonG = Math.round(sky[1] + (255 - sky[1]) * 0.45);
    const horizonB = Math.round(sky[2] + (255 - sky[2]) * 0.45);
    const grad = skyCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgb(sky));
    grad.addColorStop(1, `rgb(${horizonR}, ${horizonG}, ${horizonB})`);
    skyCtx.fillStyle = grad;
    skyCtx.fillRect(0, 0, w, h);
  }

  // ══════════════════════════════════════════════════════════════════
  // Shareable score card
  //
  // Composes a 1200×630 PNG with the current sky color, a fresh
  // raptor (carrying whatever cosmetics the player has unlocked
  // AND toggled on), the final score, and the personal best. The
  // shell exposes this through Game.generateScoreCard() and hands
  // the resulting Blob to either navigator.share (mobile) or a
  // download link (desktop). Returns a Promise<Blob>.
  // ══════════════════════════════════════════════════════════════════

  // Persistent worker reused across calls so we don't pay startup
  // cost every game-over.
  let scoreCardWorker = null;
  function getScoreCardWorker() {
    if (scoreCardWorker) return scoreCardWorker;
    try {
      scoreCardWorker = new Worker("score-card-worker.js");
    } catch (e) {
      scoreCardWorker = null;
    }
    return scoreCardWorker;
  }

  async function generateScoreCardBlob() {
    // Try the web-worker path first — keeps the main thread
    // free so the raptor keeps animating smoothly under the
    // game-over scrim.
    try {
      if (
        deathSnapshotReady &&
        typeof createImageBitmap === "function" &&
        typeof OffscreenCanvas !== "undefined"
      ) {
        const worker = getScoreCardWorker();
        if (worker) {
          const bitmap = await createImageBitmap(deathCanvas);
          const blob = await new Promise((resolve, reject) => {
            const onMessage = (e) => {
              worker.removeEventListener("message", onMessage);
              worker.removeEventListener("error", onError);
              if (e.data && e.data.blob) resolve(e.data.blob);
              else reject(new Error(e.data && e.data.error || "worker failed"));
            };
            const onError = (ev) => {
              worker.removeEventListener("message", onMessage);
              worker.removeEventListener("error", onError);
              reject(new Error("worker error: " + ev.message));
            };
            worker.addEventListener("message", onMessage);
            worker.addEventListener("error", onError);
            worker.postMessage(
              {
                bitmap,
                score: state.score,
                highScore: state.highScore,
                newHighScore: state.newHighScore,
              },
              [bitmap]
            );
          });
          return blob;
        }
      }
    } catch (e) {
      // Fall through to main-thread path.
    }
    return generateScoreCardBlobMainThread();
  }

  // Main-thread fallback for browsers without OffscreenCanvas /
  // Web Worker support, or when the worker errors out.
  function generateScoreCardBlobMainThread() {
    const W = 1200;
    const H = 630;
    // Render at 2× logical resolution so text and sprites stay
    // crisp on retina-class devices. All drawing below uses
    // logical W/H coordinates.
    const scale = 2;
    const card = document.createElement("canvas");
    card.width = W * scale;
    card.height = H * scale;
    const cctx = card.getContext("2d");
    cctx.scale(scale, scale);
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = "high";

    // ── Background: the actual game screenshot from death ─────
    // If we have a death snapshot, draw it as "object-fit: cover"
    // on the card. Otherwise fall back to a plain dark backdrop.
    if (
      deathSnapshotReady &&
      deathCanvas &&
      deathCanvas.width > 0 &&
      deathCanvas.height > 0
    ) {
      const srcW = deathCanvas.width;
      const srcH = deathCanvas.height;
      const srcAspect = srcW / srcH;
      const dstAspect = W / H;
      let sx;
      let sy;
      let sw;
      let sh;
      if (srcAspect > dstAspect) {
        // Source is wider than card — crop left/right.
        sh = srcH;
        sw = sh * dstAspect;
        sy = 0;
        sx = (srcW - sw) / 2;
      } else {
        // Source is taller than card — crop top/bottom, biased
        // toward the upper portion so the raptor + ground stay
        // in frame.
        sw = srcW;
        sh = sw / dstAspect;
        sx = 0;
        sy = Math.max(0, (srcH - sh) * 0.75);
      }
      cctx.drawImage(deathCanvas, sx, sy, sw, sh, 0, 0, W, H);
    } else {
      cctx.fillStyle = "#0c0e15";
      cctx.fillRect(0, 0, W, H);
    }

    // ── Dark gradient strip at the top for title legibility ──
    const topShadeH = 220;
    const topShade = cctx.createLinearGradient(0, 0, 0, topShadeH);
    topShade.addColorStop(0, "rgba(0, 0, 0, 0.7)");
    topShade.addColorStop(1, "rgba(0, 0, 0, 0)");
    cctx.fillStyle = topShade;
    cctx.fillRect(0, 0, W, topShadeH);

    // Dark gradient strip at the bottom for the score block.
    const botShadeH = 260;
    const botShade = cctx.createLinearGradient(
      0,
      H - botShadeH,
      0,
      H
    );
    botShade.addColorStop(0, "rgba(0, 0, 0, 0)");
    botShade.addColorStop(1, "rgba(0, 0, 0, 0.75)");
    cctx.fillStyle = botShade;
    cctx.fillRect(0, H - botShadeH, W, botShadeH);

    // ── Title + URL (top left) ────────────────────────────────
    cctx.save();
    cctx.textAlign = "left";
    cctx.textBaseline = "alphabetic";
    cctx.fillStyle = "#ffffff";
    cctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    cctx.shadowBlur = 14;
    cctx.font =
      'bold 72px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillText("Raptor Runner", 60, 100);
    cctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    cctx.font = '26px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillText("raptor.trebeljahr.com", 62, 142);
    cctx.restore();

    // ── Score block (bottom right) ────────────────────────────
    cctx.save();
    cctx.textAlign = "right";
    cctx.textBaseline = "alphabetic";
    cctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    cctx.shadowBlur = 16;
    // Uppercase label.
    cctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    cctx.font =
      '600 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillText("FINAL SCORE", W - 60, H - 180);
    // Big gradient score.
    cctx.font =
      'bold 180px "Helvetica Neue", Helvetica, Arial, sans-serif';
    const scoreGrad = cctx.createLinearGradient(
      0,
      H - 170,
      0,
      H - 40
    );
    scoreGrad.addColorStop(0, "#ffee9a");
    scoreGrad.addColorStop(1, "#e89d33");
    cctx.fillStyle = scoreGrad;
    cctx.fillText(`${state.score}`, W - 60, H - 50);
    cctx.restore();

    // Personal best / new record line (left side, bottom).
    cctx.save();
    cctx.textAlign = "left";
    cctx.textBaseline = "alphabetic";
    cctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    cctx.shadowBlur = 14;
    cctx.font =
      'italic 36px "Helvetica Neue", Helvetica, Arial, sans-serif';
    if (state.newHighScore) {
      cctx.fillStyle = "#ffd84a";
      cctx.fillText("★ New personal best!", 60, H - 60);
    } else {
      cctx.fillStyle = "rgba(255, 255, 255, 0.82)";
      cctx.fillText(
        `Personal best: ${state.highScore}`,
        60,
        H - 60
      );
    }
    cctx.restore();

    return new Promise((resolve) => {
      card.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // Update + render
  // ══════════════════════════════════════════════════════════════════

  function update(now) {
    state.frame++;

    // ── Delta-time / frame-rate independence ────────────────────
    // Every per-frame integration in the game (raptor physics,
    // cactus and cloud drift, star/smoothPhase advance, sky-color
    // lerp, star opacity fade) was originally written assuming a
    // steady 60fps step. `frameScale` is "how many 60fps frames
    // this actual frame represents", so multiplying any of those
    // integrations by it makes the game run at the same real-time
    // speed on a 60Hz display, a 120Hz one, or a 30fps one.
    //
    // We clamp the upper bound at 1/20s (≈3 frames at 60fps) so a
    // browser tab-switch or long GC pause doesn't teleport the
    // raptor through a cactus when the loop resumes.
    const prevNow = state.lastNow || now;
    const rawDtSec = (now - prevNow) / 1000;
    state.lastNow = now;
    const dtSec = Math.min(Math.max(rawDtSec, 0), 1 / 20);
    const frameScale = dtSec * 60; // 1.0 at 60fps, 0.5 at 120fps

    // Continuous, monotonic day-phase. Drives the sky color, the
    // sun/moon arc, and the star rotation so they all stay locked
    // together.
    const speedMult = state.bgVelocity / INITIAL_BG_VELOCITY;
    state.smoothPhase += (speedMult / (SKY_CYCLE_SCORE * 60)) * frameScale;

    // Rain cycle tracking: detect when we enter a new day cycle.
    const cycleIndex = Math.floor(state.smoothPhase);
    if (cycleIndex > state.lastCycleIndex && state.lastCycleIndex >= 0) {
      state.totalDayCycles += 1;
      saveTotalDayCycles(state.totalDayCycles);
      // Moon phase: realistic ~29.5 day synodic month
      state.moonPhase = (state.totalDayCycles % 30) / 30;
      if (Math.abs(state.moonPhase - 0.5) < 0.02) unlockAchievement("full-moon");
      // Start rain at cycle boundaries; duration is 0.3–1.2 day cycles
      if (!state.isRaining && shouldRainForCycle(state.totalDayCycles)) {
        state.isRaining = true;
        state.rainEndPhase = state.smoothPhase + 0.3 + Math.random() * 0.9;
      }
    }
    state.lastCycleIndex = cycleIndex;

    // End rain when duration expires
    if (state.isRaining && state.smoothPhase >= state.rainEndPhase) {
      state.isRaining = false;
      if (!state.gameOver) unlockAchievement("rainy-day");
    }

    // Smooth rain intensity transition (0→1 fade in, 1→0 fade out)
    const raining = state.isRaining;
    const targetIntensity = raining ? 1 : 0;
    // Fade in slower than fade out for natural feel
    const fadeRate = raining ? 0.008 : 0.02;
    state.rainIntensity += (targetIntensity - state.rainIntensity) * fadeRate * frameScale;
    if (state.rainIntensity < 0.005) state.rainIntensity = 0;
    if (state.rainIntensity > 0.995) state.rainIntensity = 1;

    // Spawn rain proportional to intensity
    if (state.rainIntensity > 0.01) spawnRain(frameScale);
    updateRain(dtSec);
    updateLightning(frameScale, now);

    // Rainbow: rare chance after rain fades out during daytime.
    // Never on the first storm, ~30% chance thereafter.
    if (!raining && state.rainIntensity < 0.1 && state.rainIntensity > 0 && !state.rainbow) {
      const phase = (state.smoothPhase % 1 + 1) % 1;
      const bi = Math.floor(phase * SKY_COLORS.length);
      if (!_isNightBand[bi] && !_isNightBand[(bi + 1) % SKY_COLORS.length]) {
        // Debug rain stop: always rainbow. Natural: 50% chance.
        if (state._debugRainStop || Math.random() < 0.5) {
          state.rainbow = { age: 0, life: 6 };
          unlockAchievement("rainbow");
        }
        state._debugRainStop = false;
      }
    }
    // Update rainbow
    if (state.rainbow) {
      state.rainbow.age += dtSec;
      if (state.rainbow.age >= state.rainbow.life) state.rainbow = null;
    }

    // Rain audio: fade volume with intensity
    if (state.rainIntensity > 0.01 && !audio._isRainPlaying) audio.startRain();
    else if (state.rainIntensity < 0.01 && audio._isRainPlaying) audio.stopRain();
    if (audio.rain && audio._isRainPlaying) {
      audio.rain.volume = 0.2 * state.rainIntensity;
    }

    // Slow rotation of the night-sky dome, tied to the cycle phase
    // so every night repeats the same visible arc. The rotation wraps
    // from its max angle back to zero at phase 1 → 0, which happens
    // during solid daylight when stars are fully faded out — so the
    // discontinuity is never visible.
    //
    // The total rotation per cycle is intentionally small (~18°):
    // because the pivot sits ~1.5 screen-heights above the viewport,
    // a star at screen-center is ~2h from the pivot, so even a
    // modest rotation traces a long arc. At 0.1π/cycle the drift
    // across a single night is ~7.5° — enough to see the sky move,
    // not enough to drift stars off before the night ends.
    const wrappedPhase = ((state.smoothPhase % 1) + 1) % 1;
    state.starRotation = wrappedPhase * Math.PI * 0.1;

    // Day/night cycle driven by smoothPhase (continuous), not score
    // (discrete) — so the sun/moon position never jumps when the
    // player passes a cactus.
    const phase = (state.smoothPhase % 1 + 1) % 1;
    const bandF = phase * SKY_COLORS.length;
    const bandIndex = Math.floor(bandF);
    const bandT = bandF - bandIndex;
    const nextBand = (bandIndex + 1) % SKY_COLORS.length;

    // Stars fade in when the sky is genuinely dark — solid-night
    // bands plus the dark half of each twilight transition.
    state.isNight = isNightPhase(bandIndex, bandT);

    // Night-survival tracking for the "survive N nights"
    // achievements. Two-phase detection:
    //   1. When isNight goes true → false, mark a pending night
    //      (the raptor survived through the dark).
    //   2. Only count it + fire achievements once the sky is
    //      solidly in daytime (bands 0-4) — i.e. fully past the
    //      sunrise phase — so the toast appears when the sun is
    //      clearly out, not mid-transition.
    if (state._wasInNight && !state.isNight && !state.gameOver) {
      state._pendingNights = (state._pendingNights || 0) + 1;
    }
    if (state._pendingNights > 0 && _isDayBand[bandIndex] && !state.gameOver) {
      state.runNightsSurvived += state._pendingNights;
      state._pendingNights = 0;
      if (state.runNightsSurvived >= 1) {
        unlockAchievement("first-night");
      }
      if (state.runNightsSurvived >= 10) {
        unlockAchievement("ten-nights");
      }
      if (state.runNightsSurvived >= 20) {
        unlockAchievement("twenty-nights");
      }
    }
    state._wasInNight = state.isNight;

    if (
      state.frame % SKY_UPDATE_INTERVAL_FRAMES === 0 ||
      state.score !== state.lastSkyScore
    ) {
      let target = lerpColor(
        SKY_COLORS[bandIndex],
        SKY_COLORS[nextBand],
        bandT
      );
      // Overcast sky during rain — lerp toward dark gray proportional to intensity.
      if (state.rainIntensity > 0) {
        target = lerpColor(target, [55, 60, 68], 0.7 * state.rainIntensity);
      }
      // 0.2-per-60fps-frame lerp, scaled to the real frame delta
      // (multiplied by SKY_UPDATE_INTERVAL_FRAMES because we're in
      // the throttled branch that only runs every N frames).
      const lerpT = Math.min(1, 0.2 * frameScale);
      state.currentSky = lerpColor(state.currentSky, target, lerpT);
      computeSkyGradient();
      state.lastSkyScore = state.score;
    }

    stars.update(state.isNight, frameScale);
    // Shooting-star easter egg: only runs from the 2nd night onward.
    maybeSpawnShootingStar(frameScale);
    updateShootingStars(dtSec);
    // Confetti particles from cosmetic unlocks.
    updateConfetti(dtSec);
    updateDust(dtSec);
    updateAsh(dtSec);
    updateRareEvent(dtSec);

    if (!state.gameOver) {
      raptor.update(now, frameScale);
      cactuses.update(frameScale);

      // Collision: raptor concave polygon vs each cactus polygon.
      if (!state.noCollisions) {
      const raptorPoly = raptor.collisionPolygon();
      for (const c of cactuses.cacti) {
        if (polygonsOverlap(raptorPoly, c.collisionPolygon())) {
          state.gameOver = true;
          state.gameOverFrame = state.frame;
          if (!audio.muted && navigator.vibrate) navigator.vibrate([50, 30, 80]);
          commitRunScore();
          // Bump the career run counter and unlock the
          // "first-run" / "century-runner" milestones.
          state.careerRuns += 1;
          saveCareerRuns(state.careerRuns);
          if (state.careerRuns >= 1) unlockAchievement("first-run");
          if (state.careerRuns >= 100) unlockAchievement("century-runner");
          // Sound-of-silence is awarded for surviving a full
          // run (any length) with audio muted the whole time.
          // We ignore trivial zero-jump runs so the player
          // can't game it by instantly dying.
          if (state._runMutedThroughout && state.runJumps >= 5) {
            unlockAchievement("sound-of-silence");
          }
          // Notify any listeners (e.g. the shell's share button)
          // that a game-over just happened. Fired exactly once per
          // run, directly from the transition instead of via a poll.
          for (const cb of GameAPI._gameOverCbs) {
            try { cb(); } catch (e) { /* ignore listener errors */ }
          }
          break;
        }
      }
      } // end noCollisions guard

      // Clouds drift — slower than the ground but a bit faster than
      // the first-pass fix, so the parallax reads as "distant sky"
      // without feeling sluggish.
      for (const cloud of state.clouds) {
        cloud.x -= state.bgVelocity * (state.width / 2000) * frameScale;
        cloud.y += randRange(-0.2, 0.2) * frameScale;
      }
      // Parallax layer offsets.
      state.duneOffset += state.bgVelocity * 0.08 * frameScale;
      // Age struck dune cacti; discard dead/offscreen; spawn new on right.
      if (state.duneCacti) {
        for (const dc of state.duneCacti) {
          if (dc.struck) dc.struckAge = (dc.struckAge || 0) + dtSec;
        }
        state.duneCacti = state.duneCacti.filter(
          (dc) => !dc.dead && dc.wx - state.duneOffset > -dc.w * 3
        );
        const rightEdge = state.duneOffset + state.width + 100;
        if (!state._nextDuneCactusX || state._nextDuneCactusX < rightEdge) {
          const wx = (state._nextDuneCactusX || rightEdge) + 80 + Math.random() * 200;
          state.duneCacti.push(_spawnDuneCactus(wx));
          state._nextDuneCactusX = wx;
        }
      }
      // Keep clouds until they've fully drifted past the left edge.
      state.clouds = state.clouds.filter((c) => {
        const w = cloudVisualWidth(c.size, c.scale);
        return c.x > -w && c.x < state.width + w * 2;
      });
      // Maintain a constant cloud density: if we're below the target
      // count AND the rightmost cloud is far enough away to avoid
      // visual stacking, add a new cloud just past the right edge.
      // trySpawnCloud() enforces the min-spacing constraint itself.
      if (
        state.clouds.length < targetCloudCount() &&
        state.frame % 8 === 0
      ) {
        trySpawnCloud();
      }
    } else {
      state.gameOverFade = Math.min(
        state.gameOverFade + 0.01 * frameScale,
        1
      );
    }
  }

  function render() {
    // === Background pass (no tint) =================================
    // Sky background (single blit of the cached gradient buffer).
    if (skyCanvas) ctx.drawImage(skyCanvas, 0, 0);

    // Stars + Milky Way (fade in only at night).
    // Stars fade out during rain — overcast sky blocks them.
    if (state.rainIntensity < 1) {
      if (state.rainIntensity > 0) {
        ctx.save();
        ctx.globalAlpha = 1 - state.rainIntensity;
        stars.draw(ctx);
        ctx.restore();
      } else {
        stars.draw(ctx);
      }
    }
    // Shooting stars (easter egg, second night onward).
    drawShootingStars(ctx);
    drawUfoBeam(ctx);

    // Sun + moon ride parabolic arcs across the sky. Drawn at full
    // brightness — they're light sources, not lit objects, and they
    // sit behind the foreground because the foreground gets drawn
    // on top of them below.
    drawSun(ctx);
    drawMoon(ctx);

    // Comet/meteor draw ON TOP of sun, moon, and stars.
    drawRareEventSky(ctx);

    // Rainbow — drawn in the background so foreground elements
    // (ground, cacti, raptor, clouds, dunes) all render on top.
    if (state.rainbow) {
      const rb = state.rainbow;
      let alpha;
      if (rb.age < 1) alpha = rb.age;
      else if (rb.age < 3) alpha = 1;
      else alpha = 1 - (rb.age - 3) / 3;
      alpha = Math.max(0, Math.min(1, alpha)) * 0.55;
      if (alpha > 0) {
        const cx = state.width * 0.7;
        const cy = state.ground + state.height * 0.15;
        const outerR = state.height * 0.55;
        const thickness = Math.max(15, state.width * 0.025);
        const innerR = outerR - thickness;
        // Continuous radial gradient — colors blend smoothly
        const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
        grad.addColorStop(0, `rgba(148, 0, 211, ${alpha})`);   // violet (inner)
        grad.addColorStop(0.17, `rgba(75, 0, 200, ${alpha})`);  // indigo
        grad.addColorStop(0.33, `rgba(30, 130, 255, ${alpha})`); // blue
        grad.addColorStop(0.5, `rgba(30, 200, 30, ${alpha})`);  // green
        grad.addColorStop(0.67, `rgba(255, 240, 30, ${alpha})`); // yellow
        grad.addColorStop(0.83, `rgba(255, 140, 0, ${alpha})`);  // orange
        grad.addColorStop(1, `rgba(255, 30, 30, ${alpha})`);    // red (outer)
        ctx.save();
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, Math.PI, 0);
        ctx.arc(cx, cy, innerR, 0, Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // === Foreground pass (rendered on offscreen canvas, then       =
    // === uniformly sky-tinted, then composited onto the main pass) =
    fgCtx.clearRect(0, 0, state.width, state.height);


    // Clouds — drawn pure white here, the source-atop tint below
    // picks up the sky color and washes them toward it.
    for (const cloud of state.clouds) {
      drawCloudMorphed(fgCtx, cloud.x, cloud.y, cloud.size * cloud.scale, state.rainIntensity);
    }

    // Parallax dunes — drawn procedurally from noise each frame.
    {
      const off = state.duneOffset;
      const groundY = state.ground;
      const step = 4;
      // Dune color blended with sky for atmospheric depth
      const sky = state.currentSky;
      const dr = Math.round(200 * 0.65 + sky[0] * 0.35);
      const dg = Math.round(168 * 0.65 + sky[1] * 0.35);
      const db = Math.round(120 * 0.65 + sky[2] * 0.35);
      fgCtx.fillStyle = `rgb(${dr}, ${dg}, ${db})`;
      fgCtx.beginPath();
      fgCtx.moveTo(0, state.height);
      for (let sx = 0; sx <= state.width; sx += step) {
        const y = groundY - _duneHeight(sx, off);
        fgCtx.lineTo(sx, y);
      }
      fgCtx.lineTo(state.width, state.height);
      fgCtx.closePath();
      fgCtx.fill();

      // Dune cacti + tumbleweed in 3 depth layers:
      // depth 1 cacti → tumbleweed (depth 2) → depth 3 cacti
      const _drawDuneCacti = (targetDepth) => {
        if (!state.duneCacti) return;
        for (const dc of state.duneCacti) {
          if (dc.dead || dc.depth !== targetDepth) continue;
          const sx = dc.wx - off;
          if (sx < -dc.w * 2 || sx > state.width + dc.w * 2) continue;
          const duneY = groundY - _duneHeight(sx, off);
          const img = IMAGES[dc.key];
          if (!img) continue;
          fgCtx.save();
          if (dc.struck) {
            fgCtx.filter = "brightness(0.1) saturate(0)";
            if (dc.struckAge > 0.8) {
              const fadeT = Math.min(1, (dc.struckAge - 0.8) / 0.6);
              fgCtx.globalAlpha = 1 - fadeT;
              if (Math.random() < 0.3) spawnAsh(sx, duneY, dc.w, dc.h);
              if (fadeT >= 1) { dc.dead = true; fgCtx.restore(); continue; }
            }
          }
          fgCtx.drawImage(img,
            Math.round(sx - dc.w / 2), Math.round(duneY + dc.h * 0.15 - dc.h),
            Math.round(dc.w), Math.round(dc.h));
          fgCtx.restore();
        }
      };
      _drawDuneCacti(1); // behind tumbleweed
      // Tumbleweed at depth 2
      const _re = state.activeRareEvent;
      if (_re && _re.id === "tumbleweed") {
        const twImg = IMAGES.tumbleweed;
        if (twImg) {
          fgCtx.save();
          fgCtx.translate(_re.x, _re.y);
          fgCtx.rotate(_re.rot || 0);
          fgCtx.drawImage(twImg, -10, -10, 20, 20);
          fgCtx.restore();
        }
      }
      _drawDuneCacti(3); // in front of tumbleweed
    }

    // Extra sky tint on dunes + dune cacti — stronger than the
    // foreground tint so they feel more distant.
    {
      const sky = state.currentSky;
      const strength = Math.min(1, tintStrength() * 1.8);
      fgCtx.save();
      fgCtx.globalCompositeOperation = "source-atop";
      fgCtx.fillStyle = `rgba(${sky[0]}, ${sky[1]}, ${sky[2]}, ${strength})`;
      fgCtx.fillRect(0, 0, state.width, state.height);
      fgCtx.restore();
    }

    // Ground bands.
    fgCtx.fillStyle = "#ebc334";
    fgCtx.fillRect(0, state.ground, state.width, 5);
    fgCtx.fillStyle = "#ebab21";
    fgCtx.fillRect(0, state.ground + 5, state.width, 10);
    fgCtx.fillStyle = "#ba8c27";
    fgCtx.fillRect(0, state.ground + 15, state.width, 20);
    fgCtx.fillStyle = "#EDC9AF";
    fgCtx.fillRect(0, state.ground + 35, state.width, 200);


    // Cacti.
    cactuses.draw(fgCtx);

    // Raptor.
    raptor.draw(fgCtx);
    drawDust(fgCtx);
    drawRareEventFg(fgCtx);
    drawAsh(fgCtx);

    // Sky-light tint applied ONLY where the foreground has drawn
    // pixels. `source-atop` performs alpha blending only over
    // existing dest pixels, leaving transparent areas untouched —
    // so the tint doesn't bleed into the sky region around the
    // raptor or above the cacti.
    {
      const sky = state.currentSky;
      const strength = tintStrength();
      fgCtx.save();
      fgCtx.globalCompositeOperation = "source-atop";
      fgCtx.fillStyle = `rgba(${sky[0]}, ${sky[1]}, ${sky[2]}, ${strength})`;
      fgCtx.fillRect(0, 0, state.width, state.height);
      fgCtx.restore();
    }

    // Composite the tinted foreground over the background.
    ctx.drawImage(
      fgCanvas,
      0,
      0,
      fgCanvas.width,
      fgCanvas.height,
      0,
      0,
      state.width,
      state.height
    );

    // Confetti — drawn AFTER the tinted foreground so the
    // colors pop at any time of day (no sky-tint washing them
    // out). Only alive when a cosmetic was just unlocked.
    drawConfetti(ctx);

    // Overcast bands — persistent layered cloud cover during rain.
    drawOvercastBands(ctx, state.rainIntensity);

    // Grey wash-out overlay proportional to rain intensity.
    if (state.rainIntensity > 0) {
      ctx.fillStyle = `rgba(50, 55, 60, ${state.rainIntensity * 0.15})`;
      ctx.fillRect(0, 0, state.width, state.height);
    }

    drawRain(ctx);
    drawLightning(ctx);


    // Score text lives in the DOM now (see #score-display in
    // index.html), not on the canvas. That means it doesn't appear
    // in the death-snapshot that feeds the share card, and it can
    // pick up the same pill styling as the top-right icon cluster.

    // Debug: draw the raptor and cactus collision polygons on top of
    // everything so the player can see what the collision tests are
    // actually checking against.
    if (state.showHitboxes) {
      drawPolygon(ctx, raptor.collisionPolygon(), {
        stroke: "rgba(255, 80, 80, 0.95)",
        fill: "rgba(255, 80, 80, 0.18)",
      });
      for (const c of cactuses.cacti) {
        drawPolygon(ctx, c.collisionPolygon(), {
          stroke: "rgba(80, 200, 255, 0.95)",
          fill: "rgba(80, 200, 255, 0.18)",
        });
      }
    }

    // Capture a pristine snapshot of the canvas the first frame
    // after the player dies — before the Game Over overlay is
    // drawn on top of it. Used by the share card as its
    // background, so the card literally shows the scene the
    // player just died in.
    if (state.gameOver && !deathSnapshotReady && canvas && deathCanvas) {
      deathCanvas.width = canvas.width;
      deathCanvas.height = canvas.height;
      deathCtx.setTransform(1, 0, 0, 1, 0, 0);
      deathCtx.drawImage(canvas, 0, 0);
      deathSnapshotReady = true;
    }

    // Game-over overlay: just a dim scrim. The DOM score-card
    // panel (shown by the shell on Game.onGameOver) handles the
    // "Game Over" / score / personal best / restart hint text
    // now, so the canvas only needs to provide the dark fade
    // underneath it for contrast.
    if (state.gameOver) {
      ctx.fillStyle = `rgba(0, 0, 0, ${state.gameOverFade * 0.6})`;
      ctx.fillRect(0, 0, state.width, state.height);
    }
  }

  // ── Debug performance instrumentation ──────────────────────────
  // When ?debug=true, tracks per-frame timings and draws an
  // overlay with FPS + frame budget breakdown. Updated every 30
  // frames to avoid the readout itself costing performance.
  const perf = {
    enabled: false,
    samples: [],
    maxSamples: 60,
    lastDisplay: { fps: 0, update: 0, render: 0, total: 0 },
    frameCount: 0,
  };

  function drawPerfOverlay() {
    if (!perf.enabled || !ctx) return;
    if (++perf.frameCount % 30 === 0 && perf.samples.length > 0) {
      const n = perf.samples.length;
      let sumU = 0, sumR = 0, sumT = 0;
      for (const s of perf.samples) {
        sumU += s.update;
        sumR += s.render;
        sumT += s.total;
      }
      perf.lastDisplay = {
        fps: Math.round(1000 / (sumT / n)),
        update: (sumU / n).toFixed(2),
        render: (sumR / n).toFixed(2),
        total: (sumT / n).toFixed(2),
      };
      perf.samples.length = 0;
    }
    const d = perf.lastDisplay;
    const lines = [
      `FPS: ${d.fps}`,
      `Update: ${d.update} ms`,
      `Render: ${d.render} ms`,
      `Frame:  ${d.total} ms`,
    ];
    ctx.save();
    ctx.font = "bold 11px monospace";
    ctx.textBaseline = "top";
    const x = 10, y = state.height - 70;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - 4, y - 4, 150, lines.length * 15 + 8);
    ctx.fillStyle = "#0f0";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x, y + i * 15);
    }
    ctx.restore();
  }

  function loop(now) {
    const t0 = performance.now();
    let tUpdate = t0;
    if (!state.paused) {
      update(now || t0);
      tUpdate = performance.now();
    }
    render();
    const tRender = performance.now();
    if (perf.enabled) {
      perf.samples.push({
        update: tUpdate - t0,
        render: tRender - tUpdate,
        total: tRender - t0,
      });
      drawPerfOverlay();
    }
    _rafId = requestAnimationFrame(loop);
  }

  // ══════════════════════════════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════════════════════════════

  // ── Persistent high score (localStorage) ──────────────────────────

  /** Read the saved personal best. Returns 0 if storage is
   *  unavailable (private mode, denied permission) or unparseable. */
  function loadHighScore() {
    try {
      const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
      if (raw == null) return 0;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  /** Persist the high score. Silently no-ops if storage is unavailable. */
  function saveHighScore(value) {
    try {
      window.localStorage.setItem(HIGH_SCORE_KEY, String(value));
    } catch (e) {
      /* ignore — no-op in environments without localStorage */
    }
  }

  function loadCareerRuns() {
    try {
      const raw = window.localStorage.getItem(CAREER_RUNS_KEY);
      if (raw == null) return 0;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }
  function saveCareerRuns(value) {
    try {
      window.localStorage.setItem(CAREER_RUNS_KEY, String(value));
    } catch (e) {
      /* ignore */
    }
  }

  function loadUnlockedAchievements() {
    const set = Object.create(null);
    try {
      const raw = window.localStorage.getItem(ACHIEVEMENTS_KEY);
      if (!raw) return set;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const id of arr) if (typeof id === "string") set[id] = true;
      }
    } catch (e) {
      /* ignore corrupt values */
    }
    return set;
  }
  function saveUnlockedAchievements(set) {
    try {
      const arr = Object.keys(set);
      window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(arr));
    } catch (e) {
      /* ignore */
    }
  }

  /** Unlock an achievement by id. Silently no-ops if the id is
   *  unknown or already unlocked. Fires the onAchievementUnlock
   *  callbacks so the shell can show a toast. */
  function unlockAchievement(id) {
    const def = ACHIEVEMENTS_BY_ID[id];
    if (!def) return;
    if (state.unlockedAchievements[id]) return;
    state.unlockedAchievements[id] = true;
    saveUnlockedAchievements(state.unlockedAchievements);
    for (const cb of GameAPI._achievementCbs) {
      try {
        cb(def);
      } catch (e) {
        /* ignore listener errors */
      }
    }
  }

  function loadTotalJumps() {
    try {
      const raw = window.localStorage.getItem(TOTAL_JUMPS_KEY);
      if (raw == null) return 0;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveTotalJumps(value) {
    try {
      window.localStorage.setItem(TOTAL_JUMPS_KEY, String(value));
    } catch (e) {
      /* ignore */
    }
  }

  /** Boolean localStorage helper. Returns `fallback` if the key is
   *  missing or unparseable (e.g. private mode, denied storage). */
  function loadBoolFlag(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return fallback;
      return raw === "1";
    } catch (e) {
      return fallback;
    }
  }
  function saveBoolFlag(key, value) {
    try {
      window.localStorage.setItem(key, value ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
  }

  /** Called once the player dies. Checks if this run's score beat
   *  the stored personal best and, if so, saves it and flags the
   *  run for celebration on the game-over overlay. */
  function commitRunScore() {
    if (state.score > state.highScore) {
      state.highScore = state.score;
      state.newHighScore = true;
      saveHighScore(state.highScore);
    } else {
      state.newHighScore = false;
    }
  }

  /** Reset per-run tracking state. Called from both start()
   *  (first run) and resetGame() (subsequent runs) so the
   *  initialization is identical regardless of code path. */
  function initRunState() {
    state.runJumps = 0;
    state.runNightsSurvived = 0;
    state._pendingNights = 0;
    state.runShootingStars = 0;
    state._wasInNight = false;
    // Sound of Silence: snapshot the mute state right now.
    // If the player unmutes at any point during the run,
    // setMuted() flips this to false. Checked at game-over.
    state._runMutedThroughout = !!(audio && audio.muted);
  }

  function resetGame() {
    state.gameOver = false;
    state.gameOverFade = 0;
    state.gameOverFrame = 0;
    state.newHighScore = false;
    state.currentSky = [...SKY_COLORS[0]];
    state.lastSkyScore = -1;
    state.smoothPhase = 0;
    state.score = 0;
    state.bgVelocity = INITIAL_BG_VELOCITY;
    state.lastNow = null;
    state.shootingStars = [];
    state.confetti = [];
    state.dust = [];
    state.ash = [];
    state.activeRareEvent = null;
    state.rainParticles = [];
    state.lightning = { alpha: 0, nextAt: 0 };
    state.isRaining = false;
    state.rainIntensity = 0;
    state.rainEndPhase = 0;
    state.rainbow = null;
    state.lastCycleIndex = -1;
    audio.stopRain();
    // Cloud density: 20% cloudless, 50% normal, 30% extra cloudy
    const cdRoll = Math.random();
    state._cloudDensity = cdRoll < 0.2 ? 0 : cdRoll < 0.7 ? 1 : 2;
    initRunState();
    // Fresh dunes and cacti each run.
    initDunes();
    // Next game-over will capture a fresh snapshot.
    deathSnapshotReady = false;
    seedClouds();
    if (raptor) {
      raptor.velocity = 0;
      raptor.y = raptor.ground;
      raptor.frame = 0;
      raptor.lastFrameAdvanceAt = 0;
    }
    if (cactuses) cactuses.clear();
    stars = new Stars();
    computeSkyGradient();
    // Notify any listeners (e.g. the shell's share button) that
    // the game has transitioned back to a fresh state.
    for (const cb of GameAPI._gameResetCbs) {
      try { cb(); } catch (e) { /* ignore listener errors */ }
    }
  }

  function maybeResetAfterGameOver() {
    if (state.gameOver && state.frame - state.gameOverFrame > 30) {
      resetGame();
    }
  }

  function onResize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight + 1;
    state.groundHeight = state.height / 10;
    state.ground = state.height - state.groundHeight;

    if (canvas && ctx) {
      // HiDPI/retina: back the canvas at dpr × logical size so drawing
      // stays crisp on retina screens, but cap dpr at 2 to avoid the
      // 9× pixel fill-rate on 3× Windows HiDPI displays. Then scale the
      // context so drawing code still works in logical coordinates.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(state.width * dpr);
      canvas.height = Math.round(state.height * dpr);
      canvas.style.width = state.width + "px";
      canvas.style.height = state.height + "px";
      ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
      ctx.scale(dpr, dpr);
      // Bilinear smoothing stays on — the raptor and cacti are
      // vector-ish art, not true pixel art, so nearest-neighbour gives
      // ugly jagged edges.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
    }

    // Resize the offscreen foreground canvas to match the main one
    // (in device pixels, with a matching scale transform).
    if (fgCanvas && fgCtx) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fgCanvas.width = Math.round(state.width * dpr);
      fgCanvas.height = Math.round(state.height * dpr);
      fgCtx.setTransform(1, 0, 0, 1, 0, 0);
      fgCtx.scale(dpr, dpr);
      fgCtx.imageSmoothingEnabled = true;
      fgCtx.imageSmoothingQuality = "medium";
    }

    if (raptor) raptor.resize();
    // Re-anchor every currently-alive cactus to the new
    // state.ground so they don't visibly jump when the viewport
    // dimensions change (most obvious when toggling fullscreen).
    if (cactuses && raptor) {
      for (const c of cactuses.cacti) c.resize();
    }
    if (stars) stars = new Stars();
    state.clouds = [];
    initDunes();
    computeSkyGradient();
  }

  // ══════════════════════════════════════════════════════════════════
  // Input
  // ══════════════════════════════════════════════════════════════════

  function onPointerDown(e) {
    if (!state.started || state.paused) return;
    // If the touch started on an overlay control (cog, sound, menu),
    // let the browser handle it — those elements live above the canvas
    // in the DOM tree so they'd get their own click events anyway, but
    // pointerdown on the canvas fires first on some browsers when the
    // touch overlaps the canvas area.
    if (e.target !== canvas) return;
    e.preventDefault();
    if (state.gameOver) {
      maybeResetAfterGameOver();
    } else {
      if (!raptor.jump()) raptor._jumpBufferedAt = performance.now();
    }
  }

  function onKeyDown(e) {
    // ESC is reserved for the menu overlay — let it through.
    if (e.key === "Escape") return;

    // Before the game has started, Space/Enter acts as "Start Game".
    if (!state.started) {
      if (
        e.code === "Space" ||
        e.code === "Enter" ||
        e.code === "NumpadEnter"
      ) {
        e.preventDefault();
        if (typeof window.__onStartKey === "function") {
          window.__onStartKey();
        }
      }
      return;
    }

    if (state.paused) return;

    const isJumpKey =
      e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp";
    if (isJumpKey) {
      e.preventDefault();
      if (state.gameOver) {
        maybeResetAfterGameOver();
      } else {
        if (!raptor.jump()) raptor._jumpBufferedAt = performance.now();
      }
      return;
    }

    if (e.code === "Enter" || e.code === "NumpadEnter") {
      e.preventDefault();
      maybeResetAfterGameOver();
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════════════

  const GameAPI = {
    _ready: false,
    _readyCb: null,
    // Game-over / reset listener arrays. Fired synchronously from
    // the game loop on the exact transition so the shell can
    // show/hide its share button without polling.
    _gameOverCbs: [],
    _gameResetCbs: [],
    _achievementCbs: [],

    onReady(cb) {
      if (this._ready) cb();
      else this._readyCb = cb;
    },

    /** Register a callback to run the moment the player dies.
     *  Fired once per run, synchronously from the game loop. */
    onGameOver(cb) {
      if (typeof cb === "function") this._gameOverCbs.push(cb);
    },
    /** Register a callback to run every time the game resets
     *  (after an auto-restart, or a manual Back-to-home). */
    onGameReset(cb) {
      if (typeof cb === "function") this._gameResetCbs.push(cb);
    },

    /** Register a callback fired whenever a new achievement is
     *  unlocked. Receives the achievement definition
     *  ({id, title, desc, iconPath, iconStroke}) so the shell
     *  can render a toast. */
    onAchievementUnlock(cb) {
      if (typeof cb === "function" && !this._achievementCbs.includes(cb)) {
        this._achievementCbs.push(cb);
      }
    },

    /** Full achievement catalog with unlocked status. Used by
     *  the Achievements menu overlay. Returns a shallow copy so
     *  callers can't mutate the source. */
    getAchievements() {
      return ACHIEVEMENTS.map((a) => ({
        id: a.id,
        title: a.title,
        desc: a.desc,
        iconHTML: a.iconHTML || null,
        iconImage: a.iconImage || null,
        unlocked: !!state.unlockedAchievements[a.id],
        secret: !!a.secret,
      }));
    },

    start() {
      if (state.started) return;
      state.started = true;
      state.paused = false;
        const cdRoll = Math.random();
      state._cloudDensity = cdRoll < 0.2 ? 0 : cdRoll < 0.7 ? 1 : 2;
      // Reset per-run state identically to resetGame() so the
      // very first run after page load starts clean.
      initRunState();
    },

    pause() {
      state.paused = true;
    },

    resume() {
      if (!state.started) return;
      // Clear the delta-time timestamp so the first post-resume
      // frame doesn't see a huge elapsed time and teleport
      // everything forward.
      state.lastNow = null;
      state.paused = false;
    },

    isStarted() {
      return state.started;
    },

    isPaused() {
      return state.paused;
    },

    setMuted(muted) {
      audio.setMuted(muted);
    },

    isMuted() {
      return audio.muted;
    },

    /** True when the player has explicitly saved a mute/unmute
     *  choice (either this session or a previous one). The Start
     *  Game handler uses this to decide whether to auto-unmute on
     *  first visit or honour a returning visitor's saved preference. */
    hasSavedMutePreference() {
      return audio.hasSavedPreference;
    },

    unlockAudio() {
      audio.unlockAudio();
    },

    setMusicMuted(muted) {
      audio.setMusicMuted(muted);
    },

    isMusicMuted() {
      return audio.musicMuted;
    },

    setJumpMuted(muted) {
      audio.setJumpMuted(muted);
    },

    isJumpMuted() {
      return audio.jumpMuted;
    },

    isDebug() {
      return state.debug;
    },

    /** Current run's score. */
    getScore() {
      return state.score;
    },

    /** Debug helper — overwrite the current run's score. Used by
     *  the debug menu's score editor so testers can verify unlock
     *  / personal-best / share-card behavior without waiting for
     *  natural cactus passes. */
    setScore(n) {
      const next = Math.max(0, Math.floor(Number(n) || 0));
      state.score = next;
      // Fire any score-threshold achievements the player just
      // skipped over so debug-setting the score to e.g. 6000
      // unlocks everything in one go.
      if (next >= 1) unlockAchievement("first-jump");
      if (next >= 25) unlockAchievement("score-25");
      if (next >= 100) unlockAchievement("party-time");
      if (next >= BOW_TIE_SCORE_THRESHOLD) unlockAchievement("dinosaurs-forever");
      if (next >= THUG_GLASSES_SCORE_THRESHOLD) unlockAchievement("score-250");
      // Also trigger cosmetic unlocks if thresholds are met.
      if (!state.unlockedPartyHat && next >= PARTY_HAT_SCORE_THRESHOLD) {
        state.unlockedPartyHat = true;
        state.wearPartyHat = true;
        saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, true);
        saveBoolFlag(WEAR_PARTY_HAT_KEY, true);
      }
      if (!state.unlockedThugGlasses && next >= THUG_GLASSES_SCORE_THRESHOLD) {
        state.unlockedThugGlasses = true;
        state.wearThugGlasses = true;
        saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, true);
        saveBoolFlag(WEAR_THUG_GLASSES_KEY, true);
      }
      if (!state.unlockedBowTie && next >= BOW_TIE_SCORE_THRESHOLD) {
        state.unlockedBowTie = true;
        state.wearBowTie = true;
        saveBoolFlag(UNLOCKED_BOW_TIE_KEY, true);
        saveBoolFlag(WEAR_BOW_TIE_KEY, true);
      }
    },

    /** Best score persisted in localStorage across all runs. */
    getHighScore() {
      return state.highScore;
    },

    /** True while a game-over overlay is showing for a run that
     *  broke the previous personal best. */
    isNewHighScore() {
      return state.newHighScore;
    },

    /** True if the player is currently looking at the game-over
     *  screen. Used by the shell to decide when to show the
     *  "Share your score" button. */
    isGameOver() {
      return state.gameOver;
    },

    /** Reset to a fresh run right now. Safe to call any time
     *  during a game-over state; the short death animation
     *  cooldown is still applied inside maybeResetAfterGameOver. */
    restartFromGameOver() {
      maybeResetAfterGameOver();
    },

    /** Debug helper: force a game-over immediately without needing
     *  an actual collision. Lets the shell test the share card
     *  flow end to end. */
    _forceGameOver() {
      if (state.gameOver) return;
      state.gameOver = true;
      state.gameOverFrame = state.frame;
      commitRunScore();
      for (const cb of GameAPI._gameOverCbs) {
        try { cb(); } catch (e) { /* ignore */ }
      }
    },

    /** Reset the game back to its idle pre-start state: paused,
     *  not-started, fresh score and entities. The shell pairs this
     *  with re-showing the start screen when the player picks
     *  "Back to home screen" from the menu. */
    returnToHome() {
      resetGame();
      state.started = false;
      state.paused = true;
    },

    /** Compose a 1200×630 "share your score" PNG on an offscreen
     *  canvas, using whatever sky/time-of-day and cosmetics the
     *  player had on during the run they just finished. Resolves
     *  to a Blob the shell can hand to navigator.share or a
     *  download link. */
    generateScoreCard() {
      return generateScoreCardBlob();
    },

    isShowingHitboxes() {
      return state.showHitboxes;
    },

    setShowHitboxes(on) {
      state.showHitboxes = !!on;
    },

    toggleShowHitboxes() {
      state.showHitboxes = !state.showHitboxes;
      return state.showHitboxes;
    },

    isNoCollisions() {
      return state.noCollisions;
    },

    toggleNoCollisions() {
      state.noCollisions = !state.noCollisions;
      return state.noCollisions;
    },

    isPerfOverlay() {
      return perf.enabled;
    },

    togglePerfOverlay() {
      perf.enabled = !perf.enabled;
      return perf.enabled;
    },

    isRaining() {
      return state.isRaining;
    },

    /** Debug: trigger or stop a rain cycle with natural duration. */
    toggleRain() {
      if (state.isRaining) {
        // Stop current rain immediately — force rainbow
        state.isRaining = false;
        state.rainEndPhase = 0;
        state._debugRainStop = true;
      } else {
        // Start a natural-length rain cycle
        state.isRaining = true;
        state.rainEndPhase = state.smoothPhase + 0.3 + Math.random() * 0.9;
      }
      return state.isRaining;
    },

    /** Debug: trigger a specific rare event by id. */
    triggerEvent(id) {
      const evt = RARE_EVENTS.find((e) => e.id === id);
      if (!evt) return false;
      state.activeRareEvent = {
        id: evt.id,
        age: 0,
        life: evt.duration,
        x: state.width + 50,
        y: state.height * (0.1 + Math.random() * 0.3),
      };
      if (!state._rareEventsSeen[evt.id]) {
        state._rareEventsSeen[evt.id] = true;
        saveRareEventsSeen(state._rareEventsSeen);
        unlockAchievement(evt.achievement);
      }
      return true;
    },

    /** List available rare event IDs for debug. */
    getEventIds() {
      return RARE_EVENTS.map((e) => e.id);
    },

    /** Debug: advance to next day cycle and update moon phase. */
    advanceMoonPhase() {
      state.totalDayCycles += 1;
      saveTotalDayCycles(state.totalDayCycles);
      state.moonPhase = (state.totalDayCycles % 30) / 30;
      // Jump to the start of night (band 6 of 12 = phase 0.5)
      state.smoothPhase = Math.floor(state.smoothPhase) + 0.5;
      state.lastCycleIndex = Math.floor(state.smoothPhase);
      if (Math.abs(state.moonPhase - 0.5) < 0.02) unlockAchievement("full-moon");
      return state.moonPhase;
    },

    // ── Accessory unlock state (persisted) ─────────────────────

    /** True once the player has cleared PARTY_HAT_SCORE_THRESHOLD
     *  cacti in a single run. In debug mode, always true. */
    isPartyHatUnlocked() {
      return state.unlockedPartyHat;
    },
    isThugGlassesUnlocked() {
      return state.unlockedThugGlasses;
    },

    /** True when the accessory is both unlocked and the player has
     *  the cosmetic turned on. This is what actually gates the
     *  sprite on the raptor. */
    isPartyHatActive() {
      return this.isPartyHatUnlocked() && state.wearPartyHat;
    },
    isThugGlassesActive() {
      return this.isThugGlassesUnlocked() && state.wearThugGlasses;
    },

    isBowTieUnlocked() {
      return state.unlockedBowTie;
    },
    isBowTieActive() {
      return this.isBowTieUnlocked() && state.wearBowTie;
    },

    /** Player preference setters. Silently no-op if the accessory
     *  isn't unlocked yet, so you can't turn something on you
     *  don't own. Debug mode unlocks everything, so testers can
     *  still use these. */
    setWearPartyHat(on) {
      if (!this.isPartyHatUnlocked()) return false;
      state.wearPartyHat = !!on;
      saveBoolFlag(WEAR_PARTY_HAT_KEY, state.wearPartyHat);
      return state.wearPartyHat;
    },
    setWearThugGlasses(on) {
      if (!this.isThugGlassesUnlocked()) return false;
      state.wearThugGlasses = !!on;
      saveBoolFlag(WEAR_THUG_GLASSES_KEY, state.wearThugGlasses);
      return state.wearThugGlasses;
    },

    togglePartyHat() {
      return this.setWearPartyHat(!state.wearPartyHat);
    },
    toggleThugGlasses() {
      return this.setWearThugGlasses(!state.wearThugGlasses);
    },

    setWearBowTie(on) {
      if (!this.isBowTieUnlocked()) return false;
      state.wearBowTie = !!on;
      saveBoolFlag(WEAR_BOW_TIE_KEY, state.wearBowTie);
      return state.wearBowTie;
    },
    toggleBowTie() {
      return this.setWearBowTie(!state.wearBowTie);
    },

    getTotalJumps() {
      return state.totalJumps;
    },

    /** Debug: wipe saved career jumps, unlock bits, and wear
     *  preferences so the raptor reverts to its naked state. */
    /** Wipe all persistent progress — jumps, cosmetic unlocks,
     *  career runs, achievements, and high score — back to a
     *  fresh-install state. Debug-only affordance. */
    resetAllProgress() {
      state.totalJumps = 0;
      state.highScore = 0;
      state.careerRuns = 0;
      state.unlockedPartyHat = false;
      state.unlockedThugGlasses = false;
      state.wearPartyHat = false;
      state.wearThugGlasses = false;
      state.unlockedAchievements = {};
      saveTotalJumps(0);
      saveHighScore(0);
      saveCareerRuns(0);
      saveUnlockedAchievements({});
      saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, false);
      saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, false);
      saveBoolFlag(WEAR_PARTY_HAT_KEY, false);
      saveBoolFlag(WEAR_THUG_GLASSES_KEY, false);
      state.unlockedBowTie = false;
      state.wearBowTie = false;
      saveBoolFlag(UNLOCKED_BOW_TIE_KEY, false);
      saveBoolFlag(WEAR_BOW_TIE_KEY, false);
      state.totalDayCycles = 0;
      saveTotalDayCycles(0);
      state._rareEventsSeen = {};
      saveRareEventsSeen({});
    },

    /** Remove all event listeners and stop the game loop. Call
     *  when the game is being torn down (e.g. page navigation). */
    destroy() {
      if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = 0;
      }
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("keydown", onKeyDown);
      if (canvas) canvas.removeEventListener("pointerdown", onPointerDown);
    },
  };
  window.Game = GameAPI;

  // ══════════════════════════════════════════════════════════════════
  // Init
  // ══════════════════════════════════════════════════════════════════

  function preloadImages() {
    return Promise.all(
      Object.entries(IMAGE_SRCS).map(
        ([key, src]) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              IMAGES[key] = img;
              resolve();
            };
            img.onerror = () => {
              console.warn(`Failed to load ${src}`);
              IMAGES[key] = null;
              resolve();
            };
            img.src = src;
          })
      )
    );
  }

  async function init() {
    // Parse `?debug=true` — turns on debug mode which makes the
    // "Show hitboxes" toggle visible in the menu.
    try {
      const params = new URLSearchParams(window.location.search);
      state.debug = params.get("debug") === "true";
      if (state.debug) {
        document.body.setAttribute("data-debug", "true");
        state.showHitboxes = false;
        state.noCollisions = true;
        perf.enabled = false;
      }
    } catch (e) {
      /* no-op */
    }

    canvas = document.getElementById("game-canvas");
    if (!canvas) {
      console.error("game-canvas element not found");
      return;
    }
    ctx = canvas.getContext("2d");

    skyCanvas = document.createElement("canvas");
    skyCtx = skyCanvas.getContext("2d");
    fgCanvas = document.createElement("canvas");
    fgCtx = fgCanvas.getContext("2d");
    deathCanvas = document.createElement("canvas");
    deathCtx = deathCanvas.getContext("2d");

    audio.init();

    // Load the player's saved mute preference into the audio object's
    // state, without triggering .play() yet (browser autoplay
    // policies require a user gesture). The saved value will be
    // applied for real on the first Start Game click, which IS a
    // user gesture.
    const savedMuted = audio.loadSavedMuted();
    if (savedMuted != null) {
      audio.muted = savedMuted;
      audio.hasSavedPreference = true;
    }

    // Load the player's saved personal best (if any) so the start
    // screen and game-over overlay can show it.
    state.highScore = loadHighScore();
    // Load the cumulative jump count + the two accessory unlock
    // bits. wearX defaults to true so a newly-unlocked accessory
    // shows up immediately; returning players get whatever they
    // last saved.
    state.totalJumps = loadTotalJumps();
    state.totalDayCycles = loadTotalDayCycles();
    state._rareEventsSeen = loadRareEventsSeen();
    state.careerRuns = loadCareerRuns();
    state.unlockedAchievements = loadUnlockedAchievements();
    state.unlockedPartyHat = loadBoolFlag(UNLOCKED_PARTY_HAT_KEY, false);
    state.unlockedThugGlasses = loadBoolFlag(
      UNLOCKED_THUG_GLASSES_KEY,
      false
    );
    state.wearPartyHat = loadBoolFlag(WEAR_PARTY_HAT_KEY, true);
    state.wearThugGlasses = loadBoolFlag(WEAR_THUG_GLASSES_KEY, true);
    state.unlockedBowTie = loadBoolFlag(UNLOCKED_BOW_TIE_KEY, false);
    state.wearBowTie = loadBoolFlag(WEAR_BOW_TIE_KEY, true);
    // Backwards-compat: earlier versions gated cosmetic unlocks
    // on cumulative jumps. If a returning player has already
    // banked enough jumps from that era, respect the old reward
    // rather than asking them to re-earn it under the new rules.
    if (!state.unlockedPartyHat && state.totalJumps >= 100) {
      state.unlockedPartyHat = true;
      saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, true);
    }
    if (!state.unlockedThugGlasses && state.totalJumps >= 200) {
      state.unlockedThugGlasses = true;
      saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, true);
    }

    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    await preloadImages();

    raptor = new Raptor();
    cactuses = new Cactuses();
    stars = new Stars();
    computeSkyGradient();

    // Eagerly bake the shooting-star trail sprite BEFORE the
    // first frame so the first star to spawn doesn't pay a
    // canvas / gradient compile cost on the hot path.
    bakeShootingStarSprite();
    // Warm-up draw: invisible (globalAlpha=0) drawImage pass
    // that primes any lazy GPU upload / texture bind path in
    // the main canvas ctx. Without this, the first real draw
    // on some browsers can still hitch a frame.
    if (ctx && shootingStarSprite) {
      ctx.save();
      ctx.globalAlpha = 0;
      ctx.drawImage(shootingStarSprite, 0, 0, 1, 1);
      ctx.restore();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    // Start the rAF loop. The game stays paused (state.paused = true)
    // until Game.start() is called by the Start button click handler.
    _rafId = requestAnimationFrame(loop);

    GameAPI._ready = true;
    if (GameAPI._readyCb) {
      const cb = GameAPI._readyCb;
      GameAPI._readyCb = null;
      cb();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
