"use client";

import { useState } from "react";

interface ClaudeConfigSnippetProps {
  mcpUrl: string;
  mcpUrlWithToken: string;
  bearerToken: string;
  slug: string;
}

export function ClaudeConfigSnippet({
  mcpUrl,
  mcpUrlWithToken,
  bearerToken,
  slug,
}: ClaudeConfigSnippetProps) {
  const [tab, setTab] = useState<"ui" | "json" | "cli">("ui");
  const [copied, setCopied] = useState(false);

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        [slug]: {
          command: "npx",
          args: [
            "mcp-remote",
            mcpUrl,
            "--header",
            "Authorization:${AUTH_HEADER}",
          ],
          env: {
            AUTH_HEADER: `Bearer ${bearerToken}`,
          },
        },
      },
    },
    null,
    2,
  );

  const cliCommand = `claude mcp add-json ${slug} '${JSON.stringify({
    command: "npx",
    args: [
      "mcp-remote",
      mcpUrl,
      "--header",
      "Authorization:${AUTH_HEADER}",
    ],
    env: { AUTH_HEADER: `Bearer ${bearerToken}` },
  })}'`;

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const tabs = [
    { id: "ui" as const, label: "Claude Desktop UI" },
    { id: "json" as const, label: "JSON Config" },
    { id: "cli" as const, label: "Claude Code CLI" },
  ];

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex border-b border-gray-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? "bg-gray-800 text-blue-400 border-b-2 border-blue-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === "ui" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">
              Go to <strong>Settings &rarr; Connectors &rarr; Add custom
              connector</strong> and paste this URL:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-gray-800 rounded-lg text-sm text-blue-400 break-all">
                {mcpUrlWithToken}
              </code>
              <button
                onClick={() => copy(mcpUrlWithToken)}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-300 transition-colors shrink-0"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Your bearer token is embedded in the URL. Keep it private.
            </p>
          </div>
        )}

        {tab === "json" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">
              Add to your <code className="text-blue-400">claude_desktop_config.json</code>:
            </p>
            <div className="relative">
              <pre className="px-4 py-3 bg-gray-800 rounded-lg text-xs text-gray-300 overflow-x-auto">
                {claudeConfig}
              </pre>
              <button
                onClick={() => copy(claudeConfig)}
                className="absolute top-2 right-2 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-400 transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {tab === "cli" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">Run in your terminal:</p>
            <div className="relative">
              <pre className="px-4 py-3 bg-gray-800 rounded-lg text-xs text-gray-300 overflow-x-auto">
                {cliCommand}
              </pre>
              <button
                onClick={() => copy(cliCommand)}
                className="absolute top-2 right-2 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-400 transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
