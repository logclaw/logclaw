/**
 * OAuth utility functions for Cloudflare Workers MCP server.
 * Handles CSRF protection, state management, and approval flow.
 *
 * Based on the Cloudflare MCP reference implementation.
 */

import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

export class OAuthError extends Error {
  constructor(
    public code: string,
    public description: string,
    public statusCode = 400,
  ) {
    super(description);
    this.name = "OAuthError";
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({ error: this.code, error_description: this.description }),
      { status: this.statusCode, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Create a random state token and store the OAuth request info in KV.
 */
export async function createOAuthState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace,
): Promise<{ stateToken: string }> {
  const stateToken = crypto.randomUUID();
  await kv.put(`oauth_state:${stateToken}`, JSON.stringify(oauthReqInfo), {
    expirationTtl: 600, // 10 minutes
  });
  return { stateToken };
}

/**
 * Validate the state token from the callback and retrieve the original OAuth request.
 */
export async function validateOAuthState(
  stateToken: string,
  kv: KVNamespace,
): Promise<{ oauthReqInfo: AuthRequest }> {
  const stored = await kv.get(`oauth_state:${stateToken}`);
  if (!stored) {
    throw new OAuthError("invalid_request", "Invalid or expired state token");
  }
  // One-time use: delete after retrieval
  await kv.delete(`oauth_state:${stateToken}`);
  return { oauthReqInfo: JSON.parse(stored) };
}

/**
 * Generate a CSRF token for form protection.
 */
export function generateCSRFToken(): string {
  return crypto.randomUUID();
}
