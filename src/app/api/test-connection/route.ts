import { NextRequest, NextResponse } from "next/server";
import { runTest } from "@/lib/test-runner";
import type { TestSpec } from "@/lib/types";

/**
 * Generic test connection endpoint.
 * Accepts a test specification from the schema and runs it.
 *
 * POST /api/test-connection
 * Body: {
 *   spec: TestSpec,       // The test specification from mcp-deploy.json
 *   value: string,        // The current field's value
 *   allValues?: Record<string, string>  // All form values for substitution
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { spec, value, allValues } = body as {
      spec: TestSpec;
      value: string;
      allValues?: Record<string, string>;
    };

    if (!spec) {
      return NextResponse.json(
        { success: false, error: "Missing test specification" },
        { status: 400 }
      );
    }

    if (!value) {
      return NextResponse.json(
        { success: false, error: "Missing value to test" },
        { status: 400 }
      );
    }

    // Validate the spec has required fields
    if (!spec.url || !spec.method || !spec.success) {
      return NextResponse.json(
        { success: false, error: "Invalid test specification" },
        { status: 400 }
      );
    }

    const result = await runTest(spec, value, allValues ?? {});
    return NextResponse.json(result);
  } catch (error) {
    console.error("Test connection error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to test connection" },
      { status: 500 }
    );
  }
}
