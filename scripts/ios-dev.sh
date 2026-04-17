#!/usr/bin/env bash
#
# Raptor Runner — one-command iOS dev loop with hot reload.
#
# Mirror of scripts/android-dev.sh for iOS Simulator. Same trick:
# capacitor.config.ts conditionally sets server.url from CAP_DEV_URL,
# and the WebView loads directly from the Vite dev server so edits
# hot-reload on the simulator in ~500ms — no rebuild per change.
#
# What this does:
#   1. Boot the iOS Simulator if no device is booted (defaults to the
#      lightest profile available, iPhone SE 3rd gen, for fast runs).
#   2. Start Vite on 0.0.0.0 so the simulator can reach it.
#   3. cap sync ios with CAP_DEV_URL set.
#   4. cap run ios — builds and launches on the booted simulator.
#
# iOS simulators are far lighter than Android emulators (same CPU
# architecture as the host, no translation layer), so we don't need
# Android-style GPU/memory tuning. Orientation is handled by the app's
# own ScreenOrientation plugin lock on native init.
#
# Env overrides:
#   SIM=<device name>   which simulator to use (default: iPhone SE (3rd generation))
#   VITE_PORT=<n>       Vite port (default: 5173)
#   LAN_IP=<ip>         override auto-detected LAN IP
#
# NOTE: iOS needs an Apple Developer / Xcode signing identity for
#   physical devices, but simulators need nothing. This script targets
#   simulators only — use `npx cap run ios` with `--target <udid>` for
#   tethered devices.

set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

SIM_NAME="${SIM:-iPhone SE (3rd generation)}"
VITE_PORT="${VITE_PORT:-5173}"

# Host-reachability address for the WebView.
#
# The iOS Simulator shares the Mac's network namespace, so localhost
# works — no LAN hop, no firewall prompts, works offline. For testing
# on a real iPhone over Wi-Fi, pass your LAN IP:
#     LAN_IP=192.168.0.81 npm run dev:ios
# (phone and Mac on the same Wi-Fi network).
DEV_HOST="${LAN_IP:-localhost}"

VITE_PID=""

cleanup() {
  echo ""
  echo "🧹 Stopping Vite"
  if [ -n "$VITE_PID" ]; then
    kill -TERM "$VITE_PID" 2>/dev/null || true
  fi
  # npx sometimes doesn't propagate signals to the node subprocess.
  # Belt-and-suspenders: nuke anything still holding our port.
  sleep 0.3
  lsof -ti:"$VITE_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  wait 2>/dev/null || true
  echo "   (simulator left running — next dev:ios is instant)"
}
trap cleanup EXIT INT TERM

# Clear any stale Vite from a prior run that didn't exit cleanly.
if lsof -ti:"$VITE_PORT" > /dev/null 2>&1; then
  echo "🧹 Clearing stale process on port $VITE_PORT"
  lsof -ti:"$VITE_PORT" | xargs kill -9 2>/dev/null || true
  sleep 0.3
fi

# ── 1. Simulator ──────────────────────────────────────────
if xcrun simctl list devices | grep -q "Booted"; then
  BOOTED_NAME=$(xcrun simctl list devices | grep "Booted" | head -1 | sed -E 's/^[[:space:]]+(.*) \([A-F0-9-]+\).*/\1/')
  echo "📱 Simulator already booted: $BOOTED_NAME"
else
  echo "🤖 Booting simulator: $SIM_NAME"
  # Get the UDID for the requested device. xcrun simctl shows shutdown
  # devices with (Shutdown), booted ones with (Booted). We want shutdown
  # here since nothing is booted yet.
  UDID=$(xcrun simctl list devices available \
    | grep -F "$SIM_NAME" \
    | head -1 \
    | sed -E 's/.*\(([A-F0-9-]+)\).*/\1/')
  if [ -z "$UDID" ]; then
    echo "❌ Simulator '$SIM_NAME' not found."
    echo "   Available: xcrun simctl list devices available"
    exit 1
  fi
  xcrun simctl boot "$UDID"
  # Open Simulator.app so the device window actually appears.
  # Without this, `simctl boot` boots the runtime but the GUI window
  # doesn't show.
  open -a Simulator
  # Wait for bootstate = Booted (not just "booting")
  until xcrun simctl list devices | grep -F "$UDID" | grep -q "Booted"; do
    sleep 1
  done
  echo "✅ Simulator ready"
fi

# ── 2. Fallback bundle ─────────────────────────────────────
# Same reason as android-dev.sh: cap sync writes config into ios/App/
# App/ which needs to have been populated by a prior sync. First run
# on a fresh checkout has no dist/ yet.
if [ ! -d "$REPO/dist" ] || [ ! -d "$REPO/ios/App/App/public" ]; then
  echo "📦 Building fallback bundle (first run)..."
  (cd "$REPO" && npm run build:mobile)
fi

# ── 3. Vite dev server ─────────────────────────────────────
CAP_DEV_URL="http://$DEV_HOST:$VITE_PORT"
echo "🔥 Starting Vite at $CAP_DEV_URL (host:port the WebView will hit)"
# VITE_TARGET=capacitor makes vite.config.ts set __IS_CAPACITOR__ to
# true in the transformed bundle, which is what main.ts's
# `if (__IS_CAPACITOR__)` bridge-init block keys on.
(cd "$REPO" && VITE_TARGET=capacitor npx vite --host 0.0.0.0 --port "$VITE_PORT") &
VITE_PID=$!

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

# ── 4. Capacitor sync + deploy ─────────────────────────────
echo "📦 Syncing Capacitor config (server.url = $CAP_DEV_URL)"
export CAP_DEV_URL
(cd "$REPO" && npx cap sync ios)

# Auto-pick the booted simulator UDID so cap run doesn't prompt.
SIM_UDID=$(xcrun simctl list devices | grep "Booted" | head -1 | sed -E 's/.*\(([A-F0-9-]+)\).*/\1/')
if [ -z "$SIM_UDID" ]; then
  echo "❌ No booted simulator found — this should not happen after the boot wait above."
  exit 1
fi

echo "🚀 Building + launching on $SIM_UDID..."
(cd "$REPO" && npx cap run ios --target "$SIM_UDID")

# ── 5. Keep script alive ───────────────────────────────────
echo ""
echo "✨ Live-reload active."
echo "   Edit src/ and the simulator hot-reloads in ~500ms."
echo "   Ctrl+C to stop (simulator stays running)."
wait "$VITE_PID"
