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

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1">MCP Servers</h1>
          <p className="text-gray-400 text-sm">
            Manage your Model Context Protocol servers on Cloudflare Workers.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
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

      {cfConfigured === false && (
        <div className="border border-indigo-500/30 bg-indigo-500/5 rounded-xl p-4">
          <p className="text-sm text-indigo-400">
            Cloudflare is not configured yet.{" "}
            <a href="/setup" className="underline font-medium">
              Connect your account &rarr;
            </a>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mcps.map((mcp) => (
          <McpCard key={mcp.slug} {...mcp} />
        ))}

        {/* Add MCP Card */}
        <button
          onClick={() => setShowAddModal(true)}
          className="border-2 border-dashed border-gray-700 hover:border-gray-600 rounded-xl p-8 flex flex-col items-center justify-center transition-colors group"
        >
          <div className="w-12 h-12 rounded-full bg-gray-800 group-hover:bg-gray-700 flex items-center justify-center mb-3 transition-colors">
            <svg
              className="w-6 h-6 text-gray-500 group-hover:text-gray-400"
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
          <span className="text-sm text-gray-500 group-hover:text-gray-400 font-medium">
            Add MCP from GitHub
          </span>
        </button>
      </div>

      {mcps.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>No MCPs added yet. Click the button above to add one.</p>
        </div>
      )}

      <AddMcpModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={(slug) => {
          loadData();
        }}
      />
    </div>
  );
}
