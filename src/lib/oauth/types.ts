/**
 * OAuth 2.1 types for the mcp-deploy authorization server.
 */

/** Registered OAuth client (from Dynamic Client Registration or manual setup). */
export interface OAuthClient {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope?: string;
  token_endpoint_auth_method: string;
  created_at: number;
}

/** Authorization code stored in KV, pending exchange. */
export interface AuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string; // The MCP server URL this token is for
  state?: string;
  createdAt: number;
  expiresAt: number;
}

/** JWT claims for access tokens issued by mcp-deploy. */
export interface AccessTokenClaims {
  iss: string; // mcp-deploy URL
  sub: string; // "mcp-user" (single-user system)
  aud: string; // The MCP server URL (resource)
  scope: string;
  iat: number;
  exp: number;
  jti: string; // unique token ID
}

/** OAuth error response body. */
export interface OAuthError {
  error: string;
  error_description?: string;
}
