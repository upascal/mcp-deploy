import {
  fetchMcpMetadata,
  parseGitHubRepo,
} from "./github-releases";
import {
  getStoredMcp,
  resolveMcpEntry,
  getBundleContent,
} from "./mcp-registry";
import { getDeployService } from "./cloudflare-config";
import {
  addMcp as storeAddMcp,
  getMcps,
  setCachedMetadata,
  deleteCachedMetadata,
  getDeployment,
  setDeployment,
  setMcpSecrets,
  getMcpSecrets,
  removeMcp as storeRemoveMcp,
  undeployMcp as storeUndeployMcp,
  setLatestVersionCache,
  getLatestVersionCache,
  getCachedMetadataForDisplay,
} from "./store";
import { decrypt, encrypt } from "./encryption";
import { generateBearerTokenWrapper } from "./worker-bearer-wrapper";
import { generateOAuthWrapper } from "./worker-oauth-wrapper";
import { generateOpenWrapper } from "./worker-open-wrapper";
import {
  getDeploymentJWTSecret,
  setDeploymentJWTSecret,
} from "./oauth/store";
import { randomBytes } from "crypto";
import type {
  AddMcpResult,
  DeployOptions,
  DeployResult,
  UpdateSecretsResult,
} from "./types";

const OAUTH_KV_NAMESPACE = "mcp-deploy-oauth";

/**
 * Add a new MCP from a GitHub repository.
 * Extracted from POST /api/mcps/add route handler.
 */
export async function addMcp(
  repoInput: string,
  releaseTag: string = "latest"
): Promise<AddMcpResult> {
  const repo = parseGitHubRepo(repoInput);
  if (!repo) {
    throw new Error("Invalid repository format. Use owner/repo or a GitHub URL.");
  }

  // Check if already added
  const existing = await getMcps();
  if (existing.some((m) => m.githubRepo === repo)) {
    throw new Error(`Repository ${repo} is already added`);
  }

  // Fetch metadata
  const { metadata, version, bundleUrl } = await fetchMcpMetadata(repo, releaseTag);
  const slug = metadata.worker.name;

  // Check slug uniqueness
  if (existing.some((m) => m.slug === slug)) {
    throw new Error(`"${metadata.name}" is already added`);
  }

  // Store
  await storeAddMcp({
    slug,
    githubRepo: repo,
    releaseTag,
    addedAt: new Date().toISOString(),
  });

  // Pre-populate metadata cache
  await setCachedMetadata(slug, { metadata, bundleUrl, version });

  return { slug, name: metadata.name, version, githubRepo: repo };
}

/**
 * Deploy an MCP to Cloudflare Workers.
 * Extracted from POST /api/mcps/[slug]/deploy route handler.
 */
export async function deployMcp(
  slug: string,
  options: DeployOptions
): Promise<DeployResult> {
  const { authMode, secrets: userSecrets, config: userConfig } = options;

  // Get the stored MCP entry
  const entry = await getStoredMcp(slug);
  if (!entry) {
    throw new Error("MCP not found");
  }

  // Throws with login guidance when no credentials are available.
  const cf = await getDeployService();

  // If an update is available, invalidate the metadata cache so we fetch the latest release
  const latestVersionEntry = await getLatestVersionCache(slug);
  const cachedMeta = await getCachedMetadataForDisplay(slug);
  if (latestVersionEntry && cachedMeta && latestVersionEntry.latestVersion !== cachedMeta.version) {
    await deleteCachedMetadata(slug);
  }

  // Resolve the entry to get full metadata from GitHub
  const resolved = await resolveMcpEntry(entry);

  // Merge with any existing secrets (so we don't lose them on redeploy)
  const existingSecrets = (await getMcpSecrets(slug)) ?? {};
  const mergedSecrets: Record<string, string> = {
    ...existingSecrets,
    ...userSecrets,
  };

  const existingDeployment = await getDeployment(slug);
  const regenerateOAuthPassword = options.regenerateOAuthPassword === true;
  let oauthPassword: string | null = null;
  if (authMode === "oauth") {
    if (process.env.OAUTH_PASSWORD?.trim()) {
      oauthPassword = process.env.OAUTH_PASSWORD.trim();
    } else if (
      !regenerateOAuthPassword &&
      existingDeployment?.oauthPassword
    ) {
      try {
        oauthPassword = decrypt(existingDeployment.oauthPassword);
      } catch {
        oauthPassword = null;
      }
    }
    if (!oauthPassword) {
      oauthPassword = randomBytes(32).toString("hex");
    }
  }

  // Reuse existing bearer token on redeploy (so URLs don't change).
  const regenerateToken = options.regenerateToken === true;
  let bearerToken: string | null = null;
  if (authMode !== "open") {
    if (!regenerateToken && existingDeployment?.bearerToken) {
      try {
        bearerToken = decrypt(existingDeployment.bearerToken);
      } catch {
        bearerToken = null;
      }
    }
    if (!bearerToken) {
      bearerToken = randomBytes(32).toString("hex");
    }
  }

  // Generate wrapper based on auth mode
  let wrapper: string;
  if (authMode === "oauth") {
    wrapper = generateOAuthWrapper(resolved.durableObjectClassName);
  } else if (authMode === "open") {
    wrapper = generateOpenWrapper(resolved.durableObjectClassName);
  } else {
    wrapper = generateBearerTokenWrapper(resolved.durableObjectClassName);
  }

  // Get the bundle content from GitHub
  const bundleContent = await getBundleContent(resolved);

  // Deploy the worker via wrangler
  const kvNamespaceId =
    authMode === "oauth"
      ? await cf.ensureKVNamespace(OAUTH_KV_NAMESPACE)
      : undefined;

  const { url } = await cf.deployWorker(
    resolved,
    bundleContent,
    wrapper,
    kvNamespaceId
  );

  // Set all secrets on the worker
  const allWorkerSecrets: Record<string, string> = {
    ...mergedSecrets,
    ...userConfig,
  };
  if (bearerToken) {
    allWorkerSecrets.BEARER_TOKEN = bearerToken;
  }

  let oauthEnabled = false;
  if (authMode === "oauth") {
    // Reuse the existing JWT signing secret across redeploys. Rotating it
    // would invalidate every access token clients already hold, so it must be
    // stable — including through the "update all deployments" flow. Only
    // generate a fresh one on first deploy.
    let jwtSecret = await getDeploymentJWTSecret(slug);
    if (!jwtSecret) {
      jwtSecret = randomBytes(32).toString("hex");
      await setDeploymentJWTSecret(slug, jwtSecret);
    }
    allWorkerSecrets.OAUTH_JWT_SECRET = jwtSecret;
    if (oauthPassword) {
      allWorkerSecrets.OAUTH_PASSWORD = oauthPassword;
    }
    oauthEnabled = true;
  }

  try {
    await cf.setSecrets(resolved.workerName, allWorkerSecrets);
  } catch (secretsError) {
    // If setting secrets fails, clean up the deployed worker
    console.error("[deploy] Failed to set secrets, cleaning up worker:", secretsError);
    try {
      await cf.deleteWorker(resolved.workerName);
    } catch (deleteError) {
      console.error("[deploy] Failed to delete worker during cleanup:", deleteError);
    }
    throw secretsError;
  }

  // The MCP URL is at /mcp on the worker
  const mcpUrl = `${url}/mcp`;
  const mcpUrlWithToken = bearerToken ? `${url}/mcp/t/${bearerToken}` : mcpUrl;

  // Store deployment record
  await setDeployment({
    slug,
    status: "deployed",
    workerUrl: url,
    bearerToken: bearerToken ? encrypt(bearerToken) : null,
    oauthPassword: oauthPassword ? encrypt(oauthPassword) : null,
    authMode,
    deployedAt: new Date().toISOString(),
    version: resolved.version,
  });

  // Store user secrets (not auto-generated ones)
  await setMcpSecrets(slug, { ...mergedSecrets, ...userConfig });

  // Update latest version cache so "update available" badge clears
  await setLatestVersionCache(slug, resolved.version);

  return {
    workerUrl: url,
    mcpUrl,
    mcpUrlWithToken,
    bearerToken,
    oauthPassword,
    authMode,
    oauthEnabled,
    version: resolved.version,
  };
}

