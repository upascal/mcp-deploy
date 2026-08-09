import { NextRequest, NextResponse } from "next/server";
import { parseGitHubRepo } from "@/lib/github-releases";
import { getMcps } from "@/lib/store";
import { isValidReleaseTag, isValidSlug } from "@/lib/validation";
import { addMcp } from "@/lib/operations";

/**
 * Add a new MCP from a GitHub repository.
 *
 * POST /api/mcps/add
 * Body: { githubRepo: string, slug?: string, releaseTag?: string }
 *
 * If `slug` is provided (from prior validation), skips re-fetching metadata
 * just for the slug. Still fetches metadata once for the name/version response.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      githubRepo: repoInput,
      slug: prevalidatedSlug,
      releaseTag = "latest",
    } = body as {
      githubRepo: string;
      slug?: string;
      releaseTag?: string;
    };

    if (!repoInput || typeof repoInput !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid githubRepo" },
        { status: 400 }
      );
    }

    if (!isValidReleaseTag(releaseTag)) {
      return NextResponse.json(
        { error: "Invalid releaseTag format" },
        { status: 400 }
      );
    }

    if (prevalidatedSlug && !isValidSlug(prevalidatedSlug)) {
      return NextResponse.json(
        { error: "Invalid slug format" },
        { status: 400 }
      );
    }

    // Validate repo format before calling operation
    const repo = parseGitHubRepo(repoInput);
    if (!repo) {
      return NextResponse.json(
        { error: "Invalid repository format. Use owner/repo or a GitHub URL." },
        { status: 400 }
      );
    }

    // Pre-check: if a prevalidated slug was provided, check it doesn't conflict
    if (prevalidatedSlug) {
      const existing = await getMcps();
      if (existing.some((m) => m.slug === prevalidatedSlug)) {
        return NextResponse.json(
          { error: `MCP "${prevalidatedSlug}" is already added` },
          { status: 409 }
        );
      }
    }

    const result = await addMcp(repoInput, releaseTag);

    return NextResponse.json({
      success: true,
      slug: result.slug,
      name: result.name,
      version: result.version,
      githubRepo: result.githubRepo,
    });
  } catch (error) {
    console.error("Add MCP error:", error);
    const message = error instanceof Error ? error.message : "Failed to add MCP";

    // Map known error messages to HTTP status codes
    if (message.includes("is already added") || message.includes("already added")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes("Invalid repository format")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
