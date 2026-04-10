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

  const RAPTOR_NATIVE_W = 578;
  const RAPTOR_NATIVE_H = 212;
  const RAPTOR_ASPECT = RAPTOR_NATIVE_H / RAPTOR_NATIVE_W;
  // Sprite sheet is the 12 GIF frames stacked vertically (578 × 2544).
  const RAPTOR_FRAMES = 12;
  const RAPTOR_IDLE_FRAME = 11; // pose used when airborne (legs tucked)
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

  const SKY_COLORS = [
    [80, 180, 205], // blue
    [80, 180, 205], // blue
    [255, 201, 34], // yellow
    [235, 120, 53], // orange
    [21, 34, 56], // night
    [21, 34, 56], // night
    [235, 120, 53], // orange
    [255, 201, 34], // yellow
  ];

  const IMAGE_SRCS = { raptorSheet: "assets/raptor-sheet.png" };
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
    muted: true,
    music: null,
    jump: null,

    init() {
      this.music = document.getElementById("game-music");
      this.jump = document.getElementById("game-jump");
      if (this.music) this.music.volume = 0.5;
    },

    setMuted(muted) {
      this.muted = !!muted;
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
    gameOver: false,
    gameOverFade: 0,
    gameOverFrame: 0,
    started: false,
    paused: true,
    frame: 0,
    currentSky: [...SKY_COLORS[0]],
    lastSkyScore: -1,
    isNight: false,
    clouds: [],
    // Debug mode — toggled on by `?debug=true` query param. When on,
    // the menu grows a "Show hitboxes" toggle and the game draws the
    // raptor and cactus collision polygons on top of everything.
    debug: false,
    showHitboxes: false,
  };

  let canvas, ctx;
  let skyCanvas, skyCtx;
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

    update(now) {
      this.y += this.velocity;
      this.velocity += this.downwardAcceleration;
      if (this.y > this.ground) {
        this.y = this.ground;
        this.velocity = 0;
      }

      // Frame animation: running while on the ground, locked to the
      // idle pose (frame 11) while airborne.
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

    update() {
      this.x -= state.bgVelocity * (state.width / 1000);
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

    update() {
      const last = this.cacti[this.cacti.length - 1];
      if (!last) {
        this.spawn();
      } else if (state.width - last.x >= this.minSpawnDistance) {
        this.spawn();
        state.bgVelocity += 0.1;
      }

      for (const c of this.cacti) c.update();

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

  class Stars {
    constructor() {
      this.array = [];
      this.opacity = 0;
      const count = Math.floor(state.width / 30);
      for (let i = 0; i < count; i++) {
        this.array.push({
          x: Math.random() * state.width,
          y: Math.random() * (state.height / 2),
          size: randRange(3, 6),
        });
      }
    }

    update(isNight) {
      if (isNight) this.opacity = Math.min(1, this.opacity + 0.005);
      else this.opacity = Math.max(0, this.opacity - 0.005);
    }

    draw(ctx) {
      if (this.opacity <= 0) return;
      ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
      for (const s of this.array) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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
    const grad = skyCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgb(state.currentSky));
    grad.addColorStop(1, "rgb(255, 255, 255)");
    skyCtx.fillStyle = grad;
    skyCtx.fillRect(0, 0, w, h);
  }

  // ══════════════════════════════════════════════════════════════════
  // Update + render
  // ══════════════════════════════════════════════════════════════════

  function update(now) {
    state.frame++;

    // Score-based day/night cycle.
    const phase = (state.score % SKY_CYCLE_SCORE) / SKY_CYCLE_SCORE;
    const bandF = phase * SKY_COLORS.length;
    const bandIndex = Math.floor(bandF);
    const bandT = bandF - bandIndex;
    const nextBand = (bandIndex + 1) % SKY_COLORS.length;

    state.isNight =
      bandIndex === 4 ||
      bandIndex === 5 ||
      (bandIndex === 3 && bandT > 0.7) ||
      (bandIndex === 6 && bandT < 0.3);

    if (
      state.frame % SKY_UPDATE_INTERVAL_FRAMES === 0 ||
      state.score !== state.lastSkyScore
    ) {
      const target = lerpColor(
        SKY_COLORS[bandIndex],
        SKY_COLORS[nextBand],
        bandT
      );
      state.currentSky = lerpColor(state.currentSky, target, 0.2);
      computeSkyGradient();
      state.lastSkyScore = state.score;
    }

    stars.update(state.isNight);

    if (!state.gameOver) {
      raptor.update(now);
      cactuses.update();

      // Collision: raptor concave polygon vs each cactus polygon.
      const raptorPoly = raptor.collisionPolygon();
      for (const c of cactuses.cacti) {
        if (polygonsOverlap(raptorPoly, c.collisionPolygon())) {
          state.gameOver = true;
          state.gameOverFrame = state.frame;
          break;
        }
      }

      // Clouds drift — slower than the ground but a bit faster than
      // the first-pass fix, so the parallax reads as "distant sky"
      // without feeling sluggish.
      for (const cloud of state.clouds) {
        cloud.x -= state.bgVelocity * (state.width / 2000);
        cloud.y += randRange(-0.2, 0.2);
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
      state.gameOverFade = Math.min(state.gameOverFade + 0.01, 1);
    }
  }

  function render() {
    // Sky background (single blit of the cached gradient buffer).
    if (skyCanvas) ctx.drawImage(skyCanvas, 0, 0);

    // Stars (only visible at night).
    stars.draw(ctx);

    // Clouds.
    for (const cloud of state.clouds) {
      drawCloud(ctx, cloud.x, cloud.y, cloud.size * cloud.scale);
    }

    // Ground bands.
    ctx.fillStyle = "#ebc334";
    ctx.fillRect(0, state.ground, state.width, 5);
    ctx.fillStyle = "#ebab21";
    ctx.fillRect(0, state.ground + 5, state.width, 10);
    ctx.fillStyle = "#ba8c27";
    ctx.fillRect(0, state.ground + 15, state.width, 20);
    ctx.fillStyle = "#EDC9AF";
    ctx.fillRect(0, state.ground + 35, state.width, 200);

    // Haze overlay on top of the ground, tinted by current sky.
    const haze = lerpColor(state.currentSky, [255, 255, 255], 0.6);
    ctx.fillStyle = rgba(haze, 100 / 255);
    ctx.fillRect(0, state.ground, state.width, 200);

    // Cacti.
    cactuses.draw(ctx);

    // Raptor (drawn on the canvas so the game-over overlay properly
    // covers it and so we can frame-lock to the idle pose during jumps).
    raptor.draw(ctx);

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
      ctx.font = `bold ${Math.round(state.width / 15)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillText("Game Over", state.width / 2, state.height / 2.2);
      ctx.font = `italic ${Math.round(
        state.width / 60
      )}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.fillText(
        "Press ENTER or tap to restart!",
        state.width / 2,
        state.height / 1.8
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

  function resetGame() {
    state.gameOver = false;
    state.gameOverFade = 0;
    state.gameOverFrame = 0;
    state.currentSky = [...SKY_COLORS[0]];
    state.lastSkyScore = -1;
    state.score = 0;
    state.bgVelocity = INITIAL_BG_VELOCITY;
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

    onReady(cb) {
      if (this._ready) cb();
      else this._readyCb = cb;
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
      if (state.started) state.paused = false;
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

    isDebug() {
      return state.debug;
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

    audio.init();

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
