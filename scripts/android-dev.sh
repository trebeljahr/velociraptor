#!/usr/bin/env bash
#
# Raptor Runner — one-command Android dev loop with hot reload.
#
# What this does, in order:
#   1. Source scripts/android-env.sh so JAVA_HOME / ANDROID_HOME
#      are set without touching your shell profile.
#   2. Boot the emulator in the background if one isn't already running.
#      Waits for adb to see it and for the Android boot to complete.
#   3. Start Vite on 0.0.0.0 so the emulator (which lives on a
#      different network) can reach it at your machine's LAN IP.
#   4. cap sync with CAP_DEV_URL set — capacitor.config.ts conditionally
#      injects `server.url` when that env var is present, which tells
#      the WebView to load from the dev server instead of the bundled
#      dist/ folder.
#   5. cap run android — installs the APK and launches it.
#
# Result: the emulator's WebView loads directly from Vite. Editing
# src/main.ts (or anything else) triggers HMR and the game reloads
# on the emulator in ~500ms. No APK rebuild between edits.
#
# Env overrides:
#   AVD=<name>       which AVD to boot (default: Pixel_9_Pro)
#   VITE_PORT=<n>    Vite port (default: 5173)
#   LAN_IP=<ip>      override auto-detected LAN IP
#
# On Ctrl+C: Vite stops, but the emulator keeps running so the next
# invocation of this script is instant. Use `adb emu kill` to shut it
# down manually.

set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/android-env.sh"

AVD_NAME="${AVD:-Medium_Phone_API_35}"
VITE_PORT="${VITE_PORT:-5173}"

# Host-reachability address for the WebView.
#
# The Android emulator runs inside a QEMU NAT that does NOT route to
# the Mac's real LAN IP. It reserves 10.0.2.2 as "host loopback" — any
# request to that IP hits 127.0.0.1 on the Mac. This is reliable and
# works offline, so we use it by default.
#
# If you want to test on a real Android phone over Wi-Fi instead, pass
# your LAN IP explicitly:
#     LAN_IP=192.168.0.81 npm run dev:android
# The phone has to be on the same Wi-Fi network as the Mac.
DEV_HOST="${LAN_IP:-10.0.2.2}"

VITE_PID=""

# Clean up child processes when the user hits Ctrl+C. Leaves the
# emulator/phone running on purpose — re-runs are instant.
#
# The tricky bit: Vite is launched via `npx vite` in a subshell, so
# $VITE_PID is the subshell / npx wrapper — not always the node
# process that actually holds the port. Killing the wrapper usually
# cascades, but if it doesn't (npm/npx sometimes detaches), the port
# stays held and the next run lands on 5174 instead. Belt-and-
# suspenders: TERM the tracked pid, then nuke whatever's holding the
# port regardless.
cleanup() {
  echo ""
  echo "🧹 Stopping Vite"
  if [ -n "$VITE_PID" ]; then
    # SIGTERM first (graceful), then SIGKILL anything still on the port
    kill -TERM "$VITE_PID" 2>/dev/null || true
  fi
  # Give the tree a beat to exit, then hard-kill anything still holding
  # our port. Works even when the original PID has forgotten to pass
  # signals to the real node process.
  sleep 0.3
  lsof -ti:"$VITE_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  wait 2>/dev/null || true
  echo "   (emulator/phone left running — next dev:android is instant)"
}
trap cleanup EXIT INT TERM

# ── 0. ADB sanity ──────────────────────────────────────────
# adb's design has a classic race: `adb start-server` is called by
# every adb invocation, and when several run concurrently (Capacitor's
# retry loop does this) they all try to bind port 5037 at once.
# Symptom: 'could not install *smartsocket* listener: Address already
# in use' in the adb log, and the CLI reports 'ADBs is unresponsive
# after 5000ms' 40+ times before giving up — even though one of the
# spawned daemons is actually connected to the emulator.
#
# Prevent the race by putting ONE healthy daemon in place before
# Capacitor can ever fire adb commands. The sequence is:
#   1. Kill every adb process hard (kill-server + pkill fallback).
#   2. Wait for port 5037 to free.
#   3. Start a single daemon and wait until it answers.
# Cost: ~1-2 seconds. Saves ~5 minutes of mystery hangs.
echo "🔧 Resetting adb server (prevents Capacitor retry-race)"
adb kill-server > /dev/null 2>&1 || true
pkill -9 -f 'adb fork-server' 2>/dev/null || true
pkill -9 -x adb 2>/dev/null || true

