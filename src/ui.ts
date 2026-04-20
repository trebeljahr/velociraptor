/*
 * Raptor Runner — UI chrome module.
 *
 * Start screen, menu overlay, imprint/about/credits/achievements
 * overlays, sound toggle, cog button, landscape guard, keyboard
 * shortcuts, score-display ticker, share-your-score flow. Talks to
 * the game layer exclusively through the public `window.Game` API
 * defined in src/main.ts. No direct references to canvas / audio /
 * state internals live here.
 *
 * Lifted out of an inline <script> block in index.html so that
 * index.html's Content-Security-Policy can drop 'unsafe-inline'
 * from script-src. The underlying behaviour is unchanged; the only
 * surgery on the way out was:
 *   - remove the IIFE wrapper (module scope covers the same need)
 *   - replace literal "%VITE_STEAM_STORE_URL%" with
 *     `import.meta.env.VITE_STEAM_STORE_URL` so Vite's normal env
 *     substitution handles it instead of the bespoke HTML-level
 *     replacement that was never actually plumbed in
 *   - declare window.Game, window.__onStartKey, etc. ambient types
 *     so TypeScript doesn't flag the many dynamic accesses
 *
 * @ts-nocheck because the content below is pre-existing JavaScript
 * with no type annotations. A proper migration to TypeScript types
 * can land incrementally without touching this module's behaviour.
 */

// @ts-nocheck
/* eslint-disable */

// Desktop "challenge a friend" store-link. Sourced from a Vite env
// var; falls back to the web URL when not set. The env name is
// store-neutral now — use VITE_DESKTOP_STORE_URL pointing at whichever
// store channel ships the build (itch.io, Steam, App Store once
// released). The legacy VITE_STEAM_STORE_URL is still honoured as a
// fallback so existing .env.local overrides keep working.
const STEAM_STORE_URL: string =
  import.meta.env.VITE_DESKTOP_STORE_URL ||
  import.meta.env.VITE_STEAM_STORE_URL ||
  "https://raptor.trebeljahr.com";

const cog = document.getElementById("settings-cog");
const overlay = document.getElementById("menu-overlay");
const closeBtn = document.getElementById("menu-close");
// Desktop-only: open the Steam overlay directly to the Friends
// panel. Note: on macOS the Steam overlay is flaky/unreliable
// for Electron apps (Valve limitation), so this click may be
// a no-op visually. Windows and Linux fully support it.
const steamFriendsBtn = document.getElementById("menu-steam-friends");
if (steamFriendsBtn) {
  steamFriendsBtn.addEventListener("click", () => {
    if (
      window.electronAPI &&
      typeof window.electronAPI.openSteamOverlay === "function"
    ) {
      window.electronAPI.openSteamOverlay("Friends");
    }
  });
}
// Desktop-only: open the Steam overlay to the store page for
// this game. Uses the same STEAM_STORE_URL that the share/
// challenge invite text uses (declared above) so there's one
// knob to turn when the real AppID ships.
const steamStoreBtn = document.getElementById("menu-steam-store");
if (steamStoreBtn) {
  steamStoreBtn.addEventListener("click", () => {
    if (
      window.electronAPI &&
      typeof window.electronAPI.openSteamOverlayUrl === "function"
    ) {
      window.electronAPI.openSteamOverlayUrl(STEAM_STORE_URL);
    }
  });
}
// Desktop-only: "View on Steam" button inside the achievements
// overlay. Opens the Steam overlay to the Achievements dialog
// for this game — player sees the canonical cross-platform
// achievement list right next to our in-game version.
const achievementsSteamLink = document.getElementById(
  "achievements-steam-link",
);
if (achievementsSteamLink) {
  achievementsSteamLink.addEventListener("click", () => {
    if (
      window.electronAPI &&
      typeof window.electronAPI.openSteamOverlay === "function"
    ) {
      window.electronAPI.openSteamOverlay("Achievements");
    }
  });
}
const quitBtn = document.getElementById("menu-quit");
// Wire Quit (desktop only). Safe no-op in browser since the
// <li class="desktop-only"> is display:none and the element
// is still in the DOM.
//
// stopPropagation so the click doesn't bubble to the overlay
// backdrop handler (that one only fires on e.target === overlay,
// but defensive anyway). Then fire the IPC, and if it rejects —
// or if electronAPI is absent for some reason — fall through to
// window.close() which the window-all-closed handler in
// electron/main.ts catches on Linux/Windows (macOS quits via
// app.quit() from the main-process side).
if (quitBtn) {
  quitBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (window.electronAPI && typeof window.electronAPI.quit === "function") {
      window.electronAPI.quit().catch((err: unknown) => {
        console.warn("Quit IPC failed:", err);
        try {
          window.close();
        } catch {
          /* noop */
        }
      });
      return;
    }
    try {
      window.close();
    } catch {
      /* noop */
    }
  });
}
// Desktop-only fullscreen toggle. The top-right fullscreen
// button is hidden on desktop (it's redundant — the window
// opens fullscreen by default), but players still want an
// opt-out. The Electron main process owns the window state
// and persists it across launches via prefs.json in
// userData. We ask it for the current state each time the
// menu opens so the label stays honest even if the player
// toggled via ESC on macOS Spaces fullscreen.
const fullscreenToggle = document.getElementById("menu-fullscreen-toggle");
const fullscreenLabel = document.getElementById("menu-fullscreen-label");
let fullscreenState = true; // mirror of win state
function syncFullscreenLabel() {
  if (!fullscreenLabel) return;
  fullscreenLabel.textContent =
    "Fullscreen: " + (fullscreenState ? "on" : "off");
}
async function refreshFullscreenState() {
  if (!window.electronAPI || typeof window.electronAPI.isFullscreen !== "function") {
    return;
  }
  try {
    fullscreenState = !!(await window.electronAPI.isFullscreen());
    syncFullscreenLabel();
  } catch (_) {}
}
if (fullscreenToggle && window.electronAPI) {
  fullscreenToggle.addEventListener("click", async () => {
    if (typeof window.electronAPI.setFullscreen !== "function") return;
    try {
      fullscreenState = !!(await window.electronAPI.setFullscreen(
        !fullscreenState,
      ));
      syncFullscreenLabel();
      // The fullscreen transition churns the window and on
      // some Electron versions silently drops focus to
      // <body>. That stranded the gamepad / keyboard user
      // outside the menu until they clicked back in.
      // Explicitly refocus the button after the awaited
      // IPC round-trip settles. requestAnimationFrame
      // ensures the window-resize layout pass has finished
      // so the button is visible + focusable.
      requestAnimationFrame(() => {
        if (document.activeElement !== fullscreenToggle) {
          fullscreenToggle.focus();
        }
      });
    } catch (_) {}
  });
  refreshFullscreenState();
}
const topSoundBtn = document.getElementById("sound-toggle");
const fullscreenBtn = document.getElementById("fullscreen-toggle");
const imprintOverlay = document.getElementById("imprint-overlay");
const aboutOverlay = document.getElementById("about-overlay");
const aboutCloseBtn = document.getElementById("about-close");
const aboutIframe = document.getElementById("about-iframe");
let aboutLoaded = false;
const achievementsOverlay = document.getElementById("achievements-overlay");
const achievementsCloseBtn = document.getElementById("achievements-close");
const achievementsList = document.getElementById("achievements-list");
const achievementsProgress = document.getElementById("achievements-progress");
const imprintCloseBtn = document.getElementById("imprint-close");
const imprintIframe = document.getElementById("imprint-iframe");
const startScreen = document.getElementById("start-screen");
const startBtn = document.getElementById("start-btn");
let imprintLoaded = false;
let assetsReady = false;

// ───────── Boot splash fade-out ─────────
function hideBootSplash() {
  const el = document.getElementById("boot-splash");
  if (!el) return;
  el.classList.add("fade-out");
  const remove = () => {
    if (el.parentNode) el.parentNode.removeChild(el);
  };
  el.addEventListener("transitionend", remove, { once: true });
  // Failsafe in case transitionend never fires
  setTimeout(remove, 1500);
}

// ───────── Start screen ─────────
function onGameReady() {
  assetsReady = true;
  hideBootSplash();
  startBtn.classList.remove("loading");
  startBtn.disabled = false;
  startBtn.querySelector(".label").textContent = "Start Game";

  // Show the saved personal best (if any) as a badge above
  // the Start Game button so returning players see their
  // previous record immediately.
  const hs =
    (window.Game.getHighScore && window.Game.getHighScore()) || 0;
  const hsEl = document.getElementById("start-highscore");
  const hsVal = document.getElementById("start-highscore-value");
  if (hs > 0 && hsEl && hsVal) {
    hsVal.textContent = String(hs);
    hsEl.hidden = false;
  }

  // Wire the share panel to the game's onGameOver /
  // onGameReset events now that the API is ready.
  if (window.Game.onGameOver) {
    window.Game.onGameOver(showScoreCard);
    window.Game.onGameReset(hideScoreCard);
  }
  // Achievement toasts.
  if (window.Game.onAchievementUnlock) {
    window.Game.onAchievementUnlock(showAchievementToast);
  }

  // Initial sync of the start-screen raptor cosmetics with
  // whatever the player has unlocked + toggled on.
  refreshStartRaptorCosmetics();
  // Sync the sound button with the actual mute state now
  // that the Game API is fully loaded.
  refreshSoundUI();

  // If the user previously chose to have sound on, try to
  // start music immediately. Browsers may block autoplay
  // without a user gesture — that's fine, the first click
  // anywhere will unlock it via the interaction handlers.
  if (
    window.Game.hasSavedMutePreference &&
    window.Game.hasSavedMutePreference() &&
    !window.Game.isMuted()
  ) {
    // Re-apply the unmuted state to trigger music.play()
    window.Game.setMuted(false);
  }
}
// The game module (main.ts) calls Game.onReady(cb) when assets
// are loaded. Guard in case it hasn't parsed yet.
function registerReady() {
  if (window.Game && typeof window.Game.onReady === "function") {
    window.Game.onReady(onGameReady);
  } else {
    // main.ts may still be loading (it's deferred) — retry soon.
    setTimeout(registerReady, 30);
  }
}
registerReady();

