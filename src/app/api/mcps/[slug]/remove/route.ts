import { NextRequest, NextResponse } from "next/server";
import { isValidSlug } from "@/lib/validation";
import { removeMcp } from "@/lib/operations";

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

    await removeMcp(slug);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove MCP error:", error);
    return NextResponse.json(
      { error: "Failed to remove MCP" },
      { status: 500 }
    );
  }
}
