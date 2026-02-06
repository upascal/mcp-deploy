import { NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/oauth/provider";

/**
 * OAuth 2.0 Token Endpoint.
 * POST /api/oauth/token
 *
 * Exchanges an authorization code (with PKCE verification) for an access token.
 */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let params: Record<string, string>;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      params = Object.fromEntries(formData.entries()) as Record<string, string>;
    } else if (contentType.includes("application/json")) {
      params = await request.json();
    } else {
      // Try form-urlencoded as default (per OAuth spec)
      const text = await request.text();
      params = Object.fromEntries(new URLSearchParams(text));
    }

    const result = await exchangeCodeForToken({
      grant_type: params.grant_type ?? "",
      code: params.code ?? "",
      redirect_uri: params.redirect_uri ?? "",
      client_id: params.client_id ?? "",
      code_verifier: params.code_verifier ?? "",
    });

    if ("error" in result) {
      return NextResponse.json(result, {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "server_error", error_description: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Handle CORS preflight for token endpoint.
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
