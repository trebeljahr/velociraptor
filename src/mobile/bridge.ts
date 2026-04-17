/*
 * Raptor Runner — Capacitor (native-mobile) bridge.
 *
 * Single entrypoint called from src/main.ts via a dynamic import gated
 * on __IS_CAPACITOR__. Keeps every Capacitor symbol out of the web
 * bundle: on the web build, main.ts never reaches the dynamic import
 * site so Rollup drops this module entirely.
 *
 * Mirrors the src/steamBridge.ts pattern:
 *   - The caller passes in game-side handlers (pauseToMenu, onPause,
 *     onResume) so we don't import any gameplay modules from here.
 *     Keeps the dependency direction one-way: main.ts → bridge, never
 *     bridge → main.ts.
 *   - Every native call is guarded / try-wrapped so a missing plugin
 *     or a revoked permission never crashes the game loop.
 *
 * What this sets up:
 *   - Orientation lock to landscape (PWA manifest's `orientation` hint
 *     is not honored on iOS; this plugin call is).
 *   - Status bar hidden so the game owns the full screen.
 *   - Android back button → game-side `pauseToMenu` handler, preventing
 *     the default "exit app" behavior that feels hostile to players.
 *   - App lifecycle (pause/resume on backgrounding) → `onPause` /
 *     `onResume` so audio and rAF can be cleanly suspended.
 *   - SplashScreen.hide() is called LAST, after Game.onReady fires, so
 *     the player never sees a white flash between splash and canvas.
 */

export interface MobileHandlers {
  /** Called when the player presses the Android hardware back button.
   *  Game code should route through its existing menu state (close
   *  open menu → open pause menu → confirm exit). Return `true` if the
   *  press was handled (we'll consume the event); `false` lets the
   *  platform handle it (which on Android means exit the app). */
  onBackButton: () => boolean;

  /** App was backgrounded (user hit home, received a call, etc.). The
   *  game should pause audio + rAF. Already paused is a no-op. */
  onPause: () => void;

  /** App returned to the foreground. The game should NOT auto-resume
   *  gameplay — it should stay paused and show its menu, so the player
   *  isn't killed by a cactus that appeared while they were away. */
  onResume: () => void;
}

let initialized = false;

/** Wire up the Capacitor plugins. Safe to call once during game init.
 *  All failures are swallowed — a missing plugin or denied permission
 *  must never crash the rAF loop. */
export async function initMobile(handlers: MobileHandlers): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Import lazily so this whole block tree-shakes out of the web build.
  const [
    { Capacitor },
    { App },
    { StatusBar, Style },
    { ScreenOrientation },
  ] = await Promise.all([
    import("@capacitor/core"),
    import("@capacitor/app"),
    import("@capacitor/status-bar"),
    import("@capacitor/screen-orientation"),
  ]);

  // Defensive: the build output might run in a browser under some
  // serve-to-test config. isNativePlatform() returns false for web.
  if (!Capacitor.isNativePlatform()) return;

  // Tag <body> so CSS can branch on "we're in a native shell" — used
  // to hide the fullscreen button (it's a no-op when the app already
  // owns the full screen), add safe-area insets to UI overlays, and
  // disable long-press callouts on the canvas. The class is set before
  // any native plugin work so CSS applies even if the plugins below
  // fail.
  document.body.classList.add("cap");
  document.body.setAttribute("data-platform", Capacitor.getPlatform());

  // Register the Capacitor game-services adapter (Game Center on iOS,
  // Play Games Services on Android). Stub until a plugin is wired up
  // in src/mobile/gameServices.ts — see docs/GAME_SERVICES.md.
  // Gameplay code's submitScore / unlockAchievement calls become
  // no-ops until the adapter's init() returns true.
  import("./gameServices").then(({ capacitorGameServicesAdapter }) => {
    import("../services/gameServices").then(
      ({ registerGameServices, initGameServices }) => {
        registerGameServices(capacitorGameServicesAdapter);
        initGameServices();
      },
    );
  });

  // Lock to landscape. The PWA manifest's `orientation: "landscape"`
  // is a hint that iOS ignores; this plugin call is the real lock.
  try {
    await ScreenOrientation.lock({ orientation: "landscape" });
  } catch {
    /* some devices (iPad Split View) refuse — just leave unlocked */
  }

  // Status bar off. The canvas already fills the viewport; the status
  // bar on top cuts into the score display.
  try {
    await StatusBar.hide();
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    /* ignore */
  }

  // Android hardware back button. If the game handles it, consume;
  // otherwise let Capacitor exit the app.
  App.addListener("backButton", (event) => {
    const handled = handlers.onBackButton();
    if (!handled && event.canGoBack === false) {
      App.exitApp();
    }
  });

  // App lifecycle. `isActive=false` fires when user backgrounds the
  // app; `true` when it comes back.
  App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) handlers.onResume();
    else handlers.onPause();
  });
}

/** Dismiss the splash screen. Call this AFTER Game.onReady fires, so
 *  the splash stays visible until the canvas has a frame to show —
 *  no white-flash transition. */
export async function hideSplash(): Promise<void> {
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 300 });
  } catch {
    /* ignore */
  }
}
