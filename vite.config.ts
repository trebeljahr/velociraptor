import { defineConfig } from "vite";
import { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/",
  plugins: [
    tailwindcss(),
    VitePWA({
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
    }),
  ],
  build: {
    rollupOptions: {
      input: {
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
