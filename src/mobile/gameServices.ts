/*
 * Raptor Runner — mobile (Capacitor) game-services adapter.
 *
 * Implements the GameServicesAdapter interface from
 * src/services/gameServices.ts in terms of whatever native plugin is
 * chosen for Game Center (iOS) + Play Games Services (Android).
 *
 * This file is a stub right now. It's loaded only inside the
 * `if (__IS_CAPACITOR__)` block in src/main.ts (via mobile/bridge.ts),
 * so the web bundle never sees it. When you install a specific plugin
 * — see docs/GAME_SERVICES.md for candidates — replace the `TODO`
 * bodies below with real plugin calls. Nothing else in the codebase
 * needs to change: gameplay code already calls submitScore() +
 * unlockAchievement() through the abstract bridge, which no-ops until
 * this adapter is wired up and registered.
 *
 * Why a stub instead of a real plugin right now:
 *   - iOS Game Center requires Apple Developer enrollment (blocked
 *     on LLC + D-U-N-S).
 *   - Play Games Services requires a Google Play Console app record
 *     ($25 registration, then a few days of identity verification).
 *   - Community Capacitor plugins for this space are sparse and
 *     churn a lot; picking one now risks thrashing. Better to commit
 *     when we're ready to test against real accounts.
 */

import type { GameServicesAdapter } from "../services/gameServices";

/**
 * Map game-side achievement ids (e.g. "first-run", "score-25") to
 * platform-specific identifiers. Steam uses the same mapping via
 * src/steamBridge.ts's `toSteamApiName` — here we need two more
 * translations:
 *   - Google Play Games: arbitrary string ids set in Play Console
 *     when you create each achievement (e.g. "CgkI...").
 *   - Apple Game Center: reverse-DNS style ids you set in App Store
 *     Connect (e.g. "com.ricoslabs.raptorrunner.achievement.first-run").
 *
 * Keep this table in sync with whatever you configure in the two
 * backends. Used at achievement-unlock time to translate our id into
 * the platform's.
 */
const PLATFORM_ACHIEVEMENT_IDS: Record<
  string,
  { android?: string; ios?: string }
> = {
  // Example — fill in real ids when backends are configured.
  // "first-run": {
  //   android: "CgkI__REPLACE_ME_ANDROID__",
  //   ios: "com.ricoslabs.raptorrunner.achievement.first-run",
  // },
};

const DEFAULT_LEADERBOARD_ID = {
  // Same — fill in from Play Console / App Store Connect.
  android: undefined as string | undefined,
  ios: undefined as string | undefined,
};

/**
 * Placeholder adapter. Returns false from init(), no-ops everything
 * else. This keeps the game runnable on Capacitor while we wait to
 * wire up a real plugin — calls to submitScore / unlockAchievement
 * silently drop, which is exactly what we want (the localStorage /
 * Preferences mirror is still running).
 */
export const capacitorGameServicesAdapter: GameServicesAdapter = {
  async init(): Promise<boolean> {
    // TODO: replace with something like
    //   const { GameServices } = await import("<plugin-name>");
    //   await GameServices.signIn();
    //   return true;
    return false;
  },

  submitScore(_score: number): void {
    // TODO: plugin.submitScore({ leaderboardId, score });
    void _score;
  },

  unlockAchievement(id: string): void {
    // TODO: translate + call plugin.unlock({ achievementId });
    void id;
    void PLATFORM_ACHIEVEMENT_IDS;
  },

  async showAchievements(): Promise<boolean> {
    // TODO: await plugin.showAchievements(); return true;
    return false;
  },

  async showLeaderboard(): Promise<boolean> {
    // TODO: await plugin.showLeaderboard({ leaderboardId });
    void DEFAULT_LEADERBOARD_ID;
    return false;
  },
};
