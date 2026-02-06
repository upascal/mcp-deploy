import { NextResponse } from "next/server";
import { registerClient } from "@/lib/oauth/provider";

/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591).
 * POST /api/oauth/register
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await registerClient(body);

    if ("error" in result) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Invalid JSON body" },
      { status: 400 }
    );
  }
}
