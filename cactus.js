class Cactus {
  constructor(size) {
    this.aspectRatio = 312 / 892;
    const maxSize = raptor.h * 0.5;
    this.h = maxSize; // min(size * this.aspectRatio, maxSize);
    this.w = this.h * this.aspectRatio;

    this.x = window.innerWidth;
    this.y = GROUND - this.h;
  }
  collisionPolygon() {
    const points = [
      { x: this.x + this.w, y: this.y + this.h * 0.28 },
      { x: this.x + this.w * 0.7, y: this.y + this.h * 0.28 },
      { x: this.x + this.w * 0.7, y: this.y },
      { x: this.x + this.w * 0.35, y: this.y },
      { x: this.x + this.w * 0.35, y: this.y + this.h * 0.43 },
      { x: this.x, y: this.y + this.h * 0.43 },
      { x: this.x, y: this.y + this.h },
      { x: this.x + this.w, y: this.y + this.h },
    ];
    return points;
  }
  debugPolygon() {
    beginShape();
    this.collisionPolygon().forEach(({ x, y }) => {
      vertex(x, y);
    });
    endShape(CLOSE);
  }

  update() {
    this.x -= BACKGROUND_VELOCITY;
  }
}

function getNewMinWidth() {
  return Math.floor(
    Math.random() * (window.innerWidth / 4) + window.innerWidth / 3
  );
}

let minWidthToSpawnNewCactus = getNewMinWidth();

class Cactuses {
  constructor(img) {
    this.img = img;
    this.cactuses = [];
  }
  addCactus() {
    const lastCactus = this.cactuses[this.cactuses.length - 1];
    if (lastCactus) {
      const distanceToLastCactus = window.innerWidth - lastCactus.x;
      if (distanceToLastCactus >= minWidthToSpawnNewCactus) {
        const randomSize = Math.floor(Math.random() * 30) + 10;
        this.cactuses.push(new Cactus(randomSize));
        if (BACKGROUND_VELOCITY < 20) {
          BACKGROUND_VELOCITY += 0.3;
        }
        minWidthToSpawnNewCactus = getNewMinWidth();
      }
    } else {
      const randomSize = Math.floor(Math.random() * 30) + 10;
      this.cactuses.push(new Cactus(randomSize));
    }
  }
  update() {
    cactuses.addCactus();

    for (let cactus of this.cactuses) {
      cactus.update();
      image(this.img, cactus.x, GROUND - cactus.h, cactus.w, cactus.h);
    }

    this.cactuses = this.cactuses.filter((cactus) => {
      const outOfScreen = cactus.x < 0 - cactus.w;
      if (outOfScreen) {
        score++;
        return false;
      }
      return true;
    });
  }
}
