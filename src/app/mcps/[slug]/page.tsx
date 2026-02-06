"use client";

import { useEffect, useState, use } from "react";
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
}

interface DeployResult {
  success: boolean;
  workerUrl: string;
  mcpUrl: string;
  mcpUrlWithToken: string;
  bearerToken: string;
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
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [secretVisible, setSecretVisible] = useState<Record<string, boolean>>(
    {}
  );
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});
  const [health, setHealth] = useState<{
    healthy: boolean;
    status?: number;
  } | null>(null);

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

    setTestingKey(field.key);
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
    } finally {
      setTestingKey(null);
    }
  }

  useEffect(() => {
    fetch(`/api/mcps/${slug}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
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

  // Check if a field has all its dependencies filled (for {{FIELD_KEY}} substitution)
  const canTestField = (field: SecretField): boolean => {
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
  };

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
                rel="noopener"
                className="text-blue-400 hover:underline"
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
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-amber-400"
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
                <p className="text-sm font-medium text-amber-400">
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
              className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 text-sm font-medium rounded-lg transition-colors"
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
            {visibleSecrets.map((field) => {
              const hasTestSpec = !!field.test;
              const canTest = canTestField(field);

              return (
                <div key={field.key}>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-1.5">
                    {field.label}
                    {field.required ? (
                      <span className="text-blue-400 text-xs">required</span>
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
                            rel="noopener"
                            className="text-blue-400 hover:underline"
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
                          setSecretValues({
                            ...secretValues,
                            [field.key]: e.target.value,
                          })
                        }
                        placeholder={field.placeholder}
                        className="w-full px-4 py-2.5 pr-10 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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
                    {hasTestSpec && canTest && (
                      <button
                        type="button"
                        onClick={() => testConnection(field)}
                        disabled={testingKey === field.key}
                        className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                      >
                        {testingKey === field.key ? "Testing..." : "Test"}
                      </button>
                    )}
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
                </div>
              );
            })}
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
            disabled={deploying}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {deploying
              ? "Deploying..."
              : isDeployed
                ? "Redeploy"
                : "Deploy to Cloudflare"}
          </button>
        </div>

        {deployError && (
          <p className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
            {deployError}
          </p>
        )}
      </div>

      {/* Deploy Result */}
      {deployResult && (
        <div className="space-y-4">
          <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-4">
            <p className="text-sm text-emerald-400">
              Successfully deployed to {deployResult.workerUrl}
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Connect to Claude</h2>
            <ClaudeConfigSnippet
              mcpUrl={deployResult.mcpUrl}
              mcpUrlWithToken={deployResult.mcpUrlWithToken}
              bearerToken={deployResult.bearerToken}
              slug={slug}
              oauthEnabled={deployResult.oauthEnabled}
            />
          </div>
        </div>
      )}

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
