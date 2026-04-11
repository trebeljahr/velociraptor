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
  // localStorage key for the cumulative jump count. Earns easter-egg
  // flair on the raptor: the party hat unlocks at
  // PARTY_HAT_JUMP_THRESHOLD, and the "thug life" glasses unlock at
  // THUG_GLASSES_JUMP_THRESHOLD — both persist in localStorage, so
  // the player only has to earn them once.
  const TOTAL_JUMPS_KEY = "raptor-runner:totalJumps";
  const PARTY_HAT_JUMP_THRESHOLD = 100;
  const THUG_GLASSES_JUMP_THRESHOLD = 200;
  // Per-accessory unlock + wear flags in localStorage. "unlocked"
  // is a sticky bit set when the player first crosses the jump
  // threshold; "wear" is the player's current on/off cosmetic
  // preference, defaults to true the moment the accessory is
  // earned. Both persist across sessions.
  const UNLOCKED_PARTY_HAT_KEY = "raptor-runner:unlocked:partyHat";
  const UNLOCKED_THUG_GLASSES_KEY = "raptor-runner:unlocked:thugGlasses";
  const WEAR_PARTY_HAT_KEY = "raptor-runner:wear:partyHat";
  const WEAR_THUG_GLASSES_KEY = "raptor-runner:wear:thugGlasses";

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
    jump: null,

    init() {
      this.music = document.getElementById("game-music");
      this.jump = document.getElementById("game-jump");
      if (this.music) this.music.volume = 0.5;
    },

    setMuted(muted, persist = true) {
      this.muted = !!muted;
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
      if (this.muted) {
        this.music.pause();
      } else {
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
      if (this.muted || !this.jump) return;
      try {
        this.jump.currentTime = 0;
      } catch (e) {
        /* ignored */
      }
      const p = this.jump.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
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
    // Total jumps the player has ever performed this run. Persists
    // across game-overs only via localStorage (see TOTAL_JUMPS_KEY).
    // At >= 100, the easter-egg party hat starts appearing on the
    // raptor's head as a reward for sticking with the game.
    totalJumps: 0,
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
      // Track total jumps across all runs — this is what unlocks
      // the easter-egg accessories.
      state.totalJumps += 1;
      saveTotalJumps(state.totalJumps);
      // Threshold crossings: first time the player hits the number,
      // flip the sticky unlock bit and default the wear flag to
      // true so the new cosmetic shows up immediately.
      if (
        !state.unlockedPartyHat &&
        state.totalJumps >= PARTY_HAT_JUMP_THRESHOLD
      ) {
        state.unlockedPartyHat = true;
        state.wearPartyHat = true;
        saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, true);
        saveBoolFlag(WEAR_PARTY_HAT_KEY, true);
      }
      if (
        !state.unlockedThugGlasses &&
        state.totalJumps >= THUG_GLASSES_JUMP_THRESHOLD
      ) {
        state.unlockedThugGlasses = true;
        state.wearThugGlasses = true;
        saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, true);
        saveBoolFlag(WEAR_THUG_GLASSES_KEY, true);
      }
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
      // has the cosmetic toggled on. Debug mode treats everything
      // as if already unlocked so testers can toggle the look
      // without grinding to the threshold.
      const glassesUnlocked = state.debug || state.unlockedThugGlasses;
      if (glassesUnlocked && state.wearThugGlasses) {
        this.drawThugGlasses(ctx);
      }
      const hatUnlocked = state.debug || state.unlockedPartyHat;
      if (hatUnlocked && state.wearPartyHat) {
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
      const t = 0.5;
      const cx = crown.x + (snout.x - crown.x) * t;
      const cy = crown.y + (snout.y - crown.y) * t;
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
  // Spawned only from the SECOND night onward — Math.floor(smoothPhase)
  // >= 1 means at least one full day/night cycle has already elapsed,
  // so the player has "earned" the flourish. Each shooting star is a
  // bright white dot with a fading trail. They're drawn in screen
  // space (not inside the rotating dome transform) because they're
  // brief events — dome rotation during their 1-second life would be
  // imperceptible and would just complicate the math.
  // ════════════════════════════════════════════════════════════════

  function maybeSpawnShootingStar(frameScale) {
    if (Math.floor(state.smoothPhase) < 1) return;
    if (!state.isNight) return;
    // Small per-frame chance — averaged roughly one shooting star
    // every ~6 seconds of real-time night, which is "noticeable but
    // not spammy".
    const chance = 0.003 * frameScale;
    if (Math.random() > chance) return;
    const w = state.width;
    const h = state.height;
    // Start above the upper-right quadrant, fly diagonally down-left.
    const startX = w * randRange(0.55, 1.05);
    const startY = h * randRange(-0.05, 0.35);
    const speed = Math.max(w, h) * 0.9; // px/sec
    const angle = Math.PI + randRange(0.25, 0.55); // down-left
    state.shootingStars.push({
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: randRange(0.8, 1.4),
    });
  }

  function updateShootingStars(dtSec) {
    if (state.shootingStars.length === 0) return;
    for (const s of state.shootingStars) {
      s.x += s.vx * dtSec;
      s.y += s.vy * dtSec;
      s.age += dtSec;
    }
    // Drop expired entries (alive time exceeded life, or off-screen).
    state.shootingStars = state.shootingStars.filter((s) => {
      if (s.age >= s.life) return false;
      if (s.x < -100 || s.y > state.height + 100) return false;
      return true;
    });
  }

  function drawShootingStars(ctx) {
    if (state.shootingStars.length === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    for (const s of state.shootingStars) {
      // Opacity peaks mid-life and fades at both ends so the trail
      // appears and disappears smoothly.
      const t = s.age / s.life;
      const alpha = Math.sin(Math.PI * t);
      if (alpha <= 0) continue;
      // Trail length: ~80px worth of velocity, drawn backwards from
      // the head along the inverse velocity direction.
      const trailLen = 110;
      const vMag = Math.hypot(s.vx, s.vy) || 1;
      const tx = s.x - (s.vx / vMag) * trailLen;
      const ty = s.y - (s.vy / vMag) * trailLen;
      const grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
      grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      grad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      // Bright head dot.
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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

  function generateScoreCardBlob() {
    const W = 1200;
    const H = 630;
    const card = document.createElement("canvas");
    card.width = W;
    card.height = H;
    const cctx = card.getContext("2d");
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = "high";

    // ── Sky gradient (current sky color) ────────────────────────
    const sky = state.currentSky;
    const horizonR = Math.round(sky[0] + (255 - sky[0]) * 0.45);
    const horizonG = Math.round(sky[1] + (255 - sky[1]) * 0.45);
    const horizonB = Math.round(sky[2] + (255 - sky[2]) * 0.45);
    const groundY = Math.round(H * 0.84);
    const skyGrad = cctx.createLinearGradient(0, 0, 0, groundY);
    skyGrad.addColorStop(0, rgb(sky));
    skyGrad.addColorStop(1, `rgb(${horizonR}, ${horizonG}, ${horizonB})`);
    cctx.fillStyle = skyGrad;
    cctx.fillRect(0, 0, W, groundY);

    // ── Ground bands (same palette as the in-game foreground) ──
    cctx.fillStyle = "#ebc334";
    cctx.fillRect(0, groundY, W, 5);
    cctx.fillStyle = "#ebab21";
    cctx.fillRect(0, groundY + 5, W, 10);
    cctx.fillStyle = "#ba8c27";
    cctx.fillRect(0, groundY + 15, W, 20);
    cctx.fillStyle = "#EDC9AF";
    cctx.fillRect(0, groundY + 35, W, H - groundY - 35);

    // ── Raptor (with whatever cosmetics the player earned) ─────
    // Temporarily rebind the raptor to card coords, call draw()
    // straight from its class (which already handles the hat +
    // glasses correctly), then restore.
    if (raptor && IMAGES.raptorSheet) {
      const savedX = raptor.x;
      const savedY = raptor.y;
      const savedW = raptor.w;
      const savedH = raptor.h;
      const savedFrame = raptor.frame;
      const savedGround = raptor.ground;
      raptor.w = W / 3;
      raptor.h = raptor.w * RAPTOR_ASPECT;
      raptor.ground = groundY - raptor.h + 10;
      raptor.x = W * 0.08;
      raptor.y = raptor.ground;
      // Frame 0 is a neutral running pose with the body level.
      raptor.frame = 0;
      raptor.draw(cctx);
      raptor.x = savedX;
      raptor.y = savedY;
      raptor.w = savedW;
      raptor.h = savedH;
      raptor.ground = savedGround;
      raptor.frame = savedFrame;
    }

    // ── Foreground sky-light tint over the whole lower half ────
    // Mirrors the in-game compositing so the card doesn't look
    // uncannily bright compared to the scene the player just died
    // in. Source-atop over the raptor+ground region only, so it
    // doesn't darken the sky behind.
    {
      const tint = sky;
      const strength = tintStrength();
      cctx.save();
      cctx.globalCompositeOperation = "source-atop";
      cctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${strength})`;
      // Only cover the ground/raptor region, not the whole card
      // — the sky gradient above already represents the sky and
      // doesn't need extra tinting.
      cctx.fillRect(0, Math.round(H * 0.55), W, H);
      cctx.restore();
    }

    // ── Title + score text ────────────────────────────────────
    // Drop shadow keeps the text readable at twilight / night.
    cctx.save();
    cctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    cctx.shadowBlur = 18;
    cctx.shadowOffsetY = 2;
    cctx.fillStyle = "#ffffff";
    cctx.textAlign = "right";
    cctx.textBaseline = "alphabetic";
    cctx.font =
      'bold 140px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillText(`${state.score}`, W - 70, 230);

    cctx.font = '30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillText("final score", W - 70, 275);

    // Personal best line — highlights if the run WAS the best.
    const bestLabel = state.newHighScore
      ? `★ New personal best!`
      : `Personal best: ${state.highScore}`;
    cctx.font =
      'italic 34px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillText(bestLabel, W - 70, 335);

    // Title + URL on the top-left.
    cctx.textAlign = "left";
    cctx.shadowBlur = 14;
    cctx.font =
      'bold 72px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillText("Raptor Runner", 70, 150);
    cctx.font = '28px "Helvetica Neue", Helvetica, Arial, sans-serif';
    cctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    cctx.fillText("raptor.trebeljahr.com", 70, 195);
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


    // Score text — tinted so it stays readable against the current sky.
    const textBase = state.isNight ? [255, 255, 255] : [0, 0, 0];
    const textColor = lerpColor(state.currentSky, textBase, 0.6);
    ctx.fillStyle = rgb(textColor);
    ctx.font = '32px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`Score: ${state.score}`, 20, 30);

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

    // Game over overlay.
    if (state.gameOver) {
      ctx.fillStyle = `rgba(0, 0, 0, ${state.gameOverFade})`;
      ctx.fillRect(0, 0, state.width, state.height);
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const titleSize = Math.round(state.width / 15);
      const smallSize = Math.round(state.width / 40);
      const tinySize = Math.round(state.width / 60);
      ctx.font = `bold ${titleSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillText("Game Over", state.width / 2, state.height / 2.6);

      // Score line — current run, and personal best below.
      ctx.font = `${smallSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillText(
        `Score: ${state.score}`,
        state.width / 2,
        state.height / 2.6 + titleSize * 0.95
      );

      if (state.newHighScore) {
        // Celebrate a new personal best with a pulsing warm tint.
        const pulse =
          0.7 + 0.3 * Math.sin(state.frame * 0.1);
        ctx.fillStyle = `rgba(255, 210, 80, ${pulse})`;
        ctx.font = `bold ${smallSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
        ctx.fillText(
          `★ NEW PERSONAL BEST! ★`,
          state.width / 2,
          state.height / 2.6 + titleSize * 0.95 + smallSize * 1.4
        );
        ctx.fillStyle = "#ffffff";
      } else if (state.highScore > 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        ctx.font = `${smallSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
        ctx.fillText(
          `Personal best: ${state.highScore}`,
          state.width / 2,
          state.height / 2.6 + titleSize * 0.95 + smallSize * 1.4
        );
        ctx.fillStyle = "#ffffff";
      }

      ctx.font = `italic ${tinySize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillText(
        "Press ENTER or tap to restart!",
        state.width / 2,
        state.height / 2.6 + titleSize * 0.95 + smallSize * 3.0
      );
    }
  }

  function loop(now) {
    if (!state.paused) update(now || performance.now());
    render();
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

    start() {
      if (state.started) return;
      state.started = true;
      state.paused = false;
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

    isDebug() {
      return state.debug;
    },

    /** Current run's score. */
    getScore() {
      return state.score;
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

    /** True once the player has crossed PARTY_HAT_JUMP_THRESHOLD
     *  total career jumps. In debug mode, always true. */
    isPartyHatUnlocked() {
      return state.debug || state.unlockedPartyHat;
    },
    isThugGlassesUnlocked() {
      return state.debug || state.unlockedThugGlasses;
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
    resetTotalJumps() {
      state.totalJumps = 0;
      state.unlockedPartyHat = false;
      state.unlockedThugGlasses = false;
      state.wearPartyHat = true;
      state.wearThugGlasses = true;
      saveTotalJumps(0);
      saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, false);
      saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, false);
      saveBoolFlag(WEAR_PARTY_HAT_KEY, true);
      saveBoolFlag(WEAR_THUG_GLASSES_KEY, true);
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
        // Enable hitboxes by default when debug mode is on; the user
        // can still toggle them off via the menu.
        state.showHitboxes = true;
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
    state.unlockedPartyHat = loadBoolFlag(UNLOCKED_PARTY_HAT_KEY, false);
    state.unlockedThugGlasses = loadBoolFlag(
      UNLOCKED_THUG_GLASSES_KEY,
      false
    );
    state.wearPartyHat = loadBoolFlag(WEAR_PARTY_HAT_KEY, true);
    state.wearThugGlasses = loadBoolFlag(WEAR_THUG_GLASSES_KEY, true);
    // Safety net: if the player already has enough career jumps
    // from a previous version that didn't track the unlock bit,
    // flip it on so they don't lose their earned cosmetic.
    if (!state.unlockedPartyHat && state.totalJumps >= PARTY_HAT_JUMP_THRESHOLD) {
      state.unlockedPartyHat = true;
      saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, true);
    }
    if (
      !state.unlockedThugGlasses &&
      state.totalJumps >= THUG_GLASSES_JUMP_THRESHOLD
    ) {
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
