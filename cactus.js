// Cactus variant definitions.
// Each variant is an entry describing one sprite and how tall it should be
// drawn *relative to the raptor's height*. The sprite dimensions below are
// the native pixel sizes of the extracted PNGs — aspect ratio is derived
// from them so the width scales correctly with the chosen height.
//
// Art: cactus illustrations by Freepik
//   https://www.freepik.com/free-vector/big-small-cactuses-illustrations-set-collection-cacti-spiny-tropical-plants-with-flowers-blossoms-arizona-mexico-succulents-isolated-white_20827544.htm
const CACTUS_VARIANTS = [
  // Top-row squat cacti with pink flowers — smaller, "pebble" obstacles.
  { key: "cactus1", w: 371, h: 497, heightScale: 0.55 },
  { key: "cactus2", w: 311, h: 463, heightScale: 0.5 },
  { key: "cactus3", w: 379, h: 521, heightScale: 0.55 },
  { key: "cactus4", w: 403, h: 416, heightScale: 0.5 },
  // Bottom-row tall cacti — primary obstacles at ~raptor height.
  { key: "cactus5", w: 434, h: 937, heightScale: 0.95 },
  { key: "cactus6", w: 201, h: 899, heightScale: 0.9 },
  { key: "cactus7", w: 348, h: 943, heightScale: 0.95 },
  { key: "cactus8", w: 422, h: 973, heightScale: 1.0 },
];

class Cactus {
  constructor(variant, img) {
    this.img = img;
    this.aspectRatio = variant.w / variant.h;

    // Height is a multiple of the raptor's height. raptor.h already scales
    // with window width, so obstacles stay proportional on every screen.
    this.h = raptor.h * variant.heightScale;
    this.w = this.h * this.aspectRatio;

    this.x = window.innerWidth;
    this.y = GROUND - this.h;
  }

  // Simple vertical-bbox hitbox with a small inset so collisions feel fair
  // across all sprite shapes (the old L-shape polygon was tuned for one art).
  collisionPolygon() {
    const insetX = this.w * 0.15;
    const insetY = this.h * 0.08;
    return [
      { x: this.x + insetX, y: this.y + insetY },
      { x: this.x + this.w - insetX, y: this.y + insetY },
      { x: this.x + this.w - insetX, y: this.y + this.h },
      { x: this.x + insetX, y: this.y + this.h },
    ];
  }

  debugPolygon() {
    beginShape();
    this.collisionPolygon().forEach(({ x, y }) => {
      vertex(x, y);
    });
    endShape(CLOSE);
  }

  update() {
    this.x -= BACKGROUND_VELOCITY * (width / 1000);
  }
}

function getNewMinWidth() {
  return raptor.w * 1.5 + Math.floor(Math.random() * raptor.w * 10);
}

class Cactuses {
  // `images` is an object map: { cactus1: p5.Image, cactus2: p5.Image, ... }
  constructor(images) {
    this.images = images;
    this.cactuses = [];
  }

  get minWidthToSpawnNewCactus() {
    return getNewMinWidth();
  }

  pickVariant() {
    return CACTUS_VARIANTS[Math.floor(Math.random() * CACTUS_VARIANTS.length)];
  }

  spawn() {
    const variant = this.pickVariant();
    const img = this.images[variant.key];
    this.cactuses.push(new Cactus(variant, img));
  }

  addCactus() {
    const lastCactus = this.cactuses[this.cactuses.length - 1];
    if (lastCactus) {
      const distanceToLastCactus = window.innerWidth - lastCactus.x;
      if (distanceToLastCactus >= this.minWidthToSpawnNewCactus) {
        this.spawn();
        BACKGROUND_VELOCITY += 0.1;
      }
    } else {
      this.spawn();
    }
  }

  update() {
    cactuses.addCactus();

    for (let cactus of this.cactuses) {
      cactus.update();
      image(cactus.img, cactus.x, cactus.y, cactus.w, cactus.h);
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
