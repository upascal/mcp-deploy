"use client";

import { useState, useEffect } from "react";

export function CloudflareSetup() {
  const [status, setStatus] = useState<{
    configured: boolean;
    accountId: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cloudflare/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  async function handleConnect() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/cloudflare/setup", {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      setStatus({ configured: true, accountId: data.account ?? null });
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-edge rounded-xl p-6 bg-surface">
      <h2 className="text-lg font-semibold mb-2">Cloudflare Account</h2>

      <div className="flex items-center justify-between">
        <div>
          {status === null ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-fg-faint animate-pulse" />
              <span className="text-fg-faint">Checking...</span>
            </div>
          ) : status.configured ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-success">Connected</span>
              {status.accountId && (
                <span className="text-fg-faint">
                  {status.accountId}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-fg-faint" />
              <span className="text-fg-muted">Not connected</span>
            </div>
          )}

          <p className="text-xs text-fg-faint mt-1">
            Authentication via <code className="text-fg-muted">wrangler login</code> (opens browser)
          </p>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || status === null}
          className="px-4 py-2 bg-surface-raised hover:bg-surface-overlay border border-edge-subtle rounded-lg text-sm text-fg-secondary transition-colors disabled:opacity-50"
        >
          {loading
            ? "Connecting..."
            : status?.configured
              ? "Reconnect"
              : "Connect"}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-danger bg-danger-mid/10 border border-danger-mid/20 rounded-lg px-4 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
