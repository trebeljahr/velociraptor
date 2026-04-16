# Phase 1: Vite + TypeScript + Tailwind + PWA migration notes

## Summary

Raptor Runner is now a Vite + TypeScript project with 21 typed modules, Tailwind CSS available, and a vite-plugin-pwa-generated service worker. The original 5,413-line `game.js` monolith has been split into a modular `src/` tree with clear dependency boundaries and callback-based decoupling for cross-module concerns.

**main.ts**: 5,413 → 1,850 lines (**66% extracted**).

## Module inventory

| Module | Lines | Role |
|---|---|---|
| `src/constants.ts` | 205 | Physics, rendering, localStorage keys, raptor sprite metadata, SKY_COLORS palette |
| `src/persistence.ts` | 176 | All localStorage load/save wrappers (high score, career runs, achievements, day cycles, rare events, bool flags) |
| `src/helpers.ts` | 128 | Pure math (lerp, clamp, randRange) + collision geometry (polygonsOverlap, pointInPolygon, shrinkPolygon) |
| `src/achievements.ts` | 245 | AchievementDefinition interface, full 20-entry catalog, ACHIEVEMENTS_BY_ID lookup |
| `src/cactusVariants.ts` | 176 | CactusVariant interface, 8-entry catalog with collision polygons |
| `src/images.ts` | 39 | IMAGE_SRCS (key → path) + mutable IMAGES dict populated at init |
| `src/audio.ts` | 350 | Audio singleton: music + rain `<audio>` elements, Web Audio jump/thunder buffers, per-channel mute |
| `src/state.ts` | 189 | GameState type + flat mutable singleton (~50 fields) |
| `src/canvas.ts` | 74 | Typed `contexts` object (main, sky, fg, death canvases) + `initCanvas()` |
| `src/entities/raptor.ts` | 359 | Player raptor: sprite animation, physics, jump buffering, collision polygon, 3 cosmetic overlays |
| `src/entities/cactus.ts` | 228 | Cactus (single obstacle) + Cactuses (spawn manager with score/cosmetic unlocks) |
| `src/entities/stars.ts` | 269 | Night-sky dome with tilted Milky Way band |
| `src/effects/particles.ts` | 426 | Confetti, dust, ash, shooting stars (baked trail sprite) |
| `src/effects/weather.ts` | 288 | Rain (spawn/update/draw), lightning (bolt generation, flash, thunder SFX) |
| `src/effects/rareEvents.ts` | 769 | Rare event catalog + spawn/update + all drawing (UFO abduction, Santa, tumbleweed, comet, meteor impact) |
| `src/render/sky.ts` | 249 | Night detection, tint factor, sun/moon arcs, sky gradient |
| `src/render/clouds.ts` | 158 | Cloud lifecycle: spawning, morphing (puffy → overcast), drawing |
| `src/render/world.ts` | 58 | Dune height function, procedural dune cacti |
| `src/render/scoreCard.ts` | 183 | Score card: worker bridge + main-thread fallback |
| `src/workers/scoreCard.worker.ts` | 153 | OffscreenCanvas PNG renderer |
| `src/main.ts` | 1,850 | **Orchestration layer** (see below) |

## What lives in main.ts (and why it stays)

The remaining ~1,850 lines are the game's **orchestration layer** — the code whose job is to call into every other module in the right order:

- **Game loop** (`update`, `render`, `loop`): ~570 lines. Reads state, calls entity/effect/render updates in dependency order, composites the four canvas layers, handles the game-over fade and death snapshot.
- **GameAPI** (`window.Game`): ~430 lines. The public surface that index.html's UI shell calls into — start/pause/resume, mute toggles, cosmetic toggles, achievement menu, fullscreen, resize, score card share, install prompt.
- **Game management** (`unlockAchievement`, `resetGame`, `initRunState`, `commitRunScore`, `onResize`): ~155 lines. The state-machine transitions that read/write state and call into persistence + entity reset.
- **Input handlers** (`onPointerDown`, `onKeyDown`): ~55 lines.
- **Init bootstrap** (`preloadImages`, `init`, DOMContentLoaded): ~160 lines. Image preloader, canvas + audio init, callback wiring, entity construction, rAF start.

Extracting these further would create circular dependencies (the game loop calls every module) or require callback indirection with no readability benefit. The orchestration layer IS the main module's responsibility.

## Cross-module coupling patterns

Every cross-module dependency is resolved by one of three patterns:

1. **Direct import**: leaf modules (constants, helpers, persistence) are imported by everything that needs them.
2. **Singleton import**: `state`, `audio`, `IMAGES`, `contexts` are mutable singletons imported by reference. Populated during init, read/written freely thereafter.
3. **Callback setter**: modules that need to fire a function owned by another module (e.g. `unlockAchievement` in main.ts) register a callback at init time via a setter (`setParticlesAchievementHandler`, `setRareEventsAchievementHandler`, `audio.setUnmuteDuringRunHandler`, `setDuneHeightProvider`). This keeps the module graph acyclic.

## Infrastructure

- **Vite 5** with multi-page input (index, about, imprint), ES-module workers.
- **TypeScript 5** with `strict: false` for the pragmatic `@ts-nocheck` port. Individual modules that were written from scratch (constants, persistence, helpers, achievements, cactusVariants, images, state, canvas, entities/raptor, entities/cactus, entities/stars) have proper types and can be tightened to `strict: true` independently.
- **Tailwind 4** via `@tailwindcss/vite`. Available for new UI work; existing CSS stays inline in index.html.
- **vite-plugin-pwa** in `generateSW` mode. Manifest generated from config. `skipWaiting` + `clientsClaim` for clean cache invalidation.
- **GitHub Actions** deploy workflow at `.github/workflows/deploy.yml`. Needs one manual setting flip in repo UI (Pages source → GitHub Actions).

## localStorage compatibility

Every `raptor-runner:*` key reads and writes with the same name and serialization format as the original code. A returning player's high score, achievements, career runs, and mute preferences are preserved.

## Dev loop

```bash
npm run dev         # Vite dev server, HMR, SW disabled
npm run build       # tsc --noEmit && vite build → dist/
npm run preview     # serve built dist/
npm run typecheck   # tsc --noEmit
```

## Follow-up work (not done in Phase 1)

- **Type tightening**: flip `strict: true` in tsconfig, remove `@ts-nocheck` from main.ts and the modules that still have it (sky.ts, clouds.ts, world.ts, weather.ts, rareEvents.ts, scoreCard.ts). Add proper types to the `any[]` particle arrays in GameState.
- **Tailwind CSS migration**: port the ~1,600 lines of inlined CSS in index.html to Tailwind classes. Start with the start-screen, HUD, and game-over overlay.
- **React for UI chrome** (Phase 2): if the DOM-side menu/overlay code gets complex enough, introduce React for just the UI layer while keeping the canvas game loop in vanilla TS.
- **Electron + Steam** (Phase 3): wrap `dist/` in an Electron shell, bridge `unlockAchievement` to the Steamworks SDK.