/**
 * Undeploy an MCP — delete the Cloudflare worker but keep it in the registry.
 * Extracted from DELETE /api/mcps/[slug]/undeploy route handler.
 */
export async function undeployMcp(slug: string): Promise<void> {
  const deployment = await getDeployment(slug);
  if (!deployment || deployment.status !== "deployed") {
    throw new Error("MCP is not deployed");
  }

  // Delete the Cloudflare worker
  if (deployment.workerUrl) {
    const entry = await getStoredMcp(slug);
    if (entry) {
      try {
        const resolved = await resolveMcpEntry(entry);
        const cf = await getDeployService();
        await cf.deleteWorker(resolved.workerName);
      } catch (err) {
        console.warn(`[undeploy] Failed to delete worker for "${slug}":`, err);
      }
    }
  }

  // Update deployment record — keep it but mark as not_deployed
  await storeUndeployMcp(slug);
}

/**
 * Remove an MCP from the registry.
 * Deletes the Cloudflare worker (best-effort) and cascade-deletes all related data.
 * Extracted from DELETE /api/mcps/[slug]/remove route handler.
 */
export async function removeMcp(slug: string): Promise<void> {
  const deployment = await getDeployment(slug);

  // Best-effort: delete the Cloudflare worker if deployed
  if (deployment?.workerUrl) {
    const entry = await getStoredMcp(slug);
    if (entry) {
      try {
        const resolved = await resolveMcpEntry(entry);
        const cf = await getDeployService();
        await cf.deleteWorker(resolved.workerName);
      } catch (err) {
        console.warn(`[remove] Failed to delete worker for "${slug}":`, err);
      }
    }
  }

  await storeRemoveMcp(slug);
}

/**
 * Update secrets on a deployed worker without redeploying.
 * Extracted from PUT /api/mcps/[slug]/secrets route handler.
 */
export async function updateSecrets(
  slug: string,
  secrets: Record<string, string>,
  deleteKeys: string[] = []
): Promise<UpdateSecretsResult> {
  const entry = await getStoredMcp(slug);
  if (!entry) {
    throw new Error("MCP not found");
  }

  const resolved = await resolveMcpEntry(entry);

  // Throws with login guidance when no credentials are available.
  const cf = await getDeployService();

  for (const key of deleteKeys) {
    await cf.deleteSecret(resolved.workerName, key);
  }

  await cf.setSecrets(resolved.workerName, secrets);

  // Update stored secrets (merge with existing, remove deleted)
  const existing = (await getMcpSecrets(slug)) ?? {};
  const merged = { ...existing, ...secrets };
  for (const key of deleteKeys) {
    delete merged[key];
  }
  await setMcpSecrets(slug, merged);

  return {
    updatedKeys: Object.keys(secrets),
    deletedKeys: deleteKeys,
  };
}
