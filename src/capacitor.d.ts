/*
 * Raptor Runner — Capacitor build-mode types.
 *
 * `__IS_CAPACITOR__` is replaced at build time by a Vite `define` (see
 * vite.config.ts). Consumers reference it as a normal boolean; the
 * branch gets dead-code-eliminated at minification time on the other
 * target, so Capacitor imports never reach the web bundle and vice
 * versa.
 *
 * Deliberately a `const` so TS narrows branches based on the literal
 * value at each call site.
 */

declare const __IS_CAPACITOR__: boolean;