// ───────── Live score readout (DOM) ─────────
const scoreDisplay = document.getElementById("score-display");
const scoreValueEl = document.getElementById("score-value");
let displayedScore = 0;
let lastAriaScore = -1;
let scoreLoopRunning = false;

function scoreLoop() {
  if (!scoreLoopRunning) return;
  if (window.Game && window.Game.getScore) {
    const target = window.Game.getScore();
    const diff = target - displayedScore;
    if (Math.abs(diff) > 0.01) {
      // Ease toward target at ~18% per 60fps frame. Under
      // 0.5 away, snap so the final value is exact.
      displayedScore += diff * 0.18;
      if (Math.abs(target - displayedScore) < 0.5) {
        displayedScore = target;
      }
      scoreValueEl.textContent = String(Math.floor(displayedScore));
    }
    // Update the aria-label only when the REAL score
    // changes, not on every tween frame, so assistive
    // tech doesn't get spammed with intermediate values.
    if (target !== lastAriaScore && scoreDisplay) {
      scoreDisplay.setAttribute("aria-label", "Score: " + target);
      lastAriaScore = target;
    }
  }
  requestAnimationFrame(scoreLoop);
}
function showScoreDisplay() {
  displayedScore = 0;
  if (scoreValueEl) scoreValueEl.textContent = "0";
  if (scoreDisplay) scoreDisplay.hidden = false;
  if (!scoreLoopRunning) {
    scoreLoopRunning = true;
    requestAnimationFrame(scoreLoop);
  }
}
function hideScoreDisplay() {
  if (scoreDisplay) scoreDisplay.hidden = true;
  displayedScore = 0;
  if (scoreValueEl) scoreValueEl.textContent = "0";
  scoreLoopRunning = false;
}

function startGame() {
  if (!assetsReady || window.Game.isStarted()) return;
  // The click/keypress is a user gesture — unlock the Web Audio
  // context and re-apply the mute state so music starts if
  // the user previously chose to have sound on.
  if (window.Game.unlockAudio) window.Game.unlockAudio();
  // Desktop default: if the player has never saved a mute
  // preference, start unmuted. Web default stays muted (to
  // respect browser autoplay expectations — a web page
  // blasting music on open is unexpected). Desktop games are
  // expected to play sound out of the box.
  if (
    window.electronAPI &&
    window.electronAPI.isDesktop &&
    window.Game.hasSavedMutePreference &&
    !window.Game.hasSavedMutePreference() &&
    window.Game.setMuted
  ) {
    window.Game.setMuted(false);
  } else if (window.Game.setMuted) {
    window.Game.setMuted(window.Game.isMuted());
  }
  refreshSoundUI();
  // Hide the start screen first, then tell the game to run.
  startScreen.classList.add("hidden");
  window.Game.start();
  showScoreDisplay();
}

// Start button wrapper. Uses the shared click-feedback system
// (same tap sound + scale-down wiggle as every menu button and
// the play-again button) rather than a bespoke playClick +
// start-btn-wiggle pair. Keeps the entire UI consistent.
// Gated on the settings menu being closed so a stray Space-
// fired click on Start never bypasses an open modal.
function triggerStart() {
  if (overlay.classList.contains("open")) return;
  if (!assetsReady || window.Game.isStarted()) return;
  if (window.Game && window.Game.playMenuTap) window.Game.playMenuTap();
  // Retrigger-safe: remove + force reflow + re-add so rapid
  // keyboard repeats still replay the animation cleanly.
  startBtn.classList.remove("tapped");
  void startBtn.offsetWidth;
  startBtn.classList.add("tapped");
  window.setTimeout(() => startBtn.classList.remove("tapped"), 200);
  startGame();
}
startBtn.addEventListener("click", triggerStart);
// Expose a hook so the main.ts keydown handler can trigger
// Start Game from Space/Enter on the start screen.
window.__onStartKey = triggerStart;

// ───────── Landscape guard ─────────
const isLikelyTouchDevice = () =>
  window.matchMedia("(pointer: coarse)").matches ||
  window.navigator.maxTouchPoints > 0;
const isMobileDevice = () =>
  isLikelyTouchDevice() &&
  Math.min(window.innerWidth, window.innerHeight) <= 1200;
const isMobilePortrait = () =>
  isMobileDevice() && window.innerHeight > window.innerWidth;

function refreshRotateGuard() {
  document.body.classList.toggle("needs-rotate", isMobilePortrait());
}
refreshRotateGuard();
window.addEventListener("resize", refreshRotateGuard);
window.addEventListener("orientationchange", refreshRotateGuard);

// ───────── Imprint overlay ─────────
// Loaded as an iframe pointing at the standalone imprint.html
// page. The page detects iframe embedding via window.self !==
// window.top and hides its own "Back to the game" link, so
// only the overlay's close button is usable.
function openImprint() {
  // Set the iframe src lazily on first open so the legal page
  // isn't fetched until the user actually wants to see it.
  if (!imprintLoaded) {
    imprintIframe.src = "imprint.html";
    imprintLoaded = true;
  }
  imprintOverlay.classList.add("open");
  // Focus the × button, not the iframe heading — gives the
  // gamepad / keyboard user an immediately actionable target
  // (Activate = close) and keeps the focus ring INSIDE the
  // overlay even when the iframe hasn't loaded yet.
  if (imprintCloseBtn) imprintCloseBtn.focus();
  window.Game.pause();
}

function closeImprint() {
  imprintOverlay.classList.remove("open");
  // Every path into the imprint overlay goes through the
  // settings menu (cog → Imprint). When the player hits
  // "back" (× / Esc / B-button) they expect to land back on
  // the menu — not be dumped into the live game with no way
  // to retrace their steps. openMenu() handles the Game.pause
  // side-effect, so no explicit resume is needed here.
  openMenu();
}

imprintCloseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  closeImprint();
});
imprintOverlay.addEventListener("click", (e) => {
  // Click on the dark backdrop closes the overlay.
  if (e.target === imprintOverlay) closeImprint();
});

// ───────── About overlay ─────────
// Same iframe pattern as imprint — lazy src assignment on
// first open, hidden in-frame "Back to the game" link,
// pauses the game while visible.
function openAbout() {
  if (!aboutLoaded) {
    aboutIframe.src = "about.html";
    aboutLoaded = true;
  }
  aboutOverlay.classList.add("open");
  // Focus the × button so gamepad / keyboard immediately
  // target the canonical "back" action. See openImprint.
  if (aboutCloseBtn) aboutCloseBtn.focus();
  if (window.Game && window.Game.isStarted && window.Game.isStarted()) {
    window.Game.pause();
  }
}
function closeAbout() {
  aboutOverlay.classList.remove("open");
  // Back to the menu we came from. openMenu handles its own
  // pause gating (no-op when the game isn't started).
  openMenu();
}
if (aboutCloseBtn) {
  aboutCloseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAbout();
  });
}
if (aboutOverlay) {
  aboutOverlay.addEventListener("click", (e) => {
    if (e.target === aboutOverlay) closeAbout();
  });
}

// ───────── Credits overlay ─────────
// Static content (no iframe) so it works identically on
// every platform including Capacitor, where standalone HTML
// files in the build root aren't bundled.
const creditsOverlay = document.getElementById("credits-overlay");
const creditsCloseBtn = document.getElementById("credits-close");
const creditsBtn = document.getElementById("menu-credits");
function openCredits() {
  if (!creditsOverlay) return;
  creditsOverlay.classList.add("open");
  // Focus the × button instead of the heading. The heading
  // is a non-interactive h1 — focusing it trapped the
  // gamepad user on an element whose Activate did nothing,
  // and keyboard Tab then had to cycle past it to reach the
  // actual content. The close button is the universal
  // "back" affordance; focus lands on something you can
  // act on.
  if (creditsCloseBtn) creditsCloseBtn.focus();
  if (window.Game && window.Game.isStarted && window.Game.isStarted()) {
    window.Game.pause();
  }
}
function closeCredits() {
  if (!creditsOverlay) return;
  creditsOverlay.classList.remove("open");
  // Credits is only reachable via the menu — re-open it so
  // the "back" affordance (× / Esc / gamepad B) lands the
  // player on the menu they came from, not the live game.
  openMenu();
}
if (creditsBtn) {
  creditsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu();
    openCredits();
  });
}
if (creditsCloseBtn) {
  creditsCloseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeCredits();
  });
}
if (creditsOverlay) {
  creditsOverlay.addEventListener("click", (e) => {
    if (e.target === creditsOverlay) closeCredits();
  });
}

// ───────── Achievements overlay ─────────
function renderAchievementsList() {
  if (
    !achievementsList ||
    !window.Game ||
    !window.Game.getAchievements
  ) {
    return;
  }
  const list = window.Game.getAchievements();
  // Clear previous content safely.
  while (achievementsList.firstChild) {
    achievementsList.removeChild(achievementsList.firstChild);
  }
  let unlockedCount = 0;
  for (const a of list) {
    if (a.unlocked) unlockedCount += 1;
    const li = document.createElement("li");
    li.className =
      "achievement-item " + (a.unlocked ? "unlocked" : "locked");
    const isHidden = a.secret && !a.unlocked;
    const iconDiv = document.createElement("div");
    iconDiv.className = "icon";
    if (isHidden) {
      // Show a "?" icon for undiscovered secrets
      const qSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      qSvg.setAttribute("viewBox", "0 0 24 24");
      qSvg.innerHTML = '<text x="12" y="17" text-anchor="middle" font-size="16" fill="#aaa">?</text>';
      iconDiv.appendChild(qSvg);
    } else {
      iconDiv.appendChild(buildAchievementIconNode(a));
    }
    li.appendChild(iconDiv);

    const body = document.createElement("div");
    body.className = "body";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = isHidden ? "???" : a.title;
    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = isHidden ? "Keep playing to discover this secret..." : a.desc;
    body.appendChild(title);
    body.appendChild(desc);
    li.appendChild(body);

    achievementsList.appendChild(li);
  }
  if (achievementsProgress) {
    achievementsProgress.textContent =
      unlockedCount + " / " + list.length + " unlocked";
  }
}

