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
  const JUMP_CLEARANCE_MULTIPLIER = 1.5;
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
  const THUG_GLASSES_SCORE_THRESHOLD = 200;
  // Per-accessory unlock + wear flags in localStorage. "unlocked"
  // is a sticky bit set when the player first crosses the jump
  // threshold; "wear" is the player's current on/off cosmetic
  // preference, defaults to true the moment the accessory is
  // earned. Both persist across sessions.
  const UNLOCKED_PARTY_HAT_KEY = "raptor-runner:unlocked:partyHat";
  const UNLOCKED_THUG_GLASSES_KEY = "raptor-runner:unlocked:thugGlasses";
  const WEAR_PARTY_HAT_KEY = "raptor-runner:wear:partyHat";
  const WEAR_THUG_GLASSES_KEY = "raptor-runner:wear:thugGlasses";
  // Career-wide run counter + unlocked achievement IDs live
  // under their own keys so storage is namespaced and easy to
  // wipe independently of the jump / mute preferences.
  const CAREER_RUNS_KEY = "raptor-runner:careerRuns";
  const ACHIEVEMENTS_KEY = "raptor-runner:achievements";

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
      // The actual thug-glasses cosmetic sprite.
      iconImage: "assets/thug-glasses.png",
    },
    {
      id: "score-250",
      title: "Raptor Legend",
      desc: "Score 500 points in a single run",
      // Trophy with a star in the cup.
      iconHTML:
        '<path d="M9 20h6v1.5H9z" fill="#7a4a00"/>' +
        '<path d="M10.5 17h3l.4 3h-3.8z" fill="#c78a12"/>' +
        '<path d="M7 4h10v5a5 5 0 0 1-10 0V4z" fill="#f7d148" stroke="#c78a12" stroke-width="1"/>' +
        '<path d="M7 5H5a1 1 0 0 0-1 1v1a3 3 0 0 0 3 3h.4" fill="none" stroke="#c78a12" stroke-width="1.2"/>' +
        '<path d="M17 5h2a1 1 0 0 1 1 1v1a3 3 0 0 1-3 3h-.4" fill="none" stroke="#c78a12" stroke-width="1.2"/>' +
        '<path d="M12 5.2l.9 1.9 2.1.3-1.5 1.5.3 2.1-1.8-1-1.8 1 .3-2.1L9 7.4l2.1-.3z" fill="#ffffff"/>',
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

  const IMAGE_SRCS = {
    raptorSheet: "assets/raptor-sheet.png",
    partyHat: "assets/party-hat.png",
    thugGlasses: "assets/thug-glasses.png",
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
      } else {
        const p = this.music.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    },

    setJumpMuted(muted) {
      this.jumpMuted = !!muted;
      try {
        window.localStorage.setItem(JUMP_MUTED_KEY, this.jumpMuted ? "1" : "0");
      } catch (e) { /* ignored */ }
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
    // Active shooting-star flashes. Each entry is {x, y, vx, vy,
    // age, life}. Populated only from the second night onward so
    // the first night feels clean and the easter egg reads as a
    // reward for surviving longer.
    shootingStars: [],
    // Confetti particles, spawned in bursts when a cosmetic
    // unlocks so the moment reads as a celebration. Drawn over
    // the foreground tint so the colors pop at any time of day.
    confetti: [],
    clouds: [],
    // Debug mode — toggled on by `?debug=true` query param. When on,
    // the menu grows a "Show hitboxes" toggle and the game draws the
    // raptor and cactus collision polygons on top of everything.
    debug: false,
    showHitboxes: false,
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
      if (this.y !== this.ground || state.gameOver) return;
      const targetRise = this.h * JUMP_CLEARANCE_MULTIPLIER;
      const a = this.downwardAcceleration;
      const v = Math.sqrt(2 * a * targetRise);
      this.velocity = -v;
      audio.playJump();
      // Bump both the career-wide total and the per-run counter.
      state.totalJumps += 1;
      state.runJumps += 1;
      saveTotalJumps(state.totalJumps);
      // Count a jump over a cactus as a "first jump" achievement
      // — the player has clearly worked out the controls once
      // they've pushed space even once.
      // "Up And Over" used to fire here on the first jump press,
      // but now fires from the score-++ branch when the first
      // cactus is actually cleared — feels earned, not premature.
      // Cosmetic unlocks no longer live here — they're triggered
      // in the score-++ branch inside Cactuses.update(), so the
      // player has to actually clear cacti rather than padding
      // their jump count.
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
      if (this.y > this.ground) {
        this.y = this.ground;
        this.velocity = 0;
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
          Math.round(this.x),
          Math.round(this.y),
          Math.round(this.w),
          Math.round(this.h)
        );
    }
  }

  class Cactuses {
    constructor() {
      this.cacti = [];
    }

    get minSpawnDistance() {
      return raptor.w * 1.5 + Math.floor(Math.random() * raptor.w * 10);
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
        state.bgVelocity += 0.1;
      }

      for (const c of this.cacti) c.update(frameScale);

      this.cacti = this.cacti.filter((c) => {
        if (c.x < -c.w) {
          state.score++;
          // Score-threshold achievements.
          if (state.score === 1) unlockAchievement("first-jump");
          if (state.score === 25) unlockAchievement("score-25");
          if (state.score === 100) unlockAchievement("party-time");
          if (state.score === 200) unlockAchievement("dinosaurs-forever");
          if (state.score === 500) unlockAchievement("score-250");
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
        this.field.push({
          x: -padX + Math.random() * fieldW,
          y: -padY + Math.random() * fieldH,
          size: bright ? randRange(4, 6.5) : randRange(1.6, 3.5),
          brightness: bright ? randRange(0.92, 1.0) : randRange(0.45, 0.85),
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleRate: twinkles ? randRange(0.02, 0.06) : 0,
          twinkleDepth: twinkles ? randRange(0.3, 0.7) : 0,
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
      // pulse softly via a sin wave; the rest hold steady.
      for (const s of this.field) {
        let twinkle = 1;
        if (s.twinkleDepth) {
          twinkle =
            1 -
            s.twinkleDepth *
              (0.5 + 0.5 * Math.sin(s.twinklePhase + state.frame * s.twinkleRate));
        }
        const a = s.brightness * twinkle * this.opacity;
        ctx.fillStyle = rgba(starWhite, a);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size / 2, 0, Math.PI * 2);
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
    // Solid disc only — no halo glare. The sun reads as a clean
    // bright circle against the sky, no soft bleeding glow.
    ctx.fillStyle = rgb(core);
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.fill();
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
    ctx.globalAlpha = arc.alpha;
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
    // Subtle shadow on one side — gives a hint of phase without
    // turning the whole disc dark. Clipped to the moon disc so the
    // shadow doesn't bleed onto the surrounding halo.
    ctx.save();
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = rgba(shadow, 0.35);
    ctx.beginPath();
    ctx.arc(arc.x - r * 0.55, arc.y - r * 0.25, r * 0.95, 0, Math.PI * 2);
    ctx.fill();
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

  /** Approximate pixel width of a cloud at the given size+scale, used
   *  to spawn each cloud just past the right edge so it drifts into
   *  view smoothly instead of popping in. Based on the CLOUD_BUMPS
   *  footprint: leftmost bump at dx=-12.5 to rightmost at dx=55. */
  function cloudVisualWidth(size, scale) {
    return 70 * size * scale;
  }

  /** Target cloud count for the current viewport — tuned so a typical
   *  desktop gets ~5-7 clouds and mobile gets ~3-4. The update loop
   *  maintains this density by spawning a new cloud whenever one
   *  drifts off-screen, so the sky never clusters or empties. */
  function targetCloudCount() {
    return Math.max(3, Math.round(state.width / 380));
  }

  /** Minimum horizontal distance between a newly-spawned cloud and the
   *  previous rightmost cloud, to avoid visual stacking. */
  function minCloudSpacing() {
    return Math.max(220, state.width * 0.22);
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
    // bands 6–9 plus the dark half of each twilight transition.
    state.isNight =
      (bandIndex >= 6 && bandIndex <= 9) ||
      (bandIndex === 5 && bandT > 0.5) ||
      (bandIndex === 10 && bandT < 0.5);

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
    if (state._pendingNights > 0 && bandIndex <= 4 && !state.gameOver) {
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
      const target = lerpColor(
        SKY_COLORS[bandIndex],
        SKY_COLORS[nextBand],
        bandT
      );
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

    if (!state.gameOver) {
      raptor.update(now, frameScale);
      cactuses.update(frameScale);

      // Collision: raptor concave polygon vs each cactus polygon.
      const raptorPoly = raptor.collisionPolygon();
      for (const c of cactuses.cacti) {
        if (polygonsOverlap(raptorPoly, c.collisionPolygon())) {
          state.gameOver = true;
          state.gameOverFrame = state.frame;
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

      // Clouds drift — slower than the ground but a bit faster than
      // the first-pass fix, so the parallax reads as "distant sky"
      // without feeling sluggish.
      for (const cloud of state.clouds) {
        cloud.x -= state.bgVelocity * (state.width / 2000) * frameScale;
        cloud.y += randRange(-0.2, 0.2) * frameScale;
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
    stars.draw(ctx);
    // Shooting stars (easter egg, second night onward).
    drawShootingStars(ctx);

    // Sun + moon ride parabolic arcs across the sky. Drawn at full
    // brightness — they're light sources, not lit objects, and they
    // sit behind the foreground because the foreground gets drawn
    // on top of them below.
    drawSun(ctx);
    drawMoon(ctx);

    // === Foreground pass (rendered on offscreen canvas, then       =
    // === uniformly sky-tinted, then composited onto the main pass) =
    fgCtx.clearRect(0, 0, state.width, state.height);

    // Clouds — drawn pure white here, the source-atop tint below
    // picks up the sky color and washes them toward it.
    for (const cloud of state.clouds) {
      drawCloud(fgCtx, cloud.x, cloud.y, cloud.size * cloud.scale);
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
    requestAnimationFrame(loop);
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
    initRunState();
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
      raptor.jump();
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
        raptor.jump();
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
      }));
    },

    start() {
      if (state.started) return;
      state.started = true;
      state.paused = false;
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
      if (next >= 200) unlockAchievement("dinosaurs-forever");
      if (next >= 500) unlockAchievement("score-250");
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
        // Hitboxes default to off even in debug mode — the toggle
        // is in the menu if the tester wants to turn them on.
        state.showHitboxes = false;
        // Enable the performance overlay so frame-time spikes
        // are visible at a glance.
        perf.enabled = true;
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
    state.careerRuns = loadCareerRuns();
    state.unlockedAchievements = loadUnlockedAchievements();
    state.unlockedPartyHat = loadBoolFlag(UNLOCKED_PARTY_HAT_KEY, false);
    state.unlockedThugGlasses = loadBoolFlag(
      UNLOCKED_THUG_GLASSES_KEY,
      false
    );
    state.wearPartyHat = loadBoolFlag(WEAR_PARTY_HAT_KEY, true);
    state.wearThugGlasses = loadBoolFlag(WEAR_THUG_GLASSES_KEY, true);
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
    requestAnimationFrame(loop);

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
