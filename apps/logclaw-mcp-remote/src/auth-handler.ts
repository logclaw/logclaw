/**
 * LogClaw API Key OAuth Handler
 *
 * Instead of GitHub/Google SSO, LogClaw uses a simple API key exchange:
 * 1. User is shown a form to enter their LogClaw API key
 * 2. Worker validates the key against the auth proxy
 * 3. On success, the key is encrypted & stored in the OAuth token props
 * 4. MCP client receives an opaque access token (never sees the API key)
 */

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import {
  createOAuthState,
  generateCSRFToken,
  OAuthError,
  validateOAuthState,
} from "./workers-oauth-utils.js";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

/**
 * GET /authorize — Show API key entry form
 */
app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid request", 400);
  }

  const csrfToken = generateCSRFToken();
  const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);

  return c.html(renderApiKeyForm(stateToken, csrfToken));
});

/**
 * POST /authorize — Validate API key and complete OAuth flow
 */
app.post("/authorize", async (c) => {
  try {
    const formData = await c.req.raw.formData();

    const stateToken = formData.get("state") as string;
    const csrfToken = formData.get("csrf_token") as string;
    const apiKey = formData.get("api_key") as string;

    if (!stateToken || !csrfToken) {
      return c.text("Missing state or CSRF token", 400);
    }
    if (!apiKey || !apiKey.startsWith("lc_proj_")) {
      return c.html(renderApiKeyForm(stateToken, generateCSRFToken(), "Invalid API key format. Keys start with lc_proj_"));
    }

    // Validate the API key against the LogClaw auth proxy
    const validationResult = await validateApiKey(apiKey, c.env.LOGCLAW_ENDPOINT);
    if (!validationResult.valid) {
      // Re-create state for retry
      const { oauthReqInfo } = await validateOAuthState(stateToken, c.env.OAUTH_KV);
      const newState = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
      return c.html(renderApiKeyForm(newState.stateToken, generateCSRFToken(), validationResult.error));
    }

    // Retrieve the original OAuth request
    const { oauthReqInfo } = await validateOAuthState(stateToken, c.env.OAUTH_KV);
    if (!oauthReqInfo.clientId) {
      return c.text("Invalid OAuth request data", 400);
    }

    // Complete authorization — the API key is encrypted and stored by
    // workers-oauth-provider. The MCP client only gets an opaque token.
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId: validationResult.keyPrefix,
      scope: oauthReqInfo.scope,
      metadata: {
        label: `LogClaw (${validationResult.keyPrefix}...)`,
      },
      props: {
        apiKey,
        tenantId: validationResult.tenantId,
        keyPrefix: validationResult.keyPrefix,
      },
    });

    return Response.redirect(redirectTo, 302);
  } catch (error: any) {
    console.error("POST /authorize error:", error);
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text(`Authorization failed: ${error.message}`, 500);
  }
});

/**
 * Validate an API key by calling the LogClaw auth proxy health endpoint.
 */
async function validateApiKey(
  apiKey: string,
  endpoint: string,
): Promise<{ valid: true; keyPrefix: string; tenantId: string } | { valid: false; error: string }> {
  try {
    // Use a lightweight incidents query to validate the key
    const res = await fetch(`${endpoint}/api/incidents?limit=1`, {
      headers: {
        "x-logclaw-api-key": apiKey,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Invalid or revoked API key" };
    }
    if (!res.ok) {
      return { valid: false, error: `LogClaw API returned ${res.status}` };
    }

    // Extract key prefix for display
    const keyPrefix = apiKey.slice(0, 16);
    // We don't have direct tenant info from this endpoint,
    // but the auth proxy handles tenant isolation automatically
    return { valid: true, keyPrefix, tenantId: "auto" };
  } catch (e: any) {
    return { valid: false, error: `Connection failed: ${e.message}` };
  }
}

/**
 * Render the API key entry form with LogClaw branding.
 */
function renderApiKeyForm(state: string, csrfToken: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect to LogClaw</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: #171717;
      border: 1px solid #262626;
      border-radius: 12px;
      padding: 2rem;
      max-width: 420px;
      width: 100%;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }
    .logo-icon {
      width: 32px;
      height: 32px;
      background: #FF5722;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .logo-text { font-size: 1.25rem; font-weight: 700; color: #fff; }
    h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; color: #fff; }
    p { font-size: 0.875rem; color: #a3a3a3; margin-bottom: 1.5rem; line-height: 1.5; }
    label { display: block; font-size: 0.8125rem; font-weight: 500; margin-bottom: 0.5rem; color: #d4d4d4; }
    input[type="password"] {
      width: 100%;
      padding: 0.625rem 0.75rem;
      background: #0a0a0a;
      border: 1px solid #404040;
      border-radius: 8px;
      color: #fff;
      font-size: 0.875rem;
      font-family: 'SF Mono', Monaco, monospace;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #FF5722; }
    .error {
      background: #451a03;
      border: 1px solid #92400e;
      color: #fbbf24;
      padding: 0.625rem 0.75rem;
      border-radius: 8px;
      font-size: 0.8125rem;
      margin-bottom: 1rem;
    }
    button {
      width: 100%;
      padding: 0.625rem;
      background: #FF5722;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 1rem;
      transition: background 0.2s;
    }
    button:hover { background: #E64A19; }
    .hint {
      font-size: 0.75rem;
      color: #737373;
      margin-top: 0.5rem;
    }
    a { color: #FF8A65; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">&#x1F525;</div>
      <span class="logo-text">LogClaw</span>
    </div>
    <h2>Connect your LogClaw project</h2>
    <p>Enter your LogClaw API key to connect this AI tool to your incidents, logs, and anomalies.</p>
    ${error ? `<div class="error">${error}</div>` : ""}
    <form method="POST" action="/authorize">
      <input type="hidden" name="state" value="${state}" />
      <input type="hidden" name="csrf_token" value="${csrfToken}" />
      <label for="api_key">API Key</label>
      <input type="password" id="api_key" name="api_key" placeholder="lc_proj_..." required autocomplete="off" />
      <p class="hint">Find your API key in the <a href="https://logclaw.ai" target="_blank">LogClaw Console</a> → Project Settings → API Keys</p>
      <button type="submit">Connect</button>
    </form>
  </div>
</body>
</html>`;
}

export { app as AuthHandler };
