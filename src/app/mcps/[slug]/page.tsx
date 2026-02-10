"use client";

import { useEffect, useState, useRef, use } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { SecretForm } from "@/components/SecretForm";
import { McpConfigForm } from "@/components/McpConfigForm";
import { ClaudeConfigSnippet } from "@/components/ClaudeConfigSnippet";
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

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
    );
  }
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
      />
    </svg>
  );
}

export default function McpDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [data, setData] = useState<McpDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);
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
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  // Check health if deployed
  useEffect(() => {
    if (data?.deployment?.status === "deployed") {
      fetch(`/api/mcps/${slug}/status`)
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => {});
    }
  }, [slug, data?.deployment?.status]);

  async function handleDeploy() {
    if (!isDeployed && !validateForm()) return;

    setDeploying(true);
    setDeployError(null);
    setDeployResult(null);

    try {
      const res = await fetch(`/api/mcps/${slug}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secrets: secretValues,
          config: configValues,
          authMode,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setDeployError(result.error ?? "Deployment failed");
      } else {
        setDeployResult(result);
        // Refresh data
        const refreshed = await fetch(`/api/mcps/${slug}`).then((r) =>
          r.json()
        );
        setData(refreshed);
      }
    } catch {
      setDeployError("Failed to connect to server");
    } finally {
      setDeploying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">MCP not found.</p>
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
          <p className="text-gray-400 text-sm">{data.description}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span>v{data.version}</span>
            {data.githubRepo && (
              <a
                href={`https://github.com/${data.githubRepo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:underline"
              >
                Source &rarr;
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Health Status */}
      {isDeployed && health && (
        <div
          className={`border rounded-xl p-4 ${
            health.healthy
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-red-500/30 bg-red-500/5"
          }`}
        >
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                health.healthy ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            <span
              className={health.healthy ? "text-emerald-400" : "text-red-400"}
            >
              {health.healthy ? "Healthy" : "Unhealthy"}
            </span>
            {data.deployment?.workerUrl && (
              <span className="text-gray-500 ml-2">
                {data.deployment.workerUrl}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Update Available Banner */}
      {data.updateAvailable && data.deployedVersion && data.latestVersion && (
        <div className="border border-teal-500/30 bg-teal-500/5 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-teal-400"
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
                <p className="text-sm font-medium text-teal-400">
                  Update Available
                </p>
                <p className="text-xs text-gray-400">
                  {data.deployedVersion} → {data.latestVersion}
                </p>
              </div>
            </div>
            <button
              onClick={handleDeploy}
              disabled={deploying}
              className="px-4 py-2 bg-teal-500/20 hover:bg-teal-500/30 border border-teal-500/30 text-teal-400 text-sm font-medium rounded-lg transition-colors"
            >
              {deploying ? "Updating..." : "Update Now"}
            </button>
          </div>
        </div>
      )}

      {/* Deployment Error */}
      {data.deployment?.status === "failed" && data.deployment.error && (
        <div className="border border-red-500/30 bg-red-500/5 rounded-xl p-4">
          <p className="text-sm text-red-400">
            Last deployment failed: {data.deployment.error}
          </p>
        </div>
      )}

      {/* Configuration */}
      {(data.config ?? []).length > 0 && (
        <div className="border border-gray-800 rounded-xl p-6 bg-gray-900/50">
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
        <div className="border border-gray-800 rounded-xl p-6 bg-gray-900/50">
          <h2 className="text-lg font-semibold mb-4">API Keys</h2>
          <div className="space-y-4">
            {visibleSecrets.map((field) => (
                <div key={field.key}>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-1.5">
                    {field.label}
                    {field.required ? (
                      <span className="text-indigo-400 text-xs">required</span>
                    ) : (
                      <span className="text-gray-500 text-xs">optional</span>
                    )}
                  </label>
                  {field.helpText && (
                    <p className="text-xs text-gray-500 mb-2">
                      {field.helpText}
                      {field.helpUrl && (
                        <>
                          {" "}
                          <a
                            href={field.helpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-400 hover:underline"
                          >
                            Get key &rarr;
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
                        className={`w-full px-4 py-2.5 pr-10 bg-gray-800 border rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 ${
                          validationErrors[field.key]
                            ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                            : "border-gray-700 focus:border-indigo-500 focus:ring-indigo-500"
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
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                        >
                          <EyeIcon open={secretVisible[field.key] ?? false} />
                        </button>
                      )}
                    </div>
                  </div>
                  {testResults[field.key] && (
                    <p
                      className={`text-xs mt-2 ${
                        testResults[field.key].success
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {testResults[field.key].success ? "✓" : "✗"}{" "}
                      {testResults[field.key].message}
                    </p>
                  )}
                  {validationErrors[field.key] && (
                    <p className="text-xs mt-1.5 text-red-400">
                      {validationErrors[field.key]}
                    </p>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Deploy Button */}
      <div className="border border-gray-800 rounded-xl p-6 bg-gray-900/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {isDeployed ? "Redeploy" : "Deploy"}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {isDeployed
                ? "Redeploy with the latest bundle and configuration."
                : "Deploy this MCP server to your Cloudflare Workers account."}
            </p>
          </div>
          <button
            onClick={handleDeploy}
            disabled={deploying || hasRequiredFieldsMissing}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {deploying
              ? "Deploying..."
              : isDeployed
                ? "Redeploy"
                : "Deploy to Cloudflare"}
          </button>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Authentication
          </label>
          <select
            value={authMode}
            onChange={(e) =>
              setAuthMode(e.target.value as "bearer" | "oauth" | "open")
            }
            className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="bearer">Bearer token (default)</option>
            <option value="oauth">OAuth 2.1 (password protected)</option>
            <option value="open">Open (no authentication)</option>
          </select>
          {authMode === "oauth" && (
            <p className="text-xs text-gray-500 mt-2">
              OAuth requires a password prompt during authorization. Bearer tokens are not accepted.
            </p>
          )}
          {authMode === "open" && (
            <p className="text-xs text-red-400 mt-2">
              Warning: Anyone with the URL can access this MCP.
            </p>
          )}
        </div>

        {deployError && (
          <p className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
            {deployError}
          </p>
        )}
      </div>

      {/* Deploy Result (fresh) */}
      {deployResult && (
        <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-4">
          <p className="text-sm text-emerald-400">
            Successfully deployed to {deployResult.workerUrl}
          </p>
        </div>
      )}

      {/* Credentials & Connection Info (persistent) */}
      {(() => {
        const oauthPw = deployResult?.oauthPassword ?? data.credentials?.oauthPassword;
        const bearer = deployResult?.bearerToken ?? data.credentials?.bearerToken;
        const mode = deployResult?.authMode ?? data.deployment?.authMode ?? "bearer";
        const workerUrl = deployResult?.workerUrl ?? data.deployment?.workerUrl;
        const mcpUrl = deployResult?.mcpUrl ?? (workerUrl ? `${workerUrl}/mcp` : null);
        const mcpUrlWithToken = deployResult?.mcpUrlWithToken ?? (bearer && workerUrl ? `${workerUrl}/mcp/t/${bearer}` : mcpUrl);

        if (!isDeployed && !deployResult) return null;

        return (
          <div className="space-y-4">
            {mode === "oauth" && oauthPw && (
              <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-4">
                <p className="text-sm text-amber-300 mb-2">OAuth password</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-gray-800 rounded-lg text-sm text-amber-200 break-all">
                    {oauthPw}
                  </code>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(oauthPw);
                      setPasswordCopied(true);
                      setTimeout(() => setPasswordCopied(false), 2000);
                    }}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-300 transition-colors shrink-0"
                  >
                    {passwordCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            {mcpUrl && (
              <div>
                <h2 className="text-lg font-semibold mb-3">Connect to Claude</h2>
                <ClaudeConfigSnippet
                  mcpUrl={mcpUrl}
                  mcpUrlWithToken={mcpUrlWithToken ?? mcpUrl}
                  bearerToken={bearer}
                  slug={slug}
                  authMode={mode}
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* Secret Management (post-deploy) */}
      {isDeployed && (data.secrets ?? []).length > 0 && (
        <div className="border border-gray-800 rounded-xl p-6 bg-gray-900/50">
          <h2 className="text-lg font-semibold mb-4">Update Secrets</h2>
          <p className="text-sm text-gray-400 mb-4">
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
    </div>
  );
}