function openAchievements() {
  _achievementsPriorFocus = document.activeElement;
  renderAchievementsList();
  if (achievementsOverlay) achievementsOverlay.classList.add("open");
  // Focus the × button (same rationale as openCredits /
  // openAbout / openImprint). The previous heading-focus
  // target was a non-interactive h1 that broke gamepad nav.
  if (achievementsCloseBtn) achievementsCloseBtn.focus();
  if (window.Game && window.Game.isStarted && window.Game.isStarted()) {
    window.Game.pause();
  }
}
function closeAchievements() {
  if (achievementsOverlay) achievementsOverlay.classList.remove("open");
  _achievementsPriorFocus = null;
  // Always route back to the menu — that's where every
  // entry into this overlay originates, and the "back"
  // affordance is expected to retrace steps.
  openMenu();
}
if (achievementsCloseBtn) {
  achievementsCloseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAchievements();
  });
}
if (achievementsOverlay) {
  achievementsOverlay.addEventListener("click", (e) => {
    if (e.target === achievementsOverlay) closeAchievements();
  });
}

// ───────── Sound button ─────────
const menuSoundToggle = document.getElementById("menu-sound-toggle");
const menuSoundLabel = document.getElementById("menu-sound-label");
const menuMusicToggle = document.getElementById("menu-music-toggle");
const menuMusicLabel = document.getElementById("menu-music-label");
const menuJumpToggle = document.getElementById("menu-jump-toggle");
const menuJumpLabel = document.getElementById("menu-jump-label");
const menuRainSoundToggle = document.getElementById("menu-rain-sound-toggle");
const menuRainSoundLabel = document.getElementById("menu-rain-sound-label");
const menuThunderToggle = document.getElementById("menu-thunder-toggle");
const menuThunderLabel = document.getElementById("menu-thunder-label");
const menuFootstepsToggle = document.getElementById("menu-footsteps-toggle");
const menuFootstepsLabel = document.getElementById("menu-footsteps-label");
const menuCoinsSoundToggle = document.getElementById("menu-coins-sound-toggle");
const menuCoinsSoundLabel = document.getElementById("menu-coins-sound-label");
const menuUiSoundToggle = document.getElementById("menu-ui-sound-toggle");
const menuUiSoundLabel = document.getElementById("menu-ui-sound-label");
const menuEventsSoundToggle = document.getElementById("menu-events-sound-toggle");
const menuEventsSoundLabel = document.getElementById("menu-events-sound-label");

/**
 * Small helper so every channel label follows the same
 * "<name>: on|off" pattern. Falls through quietly when the label
 * element doesn't exist (e.g. a view where the sound settings
 * block is stripped out).
 */
function _setChannelLabel(
  el: HTMLElement | null,
  name: string,
  muted: boolean | undefined,
) {
  if (!el) return;
  el.textContent = `${name}: ${muted ? "off" : "on"}`;
}

function refreshSoundUI() {
  const muted = window.Game ? window.Game.isMuted() : true;
  topSoundBtn.classList.toggle("muted", muted);
  topSoundBtn.setAttribute("aria-pressed", String(!muted));
  topSoundBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
  if (menuSoundLabel) {
    menuSoundLabel.textContent = "Sound: " + (muted ? "off" : "on");
  }
  // Per-channel labels. Each getter is optional-chained because
  // the Game API shim may not be fully wired yet on first paint.
  _setChannelLabel(menuMusicLabel, "Music", window.Game?.isMusicMuted?.());
  _setChannelLabel(menuJumpLabel, "Jump sound", window.Game?.isJumpMuted?.());
  _setChannelLabel(menuRainSoundLabel, "Rain sound", window.Game?.isRainMuted?.());
  _setChannelLabel(menuThunderLabel, "Thunder", window.Game?.isThunderMuted?.());
  _setChannelLabel(menuFootstepsLabel, "Footsteps", window.Game?.isFootstepsMuted?.());
  _setChannelLabel(menuCoinsSoundLabel, "Coins", window.Game?.isCoinsMuted?.());
  _setChannelLabel(menuUiSoundLabel, "UI clicks", window.Game?.isUiMuted?.());
  _setChannelLabel(menuEventsSoundLabel, "Rare events", window.Game?.isEventsMuted?.());
}

function toggleSound() {
  if (!window.Game || !window.Game.setMuted) return;
  // Ensure Web Audio context is unlocked on this user gesture
  if (window.Game.unlockAudio) window.Game.unlockAudio();
  window.Game.setMuted(!window.Game.isMuted());
  refreshSoundUI();
}

if (menuSoundToggle) {
  menuSoundToggle.addEventListener("click", () => {
    if (!window.Game || !window.Game.setMuted) return;
    window.Game.setMuted(!window.Game.isMuted());
    refreshSoundUI();
  });
}
if (menuMusicToggle) {
  menuMusicToggle.addEventListener("click", () => {
    if (!window.Game || !window.Game.setMusicMuted) return;
    window.Game.setMusicMuted(!window.Game.isMusicMuted());
    refreshSoundUI();
  });
}
if (menuJumpToggle) {
  menuJumpToggle.addEventListener("click", () => {
    if (!window.Game || !window.Game.setJumpMuted) return;
    window.Game.setJumpMuted(!window.Game.isJumpMuted());
    refreshSoundUI();
  });
}
if (menuRainSoundToggle) {
  menuRainSoundToggle.addEventListener("click", () => {
    if (!window.Game || !window.Game.setRainMuted) return;
    window.Game.setRainMuted(!window.Game.isRainMuted());
    refreshSoundUI();
  });
}
// The finer SFX channels each follow the same
// "toggle + refresh" pattern. One tiny helper below keeps the
// wiring code proportional to the number of channels rather
// than repeating the same 5-line block for each.
function _wireChannelToggle(
  btn: HTMLElement | null,
  getter: () => boolean | undefined,
  setter: (m: boolean) => void,
) {
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!window.Game) return;
    setter(!getter());
    refreshSoundUI();
  });
}
_wireChannelToggle(
  menuThunderToggle,
  () => window.Game?.isThunderMuted?.(),
  (m) => window.Game?.setThunderMuted?.(m),
);
_wireChannelToggle(
  menuFootstepsToggle,
  () => window.Game?.isFootstepsMuted?.(),
  (m) => window.Game?.setFootstepsMuted?.(m),
);
_wireChannelToggle(
  menuCoinsSoundToggle,
  () => window.Game?.isCoinsMuted?.(),
  (m) => window.Game?.setCoinsMuted?.(m),
);
_wireChannelToggle(
  menuUiSoundToggle,
  () => window.Game?.isUiMuted?.(),
  (m) => window.Game?.setUiMuted?.(m),
);
_wireChannelToggle(
  menuEventsSoundToggle,
  () => window.Game?.isEventsMuted?.(),
  (m) => window.Game?.setEventsMuted?.(m),
);

// ───────── Fullscreen button ─────────
function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}
function refreshFullscreenUI() {
  if (!fullscreenBtn) return;
  const on = isFullscreen();
  fullscreenBtn.classList.toggle("is-fullscreen", on);
  fullscreenBtn.setAttribute("aria-pressed", String(on));
  fullscreenBtn.setAttribute(
    "aria-label",
    on ? "Exit fullscreen" : "Enter fullscreen",
  );
}
async function toggleFullscreen() {
  try {
    if (!isFullscreen()) {
      const el = document.documentElement;
      const req =
        el.requestFullscreen ||
        el.webkitRequestFullscreen ||
        el.mozRequestFullScreen ||
        el.msRequestFullscreen;
      if (req) await req.call(el);
    } else {
      const exit =
        document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.mozCancelFullScreen ||
        document.msExitFullscreen;
      if (exit) await exit.call(document);
    }
  } catch (e) {
    /* User-cancelled or not allowed — silently ignore. */
  }
}
if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
  // Keep the button in sync whenever fullscreen state
  // changes, including via the browser's own Esc-to-exit.
  const fsEvents = [
    "fullscreenchange",
    "webkitfullscreenchange",
    "mozfullscreenchange",
    "MSFullscreenChange",
  ];
  for (const ev of fsEvents) {
    document.addEventListener(ev, refreshFullscreenUI);
  }
}

// ───────── Menu overlay ─────────
function refreshMenuHighscore() {
  const hsEl = document.getElementById("menu-highscore");
  const hsVal = document.getElementById("menu-highscore-value");
  if (!hsEl || !hsVal || !window.Game || !window.Game.getHighScore)
    return;
  const hs = window.Game.getHighScore() || 0;
  if (hs > 0) {
    hsVal.textContent = String(hs);
    hsEl.hidden = false;
  } else {
    hsEl.hidden = true;
  }
}

// Track the element that had focus before an overlay opened,
// so we can restore it when the overlay closes.
let _menuPriorFocus = null;
let _achievementsPriorFocus = null;

function openMenuBase() {
  _menuPriorFocus = document.activeElement;
  overlay.classList.add("open");
  cog.setAttribute("aria-expanded", "true");
  refreshSoundUI();
  refreshHitboxesUI();
  refreshRainUI();
  refreshNoCollisionsUI();
  refreshPerfUI();
  refreshEasterEggUI();
  refreshScoreEditor();
  refreshMenuHighscore();
  // Refresh the fullscreen toggle label so it's honest if the
  // player hit ESC or Cmd-Ctrl-F outside the menu. No-op on web.
  refreshFullscreenState();
  // Toggle a "pre-game" class on the panel so items that only
  // make sense mid-run (Back to home screen, Resume game,
  // Press Esc hint) are hidden on the start screen.
  const panel = overlay.querySelector(".menu-panel");
  if (panel) {
    if (
      window.Game &&
      window.Game.isStarted &&
      window.Game.isStarted()
    ) {
      panel.classList.remove("pre-game");
    } else {
      panel.classList.add("pre-game");
    }
  }
  // Only pause an already-running game. Before the player
  // has hit Start Game, there's nothing to pause.
  if (window.Game && window.Game.isStarted && window.Game.isStarted()) {
    window.Game.pause();
  }
}

