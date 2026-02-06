/**
 * Bundle MCP worker scripts from sibling repos using esbuild.
 *
 * This replicates what wrangler does internally — esbuild bundling
 * of TypeScript into a single ESM file that can be uploaded to
 * the Cloudflare Workers API.
 *
 * Usage: npx tsx scripts/bundle-workers.ts
 */

import * as esbuild from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const SIBLING_ROOT = resolve(PROJECT_ROOT, "..");
const SHIMS_DIR = resolve(PROJECT_ROOT, "workers/.shims");

// Create shims for node modules that aren't available in Cloudflare Workers
function createShims() {
  mkdirSync(SHIMS_DIR, { recursive: true });

  // Shim for node:os - only provides EOL which is what mimetext uses
  writeFileSync(
    resolve(SHIMS_DIR, "node-os.js"),
    `export const EOL = "\\n";\nexport default { EOL: "\\n" };`
  );

  // Shim for node-fetch - Workers have native fetch
  const nodeFetchShim = `export default globalThis.fetch;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;`;
  writeFileSync(resolve(SHIMS_DIR, "node-fetch.js"), nodeFetchShim);

  // cross-fetch needs a directory structure for cross-fetch/polyfill
  const crossFetchDir = resolve(SHIMS_DIR, "cross-fetch");
  mkdirSync(crossFetchDir, { recursive: true });
  writeFileSync(resolve(crossFetchDir, "index.js"), nodeFetchShim);
  // polyfill.js - just sets globals (they already exist in Workers)
  writeFileSync(resolve(crossFetchDir, "polyfill.js"), `// No-op: Workers have native fetch`);

  // Empty shims for Node.js modules not available in Workers
  writeFileSync(resolve(SHIMS_DIR, "empty.js"), `export default {};`);
}

interface WorkerConfig {
  name: string;
  entryPoint: string;
  outfile: string;
  alias?: Record<string, string>;
}

const WORKERS: WorkerConfig[] = [
  {
    name: "paper-search-mcp",
    entryPoint: resolve(
      SIBLING_ROOT,
      "paper-search-mcp-remote/src/index.ts",
    ),
    outfile: resolve(PROJECT_ROOT, "workers/paper-search-mcp.mjs"),
  },
  {
    name: "zotero-assistant-mcp",
    entryPoint: resolve(
      SIBLING_ROOT,
      "zotero-assistant-mcp-remote/packages/deploy/src/index.ts",
    ),
    outfile: resolve(PROJECT_ROOT, "workers/zotero-assistant-mcp.mjs"),
    // The deploy package imports from the sibling "zotero-assistant-mcp" workspace package
    alias: {
      "zotero-assistant-mcp": resolve(
        SIBLING_ROOT,
        "zotero-assistant-mcp-remote/packages/mcp/src/index.ts",
      ),
    },
  },
];

async function bundle() {
  console.log("Creating shims for node modules...");
  createShims();

  console.log("Bundling MCP workers...\n");

  for (const worker of WORKERS) {
    console.log(`  ${worker.name}`);
    console.log(`    entry: ${worker.entryPoint}`);
    console.log(`    out:   ${worker.outfile}`);

    try {
      const result = await esbuild.build({
        entryPoints: [worker.entryPoint],
        bundle: true,
        format: "esm",
        target: "es2022",
        outfile: worker.outfile,
        platform: "neutral",
        conditions: ["workerd", "worker", "browser", "import"],
        mainFields: ["esnext", "module", "main"],
        alias: {
          ...worker.alias,
          // Shim node:os with a minimal implementation (mimetext only needs EOL)
          "node:os": resolve(SHIMS_DIR, "node-os.js"),
          // Replace node-fetch with native fetch (Workers have it built-in)
          "node-fetch": resolve(SHIMS_DIR, "node-fetch.js"),
          "cross-fetch": resolve(SHIMS_DIR, "cross-fetch"),
          // Empty shims for Node.js networking modules not available in Workers
          "http": resolve(SHIMS_DIR, "empty.js"),
          "https": resolve(SHIMS_DIR, "empty.js"),
          "net": resolve(SHIMS_DIR, "empty.js"),
          "tls": resolve(SHIMS_DIR, "empty.js"),
          "node:http": resolve(SHIMS_DIR, "empty.js"),
          "node:https": resolve(SHIMS_DIR, "empty.js"),
          "node:net": resolve(SHIMS_DIR, "empty.js"),
          "node:tls": resolve(SHIMS_DIR, "empty.js"),
        },
        // Cloudflare Workers runtime provides certain node:* and cloudflare:* modules
        // Only externalize what CF Workers actually supports with nodejs_compat
        external: [
          "node:assert",
          "node:async_hooks",
          "node:buffer",
          "node:crypto",
          "node:diagnostics_channel",
          "node:events",
          "node:path",
          "node:process",
          "node:stream",
          "node:string_decoder",
          "node:util",
          "cloudflare:*",
          // Bare imports that Workers supports (for legacy packages using require())
          "path",
          "stream",
          "url",
          "util",
          "events",
          "buffer",
          "querystring",
          "assert",
          "async_hooks",
          "string_decoder",
          "crypto",
        ],
        // Cloudflare Workers specific
        define: {
          "process.env.NODE_ENV": '"production"',
        },
        sourcemap: false,
        minify: false, // Keep readable for debugging
        treeShaking: true,
        logLevel: "warning",
      });

      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          console.log(`    ⚠ ${w.text}`);
        }
      }

      console.log(`    ✓ bundled successfully\n`);
    } catch (err) {
      console.error(`    ✗ failed to bundle ${worker.name}:`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log("All workers bundled successfully.");
}

bundle();
