import { getAllMcps, resolveMcpEntry } from "../lib/mcp-registry";
import { getDeployment, getMcpSecrets, setMcpSecrets, removeMcp } from "../lib/store";
import { fetchMcpMetadata, parseGitHubRepo } from "../lib/github-releases";
import { addMcp, getMcps } from "../lib/store";
import { checkWranglerLogin, wranglerLogin, deployWorker, setSecrets, deleteSecret, ensureKVNamespace } from "../lib/wrangler";
import { generateBearerTokenWrapper } from "../lib/worker-bearer-wrapper";
import { generateOAuthWrapper } from "../lib/worker-oauth-wrapper";
import { generateOpenWrapper } from "../lib/worker-open-wrapper";
import { runTest } from "../lib/test-runner";
import { decrypt, encrypt } from "../lib/encryption";
import { randomBytes } from "crypto";
import { input, password, select, checkbox, confirm } from "@inquirer/prompts";
import type { ConfigField, SecretField } from "../lib/types";

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function promptText(options: {
  message: string;
  defaultValue?: string;
  required?: boolean;
  validate?: (value: string) => string | true;
}): Promise<string> {
  return input({
    message: options.message,
    default: options.defaultValue,
    validate: (value) => {
      if (options.required && !value.trim()) {
        return "This field is required";
      }
      if (options.validate) {
        return options.validate(value);
      }
      return true;
    },
  });
}

async function promptSecretValue(
  field: SecretField,
  hasExisting: boolean
): Promise<string> {
  const label = `${field.label}${field.required ? " (required)" : " (optional)"}${
    hasExisting ? " [press Enter to keep]" : ""
  }`;

  const validate = (value: string) => {
    if (!value.trim() && field.required && !hasExisting) {
      return `${field.label} is required`;
    }
    if (field.type === "email" && value.trim() && !EMAIL_REGEX.test(value)) {
      return "Enter a valid email address";
    }
    return true;
  };

  if (field.type === "password") {
    return password({ message: label, validate });
  }

  return input({ message: label, validate });
}

async function promptConfigValue(field: ConfigField): Promise<string> {
  if (field.type === "select" && field.options?.length) {
    return select({
      message: field.label,
      choices: field.options.map((opt) => ({
        name: opt.label,
        value: opt.value,
      })),
      default: field.default,
    });
  }

  if (field.type === "multiselect" && field.options?.length) {
    const defaultValues =
      field.default?.split(",").filter(Boolean) ?? [];
    const values = await checkbox({
      message: field.label,
      choices: field.options.map((opt) => ({
        name: opt.label,
        value: opt.value,
        checked: defaultValues.includes(opt.value),
      })),
    });
    return values.join(",");
  }

  return promptText({
    message: field.label + (field.default ? ` [${field.default}]` : ""),
    defaultValue: field.default ?? "",
  });
}

async function promptAuthMode(
  defaultMode: "bearer" | "oauth" | "open"
): Promise<"bearer" | "oauth" | "open"> {
  while (true) {
    const mode = await select<"bearer" | "oauth" | "open">({
      message: "Authentication mode",
      choices: [
        { name: "Bearer token (default)", value: "bearer" },
        { name: "OAuth 2.1 (password protected)", value: "oauth" },
        { name: "Open (no authentication)", value: "open" },
      ],
      default: defaultMode,
    });

    if (mode !== "open") return mode;

    const ok = await confirm({
      message: "Deploy without authentication? Anyone with the URL can access this MCP.",
      default: false,
    });
    if (ok) return "open";
  }
}

function canTestField(
  field: SecretField,
  values: Record<string, string>
): boolean {
  if (!field.test) return false;
  if (!values[field.key]?.trim()) return false;

  const urlRefs =
    field.test.url.match(/\{\{([^}]+)\}\}/g)?.map((m) => m.slice(2, -2)) ?? [];
  const headerRefs = Object.values(field.test.headers ?? {})
    .join("")
    .match(/\{\{([^}]+)\}\}/g)
    ?.map((m) => m.slice(2, -2)) ?? [];

  const allRefs = [...urlRefs, ...headerRefs].filter((ref) => ref !== "value");
  for (const ref of allRefs) {
    if (!values[ref]?.trim()) return false;
  }

  return true;
}

