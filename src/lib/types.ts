// Schema-driven test specification for validating external APIs
export interface TestSpec {
  url: string; // URL to test, can include {{FIELD_KEY}} placeholders
  method: "GET" | "POST"; // HTTP method
  headers?: Record<string, string>; // Headers, can include {{value}} for current field
  body?: string; // Optional body for POST requests
  success: number[]; // HTTP status codes that indicate success
  errors?: Record<number, string>; // Custom error messages by status code
}

export interface SecretField {
  key: string;
  label: string;
  required: boolean;
  type?: "text" | "password" | "email";
  placeholder?: string;
  helpText?: string;
  helpUrl?: string;
  // Schema-driven test specification (replaces testConnection string)
  test?: TestSpec;
  // If set, only show this field when this platform is enabled in ENABLED_PLATFORMS config
  forPlatform?: string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "select" | "multiselect";
  options?: { value: string; label: string }[];
  default?: string;
  helpText?: string;
}

// Worker-specific metadata (from mcp-deploy.json)
export interface WorkerConfig {
  name: string;
  durableObjectBinding: string;
  durableObjectClassName: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
  migrationTag: string;
}

// Remote MCP metadata schema (fetched from GitHub releases)
export interface McpMetadata {
  name: string;
  description: string;
  version: string;
  worker: WorkerConfig;
  secrets: SecretField[];
  config: ConfigField[];
  autoSecrets: string[];
}

// Registry entry - all MCPs come from GitHub releases
export interface McpRegistryEntry {
  slug: string;
  githubRepo: string; // e.g., "upascal/paper-search-mcp-remote"
  releaseTag?: string; // e.g., "v0.2.0" or "latest" (defaults to latest)
}

// MCP stored in KV (all MCPs are stored this way now)
export interface StoredMcpEntry {
  slug: string;
  githubRepo: string;
  releaseTag: string;
  addedAt: string;
  isDefault?: boolean; // true if this was seeded from defaults
}

// Resolved MCP entry with all metadata loaded from GitHub
export interface ResolvedMcpEntry {
  slug: string;
  githubRepo: string;
  releaseTag?: string;
  isDefault?: boolean;

  // Metadata from mcp-deploy.json
  name: string;
  description: string;
  version: string;

  // Worker config
  workerName: string;
  durableObjectBinding: string;
  durableObjectClassName: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
  migrationTag: string;

  // Bundle URL from GitHub release
  bundleUrl: string;

  // Config schema
  secrets: SecretField[];
  config: ConfigField[];
  autoSecrets: string[];
}

export interface DeploymentRecord {
  slug: string;
  status: "deployed" | "failed" | "not_deployed";
  workerUrl: string | null;
  bearerToken: string | null; // encrypted
  deployedAt: string | null;
  version: string;
  error?: string;
}

export interface McpSecretsRecord {
  [key: string]: string; // encrypted values
}
