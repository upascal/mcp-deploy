#!/usr/bin/env node

/**
 * Post-build script for Next.js standalone output.
 *
 * 1. Copies .next/static/ into the standalone directory so it can self-serve assets.
 * 2. Copies public/ into the standalone directory for static files.
 * 3. Removes packages from standalone node_modules that shouldn't ship:
 *    - better-sqlite3: native addon compiled for the build platform (user's npm copy used instead)
 *    - @img / sharp: platform-specific image binaries (not needed for this app)
 *    - typescript: build-time only, not needed at runtime
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rmSync(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

// 1. Copy static assets
const staticSrc = path.join(ROOT, ".next", "static");
const staticDest = path.join(STANDALONE, ".next", "static");
console.log("[postbuild] Copying .next/static/ → standalone/.next/static/");
copyDirSync(staticSrc, staticDest);

// 2. Copy public/
const publicSrc = path.join(ROOT, "public");
const publicDest = path.join(STANDALONE, "public");
console.log("[postbuild] Copying public/ → standalone/public/");
copyDirSync(publicSrc, publicDest);

// 3. Remove packages that shouldn't ship in the tarball
const REMOVE_PACKAGES = [
  "better-sqlite3", // native addon — use npm-installed copy for user's platform
  "@img",           // sharp native binaries — platform-specific, not needed
  "sharp",          // sharp JS — not used by this app
  "typescript",     // build-time only
];

const standaloneModules = path.join(STANDALONE, "node_modules");
for (const pkg of REMOVE_PACKAGES) {
  const pkgPath = path.join(standaloneModules, pkg);
  if (fs.existsSync(pkgPath)) {
    console.log(`[postbuild] Removing ${pkg} from standalone node_modules`);
    rmSync(pkgPath);
  }
}

console.log("[postbuild] Done.");
