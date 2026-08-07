"use client";

import { useEffect, useState } from "react";
import { McpCard } from "@/components/McpCard";
import { AddMcpModal } from "@/components/AddMcpModal";

interface McpSummary {
  slug: string;
  name: string;
  description: string;
  version: string;
  deployedVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  githubRepo: string;
  isDefault?: boolean;
  status: string;
  workerUrl: string | null;
  deployedAt: string | null;
  error?: string;
}

export default function Dashboard() {
  const [mcps, setMcps] = useState<McpSummary[]>([]);
  const [cfConfigured, setCfConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [checking, setChecking] = useState(false);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/mcps").then((r) => r.json()),
      fetch("/api/cloudflare/status").then((r) => r.json()),
    ])
      .then(([mcpData, cfData]) => {
        setMcps(mcpData.mcps ?? []);
        setCfConfigured(cfData.configured ?? false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      await fetch("/api/mcps/check-updates", { method: "POST" });
      loadData();
    } catch {
      // silently fail
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1">MCP Servers</h1>
          <p className="text-fg-muted text-sm">
            Manage your Model Context Protocol servers on Cloudflare Workers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={checkForUpdates}
            disabled={checking}
            className="px-4 py-2 bg-surface-raised hover:bg-surface-overlay disabled:opacity-50 text-fg-secondary text-sm font-medium rounded-lg transition-colors flex items-center gap-2 border border-edge-subtle"
          >
            <svg
              className={`w-4 h-4 ${checking ? "animate-spin" : ""}`}
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
            {checking ? "Checking..." : "Check for Updates"}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add MCP
          </button>
        </div>
      </div>

      {cfConfigured === false && (
        <div className="border border-accent-edge/30 bg-accent-edge/5 rounded-xl p-4">
          <p className="text-sm text-accent-fg">
            Cloudflare is not configured yet.{" "}
            <a href="/setup" className="underline font-medium">
              Connect your account &rarr;
            </a>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading && mcps.length === 0
          ? Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="border border-edge rounded-xl p-6 bg-surface animate-pulse"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="h-5 w-32 bg-surface-overlay rounded" />
                  <div className="h-5 w-16 bg-surface-overlay rounded-full" />
                </div>
                <div className="space-y-2 mb-4">
                  <div className="h-3 w-full bg-surface-raised rounded" />
                  <div className="h-3 w-2/3 bg-surface-raised rounded" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="h-3 w-16 bg-surface-raised rounded" />
                  <div className="h-3 w-24 bg-surface-raised rounded" />
                </div>
              </div>
            ))
          : mcps.map((mcp) => <McpCard key={mcp.slug} {...mcp} />)}

        {/* Add MCP Card */}
        <button
          onClick={() => setShowAddModal(true)}
          className="border-2 border-dashed border-edge-subtle hover:border-fg-disabled rounded-xl p-8 flex flex-col items-center justify-center transition-colors group"
        >
          <div className="w-12 h-12 rounded-full bg-surface-raised group-hover:bg-surface-overlay flex items-center justify-center mb-3 transition-colors">
            <svg
              className="w-6 h-6 text-fg-faint group-hover:text-fg-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </div>
          <span className="text-sm text-fg-faint group-hover:text-fg-muted font-medium">
            Add MCP from GitHub
          </span>
        </button>
      </div>

      {!loading && mcps.length === 0 && (
        <div className="text-center py-8 text-fg-faint">
          <p>No MCPs added yet. Click the button above to add one.</p>
        </div>
      )}

      <AddMcpModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={() => {
          loadData();
        }}
      />
    </div>
  );
}
