/*
 * Ambient types for the Electron preload bridge.
 *
 * window.electronAPI is undefined in the browser (PWA) build. The
 * renderer-side wrapper in src/steamBridge.ts checks for presence
 * before every call, so the optional type here matches runtime.
 */

export {};

declare global {
  interface ElectronAPI {
    readonly isDesktop: true;
    isSteam(): Promise<boolean>;
    unlockSteamAchievement(apiName: string): Promise<boolean>;
    getSteamAchievementStates(
      apiNames: string[],
    ): Promise<Record<string, boolean>>;
    quit(): Promise<void>;
    setFullscreen(on: boolean): Promise<boolean>;
    isFullscreen(): Promise<boolean>;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
