# Game Center (iOS) + Play Games Services (Android)

The gameplay code is already wired up to report achievements and scores
to a platform service via [src/services/gameServices.ts](../src/services/gameServices.ts).
Until a specific Capacitor plugin is installed, the Capacitor adapter at
[src/mobile/gameServices.ts](../src/mobile/gameServices.ts) is a stub
that no-ops everything — but the integration points in gameplay code
don't need to change once you wire it up.

## What the game already does

- `unlockAchievement(id)` in main.ts calls
  [`reportAchievementToServices(id)`](../src/main.ts) after the existing
  Steam mirror. The service's own achievement unlock (if any) fires
  in parallel to the in-app toast.
- `commitRunScore()` at game-over calls
  [`reportScoreToServices(score)`](../src/main.ts) so the platform's
  default leaderboard sees every run's result.
- No gameplay code knows about Apple Game Center or Google Play Games
  Services specifically — the abstract bridge handles that.

## What you need before wiring up a plugin

### iOS Game Center
1. Active Apple Developer Program enrollment (blocked on LLC +
   D-U-N-S — see [docs/IOS_RELEASE.md](IOS_RELEASE.md)).
2. Enable "Game Center" capability on the App ID in App Store Connect.
3. Create leaderboards + achievements in the App Store Connect →
   Game Center tab. Each gets a reverse-DNS identifier, e.g.
   `com.ricoslabs.raptorrunner.achievement.first-run`.
4. In Xcode, the app target → Signing & Capabilities → + Capability →
   Game Center. Capacitor builds will pick this up automatically.

### Android Play Games Services v2
1. Google Play Console account ($25 one-time — can register under your
   personal name now, update to LLC later once it's live).
2. Play Console → Play Games Services → Link a Play Games Services
   project to your app. Creates a numeric project ID and an OAuth2
   client.
3. Create leaderboards + achievements in the Play Console. Each gets
   a Google-assigned id like `CgkI1Y_A9I4JEAIQAA`.
4. Download the `google-services.json` and drop it into `android/app/`.
   The existing `build.gradle` already has a try-catch that applies
   the Google Services plugin when that file exists — see
   [android/app/build.gradle:47-53](../android/app/build.gradle).

## Pick a Capacitor plugin

Community plugins for this space churn regularly. Evaluate the top
options when you're ready to wire up:

| Plugin | iOS (GC) | Android (PGS) | Maintained? |
|---|---|---|---|
| `capacitor-game-connect` | yes | yes | check npm last-published date |
| `@openforge/capacitor-game-services` | yes | yes | check for Capacitor 8 support |
| Custom Capacitor plugin | yes | yes | fully in your control, but ~1 day of Swift + Kotlin |

Criteria:

- **Capacitor 8 compatibility** (the plugin must declare
  `@capacitor/core` peer dep ≥ 8).
- **Both platforms in one plugin** (splitting iOS + Android across two
  plugins doubles the surface area).
- **Active maintenance** (last published ≤ 6 months).
- **Minimal API surface** — we only need sign-in, submit score,
  unlock achievement, show leaderboard, show achievements. Anything
  more is bloat.

## Wire up

Once you pick a plugin `foo-game-services`:

### 1. Install

```bash
npm install foo-game-services
npx cap sync
```

### 2. Fill in the adapter stub

Replace the `TODO` bodies in
[src/mobile/gameServices.ts](../src/mobile/gameServices.ts) with real
plugin calls. The shape will be something like:

```ts
import { GameServices } from "foo-game-services";

export const capacitorGameServicesAdapter: GameServicesAdapter = {
  async init() {
    try {
      await GameServices.signIn();
      return true;
    } catch {
      return false;
    }
  },
  submitScore(score) {
    const platform = Capacitor.getPlatform();
    const leaderboardId = DEFAULT_LEADERBOARD_ID[platform];
    if (!leaderboardId) return;
    GameServices.submitScore({ leaderboardId, score }).catch(() => {});
  },
  unlockAchievement(id) {
    const platform = Capacitor.getPlatform();
    const mapped = PLATFORM_ACHIEVEMENT_IDS[id]?.[platform];
    if (!mapped) return;
    GameServices.unlockAchievement({ achievementId: mapped }).catch(() => {});
  },
  async showAchievements() {
    try {
      await GameServices.showAchievements();
      return true;
    } catch {
      return false;
    }
  },
  async showLeaderboard() {
    // similar
  },
};
```

### 3. Populate the id tables

Fill in `PLATFORM_ACHIEVEMENT_IDS` and `DEFAULT_LEADERBOARD_ID` at the
top of the adapter file with the real ids from App Store Connect + Play
Console. Our game-side ids (the keys in
[src/achievements.ts](../src/achievements.ts)) remain the source of
truth — the table just translates to the platforms' formats.

### 4. Add native config

- **iOS**: In Xcode, check that Signing & Capabilities → Game Center is
  on. Add a brief description to Info.plist under `NSGameCenterLoggedInKey`
  if the plugin requires it.
- **Android**: Add `<meta-data>` entries to AndroidManifest.xml pointing
  at your Play Games Services app id. Most plugins generate this from
  strings.xml — follow the plugin's instructions.

### 5. Replace the in-app "Achievements" menu button's handler

Currently the Achievements menu item opens the in-app overlay. On
mobile we can additionally offer the native UI:

```ts
// in index.html menu handler
if (window.Game.hasNativeAchievements()) {
  await window.Game.showNativeAchievements();
} else {
  openAchievements(); // existing in-app overlay
}
```

Hook `hasNativeAchievements` and `showNativeAchievements` on GameAPI in
main.ts — they delegate to the service bridge.

## Testing

iOS:
- Sandbox Game Center accounts are created from Settings → Game Center
  → Sandbox Account on the dev device / simulator.
- Achievements only appear in Game Center after the app is submitted
  for review at least once (Apple's "first review unlock" quirk). For
  local dev, the plugin will often return success but the UI stays empty
  until approval.

Android:
- Play Games Services sign-in works immediately on any device with the
  Google Play Games Services app installed.
- Create internal testers in the Play Console → link their Google
  accounts → leaderboards + achievements show up for them right away.

## When NOT to bother

Game Center / Play Games Services adds ~2 MB to the iOS IPA and a
one-time sign-in prompt on first launch. For a paid game with no
social layer to lean on, some developers skip it entirely. Decide
based on whether achievement-hunting + leaderboard competition is
actually part of the experience you're selling, or if it's just a
"nice to have".

Our existing in-app achievements overlay ([src/achievements.ts](../src/achievements.ts))
+ shareable score card are a complete experience without either
service. Native services are an additive layer, not a prerequisite for
launch.
