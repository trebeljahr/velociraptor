const scale = 1.5;
class Raptor {
  constructor(img) {
    this.h = 212 / scale;
    this.w = 578 / scale;

    this.velocity = 0.5;
    this.gravity = 0.1;
    this.ground = GROUND - this.h;
    this.y = this.ground;
    this.x = 0;

    this.jumpStrength = 3.5;
    this.img = img;
    this.delay = 70;
  }

  jump() {
    if (this.y === this.ground) {
      if (cactuses.cactuses.length > 0) {
        const y = cactuses.cactuses[0].y - cactuses.cactuses[0].h * 1.5;
        const v = sqrt(0.5 * this.downwardAcceleration * y);
        this.velocity = -v;
        if (!mute) jumpSound.play();
      }
    }
  }

  collisionPolygon() {
    const points = [
      { x: this.x + this.w * 0.5, y: this.y + this.h * 0.27 },
      { x: this.x, y: this.y + this.h * 0.1 },
      { x: this.x, y: this.y + this.h * 0.15 },
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

  get downwardAcceleration() {
    return (this.gravity * BACKGROUND_VELOCITY * BACKGROUND_VELOCITY) / 10;
  }

  debugJumpLine() {
    if (cactuses.cactuses.length > 0) {
      push();
      stroke(0);
      strokeWeight(5);
      const y = cactuses.cactuses[0].y - cactuses.cactuses[0].h * 1.5;
      line(0, y, width, y);
      pop();
    }
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
        // gameOver = true;
        // gameOverSince = frameCount;
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
