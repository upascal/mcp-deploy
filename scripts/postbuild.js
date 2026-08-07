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

// 1. Flatten nested standalone output
//    Next.js standalone nests server.js under a path that mirrors the build machine's
//    directory structure (e.g., .next/standalone/Documents/.../project/server.js).
//    Find it and move everything up to the standalone root so it works when installed elsewhere.
function findServerJs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === "server.js") return dir;
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".next" && entry.name !== "public") {
      const found = findServerJs(full);
      if (found) return found;
    }
  }
  return null;
}

const nestedDir = findServerJs(STANDALONE);
if (nestedDir && nestedDir !== STANDALONE) {
  console.log(`[postbuild] Flattening nested standalone output from ${path.relative(STANDALONE, nestedDir)}`);
  for (const entry of fs.readdirSync(nestedDir, { withFileTypes: true })) {
    const src = path.join(nestedDir, entry.name);
    const dest = path.join(STANDALONE, entry.name);
    if (fs.existsSync(dest)) rmSync(dest);
    fs.renameSync(src, dest);
  }
  // Remove the now-empty nested directory tree
  const topLevel = path.join(STANDALONE, fs.readdirSync(STANDALONE).find(
    (d) => !["node_modules", ".next", "public", "server.js", "package.json"].includes(d)
      && fs.statSync(path.join(STANDALONE, d)).isDirectory()
  ));
  if (topLevel) rmSync(topLevel);
}

// 2. Copy static assets
const staticSrc = path.join(ROOT, ".next", "static");
const staticDest = path.join(STANDALONE, ".next", "static");
console.log("[postbuild] Copying .next/static/ → standalone/.next/static/");
copyDirSync(staticSrc, staticDest);

// 3. Copy public/
const publicSrc = path.join(ROOT, "public");
const publicDest = path.join(STANDALONE, "public");
console.log("[postbuild] Copying public/ → standalone/public/");
copyDirSync(publicSrc, publicDest);

// 4. Remove packages that shouldn't ship in the tarball
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

// 5. Strip `bin` field from standalone package.json
//    (Next.js copies the root package.json, but the bin path doesn't exist inside standalone)
const standalonePkg = path.join(STANDALONE, "package.json");
if (fs.existsSync(standalonePkg)) {
  const pkg = JSON.parse(fs.readFileSync(standalonePkg, "utf8"));
  if (pkg.bin) {
    delete pkg.bin;
    fs.writeFileSync(standalonePkg, JSON.stringify(pkg, null, 2) + "\n");
    console.log("[postbuild] Stripped bin field from standalone package.json");
  }
}

console.log("[postbuild] Done.");
