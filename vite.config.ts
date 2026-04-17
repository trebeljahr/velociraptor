import { defineConfig } from "vite";
import { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Build target selector. `VITE_TARGET=capacitor npm run build` produces
// the native-mobile bundle: the PWA service worker is skipped (Workbox's
// navigateFallback conflicts with the capacitor:// scheme) and only the
// main HTML entry is emitted (about/imprint become in-app overlays on
// mobile, not separate navigable pages).
const TARGET = process.env.VITE_TARGET ?? "web";
const IS_CAPACITOR = TARGET === "capacitor";

export default defineConfig({
  // Capacitor serves assets from a WebView-local scheme, so relative paths
  // are required. On the web we keep absolute "/" so the service worker
  // and the hosted site continue to work unchanged.
  base: IS_CAPACITOR ? "./" : "/",
  define: {
    // Compile-time flag so gameplay code can branch on mobile without
    // pulling in any Capacitor symbols at import time.
    __IS_CAPACITOR__: JSON.stringify(IS_CAPACITOR),
  },
  plugins: [
    tailwindcss(),
    // The PWA service worker is desktop/web-only. Skipping it on
    // Capacitor avoids a Workbox navigateFallback vs. capacitor://
    // scheme conflict that otherwise serves a stale /index.html.
    ...(IS_CAPACITOR
      ? []
      : [VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Raptor Runner",
        short_name: "Raptor",
        description:
          "A pixel-art homage to the Chrome 'No Internet' dinosaur game, with a full day/night cycle and a starry sky.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "landscape",
        background_color: "#50b4cd",
        theme_color: "#50b4cd",
        categories: ["games", "entertainment"],
        icons: [
          {
            src: "assets/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "assets/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "assets/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "assets/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "assets/apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webmanifest,mp3}",
        ],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/about\.html$/, /^\/imprint\.html$/],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Audio files and large images — allow larger precache entries
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    })]),
  ],
  build: {
    rollupOptions: {
      // On mobile we only ship the main entry — about/imprint become
      // in-app overlays. On the web we keep them as separate pages so
      // the existing navigation and SEO remain unchanged.
      input: IS_CAPACITOR
        ? {
            main: resolve(__dirname, "index.html"),
          }
        : {
            main: resolve(__dirname, "index.html"),
            about: resolve(__dirname, "about.html"),
            imprint: resolve(__dirname, "imprint.html"),
          },
    },
  },
  worker: {
    format: "es",
  },
});
