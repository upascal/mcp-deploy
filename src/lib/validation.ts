/**
 * Input validation utilities for API routes.
 */

/**
 * Validates a slug parameter (alphanumeric, hyphens, underscores only, 1-100 chars)
 */
export function isValidSlug(slug: unknown): slug is string {
  if (typeof slug !== "string") return false;
  if (slug.length < 1 || slug.length > 100) return false;
  return /^[a-zA-Z0-9_-]+$/.test(slug);
}

/**
 * Validates a GitHub repository format (owner/repo)
 */
export function isValidGithubRepo(repo: unknown): repo is string {
  if (typeof repo !== "string") return false;
  if (repo.length < 3 || repo.length > 200) return false;
  const parts = repo.split("/");
  if (parts.length !== 2) return false;
  const [owner, name] = parts;
  if (!owner || !name) return false;
  // GitHub allows alphanumeric, hyphens, underscores, dots
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo);
}

/**
 * Validates a release tag (alphanumeric, dots, hyphens, v prefix)
 */
export function isValidReleaseTag(tag: unknown): tag is string {
  if (typeof tag !== "string") return false;
  if (tag === "latest") return true;
  if (tag.length < 1 || tag.length > 100) return false;
  return /^v?[a-zA-Z0-9._-]+$/.test(tag);
}

/**
 * Validates a secret key (alphanumeric, underscores only, 1-100 chars)
 */
export function isValidSecretKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  if (key.length < 1 || key.length > 100) return false;
  return /^[A-Z0-9_]+$/.test(key);
}

/**
 * Validates a secret value (any string, 1-10000 chars)
 */
export function isValidSecretValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return value.length >= 1 && value.length <= 10000;
}

/**
 * Validates a URL
 */
export function isValidUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an object has only valid secret key-value pairs
 */
export function isValidSecretsObject(
  obj: unknown
): obj is Record<string, string> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return false;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (!isValidSecretKey(key) || !isValidSecretValue(value)) {
      return false;
    }
  }

  return true;
}
