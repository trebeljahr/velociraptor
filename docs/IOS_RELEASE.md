# iOS release builds

**Prerequisite**: active Apple Developer Program enrollment ($99/year). Until
then, you can build-and-run on the simulator via `npm run dev:ios`, but
cannot produce a signed IPA for App Store Connect. This doc assumes the
LLC has enrolled.

## One-time setup

### 1. Enroll the LLC in Apple Developer Program

- [developer.apple.com/programs](https://developer.apple.com/programs/)
- Organization enrollment needs your D-U-N-S number (free, request from
  Dun & Bradstreet) — takes 1–2 weeks for the D-U-N-S + another few
  days for Apple's review.

### 2. Register the bundle ID

- [App Store Connect](https://appstoreconnect.apple.com) →
  Certificates, Identifiers & Profiles → Identifiers → New.
- Use `com.ricoslabs.raptorrunner` (must match
  `ios/App/App.xcodeproj/project.pbxproj`'s
  `PRODUCT_BUNDLE_IDENTIFIER`).
- Capabilities: Game Center (if you enable it later — see
  `docs/GAME_SERVICES.md`).

### 3. Xcode: automatic signing

```bash
npm run cap:open:ios
```

In Xcode:
- Target "App" → Signing & Capabilities.
- Tick "Automatically manage signing".
- Team: select your LLC's team (appears after step 1).
- Xcode creates a provisioning profile + development certificate
  on the fly.

### 4. App Store Connect record

- [App Store Connect](https://appstoreconnect.apple.com) → My Apps → +
  → New App.
- Bundle ID: pick the one you just registered.
- SKU: anything unique, e.g. `raptor-runner-1`.
- Fill in the listing once (name, description, keywords, category
  "Games → Arcade", age rating 4+, screenshots) — reuse for all
  future builds.

## Producing a release build

### Option A — from the command line

```bash
npm run build:ios:release
# This just runs `cap sync` and opens Xcode; actual archive happens
# in Xcode because it's the only path that knows how to sign.
```

In Xcode:
- Product menu → Scheme → select "App".
- Product menu → Destination → "Any iOS Device (arm64)". (Required — you
  can't archive against a simulator.)
- Product menu → Archive.
- Window → Organizer → pick the new archive → Distribute App.
- App Store Connect → Upload.

### Option B — fully scripted

Possible with `xcodebuild archive` + `xcodebuild -exportArchive`, but
requires a committed `ExportOptions.plist` referencing your signing
identity. Defer until the app is regularly shipping; Xcode-driven is
fine for the first few releases.

## Privacy manifest

`ios/App/App/PrivacyInfo.xcprivacy` is required for App Store submissions
since May 2024. Declares what "required-reason APIs" you use and why.

Raptor Runner uses `UserDefaults` (via the Capacitor Preferences plugin)
to persist high scores. When you enroll, add the manifest:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSPrivacyTracking</key>
    <false/>
    <key>NSPrivacyTrackingDomains</key>
    <array/>
    <key>NSPrivacyCollectedDataTypes</key>
    <array/>
    <key>NSPrivacyAccessedAPITypes</key>
    <array>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>CA92.1</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
```

`CA92.1` is Apple's approved reason code for "storing user preferences
within the app itself". Add the file inside Xcode via File → New File →
App Privacy. Xcode links it to the target automatically.

## Versioning

Before every release, bump **both** in the Xcode project settings
(General tab):

- `Version` (aka `CFBundleShortVersionString`): user-facing, e.g. `1.1`
- `Build` (aka `CFBundleVersion`): strictly-increasing integer, e.g. `2`

Apple rejects uploads with a Build number that's less than or equal to
the previous build for the same Version.

## TestFlight

Every AppStoreConnect upload goes to TestFlight first. Adding internal
testers (up to 100 Apple IDs) is instant; external testers (up to 10,000)
need a short Apple review (usually same-day).

Use TestFlight for the LLC team + a handful of trusted users before
promoting to production. Promotion is a one-click action from App Store
Connect once the review passes.

## Common rejection reasons

- **2.5.6 (web-wrapped)**: the app must feel like a native app, not a
  bookmark. Our hiding of `.fullscreen-btn`, safe-area inset handling,
  and native splash all address this. Keep watching for anything that
  reads as "this is clearly a website".
- **Missing privacy manifest**: fixed above.
- **Age rating mismatch**: a game with no objectionable content is 4+.
  Don't overshoot.
- **Broken links in the listing**: if you paste the website imprint URL
  as the Privacy Policy, make sure it actually loads and contains
  privacy language.
