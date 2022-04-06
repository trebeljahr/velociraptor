class Cactus {
  constructor(size) {
    this.x = window.innerWidth;
    this.aspectRatio = 892 / 311;
    this.h = size * this.aspectRatio;
    this.w = size;
  }
  update() {
    this.x -= BACKGROUND_VELOCITY;
  }
}

function getNewMinWidth() {
  return Math.floor(
    Math.random() * (window.innerWidth / 4) + window.innerWidth / 6
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
        if (BACKGROUND_VELOCITY < 6) {
          BACKGROUND_VELOCITY += 0.2;
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
      image(this.img, cactus.x, GROUND - cactus.h, cactus.w, cactus.h);
      cactus.update();
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
