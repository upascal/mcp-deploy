"use client";

import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: (slug: string) => void;
}

export function AddMcpModal({ open, onClose, onAdded }: Props) {
  const [repo, setRepo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{
    valid: boolean;
    name?: string;
    version?: string;
    repo?: string;
    slug?: string;
  } | null>(null);

  const resetState = () => {
    setRepo("");
    setError(null);
    setValidation(null);
    setValidating(false);
    setLoading(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const validateRepo = async () => {
    if (!repo.trim()) return;

    setValidating(true);
    setError(null);
    setValidation(null);

    try {
      const res = await fetch(
        `/api/mcps/validate?repo=${encodeURIComponent(repo.trim())}`
      );
      const data = await res.json();

      if (data.valid) {
        setValidation({
          valid: true,
          name: data.name,
          version: data.version,
          repo: data.repo,
          slug: data.slug,
        });
      } else {
        setError(data.error || "Invalid repository");
        setValidation(null);
      }
    } catch {
      setError("Failed to validate repository");
    } finally {
      setValidating(false);
    }
  };

  const addMcp = async () => {
    if (!validation?.valid) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/mcps/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubRepo: validation.repo || repo.trim(),
          slug: validation.slug,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to add MCP");
        return;
      }

      onAdded(data.slug);
      handleClose();
    } catch {
      setError("Failed to add MCP");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-100">Add MCP Server</h2>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              GitHub Repository
            </label>
            <input
              type="text"
              value={repo}
              onChange={(e) => {
                setRepo(e.target.value);
                setValidation(null);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !validation?.valid) {
                  e.preventDefault();
                  validateRepo();
                }
              }}
              placeholder="owner/repo or https://github.com/owner/repo"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Repository must have releases with <code>worker.mjs</code> and{" "}
              <code>mcp-deploy.json</code>
            </p>
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              {error}
            </div>
          )}

          {validation?.valid && (
            <div className="text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              <div className="font-medium">{validation.name}</div>
              <div className="text-emerald-400/70 text-xs mt-0.5">
                Version {validation.version}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors"
            >
              Cancel
            </button>

            {!validation?.valid ? (
              <button
                onClick={validateRepo}
                disabled={!repo.trim() || validating}
                className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-medium transition-colors"
              >
                {validating ? "Checking..." : "Check Repository"}
              </button>
            ) : (
              <button
                onClick={addMcp}
                disabled={loading}
                className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-medium transition-colors"
              >
                {loading ? "Adding..." : "Add MCP"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
