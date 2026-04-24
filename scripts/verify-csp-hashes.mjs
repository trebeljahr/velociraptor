#!/usr/bin/env node
/*
 * Check that every HTML entry point's inline <script> hash matches
 * what the page's Content-Security-Policy pins via
 * `script-src 'sha256-…'`. Run manually after editing any inline
 * script, or wired into CI to catch silent rot.
 *
 * If --fix is passed, rewrites the CSP with the correct hash
 * instead of just reporting.
 *
 * Background: index.html, about.html and imprint.html each embed a
 * small inline bootstrap script whose bytes are pinned in that
 * page's CSP. If the script body changes by a single character and
 * the hash isn't updated, the browser refuses to run it — which in
 * index.html's case means the desktop-detection bootstrap never
 * fires, `html.is-desktop` never gets set, and every desktop-only
 * CSS rule silently breaks.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const FILES = ["index.html", "about.html", "imprint.html"];
const fix = process.argv.includes("--fix");

function inlineScriptHashes(html) {
  // Strip HTML comments first so a <script> tag inside a comment
  // doesn't hijack the regex.
  const stripped = html.replace(/<!--[\s\S]*?-->/g, "");
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
  const hashes = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const openTag = m[0].slice(0, m[0].indexOf(">") + 1);
    if (/\ssrc\s*=/.test(openTag)) continue; // external script — CSP allows via 'self'
    hashes.push(createHash("sha256").update(m[1]).digest("base64"));
  }
  return hashes;
}

let failed = false;

for (const f of FILES) {
  const raw = readFileSync(f, "utf8");
  const actual = inlineScriptHashes(raw);
  const pinned = [...raw.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);

  const ok = actual.length === pinned.length && actual.every((a, i) => a === pinned[i]);

  if (ok) {
    console.log(`✓ ${f}`);
    continue;
  }

  failed = true;
  console.log(`✗ ${f}`);
  console.log(`   actual: ${actual.map((h) => "'sha256-" + h + "'").join(", ")}`);
  console.log(`   pinned: ${pinned.map((h) => "'sha256-" + h + "'").join(", ")}`);

  if (fix && actual.length === pinned.length) {
    let patched = raw;
    for (let i = 0; i < actual.length; i++) {
      patched = patched.replace(`'sha256-${pinned[i]}'`, `'sha256-${actual[i]}'`);
    }
    writeFileSync(f, patched);
    console.log(`   → fixed`);
  }
}

if (failed && !fix) {
  console.log("\nRun `npm run csp:verify -- --fix` to update the pinned hashes.");
  process.exit(1);
}
