import { NextRequest, NextResponse } from "next/server";
import { isValidSlug } from "@/lib/validation";
import { undeployMcp } from "@/lib/operations";

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

    await undeployMcp(slug);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Undeploy MCP error:", error);
    const message = error instanceof Error ? error.message : "Failed to undeploy MCP";

    if (message === "MCP is not deployed") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
