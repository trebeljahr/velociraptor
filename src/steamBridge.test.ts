import { afterEach, describe, expect, it, vi } from "vitest";
import { pushAchievementToSteam, reconcileWithSteam, toSteamApiName } from "./steamBridge";

/*
 * The Steam bridge is a renderer-side wrapper around window.electronAPI.
 * In the browser build window.electronAPI is undefined and every
 * function must be a clean no-op. Under Electron it fires IPC calls.
 *
 * happy-dom provides `window`. We stub window.electronAPI in the
 * tests that exercise the Electron path and clean it up after.
 */

describe("toSteamApiName", () => {
  it("adds ACH_ prefix, uppercases, and replaces dashes with underscores", () => {
    expect(toSteamApiName("first-run")).toBe("ACH_FIRST_RUN");
    expect(toSteamApiName("score-25")).toBe("ACH_SCORE_25");
    expect(toSteamApiName("sound-of-silence")).toBe("ACH_SOUND_OF_SILENCE");
  });
  it("handles already-uppercase ids without double-prefixing", () => {
    // Game ids are kebab-case lowercase in the catalog, but defensively
    // we accept any string — just uppercase and underscorify.
    expect(toSteamApiName("FOO")).toBe("ACH_FOO");
  });
  it("handles numeric ids", () => {
    expect(toSteamApiName("25")).toBe("ACH_25");
  });
  it("handles empty string (degenerate, shouldn't happen in practice)", () => {
    expect(toSteamApiName("")).toBe("ACH_");
  });
  it("handles a single-word id", () => {
    expect(toSteamApiName("rainbow")).toBe("ACH_RAINBOW");
  });
  it("handles consecutive dashes", () => {
    expect(toSteamApiName("a--b")).toBe("ACH_A__B");
  });
  it("is idempotent when called twice? (it's not — documents the behavior)", () => {
    // Passing an already-converted name through again double-prefixes.
    // Consumers must call this only on raw game ids.
    expect(toSteamApiName("ACH_FIRST_RUN")).toBe("ACH_ACH_FIRST_RUN");
  });
});

