let cactuses;
let raptor;
let sand;
let white;
let currentSkyColor, targetSkyColor;
let clouds = [];
let skyColors = [];
const initialSky = 1;
let counter = initialSky;
let stars;
let amt = 0;
let jumpSound;
let mute = true;
let music;
let gradient = [];
let soundControlBright;

function preload() {
  cactuses = new Cactuses(loadImage("assets/cactus.png"));
  sand = loadImage("assets/some-sand.jpg");
  raptor = new Raptor(loadImage("assets/raptor.gif"));
  jumpSound = loadSound("assets/jump.mp3");
  music = loadSound("assets/music2.mp3");
  soundControl = loadImage("assets/audio-play.png");
  soundControlBright = loadImage("assets/audio-play-invert.png");
}

function windowResized() {
  clear();
  resizeCanvas(window.innerWidth, window.innerHeight + 1);
  groundHeight = window.innerHeight / 10;
  GROUND = window.innerHeight - groundHeight;
  raptor.resize();
  stars = new Stars();
  clouds = [];
  resetGame();
}

function toggleMusic() {
  if (mute) {
    music.stop();
  } else {
    music.loop();
  }
}

function controlSound() {
  if (mouseX > width - 100 && mouseX < width && mouseY > 0 && mouseY < 100) {
    mute = !mute;
    toggleMusic();
    return true;
  }
  return false;
}

let released = false;
function mouseReleased() {
  released = true;
  return false;
}

function mousePressed() {
  if (!released) {
    return;
  }
  released = false;

  if (controlSound()) return;
  raptor.jump();
  resetGameIfGameOver();
}

function setup() {
  toggleMusic();
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

  currentSkyColor = skyColors[counter - 1];
  targetSkyColor = skyColors[counter];
  stars = new Stars();
  resetGame();
}

function resetGame() {
  gameOver = false;
  gameOverSince = 0;
  counter = initialSky;
  currentSkyColor = skyColors[counter - 1];
  targetSkyColor = skyColors[counter];
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
  if (keyCode === SPACE || keyCode === 87 || keyCode === UP_ARROW) {
    raptor.jump();
  }
  if (keyCode === ENTER) {
    resetGameIfGameOver();
  }
}
function computeSkyGradient() {
  gradient = [];
  for (let y = 0; y < height; y++) {
    const inter = map(y, 0, height, 0, 1);
    const c = lerpColor(currentSkyColor, white, inter);
    gradient.push(c);
  }
}

function drawSoundIcon({ black = true } = {}) {
  const soundIconSize = width / 25;

  image(
    black ? soundControl : soundControlBright,
    width - soundIconSize - 20,
    20,
    soundIconSize,
    soundIconSize
  );

  if (mute) {
    push();
    translate(width - soundIconSize - 20, 20);
    beginShape(LINES);
    strokeWeight(5);
    stroke(black ? 0 : 255);

    vertex(0, 0);
    vertex(soundIconSize, soundIconSize);

    vertex(0, soundIconSize);
    vertex(soundIconSize, 0);

    endShape(CLOSE);
    pop();
  }
}

let opacity = 0;
function draw() {
  if (gameOver) {
    push();
    opacity = min(opacity + 0.01, 1);
    background(color(`rgba(0, 0, 0, ${opacity}) `));
    drawSoundIcon({ black: false });

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
  // console.log(Math.floor(frameRate()));
  clear();
  // sky-gradient

  for (let y = 0; y < gradient.length; y++) {
    stroke(gradient[y]);
    line(0, y, width, y);
  }

  const index = counter % skyColors.length;
  const isNight =
    (index === 4 && amt > 0.02) ||
    index === 5 ||
    index === 6 ||
    (index === 7 && amt < 0.03);
  stars.draw(isNight);

  if (frameCount % 30 === 0) {
    amt += 0.001;
    if (amt >= 0.1) {
      amt = 0;
      counter++;
      targetSkyColor = skyColors[index];
    }
    currentSkyColor = lerpColor(currentSkyColor, targetSkyColor, amt);
    computeSkyGradient();
  }

  drawSoundIcon();
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
  sandX -= BACKGROUND_VELOCITY * (width / 1000);
  if (sandX < -window.innerWidth) {
    sandX = 0;
  }
  // image(sand, sandX, GROUND, window.innerWidth, 200);
  // image(sand, window.innerWidth + sandX, GROUND, window.innerWidth, 200);

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