function closeMenu() {
  overlay.classList.remove("open");
  cog.setAttribute("aria-expanded", "false");
  // Restore focus to the element that opened the menu.
  if (_menuPriorFocus && typeof _menuPriorFocus.focus === "function") {
    _menuPriorFocus.focus();
    _menuPriorFocus = null;
  }
  // Only resume if the player is actually in a started game.
  // Before Start Game, there's nothing to resume — the rAF
  // loop still renders the start screen behind the menu.
  if (window.Game && window.Game.isStarted && window.Game.isStarted()) {
    window.Game.resume();
  }
}

// Public openMenu — also resets the focus index to the first
// visible item on every open so the gamepad user lands
// somewhere predictable. Delays the focus set until after the
// panel layout settles (pre-game toggle, score editor refresh,
// etc.) so offsetParent is accurate when we pick the first
// visible item.
function openMenu() {
  openMenuBase();
  _menuFocusIdx = 0;
  requestAnimationFrame(() => focusMenuIndex(0));
}

function toggleMenu() {
  if (overlay.classList.contains("open")) {
    closeMenu();
  } else {
    openMenu();
  }
}

// Small shims so the Capacitor bridge (src/mobile/bridge.ts) and
// the gamepad poller in src/main.ts can route through the same
// menu code the cog button uses. Zero-cost on the web build —
// the Capacitor bridge is only imported inside __IS_CAPACITOR__
// guard, and the gamepad poller no-ops if no pad is attached.
window.__rrIsMenuOpen = function () {
  return overlay.classList.contains("open");
};
window.__rrToggleMenu = toggleMenu;
window.__rrCloseMenu = closeMenu;
/**
 * Stepwise "back" for the pause menu. The gamepad B button
 * and D-pad left route through this so the back motion
 * unwinds UI one level at a time instead of nuking the
 * whole menu:
 *   1. If any <details> dropdown inside the menu is open,
 *      close THAT and park focus on its summary.
 *   2. Otherwise close the menu itself.
 * Matches what console menu systems conventionally do —
 * B collapses the innermost open thing, not the entire
 * screen.
 */
window.__rrMenuBack = function () {
  const openDetails = overlay.querySelector("details[open]");
  if (openDetails) {
    openDetails.removeAttribute("open");
    const summary = openDetails.querySelector("summary");
    if (summary && typeof summary.focus === "function") {
      summary.focus();
    }
    return;
  }
  closeMenu();
};

// ── Sub-overlay helpers for gamepad support ────────
// The sub-overlays (credits / achievements / imprint /
// about / reset-confirm) all share the .imprint-overlay
// class and the .open toggle. Only one is open at a time.
// These two helpers let the gamepad poller in src/main.ts
// (a) scroll whichever sub-overlay is open by driving the
// overlay's scrollable child, and (b) close it on cancel
// buttons without knowing which overlay is active.
/**
 * Resolve a scroll handle for the currently open sub-overlay.
 * Covers three content shapes the overlays use:
 *   • .credits-scroll      — same-origin scrollable div
 *   • .achievements-scroll — same-origin scrollable div
 *   • <iframe>             — cross-document (same-origin in
 *                            practice), scroll via contentWindow
 * Returns an object with a scrollBy(dx, dy) method so the
 * caller doesn't have to branch on element type, or null if
 * no scrollable sub-overlay is open.
 */
window.__rrActiveScrollable = function () {
  const overlays = document.querySelectorAll(".imprint-overlay.open");
  if (!overlays.length) return null;
  const active = overlays[0];
  const scroll = active.querySelector(
    ".credits-scroll, .achievements-scroll",
  );
  if (scroll) {
    return {
      scrollBy(dx, dy) {
        scroll.scrollBy(dx, dy);
      },
    };
  }
  const iframe = active.querySelector("iframe");
  if (iframe) {
    return {
      scrollBy(dx, dy) {
        try {
          iframe.contentWindow?.scrollBy?.(dx, dy);
        } catch (_) {
          /* cross-origin somehow — give up gracefully */
        }
      },
    };
  }
  // Open sub-overlay with no scrollable content (reset-confirm).
  // Returning null lets the caller still detect "sub-overlay
  // active" via __rrSubOverlayOpen below.
  return null;
};
/** True if any sub-overlay is currently open. Used by the
 *  gamepad poller to decide which nav mode to run even when
 *  the overlay has no scrollable content (e.g. reset-confirm). */
window.__rrSubOverlayOpen = function () {
  return !!document.querySelector(".imprint-overlay.open");
};
/** Click the close button of the active sub-overlay. Routes
 *  through the overlay's existing click handler so any
 *  Game.resume() / state-restore hooks fire correctly. */
window.__rrCloseActiveSubOverlay = function () {
  const active = document.querySelector(".imprint-overlay.open");
  if (!active) return false;
  const closeBtn = active.querySelector(".imprint-close");
  if (closeBtn && typeof closeBtn.click === "function") {
    closeBtn.click();
    return true;
  }
  return false;
};

// ── Gamepad navigation ──────────────────────────────
// Walks the focus ring across the menu's visible buttons/
// links. The three filters here together define "visible
// AND interactable right now":
//
//   1. Not disabled.
//   2. offsetParent is truthy — skips items under a
//      display:none ancestor (the .pre-game / .in-game-only
//      / .debug-only gates).
//   3. Not inside a closed <details>. Browsers DO hide the
//      children of a collapsed <details>, but the mechanism
//      varies (content-visibility, UA-internal, etc.) and
//      offsetParent isn't reliably null for every element
//      inside a closed summary. Without this explicit check,
//      gamepad up/down walked THROUGH the folded dropdown's
//      hidden items instead of jumping to the row after the
//      summary.
//
// Include .sound-settings-summary too — it's a <summary>,
// not a .menu-item, but functionally IS a navigable button
// (it toggles the collapsible). Without it, gamepad nav
// skipped right past the "Sound Settings" row and the
// player couldn't fold it open/closed with a controller.
function getNavigableMenuItems() {
  const all = overlay.querySelectorAll(
    ".menu-item, .sound-settings-summary",
  );
  const list = [];
  for (const el of all) {
    if (el.disabled) continue;
    if (!el.offsetParent) continue;
    // Collapsed <details> — summaries themselves are fine
    // to navigate TO, but items INSIDE a closed details
    // aren't reachable visually and must not appear in
    // the nav list.
    const closestDetails = el.closest("details");
    if (
      closestDetails &&
      !closestDetails.open &&
      el.tagName.toLowerCase() !== "summary"
    ) {
      continue;
    }
    list.push(el);
  }
  return list;
}
let _menuFocusIdx = 0;
function focusMenuIndex(idx) {
  const items = getNavigableMenuItems();
  if (!items.length) return;
  _menuFocusIdx =
    ((idx % items.length) + items.length) % items.length;
  const target = items[_menuFocusIdx];
  target.focus();
  target.scrollIntoView({ block: "nearest" });
}
/**
 * Resolve the current menu-focus position from live state
 * instead of trusting the stored _menuFocusIdx. Handles two
 * cases the stored index couldn't cover:
 *   - Focus drifted off the menu entirely (user clicked
 *     outside the panel, browser gave focus to body, etc.).
 *     __rrMenuFocusNext / Prev from a controller should
 *     snap back into the menu, not silently no-op.
 *   - The set of visible items changed (pre-game class,
 *     the sound-settings dropdown opening / closing)
 *     invalidating a stored index that used to be in range.
 *
 * Returns the index of the currently-focused menu item in
 * the live items array, or the clamped stored index if
 * focus is elsewhere.
 */
function currentMenuFocusIdx() {
  const items = getNavigableMenuItems();
  if (!items.length) return 0;
  const active = document.activeElement;
  const matchIdx = items.indexOf(active);
  if (matchIdx !== -1) return matchIdx;
  // Focus is off-menu or on an item that isn't navigable
  // anymore. Clamp the stored index into the new range.
  return Math.min(Math.max(0, _menuFocusIdx), items.length - 1);
}
window.__rrMenuFocusNext = function () {
  focusMenuIndex(currentMenuFocusIdx() + 1);
};
window.__rrMenuFocusPrev = function () {
  focusMenuIndex(currentMenuFocusIdx() - 1);
};
window.__rrMenuSelect = function () {
  const items = getNavigableMenuItems();
  if (!items.length) return;
  const idx = currentMenuFocusIdx();
  const target = items[idx];
  if (target && typeof target.click === "function") {
    target.click();
  }
};

// Keep _menuFocusIdx in sync with mouse clicks. Without
// this, a post-click focus-loss recovery (e.g. after a
// fullscreen transition below) would snap focus back to
// the top of the menu instead of the row the player was
// actually interacting with.
//
// Doubles as the centralised tap-sound trigger for every menu
// button: cosmetic equip, debug toggles, per-channel sound
// mutes, the Shop entry, sub-panel summaries. Each button's own
// click handler stays focused on behaviour; the audio feedback
// lives here so it's uniform and can't drift per-item.
overlay.addEventListener("click", (e) => {
  const t = e.target && e.target.closest
    ? e.target.closest(".menu-item, .sound-settings-summary")
    : null;
  if (!t) return;
  const items = getNavigableMenuItems();
  const idx = items.indexOf(t);
  if (idx !== -1) _menuFocusIdx = idx;
  window.Game?.playMenuTap?.();
});

// Focus watchdog: if the window regains focus while the
// menu is open but keyboard focus has fallen to <body>,
// snap it back into the menu. Covers the three scenarios
// that leak focus out from under the gamepad user:
//   • Electron fullscreen transitions — macOS moves the
//     window to a new Space, Electron re-fires focus on
//     the body element.
//   • Alt-tab away and back.
//   • Any browser-triggered defocus (DevTools open,
//     system notification stealing focus).
// This listener runs on every focus event, not just
// fullscreen, so the recovery is uniform across all
// those cases.
window.addEventListener("focus", () => {
  if (!overlay.classList.contains("open")) return;
  const active = document.activeElement;
  if (active && active !== document.body) return;
  focusMenuIndex(currentMenuFocusIdx());
});

closeBtn.addEventListener("click", closeMenu);
overlay.addEventListener("click", (e) => {
  // Click outside the panel closes the menu.
  if (e.target === overlay) closeMenu();
});

