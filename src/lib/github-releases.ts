import type { McpMetadata } from "./types";

interface GitHubRelease {
  tag_name: string;
  assets: {
    name: string;
    browser_download_url: string;
  }[];
}

interface GitHubReleaseResult {
  metadata: McpMetadata;
  bundleUrl: string;
  metadataUrl: string;
  version: string;
}

interface ValidationResult {
  valid: boolean;
  hasReleases: boolean;
  hasMcpDeployJson: boolean;
  hasWorkerBundle: boolean;
  latestVersion?: string;
  name?: string;
  error?: string;
}

/**
 * Get the latest release from a GitHub repository.
 */
export async function getLatestRelease(repo: string): Promise<GitHubRelease> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        // Add token if rate limited
        ...(process.env.GITHUB_TOKEN && {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
        }),
      },
      next: { revalidate: 300 }, // Cache for 5 minutes
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Repository not found or has no releases");
    }
    throw new Error(`Failed to fetch release: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a specific release by tag from a GitHub repository.
 */
export async function getRelease(
  repo: string,
  tag: string
): Promise<GitHubRelease> {
  if (tag === "latest") {
    return getLatestRelease(repo);
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        ...(process.env.GITHUB_TOKEN && {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
        }),
      },
      next: { revalidate: 300 },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch release ${tag}: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch MCP metadata and bundle URL from a GitHub release.
 */
export async function fetchMcpMetadata(
  repo: string,
  tag: string = "latest"
): Promise<GitHubReleaseResult> {
  const release = await getRelease(repo, tag);

  const metadataAsset = release.assets.find(
    (a) => a.name === "mcp-deploy.json"
  );
  const bundleAsset = release.assets.find((a) => a.name === "worker.mjs");

  if (!metadataAsset) {
    throw new Error(`Release ${release.tag_name} missing mcp-deploy.json`);
  }
  if (!bundleAsset) {
    throw new Error(`Release ${release.tag_name} missing worker.mjs`);
  }

  // Fetch and parse metadata
  const metadataResponse = await fetch(metadataAsset.browser_download_url, {
    next: { revalidate: 300 },
  });

  if (!metadataResponse.ok) {
    throw new Error(
      `Failed to fetch metadata: ${metadataResponse.status}`
    );
  }

  const metadata: McpMetadata = await metadataResponse.json();

  return {
    metadata,
    bundleUrl: bundleAsset.browser_download_url,
    metadataUrl: metadataAsset.browser_download_url,
    version: release.tag_name,
  };
}

/**
 * Fetch the worker bundle content from a URL.
 */
export async function fetchWorkerBundle(bundleUrl: string): Promise<string> {
  const response = await fetch(bundleUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch bundle: ${response.status}`);
  }
  return response.text();
}

/**
 * Validate that a GitHub repository has proper MCP releases.
 */
export async function validateGitHubRepo(
  repo: string
): Promise<ValidationResult> {
  try {
    const release = await getLatestRelease(repo);

    const hasMetadata = release.assets.some(
      (a) => a.name === "mcp-deploy.json"
    );
    const hasBundle = release.assets.some((a) => a.name === "worker.mjs");

    if (!hasMetadata || !hasBundle) {
      return {
        valid: false,
        hasReleases: true,
        hasMcpDeployJson: hasMetadata,
        hasWorkerBundle: hasBundle,
        latestVersion: release.tag_name,
        error: !hasMetadata
          ? "Release missing mcp-deploy.json"
          : "Release missing worker.mjs",
      };
    }

    return {
      valid: true,
      hasReleases: true,
      hasMcpDeployJson: true,
      hasWorkerBundle: true,
      latestVersion: release.tag_name,
    };
  } catch (err) {
    return {
      valid: false,
      hasReleases: false,
      hasMcpDeployJson: false,
      hasWorkerBundle: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Get just the latest version tag from a GitHub repository.
 * Lighter weight than fetching full metadata.
 */
export async function getLatestVersion(repo: string): Promise<string | null> {
  try {
    const release = await getLatestRelease(repo);
    return release.tag_name;
  } catch {
    return null;
  }
}

/**
 * Parse a GitHub repository URL or shorthand into owner/repo format.
 * Accepts:
 * - "owner/repo"
 * - "https://github.com/owner/repo"
 * - "github.com/owner/repo"
 */
export function parseGitHubRepo(input: string): string | null {
  // Already in owner/repo format
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(input)) {
    return input;
  }

  // URL format
  try {
    const url = new URL(
      input.startsWith("http") ? input : `https://${input}`
    );
    if (url.hostname === "github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
    }
  } catch {
    // Not a valid URL
  }

  return null;
}
