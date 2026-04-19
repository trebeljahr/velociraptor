# Third-party notices

The packaged Raptor Runner desktop application bundles the following
third-party components. Each remains subject to its own license; this
file aggregates the attributions required for redistribution.

## Runtime dependencies (shipped in the binary)

### Electron

- License: MIT
- Homepage: https://www.electronjs.org/
- Source: https://github.com/electron/electron

The bundled Electron runtime includes Chromium (BSD-style) and Node.js
(MIT). Upstream attribution files for those components are shipped
inside the Electron distribution under `LICENSES.chromium.html` and
similar.

### steamworks.js

- License: MIT
- Homepage: https://github.com/ceifa/steamworks.js

Wraps the Steamworks SDK. Only loaded when a valid Steam App ID is
configured; not initialised in itch.io / DRM-free builds.

### Valve Steamworks SDK (loaded at runtime by steamworks.js, Steam builds only)

- License: Steamworks SDK Access Agreement
- https://partner.steamgames.com/doc/sdk/uploading/distributing_opensource

Only applicable to the Steam release channel. Not present in the
itch.io distribution.

## Build-time dependencies (not shipped in the binary)

### Vite, TypeScript, Tailwind CSS, vite-plugin-pwa

All MIT-licensed; used only at build time to produce the `dist/` bundle.
See `package.json` for the full devDependency list.

## Game assets

All original pixel-art sprites, audio, and in-game typography are
© 2026 Rico Trebeljahr. See [LICENSE](LICENSE) for redistribution terms.

### Anonymous Pro font

- License: SIL Open Font License 1.1
- Author: Mark Simonson
- Homepage: https://www.marksimonson.com/fonts/view/anonymous-pro

Self-hosted WOFF2 files under `public/assets/fonts/`. The SIL OFL
permits bundling and distribution in both open-source and commercial
products without a reserved font name clause.

---

To regenerate a complete dependency-tree license list for a build, run:

    npx license-checker --production --summary