# Wait for port 5037 to actually close — kernel keeps it in TIME_WAIT
# for a moment after the daemon dies, and starting a new one during
# that window will fail with the same 'Address already in use'.
PORT_TIMEOUT=10
SECS=0
while lsof -ti:5037 > /dev/null 2>&1; do
  sleep 0.5
  SECS=$((SECS + 1))
  if [ $SECS -ge $((PORT_TIMEOUT * 2)) ]; then
    echo "❌ adb port 5037 still held after ${PORT_TIMEOUT}s. Try:"
    echo "   lsof -i :5037    # find the holder"
    exit 1
  fi
done

# Start fresh. `adb start-server` exits as soon as the daemon is
# ready to accept connections, so no poll loop needed after.
adb start-server > /dev/null 2>&1

# ── 0a. Port preflight ────────────────────────────────────
# A previous run may have leaked a Vite process that's still holding
# our port. Starting a new Vite on an occupied port makes it pick
# the next free one (5174, 5175, ...), but we've already told
# Capacitor about the original port — so the WebView would fail to
# connect. Kill whatever's holding it before we start.
if lsof -ti:"$VITE_PORT" > /dev/null 2>&1; then
  echo "🧹 Clearing stale process on port $VITE_PORT"
  lsof -ti:"$VITE_PORT" | xargs kill -9 2>/dev/null || true
  sleep 0.3
fi

# ── 1. Device selection (physical phone OR emulator) ────────
# adb `device` lines look like:
#   emulator-5554     device        (booted AVD)
#   R3CT7079ABC       device        (physical phone, serial from adbd)
#   R3CT7079ABC       unauthorized  (need to trust the Mac on the phone)
# If any device — physical or emulator — is already attached, we
# reuse it. Only boot an emulator if nothing is attached at all.
# This way `LAN_IP=... npm run dev:android` works against a plugged-in
# phone without fighting to boot an emulator the user doesn't want.
ATTACHED_DEVICES=$(adb devices | awk 'NR>1 && $2 == "device" { print $1 }')
if [ -n "$ATTACHED_DEVICES" ]; then
  echo "📱 Using attached device(s):"
  echo "$ATTACHED_DEVICES" | sed 's/^/   /'
  # Friendly warning about a common footgun
  if echo "$ATTACHED_DEVICES" | grep -qvE '^emulator-'; then
    if [ "$DEV_HOST" = "10.0.2.2" ]; then
      echo ""
      echo "⚠️  Physical device detected but DEV_HOST=10.0.2.2 (emulator-only)."
      echo "   Real phones can't reach 10.0.2.2 — that's an emulator NAT alias."
      echo "   Re-run with your Mac's LAN IP: LAN_IP=\$(ipconfig getifaddr en0) npm run dev:android"
      exit 1
    fi
  fi
elif adb devices | awk 'NR>1 && $2 == "unauthorized" { found=1 } END { exit !found }'; then
  echo "❌ Phone shows 'unauthorized' in adb devices."
  echo "   Check the phone screen: tap 'Allow' on the USB debugging prompt."
  exit 1
else
  echo "🤖 No device attached — booting emulator: $AVD_NAME"
  # Perf flags:
  #   -no-boot-anim     skip the bootanimation.zip playback (~2s faster)
  #   -memory 2048      cap guest RAM at 2 GB (enough for a Capacitor
  #                     WebView; some AVDs default to 4 GB which hurts
  #                     Mac battery without helping the game)
  #   -gpu host         render via the Mac's GPU. Hardware-accelerated
  #                     canvas draws at 60 FPS on Apple Silicon; the
  #                     default -gpu auto sometimes picks swiftshader
  #                     which is painfully slow for this game.
  #   -netdelay/speed   remove simulated cellular lag — we want Vite
  #                     HMR round-trips to be instant.
  nohup emulator -avd "$AVD_NAME" \
      -no-boot-anim \
      -memory 2048 \
      -gpu host \
      -netdelay none -netspeed full \
    > /tmp/raptor-runner-emulator.log 2>&1 &
  disown
  echo "   waiting for adb..."
  adb wait-for-device
  echo "   waiting for Android boot..."
  BOOT_TIMEOUT=120
  SECS=0
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    sleep 1
    SECS=$((SECS + 1))
    if [ $SECS -ge $BOOT_TIMEOUT ]; then
      echo "❌ Emulator didn't finish booting in ${BOOT_TIMEOUT}s."
      echo "   Log: /tmp/raptor-runner-emulator.log"
      exit 1
    fi
  done
  echo "✅ Emulator ready"
