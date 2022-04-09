class Star {
  constructor(x) {
    this.size = random(3, 6);
    this.x = x;
    this.y = random(0, window.innerHeight / 2);
  }

  draw() {
    ellipse(this.x, this.y, this.size, this.size);
  }
}

class Stars {
  constructor() {
    this.array = [];
    this.seed();
    this.opacity = 0;
    this.fadeSpeed = 0.01;
  }

  newStar(x) {
    this.array.push(new Star(x));
  }
  seed() {
    for (let i = 0; i < width / 30; i++) {
      this.newStar(random(0, width));
    }
  }

  get color() {
    return `rgba(255, 255, 255, ${this.opacity})`;
  }

  draw(isNight) {
    if (isNight && frameCount % 2 === 0) {
      this.opacity += this.fadeSpeed;
    }
    if (!isNight && frameCount % 2 === 0) {
      this.opacity -= this.fadeSpeed;
    }
    this.opacity = constrain(this.opacity, 0, 1);

    push();
    fill(this.color);
    noStroke();
    for (let star of this.array) {
      star.draw(isNight);
    }
    pop();
  }
}
