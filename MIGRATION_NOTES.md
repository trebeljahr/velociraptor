# Phase 1: Vite + TypeScript + Tailwind + PWA migration notes

Status snapshot — updated as work lands.

## What shipped in this phase

### Infrastructure (Phase 1a)

- `package.json` with Vite 5, TypeScript 5, Tailwind 4 via `@tailwindcss/vite`, `vite-plugin-pwa` 0.19, `@types/node`.
- `tsconfig.json` — ES2022, `moduleResolution: bundler`, DOM + WebWorker libs. Currently `strict: false` so the pragmatic `// @ts-nocheck` port in `src/main.ts` compiles; tightening happens incrementally as modules move out and get proper types.
- `vite.config.ts` — multi-page entry (`index.html`, `about.html`, `imprint.html`), VitePWA plugin generating the service worker + manifest from config, Tailwind plugin, ES-module workers.
- `.gitignore` for `node_modules/`, `dist/`, `dev-dist/`, `.vite/`.
- `public/` — every static asset lives here and is served as-is with stable paths:
  - `public/assets/` (all 27 images + audio, moved from repo-root `assets/`)
  - `public/CNAME` (custom domain `raptor.trebeljahr.com` — preserved in the build output)
  - `public/favicon.ico`
- `src/main.ts` — the old `game.js`, pragmatic port: IIFE unwrapped, `@ts-nocheck` at the top, Vite `?worker` import for the score-card worker, CSS import.
- `src/workers/scoreCard.worker.ts` — old `score-card-worker.js`, with `/// <reference lib="webworker" />` and `@ts-nocheck`.
- `src/styles/base.css` — imports `tailwindcss` so Tailwind classes are available for any new code. The existing ~1,600 lines of inlined CSS in `index.html`'s `<style>` block stayed untouched for now.
- `index.html` — script tag now `<script type="module" src="/src/main.ts">`. The manual `<link rel="manifest">` and the inline service-worker registration script are gone (VitePWA injects both).
- Legacy `game.js`, `sw.js`, `manifest.webmanifest`, and `score-card-worker.js` are deleted.
- `.claude/launch.json` updated to run `npm run dev` on port 5173.

**Verified**: `npm run build` succeeds (40 precache entries, ~9.2 MiB, service worker generated), `npm run dev` starts on port 5173, the game renders on load and runs correctly after clicking Start Game. No console errors. Dev loop: edit files → HMR reloads the page.

### Module split (Phase 1b, in progress)

Seven modules extracted from `main.ts` so far, each verified with a full build + dev-server runtime check before moving to the next. Every module is strict TypeScript (typed interfaces, no `any` in the exports).

| Module | Lines | Contents |
|---|---|---|
| [src/constants.ts](src/constants.ts) | 205 | Physics/rendering/weather/particle constants, all 17 localStorage keys, raptor sprite metadata (native dimensions, frame tables, collision inset), per-frame `RAPTOR_CROWN` + `RAPTOR_SNOUT` anchor arrays, `SKY_COLORS` day/night palette, `NIGHT_COLOR`. |
| [src/persistence.ts](src/persistence.ts) | 176 | `loadHighScore`/`saveHighScore`, `loadCareerRuns`/`saveCareerRuns`, `loadUnlockedAchievements`/`saveUnlockedAchievements`, `loadTotalJumps`/`saveTotalJumps`, `loadTotalDayCycles`/`saveTotalDayCycles`, `loadRareEventsSeen`/`saveRareEventsSeen`, generic `loadBoolFlag`/`saveBoolFlag`. Every key read/write is funneled through this module. |
| [src/helpers.ts](src/helpers.ts) | 128 | Pure math + color helpers (`lerp`, `lerpColor`, `rgb`, `rgba`, `randRange`, `clamp`) and collision geometry (`polygonsOverlap`, `pointInPolygon`, `segmentsIntersect`, `cross`, `shrinkPolygon`). Typed `Point2D` and `Polygon`. Zero state dependencies. |
| [src/achievements.ts](src/achievements.ts) | 245 | `AchievementDefinition` interface, the full `ACHIEVEMENTS` catalog (20 entries including secrets), and the `ACHIEVEMENTS_BY_ID` lookup map. `unlockAchievement()` itself still lives in main.ts because it touches `state` and the `GameAPI` callback registry. |
| [src/cactusVariants.ts](src/cactusVariants.ts) | 176 | `CactusVariant` interface and the 8-entry `CACTUS_VARIANTS` catalog with sprite dimensions, height scale, and normalized collision polygons. |
| [src/images.ts](src/images.ts) | 39 | `IMAGE_SRCS` (stable key → asset path mapping, extended at module-load time with all 8 cactus variants) and the mutable `IMAGES` singleton populated during `init()`. |
| [src/audio.ts](src/audio.ts) | 350 | The full audio singleton: music `<audio>` element, rain `<audio>` element, Web Audio context with pre-decoded jump + thunder buffers, per-channel mute state (global / music / jump / rain), `init()` / `setMuted` / `playJump` / `playThunder` / `startRain` / `stopRain`. The one coupling to state (Sound of Silence achievement invalidation when the player un-mutes mid-run) is now a callback that main.ts registers during init — audio.ts has no state import. |