// "Back to home screen" — reset the game, close the menu, and
// re-show the start screen with its current personal-best badge.
const homeBtn = document.getElementById("menu-home");
if (homeBtn) {
  homeBtn.addEventListener("click", () => {
    if (window.Game && window.Game.returnToHome) {
      window.Game.returnToHome();
    }
    // Close menu without a Game.resume() side-effect, since we
    // just moved the game back to its paused pre-start state.
    overlay.classList.remove("open");
    cog.setAttribute("aria-expanded", "false");
    // Re-show the start screen. Refresh its high-score badge in
    // case the player just set a new personal best this run.
    startScreen.classList.remove("hidden");
    onGameReady();
    hideScoreDisplay();
  });
}

// Intercept the menu's imprint link so it opens as an inline
// overlay (music keeps playing) instead of navigating away.
const menuImprintLink = overlay.querySelector('a[href="imprint.html"]');
if (menuImprintLink) {
  menuImprintLink.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    openImprint();
  });
}
// Same for the about link.
const menuAboutLink = overlay.querySelector('a[href="about.html"]');
if (menuAboutLink) {
  menuAboutLink.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    openAbout();
  });
}
// Achievements button.
const menuAchievementsBtn = document.getElementById("menu-achievements");
if (menuAchievementsBtn) {
  menuAchievementsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu();
    openAchievements();
  });
}

// ───────── PWA Install button ─────────
let deferredInstallPrompt = null;
const installLi = document.getElementById("menu-install-li");
const installBtn = document.getElementById("menu-install");
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (installLi) installLi.style.display = "";
});
if (installBtn) {
  installBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (installLi) installLi.style.display = "none";
    if (outcome === "accepted") closeMenu();
  });
}
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (installLi) installLi.style.display = "none";
});

cog.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu();
});
topSoundBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleSound();
});

// ───────── Debug: hitbox toggle (only visible in ?debug=true) ─────────
const hitboxesBtn = document.getElementById("menu-hitboxes-toggle");
const hitboxesLabel = document.getElementById("menu-hitboxes-label");

function refreshHitboxesUI() {
  if (!hitboxesLabel || !window.Game) return;
  hitboxesLabel.textContent = window.Game.isShowingHitboxes()
    ? "Hitboxes: on"
    : "Hitboxes: off";
}

if (hitboxesBtn) {
  hitboxesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    window.Game.toggleShowHitboxes();
    refreshHitboxesUI();
  });
}

// ───────── Debug: rain toggle ─────────
const rainBtn = document.getElementById("menu-rain-toggle");
const rainLabel = document.getElementById("menu-rain-label");

function refreshRainUI() {
  if (!rainLabel || !window.Game || !window.Game.isRaining) return;
  rainLabel.textContent = window.Game.isRaining()
    ? "Rain: on"
    : "Rain: off";
}

if (rainBtn) {
  rainBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (window.Game && window.Game.toggleRain) {
      window.Game.toggleRain();
      closeMenu();
    }
  });
}

// ───────── Debug: no-collisions toggle ─────────
const noCollBtn = document.getElementById("menu-nocollisions-toggle");
const noCollLabel = document.getElementById("menu-nocollisions-label");

function refreshNoCollisionsUI() {
  if (!noCollLabel || !window.Game || !window.Game.isNoCollisions) return;
  noCollLabel.textContent = window.Game.isNoCollisions()
    ? "Collisions: off"
    : "Collisions: on";
}

if (noCollBtn) {
  noCollBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (window.Game && window.Game.toggleNoCollisions) {
      window.Game.toggleNoCollisions();
      refreshNoCollisionsUI();
    }
  });
}

// ───────── Debug: perf overlay toggle ─────────
const perfBtn = document.getElementById("menu-perf-toggle");
const perfLabel = document.getElementById("menu-perf-label");

function refreshPerfUI() {
  if (!perfLabel || !window.Game || !window.Game.isPerfOverlay) return;
  perfLabel.textContent = window.Game.isPerfOverlay()
    ? "Perf overlay: on"
    : "Perf overlay: off";
}

if (perfBtn) {
  perfBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (window.Game && window.Game.togglePerfOverlay) {
      window.Game.togglePerfOverlay();
      refreshPerfUI();
    }
  });
}

// ───────── Debug: rare event triggers ─────────
const eventIds = ["ufo", "santa", "tumbleweed", "comet", "meteor"];
for (const eid of eventIds) {
  const btn = document.getElementById("menu-event-" + eid);
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.Game && window.Game.triggerEvent) {
        window.Game.triggerEvent(eid);
        closeMenu();
      }
    });
  }
}

// Debug: advance moon phase
const moonBtn = document.getElementById("menu-advance-moon");
if (moonBtn) {
  moonBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (window.Game && window.Game.advanceMoonPhase) {
      window.Game.advanceMoonPhase();
      closeMenu();
    }
  });
}

// Debug: force a flower-field breather on the next frame so we can
// eyeball the rest-area layout (coin density, buffer symmetry, etc.)
// without waiting ~40 cacti for the counter to roll.
const flowerFieldBtn = document.getElementById("menu-force-breather");
if (flowerFieldBtn) {
  flowerFieldBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (window.Game && window.Game._forceBreather) {
      window.Game._forceBreather();
      closeMenu();
    }
  });
}

// ───────── Accessory toggles (party hat / thug glasses) ─────────
// Both entries are hidden in the markup by default and only
// shown once the player actually unlocks them — or always in
// debug mode for testing.
const cosmeticsGroup = document.getElementById("cosmetics");
const cosmeticsList = document.getElementById("cosmetics-list");
const menuShopBtn = document.getElementById("menu-shop");
const menuShopBalanceValue = document.getElementById(
  "menu-shop-balance-value",
);
const shopOverlay = document.getElementById("shop-overlay");
const shopCloseBtn = document.getElementById("shop-close");
const shopItemsEl = document.getElementById("shop-items");
const shopBalanceValue = document.getElementById("shop-balance-value");
const shopEmptyHint = document.getElementById("shop-empty-hint");
const jumpsResetBtn = document.getElementById("menu-jumpsreset-toggle");

// Start-screen raptor stage. Each <img class="start-raptor-cosmetic">
// has a data-slot attribute; refreshStartRaptorCosmetics() reads
// the Game API for the currently-equipped cosmetic in that slot
// and sets the img's src + hidden state accordingly. Called after
// every equip/unequip so the preview matches the live game.
const startRaptorStage = document.getElementById("start-raptor-stage");

// Idle-frame (frame 11) anchors, mirroring RAPTOR_CROWN / RAPTOR_SNOUT
// and the BACK/NECK corrections in src/constants.ts. The stage shares
// the raptor sprite's 578:212 aspect ratio, so normalised fractions
// map directly to stage percentages and the preview picks up the
// same anchors as the canvas draw path in src/entities/raptor.ts.
const _IDLE_CROWN = { x: 0.86851, y: 0.15566 };
const _IDLE_SNOUT = { x: 0.98616, y: 0.25472 };
const _IDLE_NECK_CORRECTION = { x: 0.00187, y: -0.00078 };

// The three score-unlock classics bypass the generic placeholder
// draw path in raptor.ts and use slightly smaller scales. Mirror
// those here so party-hat/thug-glasses/bow-tie render identically
// on the start screen.
const _CLASSIC_DRAW: Record<
  string,
  { scale?: number; rotation?: number }
> = {
  "party-hat": { scale: 0.25, rotation: -0.35 },
  "thug-glasses": { scale: 0.07 },
  "bow-tie": { scale: 0.06, rotation: -0.15 },
};

function refreshStartRaptorCosmetics() {
  if (!startRaptorStage || !window.Game) return;
  const slots: Array<"head" | "eyes" | "neck"> = ["head", "eyes", "neck"];
  for (const slot of slots) {
    const img = startRaptorStage.querySelector(
      `.start-raptor-cosmetic[data-slot="${slot}"]`,
    ) as HTMLImageElement | null;
    if (!img) continue;
    const id = window.Game.getEquippedCosmetic?.(slot);
    const url = id ? _spriteUrlForId(id) : null;
    if (url && id) {
      if (img.getAttribute("src") !== url) img.src = url;
      if (img.dataset.cosmeticId !== id) img.dataset.cosmeticId = id;
      img.hidden = false;
      _applyStartCosmeticTransform(img, slot, id);
    } else {
      // Nothing equipped, or equipped item has no sprite yet.
      if (img.dataset.cosmeticId) delete img.dataset.cosmeticId;
      img.hidden = true;
    }
  }
}

// Compute and apply the inline transform for a single start-screen
// cosmetic image, mirroring src/entities/raptor.ts::_drawCosmeticPlaceholder
// at the idle frame. Every number here has a direct counterpart in
// the canvas draw path — keep them in sync if that logic changes.
function _applyStartCosmeticTransform(
  img: HTMLImageElement,
  slot: "head" | "eyes" | "neck",
  id: string,
) {
  const def = window.Game?.getAllCosmetics?.().find(
    (c: { id: string }) => c.id === id,
  );
  const draw = def?.draw ?? _CLASSIC_DRAW[id] ?? {};
  let cx = 0;
  let cy = 0;
  let rot = 0;
  let widthFrac: number | null = null;
  let heightFrac: number | null = null;
  let apX = 0.5;
  let apY = 0.5;
  if (slot === "head") {
    cx = _IDLE_CROWN.x - 0.01;
    cy = _IDLE_CROWN.y + 0.04;
    heightFrac = draw.scale ?? 0.3;
    rot = draw.rotation ?? -0.35;
    // Bottom-centre of the sprite anchors to the crown.
    apX = 0.5;
    apY = 1.0;
  } else if (slot === "eyes") {
    cx = _IDLE_CROWN.x + (_IDLE_SNOUT.x - _IDLE_CROWN.x) * 0.5 - 0.012;
    cy = _IDLE_CROWN.y + (_IDLE_SNOUT.y - _IDLE_CROWN.y) * 0.5 + 0.013;
    widthFrac = draw.scale ?? 0.1;
    // atan2 must use pixel deltas, so scale dy by the raptor aspect.
    const RAPTOR_ASPECT = 212 / 578;
    const rideAngle = Math.atan2(
      (_IDLE_SNOUT.y - _IDLE_CROWN.y) * RAPTOR_ASPECT,
      _IDLE_SNOUT.x - _IDLE_CROWN.x,
    );
    rot = draw.rotation ?? rideAngle - 0.25;
  } else {
    // neck
    cx = _IDLE_CROWN.x - 0.02 + _IDLE_NECK_CORRECTION.x;
    cy = _IDLE_CROWN.y + 0.2 + _IDLE_NECK_CORRECTION.y;
    widthFrac = draw.scale ?? 0.08;
    rot = draw.rotation ?? -0.15;
  }
  if (draw.offset?.x != null) cx += draw.offset.x;
  if (draw.offset?.y != null) cy += draw.offset.y;
  img.style.left = (cx * 100).toFixed(3) + "%";
  img.style.top = (cy * 100).toFixed(3) + "%";
  if (widthFrac != null) {
    img.style.width = (widthFrac * 100).toFixed(3) + "%";
    img.style.height = "auto";
  } else {
    img.style.height = (heightFrac! * 100).toFixed(3) + "%";
    img.style.width = "auto";
  }
  img.style.transform =
    `translate(${(-apX * 100).toFixed(2)}%, ${(-apY * 100).toFixed(2)}%) ` +
    `rotate(${rot.toFixed(4)}rad)`;
  img.style.transformOrigin =
    `${(apX * 100).toFixed(2)}% ${(apY * 100).toFixed(2)}%`;
}

