class Raptor {
  constructor(img) {
    this.h = 212 / 3;
    this.w = 578 / 3;

    this.velocity = 0.5;
    this.gravity = 0.08;
    this.ground = GROUND - this.h;
    this.y = this.ground;

    this.jumpStrength = 5 * BACKGROUND_VELOCITY;
    this.img = img;
    this.delay = 100;
  }
  jump() {
    if (this.y === this.ground) {
      this.velocity = -this.jumpStrength;
      if (!mute) jumpSound.play();
    }
  }

  debugRectangles() {
    push();
    translate(this.w / 2, this.y + this.h / 10);
    rotate(PI * 1.04);
    translate(-this.w * 0.01, -this.h * 0.25);
    rect(0, 0, this.w * 0.4, this.h / 10);
    pop();

    push();
    translate(this.w * 0.5, this.y + this.h * 0.28);
    rect(0, 0, this.w / 3.4, this.h / 2);
    pop();

    push();
    translate(this.w * 0.5, this.y + this.h * 0.28 + this.h / 2);
    rect(0, 0, this.w / 4, this.h * 0.28);
    pop();

    push();
    translate(this.w * 0.8, this.y + this.h * 0.2);
    rect(0, 0, this.w * 0.2, this.h * 0.1);
    pop();
  }

  debugPolygon() {
    beginShape();
    vertex(this.w * 0.5, this.y + this.h * 0.27);
    vertex(0, this.y + this.h * 0.1);
    vertex(0, this.y + this.h * 0.15);
    vertex(this.w * 0.5, this.y + this.h * 0.4);
    vertex(this.w * 0.6, this.y + this.h * 0.6);
    vertex(this.w * 0.5, this.y + this.h);
    vertex(this.w * 0.75, this.y + this.h);
    vertex(this.w * 0.7, this.y + this.h * 0.8);
    vertex(this.w * 0.75, this.y + this.h * 0.8);
    vertex(this.w * 0.8, this.y + this.h * 0.6);
    vertex(this.w * 0.78, this.y + this.h * 0.55);
    vertex(this.w * 0.9, this.y + this.h * 0.3);
    vertex(this.w, this.y + this.h * 0.3);
    vertex(this.w, this.y + this.h * 0.23);
    vertex(this.w, this.y + this.h * 0.23);
    vertex(this.w * 0.9, this.y + this.h * 0.15);
    vertex(this.w * 0.85, this.y + this.h * 0.15);
    vertex(this.w * 0.8, this.y + this.h * 0.35);
    endShape(CLOSE);
  }

  update() {
    this.y += this.velocity;
    this.velocity += this.gravity * BACKGROUND_VELOCITY;

    image(this.img, 0, this.y, this.w, this.h);
    noFill();
    stroke(0);

    this.debugPolygon();
    // this.debugRectangles();

    if (this.y > this.ground) {
      this.y = this.ground;
      this.velocity = 0;
    }

    if (this.y === this.ground) {
      this.img.play();
      if (frameCount % 60 === 0 && this.delay > 25) {
        this.delay = this.delay - 1;
        this.img.delay(this.delay);
      }
    } else {
      this.img.setFrame(11);
      this.img.pause();
    }
  }
}