**main.ts size**: 5,413 → 4,481 lines (~930 lines / 17% extracted).

**Build stats**: 17 modules transformed, 68 KB main bundle (22 KB gzipped), ~40 precache entries in the generated service worker.

### vite-plugin-pwa config preserved

- `registerType: 'autoUpdate'` with `skipWaiting: true` + `clientsClaim: true` + `cleanupOutdatedCaches: true` so the new generated service worker replaces the old hand-rolled `raptor-runner-v4` cache on first post-deploy visit for existing players.
- `workbox.globPatterns` covers every output type (`js`, `css`, `html`, `ico`, `png`, `svg`, `webmanifest`, `mp3`).
- `maximumFileSizeToCacheInBytes: 8 * 1024 * 1024` so the 4.7 MB `music2.mp3` fits in the precache.
- `navigateFallback: '/index.html'` preserves the old SW's offline navigation behavior.
- Manifest generated from config (not the deleted `manifest.webmanifest`): name, short name, description, theme color, background color, icons (all 5 entries from the old manifest), `start_url: '/'`, `scope: '/'`, `display: standalone`, landscape orientation, category tags.

### localStorage compatibility

Every existing `raptor-runner:*` key is read and written with the exact same key name and serialization format as the old code. A returning player lands on the new build and sees their high score, career runs, achievements, and mute preferences intact. The keys are now defined once in [src/constants.ts](src/constants.ts) and only consumed through [src/persistence.ts](src/persistence.ts).

## What's still in main.ts (deferred to follow-up work)

The bulk of the game loop and rendering code hasn't been split yet. The order I plan to tackle it in (matching the original plan's dependency graph):

1. **`src/state.ts`** — the monolithic `state` object (~50 fields). Blocker for almost everything downstream because entities, effects, render, physics, and gameplay all read/write it. Flat singleton matching the current shape to keep the port mechanical.
2. **`src/canvas.ts`** — `ctx`, `skyCtx`, `fgCtx`, `deathCtx` as a mutable `contexts` export object plus an `initCanvas()` setter.
3. **`src/entities/raptor.ts`**, **`cactus.ts`**, **`stars.ts`** — the entity classes.
4. **`src/effects/particles.ts`**, **`weather.ts`**, **`rareEvents.ts`**.
5. **`src/render/sky.ts`**, **`world.ts`**, **`scoreCard.ts`**.
6. **`src/physics.ts`**, **`src/gameplay.ts`** — collision checks, jump handling, update loop orchestration, game state machine.
7. **`src/api.ts`** — the `window.Game` public API and its callback registries (`_gameOverCbs`, `_achievementCbs`). Once this lands, `unlockAchievement()` migrates fully into [src/achievements.ts](src/achievements.ts).
8. **Type tightening** — remove `// @ts-nocheck` from main.ts, flip `strict: true` in tsconfig, add proper types to the final state machine.

These are all well-behaved mechanical ports like the seven already done — each verifiable with a build + dev-server reload, each one removing ~200-500 lines from main.ts. The risk is low-level (subtle behavioral regression if a read/write is re-ordered during the split), not architectural.

### Tailwind CSS migration — deferred

Tailwind is installed and available. The `start-screen`, HUD, game-over overlay migration from the ~1,600 lines of inlined CSS hasn't happened yet. Doing it safely requires the DOM markup to be in one place where class swaps are reviewable, which is easier once the state machine code is out of main.ts. Planned as a dedicated pass after the module split stabilises.

### GitHub Actions deploy workflow — pending

`.github/workflows/deploy.yml` building `dist/` and publishing to Pages via `actions/deploy-pages@v4`. One-click manual step required on the user side after the first push: flip the Pages source from "Deploy from a branch" to "GitHub Actions" in the repo settings.

## Dev loop

```bash
npm run dev         # Vite dev server on http://localhost:5173, HMR, SW disabled
npm run build       # tsc --noEmit && vite build → dist/
npm run preview     # serve the built dist/ on a local port
npm run typecheck   # tsc --noEmit
```

Multi-page routes work at `/`, `/about.html`, and `/imprint.html`.

## Rollback

`git checkout main -- .` reverts the worktree to the pre-migration state. `node_modules/` and `dist/` are gitignored so no cleanup of build artifacts is needed. The original `game.js`, `sw.js`, `manifest.webmanifest`, `score-card-worker.js`, and flat `assets/` directory come back intact from the commit that preceded this work.
