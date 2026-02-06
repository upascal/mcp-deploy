import { NextRequest, NextResponse } from "next/server";
import { removeMcp } from "@/lib/store";

/**
 * Remove an MCP from the registry.
 *
 * DELETE /api/mcps/[slug]/remove
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

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
