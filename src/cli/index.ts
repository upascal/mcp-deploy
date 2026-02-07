import { getAllMcps, resolveMcpEntry, checkForUpdate } from "../lib/mcp-registry";
import { getDeployment, getMcpSecrets, setMcpSecrets, removeMcp } from "../lib/store";
import { fetchMcpMetadata, parseGitHubRepo } from "../lib/github-releases";
import { addMcp, getMcps } from "../lib/store";
import { checkWranglerLogin, wranglerLogin, deployWorker, setSecrets, deleteSecret } from "../lib/wrangler";
import { generateBearerTokenWrapper } from "../lib/worker-bearer-wrapper";
import { encrypt, decrypt } from "../lib/encryption";
import { randomBytes } from "crypto";
import { createInterface } from "readline";

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      process.stdout.write(question);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);
      let value = "";
      const onData = (ch: Buffer) => {
        const c = ch.toString();
        if (c === "\n" || c === "\r") {
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(value);
        } else if (c === "\u0003") {
          process.exit(1);
        } else if (c === "\u007F" || c === "\b") {
          value = value.slice(0, -1);
        } else {
          value += c;
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
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

  console.log(`Resolving ${entry.githubRepo}...`);
  const resolved = await resolveMcpEntry(entry);

  // Collect secrets interactively
  const secretValues: Record<string, string> = {};
  const existingSecrets = await getMcpSecrets(slug);

  for (const field of resolved.secrets) {
    const hasExisting = existingSecrets && existingSecrets[field.key];
    const marker = field.required ? " (required)" : " (optional)";
    const existingNote = hasExisting ? " [has existing value, press Enter to keep]" : "";

    const value = await prompt(`${field.label}${marker}${existingNote}: `, field.type === "password");

    if (value.trim()) {
      secretValues[field.key] = value.trim();
    } else if (field.required && !hasExisting) {
      die(`${field.label} is required`);
    }
  }

  // Collect config
  const configValues: Record<string, string> = {};
  for (const field of resolved.config) {
    const defaultVal = field.default ?? "";
    const value = await prompt(`${field.label} [${defaultVal}]: `);
    configValues[field.key] = value.trim() || defaultVal;
  }

  // Generate bearer token
  const bearerToken = randomBytes(32).toString("hex");
  console.log(`\nFetching worker bundle...`);
  const bundleResponse = await fetch(resolved.bundleUrl);
  if (!bundleResponse.ok) die(`Failed to fetch bundle: ${bundleResponse.status}`);
  const bundleCode = await bundleResponse.text();

  // Generate wrapper
  const wrappedCode = generateBearerTokenWrapper(bundleCode);

  // Deploy
  console.log(`Deploying ${resolved.workerName}...`);
  const { url: workerUrl } = await deployWorker(resolved, bundleCode, wrappedCode);

  // Set secrets
  const allSecrets: Record<string, string> = {
    BEARER_TOKEN: bearerToken,
    ...secretValues,
    ...configValues,
  };
  console.log("Setting secrets...");
  await setSecrets(resolved.workerName, allSecrets);

  // Store deployment
  const { setDeployment } = await import("../lib/store");
  await setDeployment({
    slug,
    status: "deployed",
    workerUrl,
    bearerToken: encrypt(bearerToken),
    deployedAt: new Date().toISOString(),
    version: resolved.version,
  });

  // Store secrets locally
  const encryptedSecrets: Record<string, string> = {};
  for (const [key, val] of Object.entries(secretValues)) {
    encryptedSecrets[key] = encrypt(val);
  }
  if (Object.keys(encryptedSecrets).length > 0) {
    await setMcpSecrets(slug, encryptedSecrets);
  }

  console.log(`\nDeployed to ${workerUrl}`);
  console.log(`\nMCP URL: ${workerUrl}/sse`);
  console.log(`Bearer Token: ${bearerToken}`);
  console.log(`\nAdd to Claude config:`);
  console.log(JSON.stringify({
    mcpServers: {
      [slug]: {
        url: `${workerUrl}/sse`,
        headers: { Authorization: `Bearer ${bearerToken}` },
      },
    },
  }, null, 2));
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

  const value = await prompt(`Enter value for ${key}: `, true);
  if (!value.trim()) die("Value cannot be empty");

  // Update on Cloudflare
  const entries = await getMcps();
  const entry = entries.find((m) => m.slug === slug);
  if (!entry) die(`MCP "${slug}" not found`);

  const resolved = await resolveMcpEntry(entry);
  await setSecrets(resolved.workerName, { [key]: value.trim() });

  // Update local store
  const existing = await getMcpSecrets(slug) ?? {};
  existing[key] = encrypt(value.trim());
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