describe("pushAchievementToSteam", () => {
  afterEach(() => {
    // Clean up any electronAPI we stubbed.
    delete window.electronAPI;
    vi.restoreAllMocks();
  });

  it("is a silent no-op when window.electronAPI is undefined (browser build)", () => {
    delete window.electronAPI;
    expect(() => pushAchievementToSteam("first-run")).not.toThrow();
  });

  it("calls unlockSteamAchievement with the mapped API name", () => {
    const unlock = vi.fn().mockResolvedValue(true);
    window.electronAPI = {
      isDesktop: true,
      isSteam: vi.fn(),
      unlockSteamAchievement: unlock,
      getSteamAchievementStates: vi.fn(),
      quit: vi.fn(),
      setFullscreen: vi.fn(),
      isFullscreen: vi.fn(),
      openSteamOverlay: vi.fn(),
      openSteamOverlayUrl: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    pushAchievementToSteam("first-run");
    expect(unlock).toHaveBeenCalledWith("ACH_FIRST_RUN");
  });

  it("swallows rejection from the IPC call (fire-and-forget)", async () => {
    const unlock = vi.fn().mockRejectedValue(new Error("steam down"));
    window.electronAPI = {
      isDesktop: true,
      unlockSteamAchievement: unlock,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    // Should not throw synchronously.
    expect(() => pushAchievementToSteam("any-id")).not.toThrow();
    // Let the microtask for .catch() run.
    await Promise.resolve();
    await Promise.resolve();
    // No assertion on the rejection — just verifying no unhandled-promise
    // crash. vi.restoreAllMocks in afterEach clears any console.error
    // mocks if applied.
  });
});

describe("reconcileWithSteam", () => {
  afterEach(() => {
    delete window.electronAPI;
    vi.restoreAllMocks();
  });

  it("is a silent no-op in the browser build", async () => {
    delete window.electronAPI;
    const onRemote = vi.fn();
    await expect(reconcileWithSteam({}, onRemote)).resolves.toBeUndefined();
    expect(onRemote).not.toHaveBeenCalled();
  });

  it("returns early when isSteam() resolves false", async () => {
    const getStates = vi.fn().mockResolvedValue({});
    window.electronAPI = {
      isDesktop: true,
      isSteam: vi.fn().mockResolvedValue(false),
      getSteamAchievementStates: getStates,
      unlockSteamAchievement: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await reconcileWithSteam({ "first-run": true }, vi.fn());
    // If Steam isn't available we should never have asked for states.
    expect(getStates).not.toHaveBeenCalled();
  });

  it("pushes local-only unlocks to Steam", async () => {
    // Local has "first-run" unlocked; Steam returns all false.
    // Expect an unlockSteamAchievement call for ACH_FIRST_RUN.
    const unlock = vi.fn().mockResolvedValue(true);
    const getStates = vi.fn().mockImplementation((apiNames: string[]) => {
      const out: Record<string, boolean> = {};
      for (const n of apiNames) out[n] = false;
      return Promise.resolve(out);
    });
    window.electronAPI = {
      isDesktop: true,
      isSteam: vi.fn().mockResolvedValue(true),
      getSteamAchievementStates: getStates,
      unlockSteamAchievement: unlock,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await reconcileWithSteam({ "first-run": true }, vi.fn());
    expect(unlock).toHaveBeenCalledWith("ACH_FIRST_RUN");
  });

  it("calls onRemoteDiscovery for Steam-only unlocks (local-behind)", async () => {
    // Steam says first-run is unlocked; local doesn't know.
    // onRemoteDiscovery("first-run") should fire; no unlock pushed back.
    const unlock = vi.fn().mockResolvedValue(true);
    const getStates = vi.fn().mockImplementation((apiNames: string[]) => {
      const out: Record<string, boolean> = {};
      for (const n of apiNames) {
        out[n] = n === "ACH_FIRST_RUN";
      }
      return Promise.resolve(out);
    });
    window.electronAPI = {
      isDesktop: true,
      isSteam: vi.fn().mockResolvedValue(true),
      getSteamAchievementStates: getStates,
      unlockSteamAchievement: unlock,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const onRemote = vi.fn();
    await reconcileWithSteam({}, onRemote);
    expect(onRemote).toHaveBeenCalledWith("first-run");
    expect(unlock).not.toHaveBeenCalled();
  });

  it("does nothing when local and Steam agree", async () => {
    const unlock = vi.fn().mockResolvedValue(true);
    // Both sides have everything unlocked — mark every apiName true.
    const getStates = vi.fn().mockImplementation((apiNames: string[]) => {
      const out: Record<string, boolean> = {};
      for (const n of apiNames) out[n] = true;
      return Promise.resolve(out);
    });
    window.electronAPI = {
      isDesktop: true,
      isSteam: vi.fn().mockResolvedValue(true),
      getSteamAchievementStates: getStates,
      unlockSteamAchievement: unlock,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const onRemote = vi.fn();
    // Supply a local set with every id unlocked — we need to know
    // what ids the bridge will request. It reads from the catalog.
    const { ACHIEVEMENTS } = await import("./achievements");
    const local: Record<string, boolean> = {};
    for (const a of ACHIEVEMENTS) local[a.id] = true;

    await reconcileWithSteam(local, onRemote);
    expect(onRemote).not.toHaveBeenCalled();
    expect(unlock).not.toHaveBeenCalled();
  });

  it("returns early if isSteam rejects", async () => {
    const getStates = vi.fn();
    window.electronAPI = {
      isDesktop: true,
      isSteam: vi.fn().mockRejectedValue(new Error("IPC broken")),
      getSteamAchievementStates: getStates,
      unlockSteamAchievement: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await reconcileWithSteam({}, vi.fn());
    expect(getStates).not.toHaveBeenCalled();
  });

  it("returns early if getSteamAchievementStates rejects", async () => {
    const unlock = vi.fn();
    const onRemote = vi.fn();
    window.electronAPI = {
      isDesktop: true,
      isSteam: vi.fn().mockResolvedValue(true),
      getSteamAchievementStates: vi.fn().mockRejectedValue(new Error("boom")),
      unlockSteamAchievement: unlock,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await reconcileWithSteam({ "first-run": true }, onRemote);
    expect(unlock).not.toHaveBeenCalled();
    expect(onRemote).not.toHaveBeenCalled();
  });
});
