import { NextRequest, NextResponse } from "next/server";
import { getDeployment, removeMcp } from "@/lib/store";
import { deleteWorker } from "@/lib/wrangler";
import { getStoredMcp, resolveMcpEntry } from "@/lib/mcp-registry";
import { isValidSlug } from "@/lib/validation";

/**
 * Remove an MCP from the registry.
 * Deletes the Cloudflare worker (best-effort) and cascade-deletes all related data.
 *
 * DELETE /api/mcps/[slug]/remove
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

    // Best-effort: delete the Cloudflare worker if deployed
    const deployment = getDeployment(slug);
    if (deployment?.workerUrl) {
      const entry = await getStoredMcp(slug);
      if (entry) {
        try {
          const resolved = await resolveMcpEntry(entry);
          await deleteWorker(resolved.workerName);
        } catch (err) {
          // Worker may already be gone — log and continue
          console.warn(`[remove] Failed to delete worker for "${slug}":`, err);
        }
      }
    }

    removeMcp(slug);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove MCP error:", error);
    return NextResponse.json(
      { error: "Failed to remove MCP" },
      { status: 500 }
    );
  }
}
