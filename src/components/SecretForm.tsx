"use client";

import { useState, useRef } from "react";
import type { SecretField } from "@/lib/types";

interface SecretFormProps {
  slug: string;
  fields: SecretField[];
  configuredKeys: string[];
  enabledPlatforms?: string[]; // If provided, filter optional fields by platform
}

export function SecretForm({
  slug,
  fields,
  configuredKeys: initialConfiguredKeys,
  enabledPlatforms,
}: SecretFormProps) {
  // Filter fields based on enabled platforms
  const visibleFields = fields.filter((field) => {
    if (field.required) return true; // Always show required fields
    if (!field.forPlatform) return true; // Show fields without platform restriction
    if (!enabledPlatforms) return true; // Show all if no platform filter provided
    return enabledPlatforms.includes(field.forPlatform); // Only show if platform is enabled
  });

  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});
  const [configuredKeys, setConfiguredKeys] =
    useState<string[]>(initialConfiguredKeys);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Track which keys have been auto-tested
  const autoTestedRef = useRef<Set<string>>(new Set());

  async function deleteSecret(key: string) {
    if (
      !confirm(
        `Are you sure you want to clear this value? This will remove it from Cloudflare.`
      )
    ) {
      return;
    }

    setDeletingKey(key);
    setMessage(null);

    try {
      const res = await fetch(`/api/mcps/${slug}/secrets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteKeys: [key] }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Failed to delete" });
      } else {
        setMessage({ type: "success", text: `Cleared successfully` });
        setConfiguredKeys(configuredKeys.filter((k) => k !== key));
        setEditing({ ...editing, [key]: false });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to connect to server" });
    } finally {
      setDeletingKey(null);
    }
  }

  async function testConnection(field: SecretField, isAutoTest = false) {
    // Must have a test spec
    if (!field.test) return;

    const value = values[field.key];
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
      for (const f of fields) {
        if (values[f.key]?.trim()) {
          allValues[f.key] = values[f.key];
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
      const data = await res.json();

      setTestResults({
        ...testResults,
        [field.key]: {
          success: data.success,
          message: data.success
            ? data.message ?? "Connection successful"
            : data.error ?? "Test failed",
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

  // Auto-test when API key field loses focus (blur) and has a value
  // Only auto-test for required fields, not optional ones
  function handleBlur(field: SecretField) {
    const value = values[field.key];
    if (
      field.test &&
      field.required &&
      value?.trim() &&
      !autoTestedRef.current.has(field.key)
    ) {
      autoTestedRef.current.add(field.key);
      testConnection(field, true);
    }
  }

  // Reset auto-test tracking when value changes significantly
  function handleValueChange(key: string, newValue: string) {
    const oldValue = values[key] ?? "";
    // Reset auto-test if value changed substantially
    if (Math.abs(newValue.length - oldValue.length) > 5 || !newValue) {
      autoTestedRef.current.delete(key);
      // Clear test result when user is typing new value
      if (testResults[key]) {
        setTestResults({
          ...testResults,
          [key]: undefined as unknown as { success: boolean; message: string },
        });
      }
    }
    setValues({ ...values, [key]: newValue });
  }

  function startEditing(key: string) {
    setEditing({ ...editing, [key]: true });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    // Only send non-empty values
    const secrets: Record<string, string> = {};
    for (const [key, val] of Object.entries(values)) {
      if (val.trim()) {
        secrets[key] = val.trim();
      }
    }

    if (Object.keys(secrets).length === 0) {
      setMessage({ type: "error", text: "No changes to save." });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/mcps/${slug}/secrets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secrets }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Failed to update" });
      } else {
        setMessage({
          type: "success",
          text: `Saved successfully`,
        });
        setValues({});
        setEditing({});
        // Update configured keys with newly saved ones
        setConfiguredKeys([
          ...new Set([...configuredKeys, ...data.updatedKeys]),
        ]);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to connect to server" });
    } finally {
      setLoading(false);
    }
  }

  if (visibleFields.length === 0) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {visibleFields.map((field) => {
        const isConfigured = configuredKeys.includes(field.key);
        const isEditing = editing[field.key] || !isConfigured;
        const hasTestSpec = !!field.test;
        const hasNewValue = !!values[field.key]?.trim();

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

            {/* Show filled state or edit state */}
            {isConfigured && !isEditing ? (
              // Configured but not editing - show masked value
              <div className="flex gap-2">
                <div className="flex-1 px-4 py-2.5 bg-gray-800/50 border border-emerald-500/30 rounded-lg text-sm text-gray-400 font-mono">
                  ••••••••••••
                </div>
                <button
                  type="button"
                  onClick={() => startEditing(field.key)}
                  className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => deleteSecret(field.key)}
                  disabled={deletingKey === field.key}
                  className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-medium rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  {deletingKey === field.key ? "Clearing..." : "Clear"}
                </button>
              </div>
            ) : (
              // Not configured or editing - show input
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={field.type === "password" ? "password" : "text"}
                    id={`${slug}-update-${field.key}`}
                    name={`${slug}-update-${field.key}`}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    value={values[field.key] ?? ""}
                    onChange={(e) =>
                      handleValueChange(field.key, e.target.value)
                    }
                    onBlur={() => handleBlur(field)}
                    placeholder={field.placeholder}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                {/* Test button - only show when there's a test spec and a value to test */}
                {hasTestSpec && hasNewValue && (
                  <button
                    type="button"
                    onClick={() => testConnection(field)}
                    disabled={testingKey === field.key}
                    className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                  >
                    {testingKey === field.key ? "Testing..." : "Test"}
                  </button>
                )}
                {/* Cancel button if editing an existing value */}
                {isConfigured && isEditing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing({ ...editing, [field.key]: false });
                      setValues({ ...values, [field.key]: "" });
                      setTestResults({
                        ...testResults,
                        [field.key]: undefined as unknown as {
                          success: boolean;
                          message: string;
                        },
                      });
                    }}
                    className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-400 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}

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

      {message && (
        <p
          className={`text-sm rounded-lg px-4 py-2 ${
            message.type === "success"
              ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
              : "text-red-400 bg-red-500/10 border border-red-500/20"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* Only show save button if there are changes */}
      {Object.values(values).some((v) => v?.trim()) && (
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? "Saving..." : "Save Changes"}
        </button>
      )}
    </form>
  );
}
