/**
 * Public library surface — what a consuming app (the hosted control plane, or
 * any other integrator) imports as `mcp-deploy/lib`.
 *
 * This is the seam that keeps the hosted app a thin layer rather than a fork:
 * it implements its own multi-tenant `Store`, injects it with `setStore()`,
 * and reuses everything else here — the deploy service, the shared deploy
 * operations, MCP resolution, and the worker wrappers.
 *
 * Individual modules are also reachable as `mcp-deploy/lib/<module>` for
 * anything not surfaced here.
 */

// ─── Storage seam ───
// Implement Store, then setStore(new YourStore()) once at startup.
export { getStore, setStore } from "./store";
export type {
  Store,
  CachedMetadata,
  LatestVersionCacheEntry,
} from "./store-types";

// ─── Cloudflare deploy + credentials ───
export { CloudflareDeployService } from "./cloudflare-deploy";
export {
  getCredentials,
  getDeployService,
  isCfConfigured,
} from "./cloudflare-config";
export type { CloudflareCredentials } from "./cloudflare-config";

// ─── High-level deploy operations (shared orchestration) ───
export {
  addMcp,
  deployMcp,
  undeployMcp,
  removeMcp,
  updateSecrets,
} from "./operations";

// ─── MCP registry + GitHub releases ───
export {
  DEFAULT_MCPS,
  seedDefaultsIfNeeded,
  getAllMcps,
  getStoredMcp,
  resolveMcpEntry,
  resolveMcpEntryFromCache,
  getBundleContent,
  checkForUpdate,
} from "./mcp-registry";
export {
  fetchMcpMetadata,
  getLatestVersion,
  parseGitHubRepo,
  validateGitHubRepo,
} from "./github-releases";

// ─── Worker wrappers (generate the code deployed into each worker) ───
export { generateBearerTokenWrapper } from "./worker-bearer-wrapper";
export { generateOAuthWrapper } from "./worker-oauth-wrapper";
export { generateOpenWrapper } from "./worker-open-wrapper";

// ─── Secret encryption, live credential test, validation ───
export { encrypt, decrypt } from "./encryption";
export { runTest } from "./test-runner";
export type { TestResult } from "./test-runner";
export {
  isValidSlug,
  isValidGithubRepo,
  isValidReleaseTag,
  isValidSecretKey,
  isValidSecretValue,
  isValidUrl,
  isValidSecretsObject,
} from "./validation";

// ─── Shared domain types ───
export type * from "./types";
export type {
  OAuthClient,
  AuthorizationCode,
  AccessTokenClaims,
  OAuthError,
} from "./oauth/types";
