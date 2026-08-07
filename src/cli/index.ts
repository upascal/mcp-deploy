import { getAllMcps, resolveMcpEntry } from "../lib/mcp-registry";
import { getDeployment, getMcpSecrets, getMcps } from "../lib/store";
import { checkWranglerLogin, wranglerLogin } from "../lib/wrangler";
import { runTest } from "../lib/test-runner";
import { input, password, select, checkbox, confirm } from "@inquirer/prompts";
import type { ConfigField, SecretField } from "../lib/types";
import {
  addMcp,
  deployMcp,
  removeMcp,
  undeployMcp,
  updateSecrets,
} from "../lib/operations";

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

  console.log(`Checking ${repoInput}...`);
  const result = await addMcp(repoInput);
  console.log(`Added "${result.name}" (${result.slug}) v${result.version}`);
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

  // Check wrangler login (interactive)
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

  // Merge for test purposes
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

  console.log(`\nDeploying ${resolved.workerName}...`);

  const result = await deployMcp(slug, {
    authMode,
    secrets: secretValues,
    config: configValues,
  });

  console.log(`\nDeployed to ${result.workerUrl}`);
  console.log(`\nMCP URL: ${result.mcpUrl}`);
  if (authMode === "bearer" && result.bearerToken) {
    console.log(`Bearer Token: ${result.bearerToken}`);
    console.log(`MCP URL with Token: ${result.mcpUrlWithToken}`);
  }

  if (authMode === "oauth") {
    console.log("OAuth enabled (password required).");
    if (result.oauthPassword) {
      console.log(`OAuth password: ${result.oauthPassword}`);
    }
  }

  if (authMode === "open") {
    console.log("Warning: This MCP is deployed without authentication.");
  }

  console.log(`\nClaude config snippet:`);
  const snippet =
    authMode === "bearer" && result.bearerToken
      ? {
          mcpServers: {
            [slug]: {
              command: "npx",
              args: [
                "mcp-remote",
                `${result.workerUrl}/mcp`,
                "--header",
                "Authorization:${AUTH_HEADER}",
              ],
              env: {
                AUTH_HEADER: `Bearer ${result.bearerToken}`,
              },
            },
          },
        }
      : {
          mcpServers: {
            [slug]: {
              command: "npx",
              args: ["mcp-remote", `${result.workerUrl}/mcp`],
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

async function cmdUndeploy() {
  const slug = rest[0];
  if (!slug) die("Usage: mcp-deploy undeploy <slug>");

  await undeployMcp(slug);
  console.log(`Undeployed "${slug}". MCP remains in registry — redeploy with 'mcp-deploy deploy ${slug}'.`);
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

  await updateSecrets(slug, { [key]: value.trim() });
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

  await updateSecrets(slug, {}, [key]);
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
  undeploy: cmdUndeploy,
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
