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
} from "@/lib/store";
import { encrypt } from "@/lib/encryption";
import { generateOAuthWrapper } from "@/lib/worker-oauth-wrapper";
import { generateBearerTokenWrapper } from "@/lib/worker-bearer-wrapper";
import { generateJWTSecret } from "@/lib/oauth/jwt";
import { getIssuerUrl } from "@/lib/oauth/provider";
import {
  setDeploymentJWTSecret,
  mapWorkerUrlToSlug,
} from "@/lib/oauth/store";

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
    const authMode: 'bearer' | 'oauth' = body.authMode || 'bearer';

    // Merge with any existing secrets (so we don't lose them on redeploy)
    const existingSecrets = (await getMcpSecrets(slug)) ?? {};
    const mergedSecrets: Record<string, string> = {
      ...existingSecrets,
      ...userSecrets,
    };

    // Generate bearer token
    const bearerToken = CloudflareDeployService.generateBearerToken();

    // Generate wrapper based on auth mode
    let wrapper: string;
    let jwtSecret: string | undefined;
    let issuerUrl: string | undefined;

    if (authMode === 'oauth') {
      // OAuth mode: generate JWT secret and OAuth wrapper
      jwtSecret = generateJWTSecret();
      issuerUrl = getIssuerUrl();
      wrapper = generateOAuthWrapper(
        resolved.durableObjectClassName,
        issuerUrl
      );
    } else {
      // Bearer token mode (default): simple bearer token wrapper
      wrapper = generateBearerTokenWrapper(
        resolved.durableObjectClassName
      );
    }

    // Get the bundle content from GitHub
    const bundleContent = await getBundleContent(resolved);

    // Deploy the worker with the selected wrapper
    const service = new CloudflareDeployService(cfToken, cfAccountId);
    const { url } = await service.deployWorker(
      resolved,
      bundleContent,
      wrapper
    );

    // Set all secrets on the worker
    const allWorkerSecrets: Record<string, string> = {
      ...mergedSecrets,
      ...userConfig,
      BEARER_TOKEN: bearerToken,
    };

    // Add OAuth JWT secret only if using OAuth mode
    if (authMode === 'oauth' && jwtSecret) {
      allWorkerSecrets.OAUTH_JWT_SECRET = jwtSecret;
    }

    await service.setSecrets(resolved.workerName, allWorkerSecrets);

    // The MCP URL is at /mcp on the worker
    const mcpUrl = `${url}/mcp`;

    // Store OAuth state only if using OAuth mode
    if (authMode === 'oauth' && jwtSecret) {
      await setDeploymentJWTSecret(slug, jwtSecret);
      // Map both the base URL and /mcp URL to this slug
      await mapWorkerUrlToSlug(url, slug);
      await mapWorkerUrlToSlug(mcpUrl, slug);
      // Also map the origin (what the JWT aud will be)
      const origin = new URL(url).origin;
      await mapWorkerUrlToSlug(origin, slug);
    }

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

    return NextResponse.json({
      success: true,
      workerUrl: url,
      mcpUrl,
      // Bearer token connection (works for both modes)
      mcpUrlWithToken: `${url}/mcp/t/${bearerToken}`,
      bearerToken,
      // Auth mode info
      authMode,
      oauthEnabled: authMode === 'oauth',
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
