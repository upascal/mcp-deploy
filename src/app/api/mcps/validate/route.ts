import { NextRequest, NextResponse } from "next/server";
import {
  validateGitHubRepo,
  parseGitHubRepo,
} from "@/lib/github-releases";

/**
 * Validate a GitHub repository has proper MCP releases.
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

    const result = await validateGitHubRepo(repo);

    return NextResponse.json({
      valid: result.valid,
      repo,
      name: result.name,
      version: result.latestVersion,
      hasReleases: result.hasReleases,
      hasMcpDeployJson: result.hasMcpDeployJson,
      hasWorkerBundle: result.hasWorkerBundle,
      error: result.error,
    });
  } catch (error) {
    console.error("Validate repo error:", error);
    return NextResponse.json(
      { valid: false, error: "Failed to validate repository" },
      { status: 500 }
    );
  }
}
