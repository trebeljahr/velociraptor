/*
 * Raptor Runner — cross-platform haptic feedback.
 *
 * Three call sites in the game (jump, thunder, death) previously
 * called navigator.vibrate directly. That's fine on Android but a
 * no-op on iOS Safari / WKWebView — iPhones never felt the jump.
 *
 * This module picks the right backend at call time:
 *   - Capacitor (iOS + Android native shells) → @capacitor/haptics.
 *     Uses ImpactStyle / NotificationType which map onto the platform's
 *     native haptic engine (Taptic Engine on iOS, VibrationEffect on
 *     Android). Feels markedly better than a raw vibrate(30).
 *   - Web (Android Chrome, Firefox, etc.) → navigator.vibrate with
 *     the old millisecond patterns the game has always used.
 *   - Desktop browsers / Electron → no-op.
 *
 * Callers still gate on `!audio.muted` at the call site, so the
 * "Sound of Silence" achievement's "also means: no vibration" contract
 * stays intact.
 *
 * The Capacitor plugin is lazily imported on first native use and
 * the result is cached, so the rAF-hot jump path pays at most one
 * dynamic-import cost per session. If the import fails (plugin
 * missing on a custom build, say), the Android fallback silently
 * takes over where possible.
 */

type CapHaptics = {
  impact(opts: { style: unknown }): Promise<void>;
  notification(opts: { type: unknown }): Promise<void>;
  ImpactStyle: { Light: unknown; Medium: unknown; Heavy: unknown };
  NotificationType: { Success: unknown; Warning: unknown; Error: unknown };
} | null;

let _cap: CapHaptics = null;
let _capLoading: Promise<void> | null = null;

function ensureCapHaptics(): void {
  if (!__IS_CAPACITOR__) return;
  if (_cap || _capLoading) return;
  _capLoading = import("@capacitor/haptics")
    .then(({ Haptics, ImpactStyle, NotificationType }) => {
      _cap = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        impact: (opts) => Haptics.impact(opts as any),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        notification: (opts) => Haptics.notification(opts as any),
        ImpactStyle,
        NotificationType,
      };
    })
    .catch(() => {
      /* plugin missing — fall through to web vibrate */
    });
}

function webVibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

/** Light tap — called on every jump. Must be low-latency. */
export function hapticJump(): void {
  if (__IS_CAPACITOR__) {
    ensureCapHaptics();
    if (_cap) {
      _cap.impact({ style: _cap.ImpactStyle.Light }).catch(() => {});
      return;
    }
    // Fall through: on Android the web vibrate still works even
    // inside a Capacitor WebView, giving first-frame feedback while
    // the plugin is loading.
  }
  webVibrate(20);
}

/** Medium bump — called on lightning strike. */
export function hapticThunder(): void {
  if (__IS_CAPACITOR__) {
    ensureCapHaptics();
    if (_cap) {
      _cap.impact({ style: _cap.ImpactStyle.Medium }).catch(() => {});
      return;
    }
  }
  webVibrate(30);
}

/** Heavy jolt pattern — called on death. Uses the Error notification
 *  style on native because iOS renders it as a recognisable "fail"
 *  rhythm (bump-bump-pause-bump). */
export function hapticDeath(): void {
  if (__IS_CAPACITOR__) {
    ensureCapHaptics();
    if (_cap) {
      _cap.notification({ type: _cap.NotificationType.Error }).catch(() => {});
      return;
    }
  }
  webVibrate([50, 30, 80]);
}
