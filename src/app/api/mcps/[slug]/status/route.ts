import { NextResponse } from "next/server";
import { getStoredMcp } from "@/lib/mcp-registry";
import { checkWorkerHealth } from "@/lib/worker-health";
import { getDeployment } from "@/lib/store";
import { isValidSlug } from "@/lib/validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "Invalid slug format" }, { status: 400 });
    }
    const entry = await getStoredMcp(slug);
    if (!entry) {
      return NextResponse.json({ error: "MCP not found" }, { status: 404 });
    }

    const deployment = getDeployment(slug);
    if (!deployment?.workerUrl) {
      return NextResponse.json({
        slug,
        status: "not_deployed",
        healthy: false,
      });
    }

    const health = await checkWorkerHealth(deployment.workerUrl);

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