/** id → sprite URL. Kept in module scope so both the shop grid
 *  and the start-raptor-stage can use it. Null for unknown ids or
 *  cosmetics whose sprite hasn't been registered yet (placeholder
 *  path kicks in). */
function _spriteUrlForId(id: string): string | null {
  const def = window.Game?.getAllCosmetics?.().find(
    (c: { id: string }) => c.id === id,
  );
  if (!def?.spriteKey) return null;
  const map: Record<string, string> = {
    partyHat: "assets/party-hat.png",
    thugGlasses: "assets/thug-glasses.png",
    bowTie: "assets/bow-tie.png",
    cowboyHat: "assets/cosmetics/cowboy-hat.png",
    topHat: "assets/cosmetics/top-hat.png",
    wizardHat: "assets/cosmetics/wizard-hat.png",
    pirateTricorn: "assets/cosmetics/pirate-tricorn.png",
    tiara: "assets/cosmetics/tiara.png",
    monocle: "assets/cosmetics/monocle.png",
    eyePatch: "assets/cosmetics/eye-patch.png",
    goldChain: "assets/cosmetics/gold-chain.png",
    sombrero: "assets/cosmetics/sombrero.png",
    bandana: "assets/cosmetics/bandana.png",
    crown: "assets/cosmetics/crown.png",
  };
  return map[def.spriteKey] ?? null;
}

// Slot data used to render the per-slot sections in the cosmetics
// menu. Order here is the order the sections stack top-to-bottom.
const COSMETIC_SLOT_UI: Array<{
  slot: "head" | "eyes" | "neck";
  label: string;
}> = [
  { slot: "head", label: "Head" },
  { slot: "eyes", label: "Eyes" },
  { slot: "neck", label: "Neck" },
];

function refreshEasterEggUI() {
  if (!window.Game) return;
  renderCosmeticsMenu();
  refreshShopBalance();
  refreshStartRaptorCosmetics();
}

/**
 * Rebuild the cosmetics section of the menu from scratch. Called
 * on every menu-open and after any equip change so the dropdowns
 * stay in sync with the latest state.
 *
 * Layout: one row per slot the player owns at least one item in.
 * Each row is a "[Slot label] [Select]" pair — the select lists
 * "None" plus every owned cosmetic in that slot, and changing it
 * equips/unequips immediately. A slot with nothing owned in it
 * is hidden entirely so the menu doesn't fill up with empty
 * Back/Eyes/Neck rows before the player has any options.
 *
 * The outer <details class="cosmetics"> stays hidden until at
 * least one cosmetic is owned — no empty header at the start of
 * a fresh save.
 */
function renderCosmeticsMenu() {
  if (!cosmeticsList || !cosmeticsGroup || !window.Game) return;
  const all = window.Game.getAllCosmetics?.() ?? [];
  const owned = all.filter((c: { id: string }) =>
    window.Game.ownsCosmetic?.(c.id),
  );
  if (owned.length === 0) {
    cosmeticsGroup.hidden = true;
    cosmeticsList.innerHTML = "";
    return;
  }
  cosmeticsGroup.hidden = false;
  // Before we blow the list away and rebuild, remember which
  // per-slot <details> elements were open so we can reopen them
  // afterward. Otherwise clicking an option inside an open slot
  // re-renders and snaps the slot closed — which reads as "the
  // equip didn't take" when actually the state just got hidden.
  const previouslyOpen = new Set<string>();
  cosmeticsList
    .querySelectorAll<HTMLDetailsElement>("details.cosmetic-slot[open]")
    .forEach((el) => {
      if (el.dataset.slot) previouslyOpen.add(el.dataset.slot);
    });
  const frag = document.createDocumentFragment();
  for (const { slot, label } of COSMETIC_SLOT_UI) {
    const ownedInSlot = owned.filter(
      (c: { slot: string }) => c.slot === slot,
    );
    if (ownedInSlot.length === 0) continue;
    const equippedId = window.Game.getEquippedCosmetic?.(slot) ?? null;
    const row = _buildCosmeticSlotRow({
      slot,
      label,
      equippedId,
      options: ownedInSlot,
    });
    if (previouslyOpen.has(slot)) row.setAttribute("open", "");
    frag.appendChild(row);
  }
  cosmeticsList.innerHTML = "";
  cosmeticsList.appendChild(frag);
}

function _buildCosmeticSlotRow(opts: {
  slot: "head" | "eyes" | "neck";
  label: string;
  equippedId: string | null;
  options: Array<{ id: string; name: string; spriteKey?: string }>;
}): HTMLElement {
  // Flat per-slot section — no <details>, no collapse. Every
  // option is always visible so the player can scan+pick in one
  // motion instead of fold→expand→click. The slot-tinted left
  // border (CSS [data-slot]) keeps Head/Eyes/Neck visually
  // distinct without needing a clickable header to separate them.
  const section = document.createElement("div");
  section.className = "cosmetic-slot";
  section.dataset.slot = opts.slot;

  const header = document.createElement("h3");
  header.className = "cosmetic-slot-label";
  header.textContent = opts.label;
  section.appendChild(header);

  const body = document.createElement("ul");
  body.className = "menu-group-body cosmetic-slot-body";

  const addOption = (id: string | "", name: string) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-item cosmetic-equip-btn";
    const isEquipped =
      (id === "" && opts.equippedId == null) || id === opts.equippedId;
    btn.setAttribute("aria-pressed", isEquipped ? "true" : "false");
    const inner = document.createElement("span");
    inner.className = "inner";
    const optThumb = document.createElement("div");
    optThumb.className = "cosmetic-option-thumb";
    _setThumbForId(optThumb, id === "" ? null : id, opts.slot);
    inner.appendChild(optThumb);
    const nameSpan = document.createElement("span");
    nameSpan.className = "cosmetic-option-name";
    nameSpan.textContent = name;
    inner.appendChild(nameSpan);
    if (isEquipped) {
      const badge = document.createElement("span");
      badge.className = "cosmetic-equip-badge";
      badge.textContent = "Equipped";
      inner.appendChild(badge);
    }
    btn.appendChild(inner);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.Game?.playMenuTap?.();
      if (id === "") {
        window.Game.unequipSlot?.(opts.slot);
      } else {
        window.Game.equipCosmetic?.(id);
      }
      renderCosmeticsMenu();
      refreshStartRaptorCosmetics();
    });
    li.appendChild(btn);
    body.appendChild(li);
  };

  addOption("", "None");
  for (const opt of opts.options) addOption(opt.id, opt.name);

  section.appendChild(body);
  return section;
}

/** Paint the given thumbnail div either as a sprite preview
 *  (when an owned item with art is equipped) or as a neutral
 *  slot-tinted placeholder (None, or an item without art yet). */
function _setThumbForId(
  el: HTMLDivElement,
  id: string | null,
  slot: "head" | "eyes" | "neck",
): void {
  const slotColor: Record<string, string> = {
    head: "#d97706",
    eyes: "#1f2937",
    neck: "#b91c1c",
  };
  const spriteUrl = id ? _spriteUrlForId(id) : null;
  el.innerHTML = "";
  el.classList.toggle("cosmetic-slot-thumb-sprite", spriteUrl != null);
  el.classList.toggle("cosmetic-slot-thumb-none", id == null);
  if (spriteUrl) {
    el.style.background = "";
    el.appendChild(_buildCosmeticThumbImg(spriteUrl));
  } else if (id == null) {
    // "None" option: crossed-out circle so it reads as
    // "nothing equipped" rather than a slot-coloured block
    // that looks like yet another cosmetic.
    el.style.background = "";
    el.appendChild(_buildNoneIcon());
  } else {
    el.style.background = slotColor[slot] ?? "#555";
  }
}

function _buildCosmeticThumbImg(src: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  return img;
}

function _buildNoneIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("cosmetic-none-icon");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "9");
  svg.appendChild(circle);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "5.6");
  line.setAttribute("y1", "5.6");
  line.setAttribute("x2", "18.4");
  line.setAttribute("y2", "18.4");
  svg.appendChild(line);
  return svg;
}

// ───────── Shop ─────────
/** Update the "💰 N" chip on the Shop menu button AND the balance
 *  line inside the shop overlay. Called after any purchase and on
 *  every menu-open. */
function refreshShopBalance() {
  if (!window.Game) return;
  const n = window.Game.getCoinsBalance?.() ?? 0;
  if (menuShopBalanceValue) menuShopBalanceValue.textContent = String(n);
  if (shopBalanceValue) shopBalanceValue.textContent = String(n);
}

/** Build the shop grid from the current inventory. Each card shows
 *  the name, price, and a state-aware action button:
 *    • "Buy"      — not owned, can afford (click purchases + refreshes)
 *    • "Costs N"  — not owned, can't afford (disabled)
 *    • "Equip"    — owned but another item in its slot is equipped
 *    • "Equipped" — currently worn (disabled)
 *
 *  Thumbnail is a slot-coloured rectangle with the item's initials
 *  — same pattern as the raptor's placeholder rendering, so the
 *  shop preview and the in-game preview match until final art
 *  lands. */