async function cmdList() {
  const entries = await getAllMcps();
  if (entries.length === 0) {
    console.log("No MCPs added yet. Use 'mcp-deploy add <repo>' to add one.");
    return;
  }

  for (const entry of entries) {
    const deployment = await getDeployment(entry.slug);
    const status = deployment?.status ?? "not_deployed";
    let line = `  ${entry.slug}`;
    line += `  [${status}]`;
    if (deployment?.workerUrl) line += `  ${deployment.workerUrl}`;
    line += `  (${entry.githubRepo})`;

    try {
      const resolved = await resolveMcpEntry(entry);
      line = `  ${resolved.name} (${entry.slug})`;
      line += `  [${status}]`;
      if (deployment?.version) line += `  ${deployment.version}`;
      if (deployment?.workerUrl) line += `  ${deployment.workerUrl}`;
    } catch {
      // Use slug if resolution fails
    }

    console.log(line);
  }
}

async function cmdAdd() {
  const repoInput = rest[0];
  if (!repoInput) die("Usage: mcp-deploy add <github-repo>");

  const repo = parseGitHubRepo(repoInput);
  if (!repo) die("Invalid repository format. Use owner/repo or a GitHub URL.");

  console.log(`Checking ${repo}...`);
  const { metadata, version } = await fetchMcpMetadata(repo);
  const slug = metadata.worker.name;

  const existing = await getMcps();
  if (existing.some((m) => m.slug === slug || m.githubRepo === repo)) {
    die(`"${metadata.name}" is already added`);
  }

  await addMcp({
    slug,
    githubRepo: repo,
    releaseTag: "latest",
    addedAt: new Date().toISOString(),
  });

  console.log(`Added "${metadata.name}" (${slug}) v${version}`);
}

async function cmdRemove() {
  const slug = rest[0];
  if (!slug) die("Usage: mcp-deploy remove <slug>");

  const entries = await getMcps();
  const entry = entries.find((m) => m.slug === slug);
  if (!entry) die(`MCP "${slug}" not found`);

  await removeMcp(slug);
  console.log(`Removed "${slug}"`);
}

