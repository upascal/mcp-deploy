import { NextRequest, NextResponse } from "next/server";
import {
  fetchMcpMetadata,
  parseGitHubRepo,
} from "@/lib/github-releases";

/**
 * Validate a GitHub repository has proper MCP releases.
 * On success, returns full metadata so the add route can skip re-fetching.
 *
 * GET /api/mcps/validate?repo=owner/repo
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const repoInput = searchParams.get("repo");

    if (!repoInput) {
      return NextResponse.json(
        { valid: false, error: "Missing repo parameter" },
        { status: 400 }
      );
    }

    // Parse the repo input (handles URLs and owner/repo format)
    const repo = parseGitHubRepo(repoInput);
    if (!repo) {
      return NextResponse.json(
        {
          valid: false,
          error: "Invalid repository format. Use owner/repo or a GitHub URL.",
        },
        { status: 400 }
      );
    }

    // Fetch full metadata in one shot — validates and gets name/version
    const { metadata, version } = await fetchMcpMetadata(repo);

    return NextResponse.json({
      valid: true,
      repo,
      name: metadata.name,
      slug: metadata.worker.name,
      version,
      hasReleases: true,
      hasMcpDeployJson: true,
      hasWorkerBundle: true,
    });
  } catch (error) {
    // Distinguish between "no releases" and other errors
    const message = error instanceof Error ? error.message : "Unknown error";
    const isNotFound = message.includes("not found") || message.includes("no releases");

    return NextResponse.json({
      valid: false,
      hasReleases: !isNotFound,
      hasMcpDeployJson: !message.includes("missing mcp-deploy.json"),
      hasWorkerBundle: !message.includes("missing worker.mjs"),
      error: message,
    });
  }
}