function renderShop() {
  if (!shopItemsEl || !window.Game) return;
  const inventory = window.Game.getShopInventory?.() ?? [];
  shopItemsEl.innerHTML = "";
  if (inventory.length === 0) {
    if (shopEmptyHint) shopEmptyHint.hidden = false;
    return;
  }
  if (shopEmptyHint) shopEmptyHint.hidden = true;
  const balance = window.Game.getCoinsBalance?.() ?? 0;
  const slotColor: Record<string, string> = {
    head: "#d97706",
    eyes: "#1f2937",
    neck: "#b91c1c",
    back: "#7c3aed",
  };
  const slotLabel: Record<string, string> = {
    head: "Head",
    eyes: "Eyes",
    neck: "Neck",
    back: "Back",
  };
  // Uses the module-level _spriteUrlForId helper so the shop
  // grid, the equip menu, and the start-raptor-stage all agree
  // on which sprite URL to load for a given cosmetic id.
  for (const def of inventory) {
    const card = document.createElement("div");
    card.className = "shop-item";
    card.dataset.id = def.id;

    const thumb = document.createElement("div");
    thumb.className = "shop-item-thumb";
    const thumbUrl = _spriteUrlForId(def.id);
    if (thumbUrl) {
      // Real sprite — transparent PNG on a neutral panel so the
      // art reads well regardless of slot colour.
      thumb.classList.add("shop-item-thumb-sprite");
      const img = document.createElement("img");
      img.src = thumbUrl;
      img.alt = "";
      img.loading = "lazy";
      thumb.appendChild(img);
    } else {
      // Placeholder: slot-tinted square with the item's initials.
      thumb.style.background = slotColor[def.slot] ?? "#555";
      thumb.textContent = def.name.slice(0, 2).toUpperCase();
    }
    card.appendChild(thumb);

    const info = document.createElement("div");
    info.className = "shop-item-info";
    const name = document.createElement("div");
    name.className = "shop-item-name";
    name.textContent = def.name;
    info.appendChild(name);
    const slotTag = document.createElement("div");
    slotTag.className = "shop-item-slot";
    slotTag.textContent = slotLabel[def.slot] ?? def.slot;
    info.appendChild(slotTag);
    if (def.description) {
      const desc = document.createElement("div");
      desc.className = "shop-item-description";
      desc.textContent = def.description;
      info.appendChild(desc);
    }
    card.appendChild(info);

    const action = document.createElement("button");
    action.type = "button";
    action.className = "shop-item-action";
    const owned = window.Game.ownsCosmetic?.(def.id) === true;
    const equipped = window.Game.isCosmeticEquipped?.(def.id) === true;
    if (equipped) {
      action.textContent = "Equipped";
      action.disabled = true;
      action.classList.add("shop-item-action-equipped");
    } else if (owned) {
      action.textContent = "Equip";
      action.addEventListener("click", (e) => {
        e.stopPropagation();
        window.Game?.playMenuTap?.();
        window.Game.equipCosmetic?.(def.id);
        renderShop();
        refreshStartRaptorCosmetics();
      });
    } else if (balance >= def.price || window.Game.isDebug?.()) {
      // Normal purchase path — or the debug-mode free grab the
      // Game API allows regardless of balance. Either way the
      // click handler is the same (buyCosmetic short-circuits
      // the coin deduction when debug is on).
      const isDebugFree =
        window.Game.isDebug?.() === true && balance < def.price;
      action.textContent = isDebugFree
        ? `Buy · ${def.price} (debug)`
        : `Buy · ${def.price}`;
      action.addEventListener("click", (e) => {
        e.stopPropagation();
        // Capture the button's screen position BEFORE buyCosmetic
        // → renderShop() rebuilds every card and detaches the
        // clicked button. getBoundingClientRect on a detached
        // element returns all zeros, which previously threw the
        // confetti burst into the top-left corner of the viewport.
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const res = window.Game.buyCosmetic?.(def.id);
        if (res === "ok") {
          refreshShopBalance();
          renderShop();
          refreshStartRaptorCosmetics();
          // Celebratory feedback: "level up" chime + a DOM confetti
          // burst emitted from the buy-button's screen position, so
          // the player gets a clear "that worked" signal that isn't
          // hidden under the shop overlay (canvas-based confetti
          // would draw behind the dim backdrop).
          window.Game.playShopPurchase?.();
          spawnShopConfetti(cx, cy);
        }
      });
    } else {
      action.textContent = `${def.price} coins`;
      action.disabled = true;
      action.classList.add("shop-item-action-poor");
    }
    card.appendChild(action);

    shopItemsEl.appendChild(card);
  }
}

// DOM confetti used only by the shop — the canvas-based
// spawnConfettiBurst would render behind the 60%-black shop backdrop,
// so we need real DOM elements on top. Kept deliberately small and
// self-contained: ~24 absolutely-positioned divs with randomised
// velocity + rotation, driven by a single rAF loop, cleaned up when
// every particle has faded. Colours mirror the canvas confetti
// palette so the two effects read as one language.
const SHOP_CONFETTI_COLORS = [
  "#ff4d6d", "#ffb703", "#06d6a0", "#118ab2",
  "#8338ec", "#ffd60a", "#ff7b00", "#ef476f",
];
function spawnShopConfetti(originX: number, originY: number) {
  // Container sits over EVERYTHING (above the shop overlay at 2700).
  // One container per burst — removed once the last particle expires.
  const layer = document.createElement("div");
  layer.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:3000;";
  document.body.appendChild(layer);
  interface P { el: HTMLElement; x: number; y: number; vx: number; vy: number; rot: number; vrot: number; age: number; life: number; }
  const particles: P[] = [];
  for (let i = 0; i < 24; i++) {
    const el = document.createElement("div");
    const color = SHOP_CONFETTI_COLORS[i % SHOP_CONFETTI_COLORS.length];
    const size = 6 + Math.random() * 5;
    el.style.cssText =
      `position:absolute;left:${originX}px;top:${originY}px;` +
      `width:${size}px;height:${size * 0.6}px;` +
      `background:${color};border-radius:1px;will-change:transform,opacity;`;
    layer.appendChild(el);
    // Radial burst — fan outward, slight upward bias so it feels
    // celebratory rather than a gravity-dominated drop.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
    const speed = 220 + Math.random() * 280;
    particles.push({
      el,
      x: originX, y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 10,
      age: 0,
      life: 0.9 + Math.random() * 0.6,
    });
  }
  let lastT = performance.now();
  function step(now: number) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    let alive = 0;
    for (const p of particles) {
      if (p.age >= p.life) continue;
      p.age += dt;
      p.vy += 780 * dt; // gravity
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      const t = p.age / p.life;
      const alpha = t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.2);
      p.el.style.transform = `translate(${p.x - originX}px, ${p.y - originY}px) rotate(${p.rot}rad)`;
      p.el.style.opacity = String(alpha);
      if (p.age < p.life) alive++;
    }
    if (alive > 0) {
      requestAnimationFrame(step);
    } else {
      layer.remove();
    }
  }
  requestAnimationFrame(step);
}

function openShop() {
  if (!shopOverlay) return;
  // Shop is a full-screen modal — always pause the game underneath.
  // Reached in two paths: (a) menu → Shop (menu already paused us,
  // but it calls Game.resume() on closeMenu just before we open),
  // or (b) direct hotkey opens from gameplay. Either way pause is
  // the right move.
  try { window.Game?.pause?.(); } catch {}
  refreshShopBalance();
  renderShop();
  shopOverlay.classList.add("open");
}
function closeShop() {
  if (!shopOverlay) return;
  shopOverlay.classList.remove("open");
  // Mirror the pause on open. Game.resume is a no-op if the run
  // hasn't started yet, so safe on the start-screen shop entry too.
  try { window.Game?.resume?.(); } catch {}
}

if (menuShopBtn) {
  menuShopBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu();
    openShop();
  });
}
if (shopCloseBtn) {
  shopCloseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeShop();
  });
}
if (shopOverlay) {
  shopOverlay.addEventListener("click", (e) => {
    // Click on the backdrop (the overlay itself, not the sheet)
    // closes the shop, matching other full-screen overlays.
    if (e.target === shopOverlay) closeShop();
  });
}
// ESC closes the shop if it's open.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && shopOverlay?.classList.contains("open")) {
    closeShop();
    e.stopPropagation();
  }
});
// ───────── Reset-progress confirmation ─────────
const resetOverlay = document.getElementById("reset-confirm-overlay");
const resetYes = document.getElementById("reset-confirm-yes");
const resetNo = document.getElementById("reset-confirm-no");

function openResetConfirm() {
  if (resetOverlay) resetOverlay.classList.add("open");
}
function closeResetConfirm() {
  if (resetOverlay) resetOverlay.classList.remove("open");
}
function doReset() {
  window.Game.resetAllProgress();
  refreshEasterEggUI();
  if (
    achievementsOverlay &&
    achievementsOverlay.classList.contains("open")
  ) {
    renderAchievementsList();
  }
  const pbEl = document.getElementById("personal-best");
  if (pbEl) pbEl.textContent = "Personal best: 0";
  closeResetConfirm();
  closeMenu();
}
if (jumpsResetBtn) {
  jumpsResetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openResetConfirm();
  });
}
if (resetYes) resetYes.addEventListener("click", doReset);
if (resetNo) resetNo.addEventListener("click", closeResetConfirm);
if (resetOverlay) {
  resetOverlay.addEventListener("click", (e) => {
    if (e.target === resetOverlay) closeResetConfirm();
  });
}