fi

# ── 1a. Force landscape (emulator only) ────────────────────
# The app locks orientation via @capacitor/screen-orientation once
# onReady fires, but the home screen and pre-onReady splash window
# default to portrait. On an emulator we can force-lock system UI to
# landscape-left so the whole experience is landscape from boot.
# Skip on physical phones — their owner controls rotation, and forcing
# user_rotation on a phone is rude + fights their OS preferences.
TARGET_DEVICE=$(adb devices | awk 'NR>1 && $2 == "device" { print $1; exit }')
if [ -n "$TARGET_DEVICE" ] && echo "$TARGET_DEVICE" | grep -qE '^emulator-'; then
  echo "🔄 Locking emulator to landscape"
  adb -s "$TARGET_DEVICE" shell settings put system accelerometer_rotation 0 >/dev/null 2>&1 || true
  # user_rotation=1 is 90° (landscape-left; home on the right).
  adb -s "$TARGET_DEVICE" shell settings put system user_rotation 1 >/dev/null 2>&1 || true
fi

# ── 2. Vite dev server ─────────────────────────────────────
CAP_DEV_URL="http://$DEV_HOST:$VITE_PORT"
echo "🔥 Starting Vite at $CAP_DEV_URL (host:port the WebView will hit)"
# VITE_TARGET=capacitor makes vite.config.ts set __IS_CAPACITOR__ to
# true in the transformed bundle. Without it, the live-reload build
# has the web-mode flag, so main.ts's `if (__IS_CAPACITOR__)` block
# stays dead — the mobile bridge never initializes, the Capacitor
# splash never hides, haptics and durable persistence are all off.
(cd "$REPO" && VITE_TARGET=capacitor npx vite --host 0.0.0.0 --port "$VITE_PORT") &
VITE_PID=$!

# Wait until Vite is actually answering before we tell the app to
# load from it. Otherwise the WebView shows a scary error page.
echo "   waiting for Vite to answer..."
READY_TIMEOUT=30
SECS=0
until curl -s -o /dev/null "http://localhost:$VITE_PORT"; do
  sleep 0.5
  SECS=$((SECS + 1))
  if [ $SECS -ge $((READY_TIMEOUT * 2)) ]; then
    echo "❌ Vite didn't start in ${READY_TIMEOUT}s."
    exit 1
  fi
done
echo "✅ Vite ready"

# ── 3. Fallback bundle ─────────────────────────────────────
# `cap sync` writes android/app/src/main/assets/capacitor.config.json.
# When server.url is set, it skips copying webDir — but the write still
# requires the assets/ dir to exist. A fresh checkout has no assets/,
# so we build once to populate dist/ and let sync create the tree.
# Second benefit: if the player ever loses the dev-server connection
# (Wi-Fi drops, Mac sleeps), the WebView falls back to the bundled
# assets instead of showing a connection error.
if [ ! -d "$REPO/android/app/src/main/assets" ] || [ ! -d "$REPO/dist" ]; then
  echo "📦 Building fallback bundle (first run)..."
  (cd "$REPO" && npm run build:mobile)
fi

# ── 4. Capacitor sync + deploy ─────────────────────────────
echo "📦 Syncing Capacitor config (server.url = $CAP_DEV_URL)"
export CAP_DEV_URL
(cd "$REPO" && npx cap sync android)

# Auto-pick the attached device so `cap run` doesn't stop to prompt.
# Accepts either an emulator-NNNN line or a physical-device serial.
TARGET_SERIAL=$(adb devices | awk 'NR>1 && $2 == "device" { print $1; exit }')
if [ -z "$TARGET_SERIAL" ]; then
  echo "❌ No device visible to adb — this should not happen after the boot wait above."
  exit 1
fi

echo "🚀 Installing + launching on $TARGET_SERIAL..."
(cd "$REPO" && npx cap run android --target "$TARGET_SERIAL")

# ── 4. Keep script alive ───────────────────────────────────
echo ""
echo "✨ Live-reload active."
echo "   Edit src/ and the emulator hot-reloads in ~500ms."
echo "   Ctrl+C to stop (emulator stays running)."
wait "$VITE_PID"
