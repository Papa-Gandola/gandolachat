#!/usr/bin/env node
/**
 * Rewrite absolute paths in the Expo web export to live under /app.
 *
 * Why this exists: Expo SDK 51 ignores `experiments.baseUrl` for a plain
 * `expo export -p web` (it's an Expo-Router-only feature). Without rewriting,
 * the generated index.html has <script src="/_expo/static/..."> and the
 * browser loads it from the server root, which 404s because the server
 * mounts the bundle at /app/. This script post-processes the dist folder
 * so all in-bundle URLs are /app/-prefixed.
 *
 * Idempotent — running it twice is a no-op (only matches paths that don't
 * already start with /app/).
 */
const fs = require("fs");
const path = require("path");

const distDir = path.resolve(__dirname, "..", "dist");
const BASE = "/app";

// Files we care about. JSON in dist (e.g. manifest.json, metadata.json)
// may also embed paths.
const TEXT_FILE_EXT = /\.(html|js|mjs|css|json|webmanifest|map)$/i;

// Things that look like absolute root paths but shouldn't already be /app.
// `(?!/?app/)` keeps the rewrite idempotent — running again does nothing.
const REWRITES = [
  // src="/foo", href="/foo", url("/foo"), `"/foo"` — covers the cases Expo
  // and react-native-web emit in the bundle.
  {
    re: /(["'(=])\/(?!app\/)(_expo\/|assets\/|favicon\.ico|metadata\.json|sw\.js|apple-touch-icon\.png|manifest\.json)/g,
    sub: (_m, q, rest) => `${q}${BASE}/${rest}`,
  },
];

let touched = 0;

function processFile(p) {
  const original = fs.readFileSync(p, "utf8");
  let next = original;
  for (const { re, sub } of REWRITES) next = next.replace(re, sub);
  if (next !== original) {
    fs.writeFileSync(p, next);
    touched++;
    console.log("  rewritten:", path.relative(distDir, p));
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (TEXT_FILE_EXT.test(entry.name)) processFile(full);
  }
}

if (!fs.existsSync(distDir)) {
  console.error(`postbuild-web: ${distDir} doesn't exist — did you run \`expo export -p web\` first?`);
  process.exit(1);
}

console.log(`postbuild-web: rewriting paths under ${distDir} to base="${BASE}"`);
walk(distDir);
console.log(`postbuild-web: done (${touched} file(s) changed)`);
