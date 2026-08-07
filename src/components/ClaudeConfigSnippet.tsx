"use client";

import { useState } from "react";
import { EyeIcon } from "./EyeIcon";

interface ClaudeConfigSnippetProps {
  mcpUrl: string;
  mcpUrlWithToken: string;
  bearerToken: string | null;
  slug: string;
  authMode?: "bearer" | "oauth" | "open";
  oauthPassword?: string | null;
}

export function ClaudeConfigSnippet({
  mcpUrl,
  mcpUrlWithToken,
  bearerToken,
  slug,
  authMode = "bearer",
  oauthPassword,
}: ClaudeConfigSnippetProps) {
  const [tab, setTab] = useState<"ui" | "json">("ui");
  const [copied, setCopied] = useState(false);
  const [pwVisible, setPwVisible] = useState(false);
  const [pwCopied, setPwCopied] = useState(false);

  const urlToShow = authMode === "bearer" ? mcpUrlWithToken : mcpUrl;

  // Config for mcp-remote
  const jsonConfig = authMode === "bearer"
    ? {
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
            AUTH_HEADER: `Bearer ${bearerToken ?? ""}`,
          },
        },
      },
    }
    : {
      mcpServers: {
        [slug]: {
          command: "npx",
          args: ["mcp-remote", mcpUrl],
        },
      },
    };

  const jsonConfigText = JSON.stringify(jsonConfig, null, 2);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for insecure contexts (HTTP dev server)
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyPassword() {
    if (!oauthPassword) return;
    try {
      await navigator.clipboard.writeText(oauthPassword);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = oauthPassword;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setPwCopied(true);
    setTimeout(() => setPwCopied(false), 2000);
  }

  const tabs = [
    { id: "ui" as const, label: "Claude Desktop UI" },
    { id: "json" as const, label: "JSON Config" },
  ];

  const passwordBlock = oauthPassword && authMode === "oauth" && (
    <div className="mt-3 pt-3 border-t border-edge-subtle/50">
      <p className="text-xs text-fg-faint mb-2">
        OAuth password
      </p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <div className="w-full px-4 py-2.5 pr-10 bg-surface-raised border border-edge-subtle rounded-lg text-sm text-fg font-mono break-all">
            {pwVisible ? oauthPassword : "\u2022".repeat(24)}
          </div>
          <button
            onClick={() => setPwVisible(!pwVisible)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg-secondary transition-colors"
            title={pwVisible ? "Hide password" : "Show password"}
          >
            <EyeIcon open={pwVisible} />
          </button>
        </div>
        <button
          onClick={copyPassword}
          className="px-3 py-2.5 bg-surface-overlay hover:bg-edge-subtle rounded-lg text-xs text-fg-secondary transition-colors shrink-0"
        >
          {pwCopied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="border border-edge rounded-xl overflow-hidden">
      <div className="flex border-b border-edge">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors ${tab === t.id
              ? "bg-surface-raised text-accent-fg border-b-2 border-accent-fg"
              : "text-fg-faint hover:text-fg-secondary"
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === "ui" && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              Go to{" "}
              <strong>
                Settings &rarr; Connectors &rarr; Add custom connector
              </strong>{" "}
              and paste this URL:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-surface-raised border border-edge-subtle rounded-lg text-sm text-accent-fg break-all">
                {urlToShow}
              </code>
              <button
                onClick={() => copy(urlToShow)}
                className="px-3 py-2 bg-surface-overlay hover:bg-edge-subtle rounded-lg text-xs text-fg-secondary transition-colors shrink-0"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            {authMode === "bearer" && (
              <p className="text-xs text-fg-faint">
                Your bearer token is embedded in the URL. Keep it private.
              </p>
            )}
            {authMode === "oauth" && (
              <p className="text-xs text-fg-faint">
                After adding the connector, click <strong>Configure</strong> when
                prompted. Enter the password below in the authorization dialog.
              </p>
            )}
            {authMode === "open" && (
              <p className="text-xs text-danger">
                This MCP is deployed without authentication. Anyone with the URL can access it.
              </p>
            )}
            {passwordBlock}
          </div>
        )}

        {tab === "json" && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              Add to your{" "}
              <code className="text-accent-fg">claude_desktop_config.json</code>:
            </p>
            <div className="relative">
              <pre className="px-4 py-3 bg-surface-raised rounded-lg text-xs text-fg-secondary overflow-x-auto">
                {jsonConfigText}
              </pre>
              <button
                onClick={() => copy(jsonConfigText)}
                className="absolute top-2 right-2 px-2 py-1 bg-surface-overlay hover:bg-edge-subtle rounded text-xs text-fg-muted transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            {authMode === "bearer" && (
              <p className="text-xs text-fg-faint">
                Uses <code>mcp-remote</code> with bearer token authentication.
              </p>
            )}
            {authMode === "oauth" && (
              <p className="text-xs text-fg-faint">
                On first connect, your browser will open for OAuth authorization.
                Enter the password below when prompted.
              </p>
            )}
            {authMode === "open" && (
              <p className="text-xs text-danger">
                This MCP is open. No authentication headers are sent.
              </p>
            )}
            {passwordBlock}
          </div>
        )}
      </div>
    </div>
  );
}
