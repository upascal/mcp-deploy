import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import {
  validateAuthorizeParams,
  generateAuthCode,
} from "@/lib/oauth/provider";
import { getOAuthClient } from "@/lib/oauth/store";

function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time, then return false
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Handle user consent approval.
 * POST /api/oauth/approve
 *
 * Called from the consent page when the user clicks "Authorize".
 * Generates an authorization code and redirects back to the client.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const params = Object.fromEntries(formData.entries()) as Record<
      string,
      string
    >;

    // Validate the authorization password if configured
    const oauthPassword = process.env.OAUTH_PASSWORD;
    if (oauthPassword) {
      const providedPassword = params.password ?? "";
      if (!constantTimeCompare(providedPassword, oauthPassword)) {
        // Re-render the consent page with an error
        const errorUrl = new URL("/oauth/authorize", request.url);
        errorUrl.searchParams.set("client_id", params.client_id ?? "");
        errorUrl.searchParams.set("redirect_uri", params.redirect_uri ?? "");
        errorUrl.searchParams.set("response_type", params.response_type ?? "");
        errorUrl.searchParams.set(
          "code_challenge",
          params.code_challenge ?? ""
        );
        errorUrl.searchParams.set(
          "code_challenge_method",
          params.code_challenge_method ?? ""
        );
        if (params.scope) errorUrl.searchParams.set("scope", params.scope);
        if (params.state) errorUrl.searchParams.set("state", params.state);
        if (params.resource)
          errorUrl.searchParams.set("resource", params.resource);
        errorUrl.searchParams.set("error", "invalid_password");
        return NextResponse.redirect(errorUrl.toString(), 303);
      }
    }

    // Validate the authorize params
    const validated = validateAuthorizeParams(params);
    if ("error" in validated) {
      return NextResponse.json(validated, { status: 400 });
    }

    // Verify the client exists
    const client = await getOAuthClient(validated.client_id);
    if (!client) {
      return NextResponse.json(
        {
          error: "invalid_client",
          error_description: "Unknown client_id",
        },
        { status: 400 }
      );
    }

    // Verify redirect_uri is registered
    if (!client.redirect_uris.includes(validated.redirect_uri)) {
      return NextResponse.json(
        {
          error: "invalid_request",
          error_description: "redirect_uri not registered for this client",
        },
        { status: 400 }
      );
    }

    // Generate authorization code
    const code = await generateAuthCode(validated);

    // Redirect back to the client with the authorization code
    const redirectUrl = new URL(validated.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (validated.state) {
      redirectUrl.searchParams.set("state", validated.state);
    }

    return NextResponse.redirect(redirectUrl.toString(), 303);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "server_error", error_description: message },
      { status: 500 }
    );
  }
}
