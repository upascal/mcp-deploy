import { NextRequest, NextResponse } from "next/server";
import {
  fetchMcpMetadata,
  parseGitHubRepo,
} from "@/lib/github-releases";
import { addMcp, getMcps } from "@/lib/store";
import { isValidReleaseTag, isValidSlug } from "@/lib/validation";

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

    // Parse the repo input
    const repo = parseGitHubRepo(repoInput);
    if (!repo) {
      return NextResponse.json(
        { error: "Invalid repository format. Use owner/repo or a GitHub URL." },
        { status: 400 }
      );
    }

    // Check if already added (fast check before any network calls)
    const existing = getMcps();
    if (existing.some((m) => m.githubRepo === repo)) {
      return NextResponse.json(
        { error: `Repository ${repo} is already added` },
        { status: 409 }
      );
    }

    if (prevalidatedSlug && existing.some((m) => m.slug === prevalidatedSlug)) {
      return NextResponse.json(
        { error: `MCP "${prevalidatedSlug}" is already added` },
        { status: 409 }
      );
    }

    // Fetch metadata (single round-trip: release + metadata asset)
    const { metadata, version } = await fetchMcpMetadata(repo, releaseTag);
    const slug = metadata.worker.name;

    // Double-check slug uniqueness (in case prevalidatedSlug wasn't provided)
    if (!prevalidatedSlug && existing.some((m) => m.slug === slug)) {
      return NextResponse.json(
        { error: `"${metadata.name}" is already added` },
        { status: 409 }
      );
    }

    // Add to MCPs
    addMcp({
      slug,
      githubRepo: repo,
      releaseTag,
      addedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      slug,
      name: metadata.name,
      version,
      githubRepo: repo,
    });
  } catch (error) {
    console.error("Add MCP error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add MCP" },
      { status: 500 }
    );
  }
}
