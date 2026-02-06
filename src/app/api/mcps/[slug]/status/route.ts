import { NextResponse } from "next/server";
import { getStoredMcp } from "@/lib/mcp-registry";
import { CloudflareDeployService } from "@/lib/cloudflare-deploy";
import { getCfToken, getCfAccountId, getDeployment } from "@/lib/kv";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const entry = await getStoredMcp(slug);
    if (!entry) {
      return NextResponse.json({ error: "MCP not found" }, { status: 404 });
    }

    const deployment = await getDeployment(slug);
    if (!deployment?.workerUrl) {
      return NextResponse.json({
        slug,
        status: "not_deployed",
        healthy: false,
      });
    }

    const [cfToken, cfAccountId] = await Promise.all([
      getCfToken(),
      getCfAccountId(),
    ]);

    if (!cfToken || !cfAccountId) {
      return NextResponse.json({
        slug,
        status: deployment.status,
        healthy: false,
        error: "Cloudflare not configured",
      });
    }

    const service = new CloudflareDeployService(cfToken, cfAccountId);
    const health = await service.checkHealth(deployment.workerUrl);

    return NextResponse.json({
      slug,
      status: deployment.status,
      workerUrl: deployment.workerUrl,
      deployedAt: deployment.deployedAt,
      ...health,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
