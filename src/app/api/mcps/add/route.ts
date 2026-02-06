import { NextRequest, NextResponse } from "next/server";
import {
  validateGitHubRepo,
  fetchMcpMetadata,
  parseGitHubRepo,
} from "@/lib/github-releases";
import { addMcp, getMcps } from "@/lib/kv";

/**
 * Add a new MCP from a GitHub repository.
 *
 * POST /api/mcps/add
 * Body: { githubRepo: string, releaseTag?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { githubRepo: repoInput, releaseTag = "latest" } = body as {
      githubRepo: string;
      releaseTag?: string;
    };

    if (!repoInput) {
      return NextResponse.json(
        { error: "Missing githubRepo" },
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

    // Validate the repo has proper releases
    const validation = await validateGitHubRepo(repo);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: validation.error || "Repository does not have valid MCP releases",
          hasReleases: validation.hasReleases,
          hasMcpDeployJson: validation.hasMcpDeployJson,
          hasWorkerBundle: validation.hasWorkerBundle,
        },
        { status: 400 }
      );
    }

    // Fetch full metadata to get the worker name (used as slug)
    const { metadata, version } = await fetchMcpMetadata(repo, releaseTag);
    const slug = metadata.worker.name;

    // Check if already added
    const existing = await getMcps();
    if (existing.some((m) => m.slug === slug)) {
      return NextResponse.json(
        { error: `"${metadata.name}" is already added` },
        { status: 409 }
      );
    }

    // Check if same repo is already added (different slug somehow)
    if (existing.some((m) => m.githubRepo === repo)) {
      return NextResponse.json(
        { error: `Repository ${repo} is already added` },
        { status: 409 }
      );
    }

    // Add to MCPs
    await addMcp({
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
