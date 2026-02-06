import { NextResponse } from "next/server";
import {
  getStoredMcp,
  resolveMcpEntry,
  getBundleContent,
} from "@/lib/mcp-registry";
import { CloudflareDeployService } from "@/lib/cloudflare-deploy";
import {
  getCfToken,
  getCfAccountId,
  setDeployment,
  setMcpSecrets,
  getMcpSecrets,
} from "@/lib/kv";
import { encrypt } from "@/lib/encryption";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    // Get the stored MCP entry
    const entry = await getStoredMcp(slug);
    if (!entry) {
      return NextResponse.json({ error: "MCP not found" }, { status: 404 });
    }

    // Resolve the entry to get full metadata from GitHub
    const resolved = await resolveMcpEntry(entry);

    // Get Cloudflare credentials
    const [cfToken, cfAccountId] = await Promise.all([
      getCfToken(),
      getCfAccountId(),
    ]);

    if (!cfToken || !cfAccountId) {
      return NextResponse.json(
        { error: "Cloudflare not configured. Go to Settings first." },
        { status: 400 }
      );
    }

    // Get user-provided secrets and config from the request body
    const body = await request.json().catch(() => ({}));
    const userSecrets: Record<string, string> = body.secrets ?? {};
    const userConfig: Record<string, string> = body.config ?? {};

    // Merge with any existing secrets (so we don't lose them on redeploy)
    const existingSecrets = (await getMcpSecrets(slug)) ?? {};
    const mergedSecrets: Record<string, string> = {
      ...existingSecrets,
      ...userSecrets,
    };

    // Generate bearer token
    const bearerToken = CloudflareDeployService.generateBearerToken();

    // Get the bundle content from GitHub
    const bundleContent = await getBundleContent(resolved);

    // Deploy the worker
    const service = new CloudflareDeployService(cfToken, cfAccountId);
    const { url } = await service.deployWorker(resolved, bundleContent);

    // Set all secrets on the worker
    const allWorkerSecrets: Record<string, string> = {
      ...mergedSecrets,
      ...userConfig,
      BEARER_TOKEN: bearerToken,
    };

    await service.setSecrets(resolved.workerName, allWorkerSecrets);

    // Store deployment record
    await setDeployment({
      slug,
      status: "deployed",
      workerUrl: url,
      bearerToken: encrypt(bearerToken),
      deployedAt: new Date().toISOString(),
      version: resolved.version,
    });

    // Store user secrets (not auto-generated ones)
    await setMcpSecrets(slug, { ...mergedSecrets, ...userConfig });

    // Build Claude Desktop config snippet
    const mcpUrl = `${url}/mcp`;
    const claudeConfig = {
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
            AUTH_HEADER: `Bearer ${bearerToken}`,
          },
        },
      },
    };

    return NextResponse.json({
      success: true,
      workerUrl: url,
      mcpUrl,
      mcpUrlWithToken: `${url}/mcp/t/${bearerToken}`,
      claudeConfig,
      bearerToken,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    // Store failed deployment
    try {
      await setDeployment({
        slug,
        status: "failed",
        workerUrl: null,
        bearerToken: null,
        deployedAt: new Date().toISOString(),
        version: "unknown",
        error: message,
      });
    } catch {
      // Don't let KV errors mask the original deployment error
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
