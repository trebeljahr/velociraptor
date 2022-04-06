let cactuses;
let raptor;
let sand;
let white;
let currentSkyColor, targetSkyColor;
let clouds = [];
let skyColors = [];
let counter = 3;
let pebbles, stars;
let amt = 0;
let jumpSound;
let mute = false;

function preload() {
  cactuses = new Cactuses(loadImage("assets/cactus.png"));
  sand = loadImage("assets/some-sand.jpg");
  raptor = new Raptor(loadImage("assets/raptor.gif"));
  jumpSound = loadSound("assets/jump.mp3");
  music = loadSound("assets/music2.mp3");
  soundControl = loadImage("assets/audio-play.jpg");
}

function windowResized() {
  resizeCanvas(window.innerWidth, window.innerHeight);
  groundHeight = window.innerHeight / 10;
  GROUND = window.innerHeight - groundHeight;
  raptor.ground = GROUND - raptor.h;
  raptor.y = raptor.ground;
  pebbles = new Pebbles();
  stars = new Stars();
  clouds = [];
}

function toggleMusic() {
  if (mute) {
    music.stop();
  } else {
    music.loop();
  }
}

function mousePressed() {
  if (mouseX > width - 100 && mouseX < width && mouseY > 0 && mouseY < 100) {
    mute = !mute;
    toggleMusic();
  }
}
function setup() {
  toggleMusic();
  createCanvas(window.innerWidth, window.innerHeight);
  const skyBlue = color(80, 180, 205);
  const skySunset = color(235, 120, 53);
  const skyMorning = color(255, 201, 34);
  const skyNight = color(21, 34, 56);
  white = color(255);
  skyColors = [
    skyBlue,
    skyMorning,
    skySunset,
    skyNight,
    skyNight,
    skySunset,
    skyMorning,
  ];

  currentSkyColor = skyColors[counter - 1];
  targetSkyColor = skyColors[counter];
  pebbles = new Pebbles();
  stars = new Stars();
}

function keyPressed() {
  if (keyCode === SPACE) {
    raptor.jump();
  }
}

function draw() {
  const index = counter % skyColors.length;
  const isNight =
    (index === 3 && amt > 0.05) ||
    index === 4 ||
    index === 5 ||
    (index === 6 && amt < 0.07);
  if (isNight) {
    noStroke();
    stars.draw();
  }

  if (frameCount % 10 === 0) {
    amt += 0.001;
    if (amt >= 0.1) {
      amt = 0;
      counter++;
      targetSkyColor = skyColors[index];
    }
    currentSkyColor = lerpColor(currentSkyColor, targetSkyColor, amt);
  }

  // sky-gradient
  for (let y = 0; y < height; y++) {
    const inter = map(y, 0, height, 0, 1);
    const c = lerpColor(currentSkyColor, white, inter);
    stroke(c);
    line(0, y, width, y);
  }

  const soundIconSize = width / 25;
  image(
    soundControl,
    width - width / 20,
    width / 20 - soundIconSize,
    soundIconSize,
    soundIconSize
  );

  if (mute) {
    push();
    translate(width - width / 20, width / 20 - soundIconSize);
    rotate(PI * 0.2);
    translate(width / 38, -width / 52);
    stroke(0);
    fill(0);
    rect(0, 0, soundIconSize / 10, soundIconSize);
    pop();
  }

  textSize(32);
  noStroke();

  var textColor = lerpColor(
    currentSkyColor,
    isNight ? color(255) : color(0),
    0.6
  );
  fill(textColor);
  text(`Score: ${score}`, 20, 50);

  noStroke();
  fill("#ebc334");
  rect(0, GROUND, window.innerWidth, 5);
  fill("#ebab21");
  rect(0, GROUND + 5, window.innerWidth, 10);
  fill("#ba8c27");
  rect(0, GROUND + 5 + 10, window.innerWidth, 20);
  fill("#EDC9AF");
  rect(0, GROUND + 5 + 10 + 20, window.innerWidth, 200);
  pebbles.update();

  const haze = lerpColor(currentSkyColor, white, 0.6);
  haze.setAlpha(100);
  fill(haze);
  rect(0, GROUND, window.innerWidth, 200);

  // clouds
  for (let i = 0; i < clouds.length; i++) {
    const singleCloud = clouds[i];
    cloud(singleCloud.xpos, singleCloud.ypos, singleCloud.size);
    singleCloud.xpos -= BACKGROUND_VELOCITY + 0.5;
    singleCloud.ypos += random(-0.5, 0.5);
  }

  clouds = clouds.filter(
    (cloud) => !(cloud.xpos > width + 20 || cloud.xpos < -50)
  );

  if (frameCount % 20 === 0 && random(0, 100) > 50 - BACKGROUND_VELOCITY * 6) {
    newCloud();
  }

  fill(0);
  sandX -= BACKGROUND_VELOCITY;
  if (sandX < -window.innerWidth) {
    sandX = 0;
  }
  // image(sand, sandX, GROUND, window.innerWidth, 200);
  // image(sand, window.innerWidth + sandX, GROUND, window.innerWidth, 200);

  raptor.update();
  cactuses.update();
}

class Star {
  constructor(x) {
    this.size = random(3, 6);
    this.x = x;
    this.y = random(0, window.innerHeight / 2);
    this.color = 255;
  }

  draw() {
    fill(this.color);
    ellipse(this.x, this.y, this.size, this.size);
  }
}

class Stars {
  constructor() {
    this.array = [];
    this.seed();
  }
  newStar(x) {
    this.array.push(new Star(x));
  }
  seed() {
    for (let i = 0; i < width / 30; i++) {
      this.newStar(random(0, width));
    }
  }
  draw() {
    for (let star of this.array) {
      star.draw();
    }
  }
}

class Pebble {
  constructor(x) {
    this.size = random(3, 6);
    this.x = x || window.innerWidth + this.size + 30 + random(-30, 30);
    this.y = random(GROUND + 40 - this.size, window.innerHeight);
    this.color = random(0, 100);
  }

  update() {
    fill(this.color);
    ellipse(this.x, this.y, this.size, this.size);
    this.x -= BACKGROUND_VELOCITY;
  }
}
class Pebbles {
  constructor() {
    this.array = [];
    this.seed();
  }
  seed() {
    for (let i = 0; i < 100; i++) {
      this.newPebble(random(0, width));
    }
  }
  newPebble(x) {
    this.array.push(new Pebble(x));
  }
  update() {
    const every20Frames = frameCount % 20 === 0;
    if (every20Frames) {
      this.newPebble();
      this.newPebble();
      this.newPebble();
      this.newPebble();
    }
    for (let pebble of this.array) {
      pebble.update();
    }
    this.array = this.array.filter((pebble) => pebble.x > 0 - pebble.size);
  }
}

function cloud(x, y, size) {
  fill(255, 255, 255);
  noStroke();
  arc(x, y, 25 * size, 20 * size, PI + TWO_PI, TWO_PI);
  arc(x + 10, y, 25 * size, 45 * size, PI + TWO_PI, TWO_PI);
  arc(x + 25, y, 25 * size, 35 * size, PI + TWO_PI, TWO_PI);
  arc(x + 40, y, 30 * size, 20 * size, PI + TWO_PI, TWO_PI);
}

function newCloud() {
  const newCloud = {
    xpos: window.innerWidth,
    ypos: random(40, window.innerHeight - 1.5 * groundHeight),
    size: random(0.8, 1.3),
  };
  clouds.push(newCloud);
}
