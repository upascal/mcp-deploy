"use client";

import { useEffect, useState, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { SecretForm } from "@/components/SecretForm";
import { McpConfigForm } from "@/components/McpConfigForm";
import { ClaudeConfigSnippet } from "@/components/ClaudeConfigSnippet";
import { EyeIcon } from "@/components/EyeIcon";
import { ExternalLinkIcon } from "@/components/ExternalLinkIcon";
import type { DeploymentRecord, SecretField, ConfigField } from "@/lib/types";

interface McpDetailData {
  slug: string;
  githubRepo: string;
  isDefault?: boolean;
  name: string;
  description: string;
  version: string;
  deployedVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  workerName: string;
  secrets: SecretField[];
  config: ConfigField[];
  autoSecrets: string[];
  deployment: DeploymentRecord;
  configuredSecrets: string[];
  credentials?: {
    bearerToken: string | null;
    oauthPassword: string | null;
  };
}

interface DeployResult {
  success: boolean;
  workerUrl: string;
  mcpUrl: string;
  mcpUrlWithToken: string;
  bearerToken: string | null;
  authMode: "bearer" | "oauth" | "open";
  oauthPassword?: string;
  oauthEnabled?: boolean;
  error?: string;
}

export default function McpDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const [data, setData] = useState<McpDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [secretVisible, setSecretVisible] = useState<Record<string, boolean>>(
    {}
  );
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});
  const [health, setHealth] = useState<{
    healthy: boolean;
    status?: number;
  } | null>(null);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});
  const [authMode, setAuthMode] = useState<"bearer" | "oauth" | "open">(
    "bearer"
  );
  const [regenerateAuth, setRegenerateAuth] = useState(false);
  const [regenerateSuccess, setRegenerateSuccess] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [undeploying, setUndeploying] = useState(false);

  // Track which keys have been auto-tested to avoid duplicate tests
  const autoTestedRef = useRef<Set<string>>(new Set());

  // Auto-test when any API key field with a test spec loses focus
  function handleSecretBlur(field: SecretField) {
    const value = secretValues[field.key];
    if (
      field.test &&
      value?.trim() &&
      !autoTestedRef.current.has(field.key) &&
      canTestField(field)
    ) {
      autoTestedRef.current.add(field.key);
      testConnection(field, true);
    }
  }

  // Reset auto-test tracking when value changes significantly
  function handleSecretChange(key: string, newValue: string) {
    const oldValue = secretValues[key] ?? "";
    if (Math.abs(newValue.length - oldValue.length) > 5 || !newValue) {
      autoTestedRef.current.delete(key);
      if (testResults[key]) {
        setTestResults({
          ...testResults,
          [key]: undefined as unknown as { success: boolean; message: string },
        });
      }
    }
    // Clear validation error for this field on change
    if (validationErrors[key]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    setSecretValues({ ...secretValues, [key]: newValue });
  }

  async function testConnection(field: SecretField, isAutoTest = false) {
    if (!field.test) return;

    const value = secretValues[field.key];
    if (!value?.trim()) {
      if (!isAutoTest) {
        setTestResults({
          ...testResults,
          [field.key]: { success: false, message: "Enter a value first" },
        });
      }
      return;
    }

    setTestResults({
      ...testResults,
      [field.key]: undefined as unknown as { success: boolean; message: string },
    });

    try {
      // Build allValues from current form state for {{FIELD_KEY}} substitution
      const allValues: Record<string, string> = {};
      for (const f of data?.secrets ?? []) {
        if (secretValues[f.key]?.trim()) {
          allValues[f.key] = secretValues[f.key];
        }
      }

      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: field.test,
          value,
          allValues,
        }),
      });
      const responseData = await res.json();

      setTestResults({
        ...testResults,
        [field.key]: {
          success: responseData.success,
          message: responseData.success
            ? responseData.message ?? "Connection successful"
            : responseData.error ?? "Test failed",
        },
      });
    } catch {
      setTestResults({
        ...testResults,
        [field.key]: { success: false, message: "Failed to test connection" },
      });
    }
  }

  useEffect(() => {
    fetch(`/api/mcps/${slug}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        if (d.deployment?.authMode) {
          setAuthMode(d.deployment.authMode);
        }
        // Initialize config defaults
        const defaults: Record<string, string> = {};
        for (const field of d.config ?? []) {
          defaults[field.key] = field.default ?? "";
        }
        setConfigValues(defaults);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [slug]);

  // Check health if deployed
  useEffect(() => {
    if (data?.deployment?.status === "deployed") {
      fetch(`/api/mcps/${slug}/status`)
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => { });
    }
  }, [slug, data?.deployment?.status]);

  async function handleDeploy() {
    if (!isDeployed && !validateForm()) return;

    if (regenerateAuth && isDeployed) {
      const authLabel = authMode === "oauth" ? "OAuth password" : "bearer token";
      if (!confirm(`This will regenerate your ${authLabel} and invalidate existing connections. Continue?`)) return;
    }

    setDeploying(true);
    setDeployError(null);
    setDeployResult(null);
    setRegenerateSuccess(false);

    try {
      const res = await fetch(`/api/mcps/${slug}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secrets: secretValues,
          config: Object.fromEntries(
            Object.entries(configValues).filter(([, v]) => v !== "")
          ),
          authMode,
          ...(regenerateAuth && authMode === "bearer" ? { regenerateToken: true } : {}),
          ...(regenerateAuth && authMode === "oauth" ? { regenerateOAuthPassword: true } : {}),
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setDeployError(result.error ?? "Deployment failed");
      } else {
        setDeployResult(result);
        if (regenerateAuth) {
          setRegenerateSuccess(true);
        }
        // Refresh data
        const refreshed = await fetch(`/api/mcps/${slug}`).then((r) =>
          r.json()
        );
        setData(refreshed);
        setRegenerateAuth(false);
      }
    } catch {
      setDeployError("Failed to connect to server");
    } finally {
      setDeploying(false);
    }
  }

  async function handleCheckForUpdate() {
    setCheckingUpdate(true);
    setUpdateCheckResult(null);
    try {
      await fetch("/api/mcps/check-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: [slug] }),
      });
      // Refresh data to pick up new update status
      const refreshed = await fetch(`/api/mcps/${slug}`).then((r) => r.json());
      setData(refreshed);
      setUpdateCheckResult(
        refreshed.updateAvailable ? "Update available!" : "Already up to date"
      );
      setTimeout(() => setUpdateCheckResult(null), 3000);
    } catch {
      // silently fail
    } finally {
      setCheckingUpdate(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-fg-faint">Loading...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-fg-faint">MCP not found.</p>
      </div>
    );
  }

  const isDeployed = data.deployment?.status === "deployed";

  // Get enabled platforms from config
  const enabledPlatforms = new Set(
    (configValues["ENABLED_PLATFORMS"] || "").split(",").filter(Boolean)
  );

  // Filter secrets to only show those for enabled platforms (or required ones, or those without platform restriction)
  const visibleSecrets = (data.secrets ?? []).filter((field) => {
    if (field.required) return true; // Always show required fields
    if (!field.forPlatform) return true; // Show fields without platform restriction
    return enabledPlatforms.has(field.forPlatform); // Only show if platform is enabled
  });

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    for (const field of visibleSecrets) {
      const value = secretValues[field.key]?.trim() ?? "";
      if (field.required && !value) {
        errors[field.key] = `${field.label} is required`;
      } else if (field.type === "email" && value && !EMAIL_REGEX.test(value)) {
        errors[field.key] = "Enter a valid email address";
      }
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }

  // For initial deploys, check if any required fields are still empty
  const hasRequiredFieldsMissing =
    !isDeployed &&
    visibleSecrets.some(
      (f) => f.required && !secretValues[f.key]?.trim()
    );

  // Check if a field has all its dependencies filled (for {{FIELD_KEY}} substitution)
  function canTestField(field: SecretField): boolean {
    if (!field.test) return false;
    if (!secretValues[field.key]?.trim()) return false;

    // Check if test URL references other fields that need to be filled
    const urlReferences =
      field.test.url.match(/\{\{([^}]+)\}\}/g)?.map((m) => m.slice(2, -2)) ?? [];
    const headerReferences = Object.values(field.test.headers ?? {})
      .join("")
      .match(/\{\{([^}]+)\}\}/g)
      ?.map((m) => m.slice(2, -2)) ?? [];

    const allReferences = [...urlReferences, ...headerReferences].filter(
      (ref) => ref !== "value"
    );

    for (const ref of allReferences) {
      if (!secretValues[ref]?.trim()) return false;
    }

    return true;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{data.name}</h1>
            <StatusBadge status={data.deployment?.status ?? "not_deployed"} />
          </div>
          <p className="text-fg-muted text-sm">{data.description}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-fg-faint">
            <span>v{data.version}</span>
            <button
              onClick={handleCheckForUpdate}
              disabled={checkingUpdate}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-raised hover:bg-surface-overlay border border-edge-subtle rounded-lg text-xs text-fg-secondary transition-colors disabled:opacity-50"
            >
              <svg
                className={`w-3 h-3 ${checkingUpdate ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {checkingUpdate ? "Checking..." : "Check for updates"}
            </button>
            {updateCheckResult && (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  updateCheckResult === "Update available!"
                    ? "bg-success-mid/10 text-success"
                    : "bg-surface-overlay/50 text-fg-muted"
                }`}
              >
                {updateCheckResult}
              </span>
            )}
            {data.githubRepo && (
              <a
                href={`https://github.com/${data.githubRepo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-fg hover:underline"
              >
                Source <ExternalLinkIcon />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Health Status */}
      {isDeployed && health && (
        <div
          className={`border rounded-xl p-4 ${health.healthy
              ? "border-success-mid/30 bg-success-mid/5"
              : "border-danger-mid/30 bg-danger-mid/5"
            }`}
        >
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${health.healthy ? "bg-success" : "bg-danger"
                }`}
            />
            <span
              className={health.healthy ? "text-success" : "text-danger"}
            >
              {health.healthy ? "Healthy" : "Unhealthy"}
            </span>
            {data.deployment?.workerUrl && (
              <span className="text-fg-faint ml-2">
                {data.deployment.workerUrl}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Update Available Banner */}
      {data.updateAvailable && data.deployedVersion && data.latestVersion && (
        <div className="border border-info-mid/30 bg-info-mid/5 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-info-mid/20 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-info"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-info">
                  Update Available
                </p>
                <p className="text-xs text-fg-muted">
                  {data.deployedVersion ?? data.version} → {data.latestVersion}
                </p>
              </div>
            </div>
            <button
              onClick={handleDeploy}
              disabled={deploying}
              className="px-4 py-2 bg-info-mid/20 hover:bg-info-mid/30 border border-info-mid/30 text-info text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
            >
              {deploying ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Updating…
                </span>
              ) : "Update Now"}
            </button>
          </div>
        </div>
      )}

      {/* Deployment Error */}
      {data.deployment?.status === "failed" && data.deployment.error && (
        <div className="border border-danger-mid/30 bg-danger-mid/5 rounded-xl p-4">
          <p className="text-sm text-danger">
            Last deployment failed: {data.deployment.error}
          </p>
        </div>
      )}

      {/* Configuration */}
      {(data.config ?? []).length > 0 && (
        <div className="border border-edge rounded-xl p-6 bg-surface/80">
          <h2 className="text-lg font-semibold mb-4">Configuration</h2>
          <McpConfigForm
            fields={data.config}
            values={configValues}
            onChange={setConfigValues}
          />
        </div>
      )}

      {/* Secrets — for initial deploy */}
      {!isDeployed && visibleSecrets.length > 0 && (
        <div className="border border-edge rounded-xl p-6 bg-surface/80">
          <h2 className="text-lg font-semibold mb-4">API Keys</h2>
          <div className="space-y-4">
            {visibleSecrets.map((field) => (
              <div key={field.key}>
                <label className="flex items-center gap-2 text-sm font-medium text-fg-secondary mb-1.5">
                  {field.label}
                  {field.required ? (
                    <span className="text-accent-fg text-xs">required</span>
                  ) : (
                    <span className="text-fg-faint text-xs">optional</span>
                  )}
                </label>
                {field.helpText && (
                  <p className="text-xs text-fg-faint mb-2">
                    {field.helpText}
                    {field.helpUrl && (
                      <>
                        {" "}
                        <a
                          href={field.helpUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-fg hover:underline"
                        >
                          Get key <ExternalLinkIcon />
                        </a>
                      </>
                    )}
                  </p>
                )}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={
                        field.type === "password" && !secretVisible[field.key]
                          ? "password"
                          : "text"
                      }
                      id={`${slug}-${field.key}`}
                      name={`${slug}-${field.key}`}
                      autoComplete="off"
                      data-1p-ignore
                      data-lpignore="true"
                      value={secretValues[field.key] ?? ""}
                      onChange={(e) =>
                        handleSecretChange(field.key, e.target.value)
                      }
                      onBlur={() => handleSecretBlur(field)}
                      placeholder={field.placeholder}
                      className={`w-full px-4 py-2.5 pr-10 bg-surface-raised border rounded-lg text-sm text-fg placeholder-fg-faint focus:outline-none focus:ring-1 ${validationErrors[field.key]
                          ? "border-danger-mid focus:border-danger-mid focus:ring-danger-mid"
                          : "border-edge-subtle focus:border-accent-edge focus:ring-accent-edge"
                        }`}
                    />
                    {field.type === "password" && (
                      <button
                        type="button"
                        onClick={() =>
                          setSecretVisible({
                            ...secretVisible,
                            [field.key]: !secretVisible[field.key],
                          })
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg-secondary transition-colors"
                      >
                        <EyeIcon open={secretVisible[field.key] ?? false} />
                      </button>
                    )}
                  </div>
                </div>
                {testResults[field.key] && (
                  <p
                    className={`text-xs mt-2 ${testResults[field.key].success
                        ? "text-success"
                        : "text-danger"
                      }`}
                  >
                    {testResults[field.key].success ? "✓" : "✗"}{" "}
                    {testResults[field.key].message}
                  </p>
                )}
                {validationErrors[field.key] && (
                  <p className="text-xs mt-1.5 text-danger">
                    {validationErrors[field.key]}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Secret Management (post-deploy) */}
      {isDeployed && (data.secrets ?? []).length > 0 && (
        <div className="border border-edge rounded-xl p-6 bg-surface/80">
          <h2 className="text-lg font-semibold mb-4">Update Secrets</h2>
          <p className="text-sm text-fg-muted mb-4">
            Update API keys without redeploying. Leave fields blank to keep
            existing values.
          </p>
          <SecretForm
            slug={slug}
            fields={data.secrets}
            configuredKeys={data.configuredSecrets}
            enabledPlatforms={Array.from(enabledPlatforms)}
          />
        </div>
      )}

      {/* Deploy */}
      <div className="border border-edge rounded-xl p-6 bg-surface/80">
        <h2 className="text-lg font-semibold">
          {isDeployed ? "Redeploy" : "Deploy"}
        </h2>
        <p className="text-sm text-fg-muted mt-1">
          {isDeployed
            ? "Redeploy with the latest bundle and configuration."
            : "Deploy this MCP server to your Cloudflare Workers account."}
        </p>

        <div className="mt-5">
          <label className="block text-sm font-medium text-fg-secondary mb-2">
            Authentication
          </label>
          <div className="relative">
            <select
              value={authMode}
              onChange={(e) =>
                setAuthMode(e.target.value as "bearer" | "oauth" | "open")
              }
              className="w-full appearance-none px-4 py-2.5 pr-10 bg-surface-raised border border-edge-subtle rounded-lg text-sm text-fg focus:outline-none focus:border-accent-edge focus:ring-1 focus:ring-accent-edge"
            >
              <option value="bearer">Bearer token (default)</option>
              <option value="oauth">OAuth 2.1 (password protected)</option>
              <option value="open">Open (no authentication)</option>
            </select>
            <svg
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {authMode === "oauth" && (
            <p className="text-xs text-fg-faint mt-2">
              OAuth requires a password prompt during authorization. Bearer tokens are not accepted.
            </p>
          )}
          {authMode === "open" && (
            <p className="text-xs text-danger mt-2">
              Warning: Anyone with the URL can access this MCP.
            </p>
          )}
        </div>

        {isDeployed && authMode !== "open" && (
          <div className="mt-4 pt-4 border-t border-edge">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={regenerateAuth}
                  onChange={(e) => setRegenerateAuth(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-surface-overlay rounded-full peer-checked:bg-warning transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-surface-page shadow-sm rounded-full peer-checked:translate-x-4 transition-transform" />
              </div>
              <div>
                <p className="text-sm font-medium text-fg-secondary group-hover:text-fg transition-colors">
                  Regenerate {authMode === "oauth" ? "OAuth password" : "bearer token"}
                </p>
                <p className="text-xs text-fg-faint">
                  Invalidates existing connections. Use if compromised.
                </p>
              </div>
            </label>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            onClick={handleDeploy}
            disabled={deploying || hasRequiredFieldsMissing}
            className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              regenerateAuth && isDeployed
                ? "bg-warning hover:bg-warning-hover"
                : "bg-accent hover:bg-accent-hover"
            }`}
          >
            {deploying
              ? "Deploying..."
              : regenerateAuth && isDeployed
                ? "Regenerate & redeploy"
                : isDeployed
                  ? "Redeploy"
                  : "Deploy to Cloudflare"}
          </button>
        </div>

        {deployError && (
          <p className="mt-4 text-sm text-danger bg-danger-mid/10 border border-danger-mid/20 rounded-lg px-4 py-2">
            {deployError}
          </p>
        )}
      </div>

      {/* Deploy Result (fresh) */}
      {deployResult && (
        <div className="border border-success-mid/30 bg-success-mid/5 rounded-xl p-4">
          <p className="text-sm text-success">
            {regenerateSuccess && deployResult.authMode === "oauth"
              ? "OAuth password regenerated. Update your client connections."
              : regenerateSuccess
                ? "Bearer token regenerated. Update your client connections."
                : `Successfully deployed to ${deployResult.workerUrl}`}
          </p>
        </div>
      )}

      {/* Credentials & Connection Info (persistent) */}
      {(() => {
        const oauthPw = deployResult?.oauthPassword ?? data.credentials?.oauthPassword;
        const bearer = deployResult?.bearerToken ?? data.credentials?.bearerToken ?? null;
        const mode = deployResult?.authMode ?? data.deployment?.authMode ?? "bearer";
        const workerUrl = deployResult?.workerUrl ?? data.deployment?.workerUrl;
        const mcpUrl = deployResult?.mcpUrl ?? (workerUrl ? `${workerUrl}/mcp` : null);
        const mcpUrlWithToken = deployResult?.mcpUrlWithToken ?? (bearer && workerUrl ? `${workerUrl}/mcp/t/${bearer}` : mcpUrl);

        if (!isDeployed && !deployResult) return null;

        return (
          <div className="space-y-4">
            {mcpUrl && (
              <div className="border border-edge rounded-xl p-6 bg-surface/80">
                <h2 className="text-lg font-semibold mb-3">Connect to Claude</h2>
                <ClaudeConfigSnippet
                  mcpUrl={mcpUrl}
                  mcpUrlWithToken={mcpUrlWithToken ?? mcpUrl}
                  bearerToken={bearer}
                  slug={slug}
                  authMode={mode}
                  oauthPassword={oauthPw}
                />
              </div>
            )}

          </div>
        );
      })()}

      {/* Danger Zone */}
      <div className="border border-danger-mid/20 rounded-xl p-6 bg-danger-mid/5">
        <h2 className="text-lg font-semibold text-danger mb-4">Danger Zone</h2>
        <div className="space-y-4">
          {isDeployed && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-fg-secondary">Undeploy</p>
                <p className="text-xs text-fg-faint mt-1">
                  Take the worker offline. You can redeploy later.
                </p>
              </div>
              <button
                onClick={async () => {
                  if (!confirm("This will delete the deployed worker. You can redeploy later. Continue?")) return;
                  setUndeploying(true);
                  try {
                    const res = await fetch(`/api/mcps/${slug}/undeploy`, {
                      method: "DELETE",
                    });
                    if (res.ok) {
                      const refreshed = await fetch(`/api/mcps/${slug}`).then((r) => r.json());
                      setData(refreshed);
                      setHealth(null);
                      setDeployResult(null);
                    } else {
                      const result = await res.json();
                      alert(result.error ?? "Failed to undeploy");
                    }
                  } catch {
                    alert("Failed to connect to server");
                  } finally {
                    setUndeploying(false);
                  }
                }}
                disabled={undeploying}
                className="px-4 py-2 bg-danger-dark/50 hover:bg-danger-dark/70 border border-danger-strong/50 rounded-lg text-sm text-danger transition-colors shrink-0 disabled:opacity-50"
              >
                {undeploying ? "Undeploying..." : "Undeploy"}
              </button>
            </div>
          )}
          {isDeployed && (
            <div className="border-t border-danger-mid/10" />
          )}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-fg-secondary">Remove</p>
              <p className="text-xs text-fg-faint mt-1">
                Undeploy the worker and permanently remove this MCP from the dashboard.
              </p>
            </div>
            <button
              onClick={async () => {
                if (!confirm("This will permanently remove this MCP from the dashboard. Continue?")) return;
                setRemoving(true);
                try {
                  const res = await fetch(`/api/mcps/${slug}/remove`, {
                    method: "DELETE",
                  });
                  if (res.ok) {
                    router.push("/");
                  } else {
                    const result = await res.json();
                    alert(result.error ?? "Failed to remove MCP");
                  }
                } catch {
                  alert("Failed to connect to server");
                } finally {
                  setRemoving(false);
                }
              }}
              disabled={removing}
              className="px-4 py-2 bg-danger-dark/50 hover:bg-danger-dark/70 border border-danger-strong/50 rounded-lg text-sm text-danger transition-colors shrink-0 disabled:opacity-50"
            >
              {removing ? "Removing..." : "Remove"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
