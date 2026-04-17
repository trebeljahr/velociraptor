# Android release builds

This doc covers everything you need to produce a signed, Play Store-ready
Android App Bundle (AAB) of Raptor Runner.

## One-time setup

### 1. Generate a release keystore

The keystore is a private file containing the signing key for all Raptor
Runner releases. **Losing this file or its password means you can never
update the app on Play Store again** — Google requires every update to
be signed with the same key. Back up to a password manager immediately.

```bash
# Generated once, stored OUTSIDE the repo.
keytool -genkey -v \
  -keystore ~/keys/raptor-runner-release.keystore \
  -alias raptor-runner \
  -keyalg RSA -keysize 2048 -validity 10000
```

You'll be prompted for:

- A keystore password (save in password manager)
- A key password (can be the same as above)
- Certificate metadata: name, org, etc. (use your legal LLC name)

Enable Google Play App Signing when you first upload an AAB. That way
Google manages the distribution key itself, and the key above is only
the "upload key" — losing it is still painful but recoverable (Google
can re-issue).

### 2. Create `android/keystore.properties`

This file is gitignored. Copy the example and fill in real values:

```bash
cp android/keystore.properties.example android/keystore.properties
```

Edit the copy with the path to the keystore, the alias, and the two
passwords from step 1.

## Build

```bash
# Build a signed AAB for Play Store upload
npm run build:android:release
# → android/app/build/outputs/bundle/release/app-release.aab

# Or a signed APK for sideload / direct distribution
npm run build:android:apk
# → android/app/build/outputs/apk/release/app-release.apk
```

First build takes 2-5 minutes (R8 obfuscation + resource shrinking).
Subsequent builds are ~30-60 seconds thanks to Gradle's build cache.

If the keystore config is missing, the build falls through to debug
signing — useful for local smoke-testing, but Play Store will reject
the upload.

## Versioning

Before every release, bump **both** numbers in
[android/app/build.gradle](../android/app/build.gradle):

```gradle
versionCode 2       // must be strictly greater than the previous upload
versionName "1.1"   // the user-facing version string
```

`versionCode` is the integer Play Store uses to decide what's newer.
`versionName` is the string shown in the Play listing.

## Play Console upload

1. [Play Console](https://play.google.com/console) → your app → Production →
   Create new release → Upload the AAB.
2. Fill in release notes ("What's new in this version?" — 500 chars max).
3. Run through the content rating, target audience, data safety, and
   privacy policy forms on first upload only.
4. **New developer accounts (registered after Nov 2023) must run a
   14-day closed test with 20+ testers before promoting to production.**
   Account for this in your release schedule.

## What R8 does in release builds

`minifyEnabled true` + `shrinkResources true` in build.gradle trigger:

- **Minification**: dead code elimination, method inlining, variable
  renaming. Typical reduction: ~30% smaller APK.
- **Resource shrinking**: drops unreferenced strings, drawables, layouts.
- **Obfuscation**: renames classes/methods to single letters. Not a
  security measure — just a size optimization.

Capacitor's plugin bridge (`com.getcapacitor.*` and
`@CapacitorPlugin`-annotated classes) is kept via `proguard-rules.pro`.
If you add a native Android plugin in the future that's invoked from JS,
add a `-keep class com.its.package.** { *; }` rule there too.

## When to test release builds locally

Before uploading to Play for the first time, or any time after changing
[android/app/proguard-rules.pro](../android/app/proguard-rules.pro), do a
full release build and install it on a real device. R8 bugs don't show
up in debug builds.

```bash
npm run build:android:apk
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

If it crashes on launch with "ClassNotFoundException" or a JS-side
"Plugin Foo not implemented", R8 removed something it shouldn't have.
Check logcat, then add a matching `-keep` rule.
