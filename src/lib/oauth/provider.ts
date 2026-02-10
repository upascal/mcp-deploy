/**
 * OAuth 2.1 Authorization Server provider for mcp-deploy.
 *
 * Supports:
 * - Authorization Code flow with PKCE (mandatory per OAuth 2.1)
 * - Dynamic Client Registration (RFC 7591)
 * - Resource Indicators (RFC 8707)
 */

import { randomBytes, createHash } from "crypto";
import { signJWT, generateTokenId } from "./jwt";
import {
  storeAuthCode,
  getAuthCode,
  deleteAuthCode,
  storeOAuthClient,
  getDeploymentJWTSecret,
  getSlugForWorkerUrl,
} from "./store";
import type {
  OAuthClient,
  AuthorizationCode,
  AccessTokenClaims,
  OAuthError,
} from "./types";

const ACCESS_TOKEN_TTL = 3600; // 1 hour

/**
 * Get the base URL for this mcp-deploy instance.
 */
export function getIssuerUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Build the OAuth 2.0 Authorization Server Metadata (RFC 8414).
 */
export function getAuthServerMetadata() {
  const issuer = getIssuerUrl();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "none",
    ],
    scopes_supported: ["mcp"],
    service_documentation: `${issuer}`,
  };
}

// ─── Dynamic Client Registration ───

export async function registerClient(
  request: Record<string, unknown>
): Promise<OAuthClient | OAuthError> {
  const redirectUris = request.redirect_uris as string[] | undefined;
  if (!redirectUris || redirectUris.length === 0) {
    return {
      error: "invalid_client_metadata",
      error_description: "redirect_uris is required",
    };
  }

  const clientId = randomBytes(16).toString("hex");
  const clientSecret = randomBytes(32).toString("hex");

  const client: OAuthClient = {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: (request.client_name as string) ?? "Unknown Client",
    redirect_uris: redirectUris,
    grant_types: (request.grant_types as string[]) ?? ["authorization_code"],
    response_types: (request.response_types as string[]) ?? ["code"],
    scope: (request.scope as string) ?? "mcp",
    token_endpoint_auth_method:
      (request.token_endpoint_auth_method as string) ?? "client_secret_post",
    created_at: Math.floor(Date.now() / 1000),
  };

  storeOAuthClient(client);

  return client;
}

// ─── Authorization ───

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
  state?: string;
  resource?: string;
}

export function validateAuthorizeParams(
  params: Record<string, string | undefined>
): AuthorizeParams | OAuthError {
  const {
    client_id,
    redirect_uri,
    response_type,
    code_challenge,
    code_challenge_method,
    scope,
    state,
    resource,
  } = params;

  if (!client_id) {
    return { error: "invalid_request", error_description: "client_id required" };
  }
  if (!redirect_uri) {
    return {
      error: "invalid_request",
      error_description: "redirect_uri required",
    };
  }
  if (response_type !== "code") {
    return {
      error: "unsupported_response_type",
      error_description: "Only 'code' response_type is supported",
    };
  }
  if (!code_challenge) {
    return {
      error: "invalid_request",
      error_description: "code_challenge required (PKCE is mandatory)",
    };
  }
  if (code_challenge_method !== "S256") {
    return {
      error: "invalid_request",
      error_description: "Only S256 code_challenge_method is supported",
    };
  }

  return {
    client_id,
    redirect_uri,
    response_type,
    code_challenge,
    code_challenge_method,
    scope: scope ?? "mcp",
    state,
    resource: resource ?? "",
  };
}

/**
 * Generate an authorization code after user consent.
 */
export async function generateAuthCode(
  params: AuthorizeParams
): Promise<string> {
  const code = randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);

  const authCode: AuthorizationCode = {
    code,
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    codeChallengeMethod: params.code_challenge_method,
    scope: params.scope ?? "mcp",
    resource: params.resource ?? "",
    state: params.state,
    createdAt: now,
    expiresAt: now + 600, // 10 minutes
  };

  storeAuthCode(authCode);
  return code;
}

// ─── Token Exchange ───

/**
 * Exchange an authorization code for an access token.
 */
export async function exchangeCodeForToken(params: {
  grant_type: string;
  code: string;
  redirect_uri: string;
  client_id: string;
  code_verifier: string;
}): Promise<
  | { access_token: string; token_type: string; expires_in: number; scope: string }
  | OAuthError
> {
  if (params.grant_type !== "authorization_code") {
    return {
      error: "unsupported_grant_type",
      error_description: "Only authorization_code is supported",
    };
  }

  // Look up the authorization code
  const authCode = getAuthCode(params.code);
  if (!authCode) {
    return { error: "invalid_grant", error_description: "Invalid or expired authorization code" };
  }

  // Verify the code hasn't expired
  const now = Math.floor(Date.now() / 1000);
  if (authCode.expiresAt < now) {
    deleteAuthCode(params.code);
    return { error: "invalid_grant", error_description: "Authorization code expired" };
  }

  // Verify client_id matches
  if (authCode.clientId !== params.client_id) {
    return { error: "invalid_grant", error_description: "client_id mismatch" };
  }

  // Verify redirect_uri matches
  if (authCode.redirectUri !== params.redirect_uri) {
    return { error: "invalid_grant", error_description: "redirect_uri mismatch" };
  }

  // Verify PKCE code_verifier against stored code_challenge
  const computedChallenge = createHash("sha256")
    .update(params.code_verifier)
    .digest("base64url");

  if (computedChallenge !== authCode.codeChallenge) {
    return {
      error: "invalid_grant",
      error_description: "PKCE code_verifier verification failed",
    };
  }

  // Delete the code (single use)
  deleteAuthCode(params.code);

  // Find the JWT secret for the target resource
  const resource = authCode.resource;
  const slug = getSlugForWorkerUrl(resource);
  if (!slug) {
    return {
      error: "invalid_grant",
      error_description: "Unknown resource - MCP server not found",
    };
  }

  const jwtSecret = getDeploymentJWTSecret(slug);
  if (!jwtSecret) {
    return {
      error: "server_error",
      error_description: "JWT signing key not found for this deployment",
    };
  }

  // Issue an access token (JWT)
  const issuer = getIssuerUrl();
  const claims: AccessTokenClaims = {
    iss: issuer,
    sub: "mcp-user",
    aud: resource,
    scope: authCode.scope,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
    jti: generateTokenId(),
  };

  const accessToken = signJWT(claims, jwtSecret);

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL,
    scope: authCode.scope,
  };
}
