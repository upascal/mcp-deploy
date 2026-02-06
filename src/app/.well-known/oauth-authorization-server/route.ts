import { NextResponse } from "next/server";
import { getAuthServerMetadata } from "@/lib/oauth/provider";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 * Served at /.well-known/oauth-authorization-server
 */
export async function GET() {
  return NextResponse.json(getAuthServerMetadata(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
