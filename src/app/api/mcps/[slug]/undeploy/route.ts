import { NextRequest, NextResponse } from "next/server";
import { getDeployment, undeployMcp } from "@/lib/store";
import { deleteWorker } from "@/lib/wrangler";
import { getStoredMcp, resolveMcpEntry } from "@/lib/mcp-registry";
import { isValidSlug } from "@/lib/validation";

/**
 * Undeploy an MCP — delete the Cloudflare worker but keep the MCP in the registry.
 *
 * DELETE /api/mcps/[slug]/undeploy
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "Invalid slug format" }, { status: 400 });
    }

    const deployment = getDeployment(slug);
    if (!deployment || deployment.status !== "deployed") {
      return NextResponse.json({ error: "MCP is not deployed" }, { status: 400 });
    }

    // Delete the Cloudflare worker
    if (deployment.workerUrl) {
      const entry = await getStoredMcp(slug);
      if (entry) {
        try {
          const resolved = await resolveMcpEntry(entry);
          await deleteWorker(resolved.workerName);
        } catch (err) {
          console.warn(`[undeploy] Failed to delete worker for "${slug}":`, err);
        }
      }
    }

    // Update deployment record — keep it but mark as not_deployed
    undeployMcp(slug);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Undeploy MCP error:", error);
    return NextResponse.json(
      { error: "Failed to undeploy MCP" },
      { status: 500 }
    );
  }
}
