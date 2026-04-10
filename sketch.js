let cactuses;
let raptor;
let white;
let currentSkyColor;
let clouds = [];
let skyColors = [];
let stars;
let jumpSound;
let mute = true;
let music;
// Off-screen buffer holding the pre-rendered sky gradient. We only repaint
// it when the gradient actually changes (every few seconds), then blit it
// to the main canvas each frame. Avoids drawing `height` lines per frame.
let skyBuffer;
// The day/night cycle is tied to the score: night happens around score 30
// (half-way through the 60-point loop).
const SKY_CYCLE_SCORE = 60;
// Only regenerate the sky gradient every N frames even when interpolating,
// to avoid per-frame `lerpColor × height` cost.
const SKY_UPDATE_INTERVAL = 10;
let lastSkyScore = -1;

function preload() {
  const cactusImages = {};
  for (const variant of CACTUS_VARIANTS) {
    cactusImages[variant.key] = loadImage(`assets/${variant.key}.png`);
  }
  cactuses = new Cactuses(cactusImages);
  raptor = new Raptor(loadImage("assets/raptor.gif"));
  jumpSound = loadSound("assets/jump.mp3");
  music = loadSound("assets/music2.mp3");
}

function windowResized() {
  // Guard against resize firing before setup() has fully initialized.
  if (!raptor || !skyBuffer) return;

  clear();
  resizeCanvas(window.innerWidth, window.innerHeight + 1);
  groundHeight = window.innerHeight / 10;
  GROUND = window.innerHeight - groundHeight;
  raptor.resize();
  stars = new Stars();
  clouds = [];
  skyBuffer = createGraphics(width, height);
  computeSkyGradient();
  resetGame();
}

function toggleMusic() {
  if (mute) {
    music.stop();
  } else {
    music.loop();
  }
}

// Sound toggle is now an HTML button in index.html next to the cog —
// this function is kept as a no-op so any stale references are safe.
function controlSound() {
  return false;
}

function isGameStarted() {
  return typeof window.isGameStarted !== "function" || window.isGameStarted();
}

function isMenuOpen() {
  return typeof window.isMenuOpen === "function" && window.isMenuOpen();
}

function mouseReleased() {
  return false;
}

function mousePressed() {
  if (!isGameStarted()) return;
  if (isMenuOpen()) return;
  if (controlSound()) return;
  // After a game-over, a single click both resets AND jumps feels bad —
  // reset first and return so the player starts fresh without an
  // immediate accidental jump.
  if (gameOver) {
    resetGameIfGameOver();
    return;
  }
  raptor.jump();
}

// Explicit touch handler so mobile taps on the canvas trigger a jump
// without first firing a synthetic 300ms-delayed click. Returning false
// also tells the browser to skip default scroll/zoom behaviour so the
// page doesn't move when the player taps.
function touchStarted(event) {
  if (!isGameStarted()) return;
  if (isMenuOpen()) return;
  // If the touch originated on an HTML control above the canvas, let the
  // browser handle it normally (so cog/sound/menu buttons keep working).
  if (event && event.target && event.target !== document.body) {
    const tag = event.target.tagName;
    if (tag === "BUTTON" || tag === "A" || event.target.closest("button, a")) {
      return;
    }
  }
  if (gameOver) {
    resetGameIfGameOver();
    return false;
  }
  raptor.jump();
  return false;
}

function setup() {
  createCanvas(window.innerWidth, window.innerHeight + 1);
  const skyBlue = color(80, 180, 205);
  const skyOrange = color(235, 120, 53);
  const skyYellow = color(255, 201, 34);
  const skyNight = color(21, 34, 56);
  white = color(255);
  skyColors = [
    skyBlue,
    skyBlue,
    skyYellow,
    skyOrange,
    skyNight,
    skyNight,
    skyOrange,
    skyYellow,
  ];

  currentSkyColor = skyColors[0];
  stars = new Stars();
  skyBuffer = createGraphics(width, height);
  resetGame();

  // Pause the draw loop until the user clicks "Start Game". The start
  // screen in index.html gives us a real user gesture so music (which
  // needs a Web Audio context unlocked by user interaction) can play
  // immediately when the game begins.
  noLoop();

  // Tell the start screen that assets are loaded and the game is ready.
  if (typeof window.onGameReady === "function") {
    window.onGameReady();
  }
}

function resetGame() {
  gameOver = false;
  gameOverSince = 0;
  currentSkyColor = skyColors[0];
  lastSkyScore = -1;
  computeSkyGradient();
  stars = new Stars();
  raptor.velocity = 0;
  raptor.ground = GROUND - raptor.h;
  raptor.y = raptor.ground;
  cactuses.cactuses = [];
  clouds = [];
  score = 0;
  BACKGROUND_VELOCITY = initialVelocity;
}

function resetGameIfGameOver() {
  if (gameOver && frameCount - gameOverSince > 30) {
    resetGame();
  }
}

