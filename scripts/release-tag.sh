#!/usr/bin/env bash
# release-tag.sh — stamp the current commit with the version from
# package.json, push the tag, and print a butler-compatible
# --userversion string.
#
# Why this exists: `git tag vX.Y.Z` by itself doesn't reach itch.io.
# Butler picks up version info from the --userversion flag passed at
# push time (see the `itch:push:*` scripts). So a release needs BOTH:
#   1. The package.json version bumped locally.
#   2. A git tag recording it.
#   3. Every butler push run with --userversion=$npm_package_version
#      so itch.io's "Version" column renders correctly instead of
#      falling back to the upload filename.
#
# This script covers (1)-(2). (3) is handled automatically by the
# itch:push:* scripts in package.json, which read $npm_package_version
# from npm's environment.
#
# Usage:
#   npm run release:tag                  # tag package.json version
#   npm run release:tag -- --push        # also push the tag to origin

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Read version from package.json. Use node so we don't rely on jq/sed
# and so the parse matches exactly what npm sees in $npm_package_version.
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

if [[ -z "${VERSION}" ]]; then
  echo "release-tag: could not read version from package.json" >&2
  exit 1
fi

# Refuse to tag a dirty tree — a tag should reference a commit the
# user can actually reproduce. Allow override with FORCE_DIRTY=1 for
# emergencies.
if [[ -z "${FORCE_DIRTY:-}" ]] && ! git diff-index --quiet HEAD --; then
  echo "release-tag: working tree is dirty. Commit or stash first" >&2
  echo "            (or run with FORCE_DIRTY=1 to bypass)" >&2
  exit 2
fi

# If the tag already exists and points at HEAD, that's fine — idempotent
# re-run. If it exists and points somewhere else, bail — per the user's
# rule we never rewrite published tags; bump the patch version instead.
if git rev-parse "$TAG" >/dev/null 2>&1; then
  EXISTING_SHA=$(git rev-list -n 1 "$TAG")
  HEAD_SHA=$(git rev-parse HEAD)
  if [[ "$EXISTING_SHA" == "$HEAD_SHA" ]]; then
    echo "release-tag: tag $TAG already exists at HEAD — nothing to do"
  else
    echo "release-tag: tag $TAG already exists pointing at $EXISTING_SHA" >&2
    echo "            HEAD is at $HEAD_SHA" >&2
    echo "            Bump the patch version in package.json and retry" >&2
    echo "            (never rewrite a published tag)." >&2
    exit 3
  fi
else
  git tag -a "$TAG" -m "Release $TAG"
  echo "release-tag: tagged HEAD as $TAG"
fi

if [[ "${1:-}" == "--push" ]]; then
  git push origin "$TAG"
  echo "release-tag: pushed $TAG to origin"
fi

echo ""
echo "Next: run one of"
echo "  npm run itch:push:mac"
echo "  npm run itch:push:win"
echo "  npm run itch:push:linux"
echo "Each invocation reads $TAG's version ($VERSION) automatically."
