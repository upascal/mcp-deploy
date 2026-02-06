"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function AuthorizeContent() {
  const searchParams = useSearchParams();

  const clientId = searchParams.get("client_id") ?? "";
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  const responseType = searchParams.get("response_type") ?? "";
  const codeChallenge = searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") ?? "";
  const scope = searchParams.get("scope") ?? "mcp";
  const state = searchParams.get("state") ?? "";
  const resource = searchParams.get("resource") ?? "";
  const error = searchParams.get("error");

  // Extract a readable name from the resource URL
  const resourceName = resource
    ? new URL(resource).hostname.replace(".workers.dev", "")
    : "an MCP server";

  const missingParams = !clientId || !redirectUri || !codeChallenge;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="border border-gray-800 rounded-2xl bg-gray-900/80 p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-indigo-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white">
              Authorize MCP Access
            </h1>
            <p className="text-gray-400 text-sm mt-2">
              An application is requesting access to:
            </p>
            <p className="text-indigo-400 font-mono text-sm mt-1">
              {resourceName}
            </p>
          </div>

          {missingParams ? (
            <div className="text-center">
              <p className="text-red-400 text-sm">
                Invalid authorization request. Missing required parameters.
              </p>
            </div>
          ) : (
            <form action="/api/oauth/approve" method="POST">
              {/* Hidden fields to pass through to the approve endpoint */}
              <input type="hidden" name="client_id" value={clientId} />
              <input type="hidden" name="redirect_uri" value={redirectUri} />
              <input type="hidden" name="response_type" value={responseType} />
              <input
                type="hidden"
                name="code_challenge"
                value={codeChallenge}
              />
              <input
                type="hidden"
                name="code_challenge_method"
                value={codeChallengeMethod}
              />
              <input type="hidden" name="scope" value={scope} />
              <input type="hidden" name="state" value={state} />
              <input type="hidden" name="resource" value={resource} />

              {/* Scope display */}
              <div className="mb-6 p-3 bg-gray-800 rounded-lg">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                  Requested permissions
                </p>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-sm text-gray-300">
                    Access MCP tools and resources
                  </span>
                </div>
              </div>

              {/* Password field (shown if OAUTH_PASSWORD is configured) */}
              <div className="mb-6">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-300 mb-1.5"
                >
                  Authorization password
                </label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter your deploy password"
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  The password configured in your mcp-deploy instance.
                </p>
              </div>

              {error === "invalid_password" && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-sm text-red-400">
                    Incorrect password. Please try again.
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Authorize
                </button>
                <a
                  href={`${redirectUri}?error=access_denied&error_description=User%20denied%20access${state ? `&state=${encodeURIComponent(state)}` : ""}`}
                  className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition-colors text-center"
                >
                  Deny
                </a>
              </div>
            </form>
          )}

          {/* Footer */}
          <p className="text-xs text-gray-600 text-center mt-6">
            Powered by mcp-deploy
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 flex items-center justify-center">
          <p className="text-gray-500">Loading...</p>
        </div>
      }
    >
      <AuthorizeContent />
    </Suspense>
  );
}
