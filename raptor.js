class Raptor {
  constructor(img) {
    this.resize();

    this.velocity = 0.5;
    this.gravity = 0.1;

    this.x = 0;

    this.jumpStrength = 3.5;
    this.img = img;
    this.delay = 70;
  }

  resize() {
    this.aspectRatio = 212 / 578;
    this.w = window.innerWidth / 3;
    this.h = this.w * this.aspectRatio;
    this.ground = GROUND - this.h;
    this.y = this.ground;
  }

  get downwardAcceleration() {
    return (
      (this.gravity *
        BACKGROUND_VELOCITY *
        BACKGROUND_VELOCITY *
        (width / 1000)) /
      10
    );
  }

  jump() {
    // Only jump when grounded and alive — otherwise hold mid-air state.
    if (this.y !== this.ground || gameOver) return;

    // Consistent jump velocity, independent of which cactus is next.
    // We aim for a fixed apex tuned to the tallest cactus variant
    // (heightScale 1.0 × raptor.h) with a generous clearance multiplier
    // that matches the "floaty" feel of the original game.
    //
    // Real kinematics: v = sqrt(2 * a * h). The `* 25` fudge factor from
    // the old code is *not* needed — it was overshooting by ~5x.
    // 1.5× = just enough clearance over the tallest cactus (heightScale 1.0)
    // with half-a-cactus margin for timing — keeps the jump snappy and
    // skill-based instead of floaty.
    const MAX_CACTUS_HEIGHT = this.h; // largest heightScale in CACTUS_VARIANTS
    const JUMP_CLEARANCE_MULTIPLIER = 1.5;
    const targetRise = MAX_CACTUS_HEIGHT * JUMP_CLEARANCE_MULTIPLIER;
    const a = this.downwardAcceleration;
    const v = sqrt(2 * a * targetRise);
    this.velocity = -v;

    if (!mute && jumpSound && jumpSound.isLoaded()) jumpSound.play();
  }

  collisionPolygon() {
    // Note: the two tail-tip points that used to reach all the way to
    // { x: this.x, y: ... } have been removed. They were causing passing
    // cacti to clip through the tail as they exited the raptor's region
    // on the left, registering false-positive collisions.
    const points = [
      { x: this.x + this.w * 0.5, y: this.y + this.h * 0.27 },
      { x: this.x + this.w * 0.5, y: this.y + this.h * 0.4 },
      { x: this.x + this.w * 0.6, y: this.y + this.h * 0.6 },
      { x: this.x + this.w * 0.5, y: this.y + this.h * 0.82 },
      { x: this.x + this.w * 0.48, y: this.y + this.h },
      { x: this.x + this.w * 0.55, y: this.y + this.h },
      { x: this.x + this.w * 0.51, y: this.y + this.h * 0.955 },
      { x: this.x + this.w * 0.53, y: this.y + this.h * 0.9 },
      { x: this.x + this.w * 0.55, y: this.y + this.h * 0.9 },
      { x: this.x + this.w * 0.55, y: this.y + this.h * 0.86 },
      { x: this.x + this.w * 0.51, y: this.y + this.h * 0.86 },
      { x: this.x + this.w * 0.53, y: this.y + this.h * 0.8 },
      { x: this.x + this.w * 0.62, y: this.y + this.h * 0.65 },
      { x: this.x + this.w * 0.63, y: this.y + this.h * 0.6 },
      { x: this.x + this.w * 0.67, y: this.y + this.h * 0.6 },
      { x: this.x + this.w * 0.67, y: this.y + this.h * 0.85 },
      { x: this.x + this.w * 0.72, y: this.y + this.h * 0.95 },
      { x: this.x + this.w * 0.78, y: this.y + this.h * 0.95 },
      { x: this.x + this.w * 0.7, y: this.y + this.h * 0.8 },
      { x: this.x + this.w * 0.75, y: this.y + this.h * 0.8 },
      { x: this.x + this.w * 0.8, y: this.y + this.h * 0.6 },
      { x: this.x + this.w * 0.78, y: this.y + this.h * 0.55 },
      { x: this.x + this.w * 0.9, y: this.y + this.h * 0.3 },
      { x: this.x + this.w, y: this.y + this.h * 0.3 },
      { x: this.x + this.w, y: this.y + this.h * 0.23 },
      { x: this.x + this.w * 0.9, y: this.y + this.h * 0.15 },
      { x: this.x + this.w * 0.85, y: this.y + this.h * 0.15 },
      { x: this.x + this.w * 0.8, y: this.y + this.h * 0.35 },
    ];
    return points;
  }

  debugJumpLine() {
    // no-op — the jump apex is now a fixed distance above the ground.
  }

  update() {
    this.y += this.velocity;
    this.velocity += this.downwardAcceleration;
    // this.debugJumpLine();

    noFill();
    stroke(0);

    if (this.y > this.ground) {
      this.y = this.ground;
      this.velocity = 0;
    }

    if (this.y === this.ground) {
      this.img.play();
      if (frameCount % 60 === 0 && this.delay > 40) {
        this.delay = this.delay - 1;
        this.img.delay(this.delay);
      }
    } else {
      this.img.setFrame(11);
      this.img.pause();
    }

    image(this.img, 0, this.y, this.w, this.h);

    const points = this.collisionPolygon();
    for (let cactus of cactuses.cactuses) {
      const cactusPoints = cactus.collisionPolygon();
      const hitCactus = collidePolyPoly(points, cactusPoints, true);
      if (hitCactus) {
        gameOver = true;
        gameOverSince = frameCount;
      }
    }
  }

  debugPolygon() {
    const points = this.collisionPolygon();
    beginShape();
    points.forEach(({ x, y }) => {
      vertex(x, y);
    });
    endShape(CLOSE);
  }
}