// Debug: live-editable score input. Typing a new number
// overwrites state.score on the fly so testers can hop
// the raptor past the high-score / unlock thresholds
// without grinding.
const scoreInput = document.getElementById("menu-score-input");
function refreshScoreEditor() {
  if (!scoreInput || !window.Game || !window.Game.getScore) return;
  // Only overwrite the input if the user isn't actively
  // editing it, to avoid stealing focus or caret position.
  if (document.activeElement === scoreInput) return;
  scoreInput.value = String(window.Game.getScore() | 0);
}
if (scoreInput) {
  scoreInput.addEventListener("input", () => {
    if (!window.Game || !window.Game.setScore) return;
    const n = Math.max(0, Math.floor(Number(scoreInput.value) || 0));
    window.Game.setScore(n);
    // Sync the HUD's displayed value so it snaps to the
    // new number instead of slowly tweening up.
    if (scoreValueEl) scoreValueEl.textContent = String(n);
    displayedScore = n;
  });
  scoreInput.addEventListener("click", (e) => e.stopPropagation());
}

// ───────── Keyboard ─────────
// ESC toggles the menu (or closes imprint first if it's open).
// We use a capture-phase listener on document so this runs before
// main.ts' window-level keydown handler.
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (
        achievementsOverlay &&
        achievementsOverlay.classList.contains("open")
      ) {
        closeAchievements();
      } else if (
        creditsOverlay &&
        creditsOverlay.classList.contains("open")
      ) {
        closeCredits();
      } else if (
        aboutOverlay &&
        aboutOverlay.classList.contains("open")
      ) {
        closeAbout();
      } else if (imprintOverlay.classList.contains("open")) {
        closeImprint();
      } else {
        toggleMenu();
      }
    }
  },
  true,
);

// Initial UI sync.
refreshSoundUI();

// ───────── Share your score ─────────
const scoreCardOverlay = document.getElementById("score-card-overlay");
const sharePanel = document.getElementById("score-card-panel");
const scoreCardImg = document.getElementById("score-card-preview");
const shareBtn = document.getElementById("share-score-btn");
const shareBtnLabel = shareBtn
  ? shareBtn.querySelector(".label")
  : null;
const originalShareLabel = shareBtnLabel
  ? shareBtnLabel.textContent
  : "Share your score";
let currentCardBlob = null;
let currentCardUrl = null;
let shareInFlight = false;

function clearCard() {
  if (currentCardUrl) {
    URL.revokeObjectURL(currentCardUrl);
    currentCardUrl = null;
  }
  currentCardBlob = null;
  if (scoreCardImg) scoreCardImg.removeAttribute("src");
}

const scoreCardSlot = document.getElementById("score-card-slot");

function showScoreCard() {
  if (!sharePanel || !scoreCardImg || !window.Game) return;
  // Open the panel with the spinner visible immediately —
  // no waiting for the worker to finish composing the
  // image. The spinner is swapped for the real image once
  // the worker returns.
  clearCard();
  if (scoreCardSlot) scoreCardSlot.classList.remove("loaded");
  sharePanel.classList.add("visible");
  if (scoreCardOverlay) scoreCardOverlay.classList.add("visible");
  if (shareBtnLabel) shareBtnLabel.textContent = originalShareLabel;
  // Defer card generation by two animation frames so the
  // death snapshot is captured in render() before the
  // worker asks for it.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.Game.generateScoreCard()
        .then((blob) => {
          if (!blob || !sharePanel.classList.contains("visible")) {
            return;
          }
          currentCardBlob = blob;
          currentCardUrl = URL.createObjectURL(blob);
          scoreCardImg.onload = () => {
            if (scoreCardSlot) scoreCardSlot.classList.add("loaded");
          };
          scoreCardImg.src = currentCardUrl;
        })
        .catch((e) => {
          console.warn("score card failed", e);
        });
    });
  });
}

// ───────── Achievement toasts ─────────
const achievementToastStack = document.getElementById("achievement-toasts");
// Shared renderer for achievement icons. Supports two
// shapes from main.ts's ACHIEVEMENTS table:
//   - { iconHTML }  — inline multi-colour SVG fragment
//                     (drawn inside a 24×24 viewBox).
//   - { iconImage } — path to a sprite under /assets,
//                     rendered as a plain <img>. Used
//                     for the party-hat / thug-glasses
//                     cosmetics so the reward preview
//                     is literally the thing you unlock.
// Both input fields come from static strings in main.ts,
// so it's safe to use innerHTML for the SVG fragment.
function buildAchievementIconNode(ach) {
  if (ach && ach.iconImage) {
    const img = document.createElement("img");
    img.src = ach.iconImage;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.className = "achievement-icon-image";
    return img;
  }
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = (ach && ach.iconHTML) || "";
  return svg;
}

function showAchievementToast(ach) {
  if (!achievementToastStack || !ach) return;
  const el = document.createElement("div");
  el.className = "achievement-toast";
  const iconWrap = document.createElement("div");
  iconWrap.className = "achievement-toast-icon";
  iconWrap.appendChild(buildAchievementIconNode(ach));
  el.appendChild(iconWrap);

  const body = document.createElement("div");
  body.className = "achievement-toast-body";
  const kicker = document.createElement("div");
  kicker.className = "achievement-toast-kicker";
  // Show n/m counter
  const allAch = window.Game.getAchievements ? window.Game.getAchievements() : [];
  const unlocked = allAch.filter((a) => a.unlocked).length;
  kicker.textContent = `Achievement Unlocked (${unlocked}/${allAch.length})`;
  const title = document.createElement("div");
  title.className = "achievement-toast-title";
  title.textContent = ach.title;
  const desc = document.createElement("div");
  desc.className = "achievement-toast-desc";
  desc.textContent = ach.desc;
  body.appendChild(kicker);
  body.appendChild(title);
  body.appendChild(desc);
  el.appendChild(body);

  achievementToastStack.appendChild(el);
  // Entry animation fires from the CSS `toast-in`
  // keyframe the instant the element is in the DOM —
  // no explicit class toggle needed.
  // Slide out after a few seconds and remove from DOM
  // once the leave animation is done.
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 420);
  }, 4200);
}

function hideScoreCard() {
  if (sharePanel) sharePanel.classList.remove("visible");
  if (scoreCardOverlay) scoreCardOverlay.classList.remove("visible");
  if (scoreCardSlot) scoreCardSlot.classList.remove("loaded");
  clearCard();
  shareInFlight = false;
  if (shareBtnLabel) shareBtnLabel.textContent = originalShareLabel;
}

// Touch/mobile heuristic — on desktop we prefer clipboard
// copy, on touch we prefer the OS share sheet.
const isTouchDevice =
  window.matchMedia("(pointer: coarse)").matches ||
  (navigator.maxTouchPoints || 0) > 1;

function setShareLabel(text) {
  if (shareBtnLabel) shareBtnLabel.textContent = text;
}
function flashShareLabel(text, duration = 1800) {
  setShareLabel(text);
  setTimeout(() => {
    if (!shareInFlight) setShareLabel(originalShareLabel);
  }, duration);
}

function isDesktopApp() {
  return !!(window.electronAPI && window.electronAPI.isDesktop);
}

function buildShareText(score) {
  if (isDesktopApp()) {
    return `🦖 I scored ${score} in Raptor Runner — can you beat me? ${STEAM_STORE_URL}`;
  }
  return `Can you beat my highscore of ${score} at https://raptor.trebeljahr.com?`;
}

async function handleShareClick() {
  if (shareInFlight || !currentCardBlob) return;
  shareInFlight = true;
  try {
    const score = window.Game.getScore ? window.Game.getScore() : 0;
    const shareText = buildShareText(score);
    const file = new File(
      [currentCardBlob],
      `raptor-runner-${score}.png`,
      { type: "image/png" },
    );
    // Mobile: native share sheet with the file — the OS
    // decides whether the image, the text, or both end up
    // in the target app.
    if (
      isTouchDevice &&
      navigator.canShare &&
      navigator.canShare({ files: [file] }) &&
      navigator.share
    ) {
      try {
        await navigator.share({
          title: "Raptor Runner",
          text: shareText,
          files: [file],
        });
        flashShareLabel("Shared!");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // cancelled
        // fall through to clipboard
      }
    }
    // Desktop / fallback: write BOTH the PNG and the share
    // text as a single ClipboardItem. Apps that only know
    // how to paste images (WhatsApp desktop) get the
    // picture; apps that paste rich content (Gmail, Slack)
    // get both. A single ClipboardItem is atomic — one
    // paste delivers both types.
    const textBlob = new Blob([shareText], {
      type: "text/plain",
    });
    if (
      navigator.clipboard &&
      window.ClipboardItem &&
      navigator.clipboard.write
    ) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": currentCardBlob,
            "text/plain": textBlob,
          }),
        ]);
        flashShareLabel(isDesktopApp() ? "Invite copied!" : "Copied!");
        return;
      } catch (e) {
        // Some browsers reject multi-type ClipboardItems;
        // fall back to image-only.
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": currentCardBlob }),
          ]);
          flashShareLabel(isDesktopApp() ? "Invite copied!" : "Copied!");
          return;
        } catch (e2) {
          // fall through to text-only copy
        }
      }
    }
    // Last-resort text fallback: at least copy the share
    // sentence so the player has something to paste.
    try {
      await navigator.clipboard.writeText(shareText);
      flashShareLabel("Link copied!");
    } catch (e) {
      flashShareLabel("Copy failed");
    }
  } finally {
    shareInFlight = false;
  }
}

if (shareBtn) {
  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleShareClick();
  });
}

// Play again button — explicit restart action. Uses
// Game.restartFromGameOver which honours the short
// death-animation cooldown built into main.ts.
function doRestart() {
  if (window.Game && window.Game.restartFromGameOver) {
    window.Game.restartFromGameOver();
  }
}
const playAgainBtn = document.getElementById("play-again-btn");
if (playAgainBtn) {
  playAgainBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    doRestart();
  });
}
// Clicking anywhere on the game-over overlay backdrop
// (but not the panel itself) restarts the game via mouse
// only — touch devices already use "tap to restart" via
// the canvas pointerdown handler.
if (scoreCardOverlay) {
  scoreCardOverlay.addEventListener("click", (e) => {
    if (e.target === scoreCardOverlay) {
      doRestart();
    }
  });
}
// Make the "Press Enter to restart" hint clickable too.
const scoreCardHint = document.getElementById("score-card-hint");
if (scoreCardHint) {
  scoreCardHint.addEventListener("click", (e) => {
    e.stopPropagation();
    doRestart();
  });
}
