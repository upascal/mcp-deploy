"use client";

import { useState, useEffect } from "react";

export function CloudflareSetup() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<{
    configured: boolean;
    accountId: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    fetch("/api/cloudflare/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/cloudflare/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: token }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to validate token");
        return;
      }

      setSuccess(
        `Connected to account: ${data.accountName ?? data.accountId}`,
      );
      setStatus({ configured: true, accountId: data.accountId });
      setToken("");
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Current Status */}
      <div className="border border-gray-800 rounded-xl p-6 bg-gray-900/50">
        <h2 className="text-lg font-semibold mb-2">Cloudflare Account</h2>
        {status?.configured ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-emerald-400">Connected</span>
            <span className="text-gray-500">
              Account: {status.accountId}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            <span className="text-gray-400">Not connected</span>
          </div>
        )}
      </div>

      {/* Token Form */}
      <div className="border border-gray-800 rounded-xl p-6 bg-gray-900/50">
        <h2 className="text-lg font-semibold mb-2">
          {status?.configured ? "Update" : "Connect"} API Token
        </h2>
        <p className="text-sm text-gray-400 mb-2">
          Create a Cloudflare API token with{" "}
          <code className="text-indigo-400 bg-gray-800 px-1.5 py-0.5 rounded text-xs">
            Workers Scripts:Edit
          </code>{" "}
          and{" "}
          <code className="text-indigo-400 bg-gray-800 px-1.5 py-0.5 rounded text-xs">
            Account Settings:Read
          </code>{" "}
          permissions.{" "}
          <a
            href="https://dash.cloudflare.com/profile/api-tokens"
            target="_blank"
            rel="noopener"
            className="text-indigo-400 hover:underline"
          >
            Create token &rarr;
          </a>
        </p>

        <button
          type="button"
          onClick={() => setShowHelp(!showHelp)}
          className="text-sm text-gray-500 hover:text-gray-300 flex items-center gap-1 mb-4 transition-colors"
        >
          <span className={`transition-transform ${showHelp ? "rotate-90" : ""}`}>▶</span>
          Need help?
        </button>

        {showHelp && (
          <div className="text-sm text-gray-400 bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-4 space-y-3">
            <p className="font-medium text-gray-300">How to create the token:</p>
            <ol className="list-decimal list-inside space-y-2 text-gray-400">
              <li>
                <strong className="text-gray-300">Permissions</strong> — you need two rows:
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1 text-gray-500">
                  <li>Row 1: <code className="text-indigo-400 bg-gray-800 px-1 rounded text-xs">Account</code> → <code className="text-indigo-400 bg-gray-800 px-1 rounded text-xs">Workers Scripts</code> → <code className="text-indigo-400 bg-gray-800 px-1 rounded text-xs">Edit</code></li>
                  <li>Row 2: Click <span className="text-indigo-400">+ Add more</span>, then: <code className="text-indigo-400 bg-gray-800 px-1 rounded text-xs">Account</code> → <code className="text-indigo-400 bg-gray-800 px-1 rounded text-xs">Account Settings</code> → <code className="text-indigo-400 bg-gray-800 px-1 rounded text-xs">Read</code></li>
                </ul>
              </li>
              <li>
                <strong className="text-gray-300">Account Resources:</strong> <code className="text-gray-500">Include → All accounts</code> (already set, leave it)
              </li>
              <li>
                <strong className="text-gray-300">Client IP Address Filtering:</strong> Leave blank (skip it)
              </li>
              <li>
                <strong className="text-gray-300">TTL:</strong> Leave blank (no expiration)
              </li>
            </ol>
            <p className="text-gray-500 text-xs pt-2">Click <strong>Continue to summary</strong> → <strong>Create Token</strong>, then copy the token.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            id="cloudflare-api-token"
            name="cloudflare-api-token"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your Cloudflare API token"
            className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={!token || loading}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? "Validating..." : "Save & Validate"}
          </button>
        </form>
      </div>
    </div>
  );
}