async function cmdDeploy() {
  const slug = rest[0];
  if (!slug) die("Usage: mcp-deploy deploy <slug>");

  // Check wrangler login
  const loginStatus = checkWranglerLogin();
  if (!loginStatus.loggedIn) {
    console.log("Not logged in to Cloudflare. Running wrangler login...");
    await wranglerLogin();
  }

  const entries = await getMcps();
  const entry = entries.find((m) => m.slug === slug);
  if (!entry) die(`MCP "${slug}" not found. Run 'mcp-deploy list' to see available MCPs.`);

  const existingDeployment = await getDeployment(slug);
  const defaultAuthMode: "bearer" | "oauth" | "open" =
    existingDeployment?.authMode ?? "bearer";
  const authMode: "bearer" | "oauth" | "open" = await promptAuthMode(defaultAuthMode);

  let oauthPassword: string | null = null;
  if (authMode === "oauth") {
    if (process.env.OAUTH_PASSWORD?.trim()) {
      oauthPassword = process.env.OAUTH_PASSWORD.trim();
    } else if (existingDeployment?.oauthPassword) {
      try {
        oauthPassword = decrypt(existingDeployment.oauthPassword);
      } catch {
        oauthPassword = null;
      }
    }
    if (!oauthPassword) {
      oauthPassword = randomBytes(16).toString("hex");
    }
  }

  console.log(`Resolving ${entry.githubRepo}...`);
  const resolved = await resolveMcpEntry(entry);

  // Collect config
  const configValues: Record<string, string> = {};
  for (const field of resolved.config) {
    const value = await promptConfigValue(field);
    configValues[field.key] = value.trim();
  }

  // Collect secrets interactively
  const secretValues: Record<string, string> = {};
  const existingSecrets = (await getMcpSecrets(slug)) ?? {};

  const enabledPlatforms = new Set(
    (configValues["ENABLED_PLATFORMS"] || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );

  const visibleSecrets = resolved.secrets.filter((field) => {
    if (field.required) return true;
    if (!field.forPlatform) return true;
    return enabledPlatforms.has(field.forPlatform);
  });

  for (const field of visibleSecrets) {
    const hasExisting = !!existingSecrets[field.key];
    const value = await promptSecretValue(field, hasExisting);

    if (value.trim()) {
      secretValues[field.key] = value.trim();
    } else if (field.required && !hasExisting) {
      die(`${field.label} is required`);
    }
  }

  const mergedSecrets = {
    ...existingSecrets,
    ...secretValues,
  };

  const runTests = await confirm({
    message: "Run API credential tests now?",
    default: false,
  });
  if (runTests) {
    for (const field of visibleSecrets) {
      if (!field.test) continue;
      if (!canTestField(field, mergedSecrets)) continue;
      const result = await runTest(
        field.test,
        mergedSecrets[field.key],
        mergedSecrets
      );
      if (result.success) {
        console.log(`  ✓ ${field.label}: ${result.message ?? "OK"}`);
      } else {
        console.log(`  ✗ ${field.label}: ${result.error ?? "Failed"}`);
      }
    }
  }

  // Generate bearer token
  const bearerToken =
    authMode === "open" ? null : randomBytes(32).toString("hex");
  console.log(`\nFetching worker bundle...`);
  const bundleResponse = await fetch(resolved.bundleUrl);
  if (!bundleResponse.ok) die(`Failed to fetch bundle: ${bundleResponse.status}`);
  const bundleCode = await bundleResponse.text();

  // Generate wrapper
  let wrappedCode: string;
  if (authMode === "oauth") {
    wrappedCode = generateOAuthWrapper(
      resolved.durableObjectClassName
    );
  } else if (authMode === "open") {
    wrappedCode = generateOpenWrapper(resolved.durableObjectClassName);
  } else {
    wrappedCode = generateBearerTokenWrapper(
      resolved.durableObjectClassName
    );
  }

  // Deploy
  console.log(`Deploying ${resolved.workerName}...`);
  const kvNamespaceId =
    authMode === "oauth"
      ? await ensureKVNamespace("mcp-deploy-oauth")
      : undefined;

  const { url: workerUrl } = await deployWorker(
    resolved,
    bundleCode,
    wrappedCode,
    kvNamespaceId
  );

  // Set secrets
  const allSecrets: Record<string, string> = {
    ...mergedSecrets,
    ...configValues,
  };
  if (bearerToken) {
    allSecrets.BEARER_TOKEN = bearerToken;
  }
  if (authMode === "oauth") {
    const jwtSecret = randomBytes(32).toString("hex");
    allSecrets.OAUTH_JWT_SECRET = jwtSecret;
    if (oauthPassword) {
      allSecrets.OAUTH_PASSWORD = oauthPassword;
    }
  }
  console.log("Setting secrets...");
  await setSecrets(resolved.workerName, allSecrets);

  // Store deployment
  const { setDeployment } = await import("../lib/store");
  await setDeployment({
    slug,
    status: "deployed",
    workerUrl,
    bearerToken: bearerToken ? encrypt(bearerToken) : null,
    oauthPassword: oauthPassword ? encrypt(oauthPassword) : null,
    authMode,
    deployedAt: new Date().toISOString(),
    version: resolved.version,
  });

  // Store secrets locally
  await setMcpSecrets(slug, { ...mergedSecrets, ...configValues });

  console.log(`\nDeployed to ${workerUrl}`);
  console.log(`\nMCP URL: ${workerUrl}/mcp`);
  if (authMode === "bearer" && bearerToken) {
    console.log(`Bearer Token: ${bearerToken}`);
    console.log(`MCP URL with Token: ${workerUrl}/mcp/t/${bearerToken}`);
  }

  if (authMode === "oauth") {
    console.log("OAuth enabled (password required).");
    if (oauthPassword) {
      console.log(`OAuth password: ${oauthPassword}`);
    }
  }

  if (authMode === "open") {
    console.log("Warning: This MCP is deployed without authentication.");
  }

  console.log(`\nClaude config snippet:`);
  const snippet =
    authMode === "bearer" && bearerToken
      ? {
          mcpServers: {
            [slug]: {
              command: "npx",
              args: [
                "mcp-remote",
                `${workerUrl}/mcp`,
                "--header",
                "Authorization:${AUTH_HEADER}",
              ],
              env: {
                AUTH_HEADER: `Bearer ${bearerToken}`,
              },
            },
          },
        }
      : {
          mcpServers: {
            [slug]: {
              command: "npx",
              args: ["mcp-remote", `${workerUrl}/mcp`],
            },
          },
        };
  console.log(JSON.stringify(snippet, null, 2));
}

async function cmdStatus() {
  const slug = rest[0];
  if (!slug) die("Usage: mcp-deploy status <slug>");

  const deployment = await getDeployment(slug);
  if (!deployment) die(`No deployment found for "${slug}"`);

  console.log(`Status: ${deployment.status}`);
  if (deployment.workerUrl) console.log(`URL: ${deployment.workerUrl}`);
  if (deployment.version) console.log(`Version: ${deployment.version}`);
  if (deployment.deployedAt) console.log(`Deployed: ${deployment.deployedAt}`);

  if (deployment.status === "deployed" && deployment.workerUrl) {
    try {
      const res = await fetch(`${deployment.workerUrl}/health`, { signal: AbortSignal.timeout(5000) });
      console.log(`Health: ${res.ok ? "healthy" : "unhealthy"} (${res.status})`);
    } catch {
      console.log("Health: unreachable");
    }
  }
}

async function cmdSecretsList() {
  const slug = rest[0];
  if (!slug) die("Usage: mcp-deploy secrets:list <slug>");

  const secrets = await getMcpSecrets(slug);
  if (!secrets || Object.keys(secrets).length === 0) {
    console.log("No secrets configured.");
    return;
  }

  for (const key of Object.keys(secrets)) {
    console.log(`  ${key}: ••••••••`);
  }
}

async function cmdSecretsSet() {
  const slug = rest[0];
  const key = rest[1];
  if (!slug || !key) die("Usage: mcp-deploy secrets:set <slug> <key>");

  const deployment = await getDeployment(slug);
  if (!deployment || deployment.status !== "deployed") {
    die(`"${slug}" is not deployed. Deploy first with 'mcp-deploy deploy ${slug}'`);
  }

  const value = await password({ message: `Enter value for ${key}: ` });
  if (!value.trim()) die("Value cannot be empty");

  // Update on Cloudflare
  const entries = await getMcps();
  const entry = entries.find((m) => m.slug === slug);
  if (!entry) die(`MCP "${slug}" not found`);

  const resolved = await resolveMcpEntry(entry);
  await setSecrets(resolved.workerName, { [key]: value.trim() });

  // Update local store
  const existing = await getMcpSecrets(slug) ?? {};
  existing[key] = value.trim();
  await setMcpSecrets(slug, existing);

  console.log(`Secret "${key}" updated for ${slug}`);
}

async function cmdSecretsDelete() {
  const slug = rest[0];
  const key = rest[1];
  if (!slug || !key) die("Usage: mcp-deploy secrets:delete <slug> <key>");

  const deployment = await getDeployment(slug);
  if (!deployment || deployment.status !== "deployed") {
    die(`"${slug}" is not deployed`);
  }

  const entries = await getMcps();
  const entry = entries.find((m) => m.slug === slug);
  if (!entry) die(`MCP "${slug}" not found`);

  const resolved = await resolveMcpEntry(entry);
  await deleteSecret(resolved.workerName, key);

  // Remove from local store
  const existing = await getMcpSecrets(slug) ?? {};
  delete existing[key];
  await setMcpSecrets(slug, existing);

  console.log(`Secret "${key}" deleted from ${slug}`);
}

async function cmdLogin() {
  const status = checkWranglerLogin();
  if (status.loggedIn) {
    console.log(`Already logged in as ${status.account ?? "unknown"}`);
    return;
  }
  console.log("Opening Cloudflare login...");
  await wranglerLogin();
  console.log("Login successful");
}

// ─── Dispatch ───

const commands: Record<string, () => Promise<void>> = {
  list: cmdList,
  add: cmdAdd,
  remove: cmdRemove,
  deploy: cmdDeploy,
  status: cmdStatus,
  "secrets:list": cmdSecretsList,
  "secrets:set": cmdSecretsSet,
  "secrets:delete": cmdSecretsDelete,
  login: cmdLogin,
};

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

handler().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
