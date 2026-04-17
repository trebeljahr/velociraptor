import type { CapacitorConfig } from "@capacitor/cli";

/*
 * Raptor Runner — Capacitor (iOS + Android) configuration.
 *
 * Architecture:
 *   • The mobile build is produced by `npm run build:mobile`, which sets
 *     VITE_TARGET=capacitor. That build disables the PWA service worker
 *     (Workbox + capacitor:// scheme conflict) and strips the Electron /
 *     Steam bridge imports. The resulting `dist/` is what Capacitor copies
 *     into the native projects via `npx cap sync`.
 *   • Bundle id is `com.ricoslabs.raptorrunner`. No hyphens — Android
 *     package names (Java naming rules) don't allow them. This differs
 *     from the Electron appId (`com.trebeljahr.raptor-runner`) on purpose;
 *     the mobile app ships under the Rico's Labs LLC.
 */
const config: CapacitorConfig = {
  appId: "com.ricoslabs.raptorrunner",
  appName: "Raptor Runner",
  webDir: "dist",

  // Use https scheme on Android so localStorage/Preferences keys stay
  // stable across WebView upgrades and Android 11+ scoped-storage changes.
  android: {
    allowMixedContent: false,
  },

  // Match the <meta theme-color> and PWA manifest background so the
  // launch transition from splash → canvas doesn't flash a different hue.
  backgroundColor: "#50b4cd",

  // Live-reload during development. When CAP_DEV_URL is set at
  // `cap sync` time (by scripts/android-dev.sh / scripts/ios-dev.sh),
  // the WebView loads from the Vite dev server on your LAN instead
  // of the bundled dist/ folder. Edits to src/ hot-reload in place
  // — no APK rebuild per change.
  //
  // On production builds (CAP_DEV_URL unset), this block is omitted
  // entirely and the WebView loads bundled assets as normal.
  //
  // cleartext: true because Vite serves over plain HTTP. This only
  // applies when server.url is set; the production build blocks
  // cleartext by default.
  ...(process.env.CAP_DEV_URL
    ? {
        server: {
          url: process.env.CAP_DEV_URL,
          cleartext: true,
        },
      }
    : {}),

  plugins: {
    SplashScreen: {
      // Hold the splash until Game.onReady() fires, then call
      // SplashScreen.hide() from mobileBridge. Otherwise the player sees
      // white flash → splash → white flash → game.
      launchShowDuration: 3000,
      launchAutoHide: false,
      backgroundColor: "#50b4cd",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
