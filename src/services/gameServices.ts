/*
 * Raptor Runner — cross-platform game-services bridge.
 *
 * One front for three very different backends:
 *   - Steam (desktop / Electron) via src/steamBridge.ts
 *   - Google Play Games Services (Android Capacitor) via a plugin
 *   - Apple Game Center (iOS Capacitor) via a plugin
 *
 * Gameplay code (main.ts, achievements, etc.) calls into the helpers
 * exported here. They fan out to whichever backend is registered for
 * the current platform. If no backend is registered — web build, or
 * mobile build before the plugin is wired — every method is a no-op.
 * The game's localStorage/Preferences high-score + achievement state
 * remains the operational source of truth; the service backend is a
 * mirror, same as Steam.
 *
 * Why this abstraction exists:
 *   - The gameplay code shouldn't know about Steam vs Play Games vs
 *     Game Center. One call site per concept ("player unlocked X").
 *   - Each backend has different async semantics, different error
 *     surfaces, and different init timing. The bridge hides all that.
 *   - We can ship the game without any service wired up, then flip
 *     each platform live as the relevant developer account goes live
 *     (Apple blocked on LLC + D-U-N-S; Play Games blocked on Play
 *     Console registration).
 *
 * See docs/GAME_SERVICES.md for the plugin-integration steps.
 */

/**
 * Minimal interface every backend must satisfy. The game only needs
 * three one-way operations to integrate with a service; anything
 * richer (friend lists, invites, saved games) stays out of scope
 * until we have a reason to add it.
 */
export interface GameServicesAdapter {
  /** Asynchronous boot. For Game Center this triggers the OS sign-in
   *  sheet; for Play Games Services v2 the Games app handles sign-in
   *  automatically. Returns true on successful auth. */
  init(): Promise<boolean>;

  /** Fire-and-forget: report a score to the default leaderboard. */
  submitScore(score: number): void;

  /** Fire-and-forget: unlock an achievement by game-side id (e.g.
   *  "first-run"). The adapter is responsible for translating to
   *  the platform's own identifier scheme. */
  unlockAchievement(id: string): void;

  /** Open the platform's built-in achievements UI on top of the game.
   *  Returns false if the platform doesn't support this or sign-in
   *  hasn't completed yet. */
  showAchievements(): Promise<boolean>;

  /** Open the platform's built-in leaderboard UI. Same caveats as
   *  showAchievements. */
  showLeaderboard(): Promise<boolean>;
}

let _adapter: GameServicesAdapter | null = null;
let _initPromise: Promise<boolean> | null = null;

/**
 * Register a backend. Called once during platform init:
 *   - src/mobile/bridge.ts registers the mobile plugin adapter on
 *     Capacitor startup.
 *   - Desktop / Electron is served by src/steamBridge.ts directly
 *     (separate abstraction) — no adapter is registered here.
 *
 * Registering replaces any previous adapter, so it's safe to call
 * more than once during a hot-reload. */
export function registerGameServices(adapter: GameServicesAdapter): void {
  _adapter = adapter;
  _initPromise = null;
}

/** Whether a real backend is wired up. Gameplay code rarely needs
 *  this — prefer calling the no-op-on-web methods below. */
export function hasGameServices(): boolean {
  return _adapter !== null;
}

/** Idempotent init. Safe to call from anywhere that needs sign-in to
 *  have succeeded; subsequent calls return the same Promise. */
export function initGameServices(): Promise<boolean> {
  if (!_adapter) return Promise.resolve(false);
  if (_initPromise) return _initPromise;
  _initPromise = _adapter.init().catch(() => false);
  return _initPromise;
}

/** Fire-and-forget score submission. Logs nothing — the adapter
 *  handles its own error reporting. Safe to call every game-over. */
export function submitScore(score: number): void {
  if (!_adapter) return;
  try {
    _adapter.submitScore(score);
  } catch {
    /* swallow — next session will re-sync via init() */
  }
}

/** Fire-and-forget achievement unlock. The game's own localStorage
 *  state is the source of truth; this just mirrors to the platform
 *  so the player's achievements show up in Game Center / Play Games. */
export function unlockAchievement(id: string): void {
  if (!_adapter) return;
  try {
    _adapter.unlockAchievement(id);
  } catch {
    /* swallow */
  }
}

/** Show the platform's native achievements UI. Resolves false when
 *  no backend is registered or the backend isn't ready — the caller
 *  should fall back to the in-app achievements overlay. */
export function showAchievements(): Promise<boolean> {
  if (!_adapter) return Promise.resolve(false);
  return _adapter.showAchievements().catch(() => false);
}

/** Show the platform's native leaderboard UI. Resolves false when
 *  no backend is registered or the backend isn't ready. */
export function showLeaderboard(): Promise<boolean> {
  if (!_adapter) return Promise.resolve(false);
  return _adapter.showLeaderboard().catch(() => false);
}