function keyPressed() {
  // ESC is handled by the HTML menu overlay — let it through.
  if (keyCode === ESCAPE) return;

  // Block all gameplay input until Start has been clicked or while a
  // menu/imprint overlay is open.
  if (!isGameStarted()) return false;
  if (isMenuOpen()) return false;

  const isJumpKey =
    keyCode === SPACE || keyCode === 87 || keyCode === UP_ARROW;

  if (isJumpKey) {
    // Mirror mouse behaviour: after a game-over any jump key resets first
    // rather than jumping into a fresh obstacle. Return false so the
    // browser doesn't also scroll the page on space-bar.
    if (gameOver) {
      resetGameIfGameOver();
    } else {
      raptor.jump();
    }
    return false;
  }

  if (keyCode === ENTER) {
    resetGameIfGameOver();
    return false;
  }
}
// Paint the gradient into the off-screen buffer. Only called when the sky
// colour has actually changed (i.e. inside the day/night update block),
// so the per-pixel loop runs at most a couple of times per second instead
// of every frame.
function computeSkyGradient() {
  if (!skyBuffer) return;
  skyBuffer.noStroke();
  for (let y = 0; y < height; y++) {
    const inter = y / height;
    const c = lerpColor(currentSkyColor, white, inter);
    skyBuffer.stroke(c);
    skyBuffer.line(0, y, width, y);
  }
}

let opacity = 0;
function draw() {
  if (gameOver) {
    push();
    opacity = min(opacity + 0.01, 1);
    background(color(`rgba(0, 0, 0, ${opacity}) `));

    textAlign(CENTER, CENTER);
    strokeWeight(0);
    fill(255);
    textFont("Helvetica");
    textSize(width / 15);
    noStroke();
    textStyle(BOLD);
    text("Game Over", width / 2, height / 2.2);
    textSize(width / 60);
    textStyle(ITALIC);
    text("Press ENTER to restart!", width / 2, height / 1.8);
    pop();
    push();
    fill(255);
    noStroke();
    textSize(32);
    text(`Score: ${score}`, 20, 50);
    pop();

    return;
  }

  // Sky background — one image blit, no per-pixel loop.
  image(skyBuffer, 0, 0);

  // The sky phase is derived from the score, so a full day/night cycle
  // takes exactly SKY_CYCLE_SCORE cacti-cleared (≈60 jumps). Night peaks
  // around score 30 (index 4 = skyNight).
  const phase = (score % SKY_CYCLE_SCORE) / SKY_CYCLE_SCORE; // 0..1
  const bandF = phase * skyColors.length;                    // 0..8
  const bandIndex = Math.floor(bandF);
  const bandT = bandF - bandIndex;
  const nextBand = (bandIndex + 1) % skyColors.length;

  // Night = we are in or near the two skyNight bands (indices 4 and 5).
  const isNight =
    bandIndex === 4 || bandIndex === 5 || (bandIndex === 3 && bandT > 0.7) || (bandIndex === 6 && bandT < 0.3);
  stars.draw(isNight);

  // Recompute the sky only when it has drifted noticeably or the score
  // ticked. Throttle the (expensive) gradient regen to every N frames.
  if (frameCount % SKY_UPDATE_INTERVAL === 0 || score !== lastSkyScore) {
    const targetSkyColor = lerpColor(
      skyColors[bandIndex],
      skyColors[nextBand],
      bandT
    );
    currentSkyColor = lerpColor(currentSkyColor, targetSkyColor, 0.2);
    computeSkyGradient();
    lastSkyScore = score;
  }

  textSize(32);
  noStroke();

  const textColor = lerpColor(
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

  const haze = lerpColor(currentSkyColor, white, 0.6);
  haze.setAlpha(100);
  fill(haze);
  rect(0, GROUND, window.innerWidth, 200);

  // clouds
  for (let i = 0; i < clouds.length; i++) {
    const cloud = clouds[i];
    drawCloud(cloud.xpos, cloud.ypos, cloud.size * cloud.scale);
    cloud.xpos -= BACKGROUND_VELOCITY * (width / 900);
    cloud.ypos += random(-0.5, 0.5);
  }

  clouds = clouds.filter(
    (cloud) =>
      !(cloud.xpos > width + 20 || cloud.xpos < -cloud.size * cloud.scale * 60)
  );

  if (frameCount % 20 === 0 && random(0, 100) > 50 - BACKGROUND_VELOCITY * 6) {
    newCloud();
  }

  fill(0);

  raptor.update();
  cactuses.update();
}

function drawCloud(x, y, size) {
  fill(255, 255, 255);
  noStroke();
  arc(x, y, 25 * size, 20 * size, PI + TWO_PI, TWO_PI);
  arc(x + 10 * size, y, 25 * size, 45 * size, PI + TWO_PI, TWO_PI);
  arc(x + 25 * size, y, 25 * size, 35 * size, PI + TWO_PI, TWO_PI);
  arc(x + 40 * size, y, 30 * size, 20 * size, PI + TWO_PI, TWO_PI);
}

function newCloud() {
  const newCloud = {
    scale: window.innerWidth / 600,
    xpos: window.innerWidth,
    ypos: random(40, window.innerHeight - 1.5 * groundHeight),
    size: random(0.8, 1.3),
  };
  clouds.push(newCloud);
}
