/**
 * Slack OAuth 2.0 install flow + LogClaw API key linking.
 *
 * Flow:
 *   1. GET /oauth/install → redirect to Slack authorize URL
 *   2. User approves → Slack redirects to GET /oauth/callback?code=...
 *   3. Exchange code for bot token, store in KV
 *   4. Show API key linking form
 *   5. POST /oauth/link → validate API key, link to workspace
 */
import { Hono } from "hono";
import { saveInstallation, linkApiKey, type Installation } from "./installations.js";

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const BOT_SCOPES = "app_mentions:read,chat:write,channels:history,groups:history";

export const oauthApp = new Hono<{ Bindings: Env }>();

// ── GET /install — Start OAuth flow ──────────────────────────────

oauthApp.get("/install", async (c) => {
  const state = crypto.randomUUID();

  // Store state in KV with 10-minute TTL for CSRF protection
  await c.env.OAUTH_STATE.put(`oauth:${state}`, "pending", {
    expirationTtl: 600,
  });

  const params = new URLSearchParams({
    client_id: c.env.SLACK_CLIENT_ID,
    scope: BOT_SCOPES,
    state,
    redirect_uri: `https://slack.logclaw.ai/oauth/callback`,
  });

  return c.redirect(`${SLACK_AUTHORIZE_URL}?${params}`);
});

// ── GET /callback — Slack redirects here after approval ──────────

oauthApp.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.html(renderErrorPage(`Slack authorization failed: ${error}`));
  }

  if (!code || !state) {
    return c.html(renderErrorPage("Missing authorization code or state parameter."));
  }

  // Validate CSRF state
  const stored = await c.env.OAUTH_STATE.get(`oauth:${state}`);
  if (!stored) {
    return c.html(renderErrorPage("Invalid or expired state token. Please try again."));
  }
  await c.env.OAUTH_STATE.delete(`oauth:${state}`);

  // Exchange code for bot token
  const tokenRes = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.SLACK_CLIENT_ID,
      client_secret: c.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: `https://slack.logclaw.ai/oauth/callback`,
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    team?: { id: string; name: string };
    bot_user_id?: string;
  };

  if (!tokenData.ok || !tokenData.access_token || !tokenData.team) {
    return c.html(renderErrorPage(`Token exchange failed: ${tokenData.error || "unknown error"}`));
  }

  // Store the installation
  const installation: Installation = {
    botToken: tokenData.access_token,
    teamId: tokenData.team.id,
    teamName: tokenData.team.name,
    installedAt: new Date().toISOString(),
  };

  await saveInstallation(c.env.SLACK_INSTALLATIONS, tokenData.team.id, installation);

  // Store team_id in KV state for the link form (short TTL)
  const linkState = crypto.randomUUID();
  await c.env.OAUTH_STATE.put(`link:${linkState}`, tokenData.team.id, {
    expirationTtl: 600,
  });

  // Show API key linking form
  return c.html(renderApiKeyForm(linkState, tokenData.team.name));
});

// ── POST /link — Link LogClaw API key to workspace ───────────────

oauthApp.post("/link", async (c) => {
  const formData = await c.req.raw.formData();
  const linkState = formData.get("state") as string;
  const apiKey = formData.get("api_key") as string;

  if (!linkState) {
    return c.html(renderErrorPage("Missing state parameter."));
  }

  // Look up team from state
  const teamId = await c.env.OAUTH_STATE.get(`link:${linkState}`);
  if (!teamId) {
    return c.html(renderErrorPage("Session expired. Please reinstall the app."));
  }

  if (!apiKey || !apiKey.startsWith("lc_proj_")) {
    // Re-create state for retry
    const newState = crypto.randomUUID();
    await c.env.OAUTH_STATE.put(`link:${newState}`, teamId, { expirationTtl: 600 });
    return c.html(renderApiKeyForm(newState, "", "Invalid API key format. Keys start with lc_proj_"));
  }

  // Validate the API key against the LogClaw auth proxy
  try {
    const res = await fetch(`${c.env.LOGCLAW_ENDPOINT}/api/incidents?limit=1`, {
      headers: {
        "x-logclaw-api-key": apiKey,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 401 || res.status === 403) {
      const newState = crypto.randomUUID();
      await c.env.OAUTH_STATE.put(`link:${newState}`, teamId, { expirationTtl: 600 });
      return c.html(renderApiKeyForm(newState, "", "Invalid or revoked API key."));
    }

    // 502/503/504 = backend temporarily down but key format is valid — proceed
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      console.warn(`LogClaw API returned ${res.status} during key validation — proceeding (key format valid)`);
      // Fall through to link the key anyway
    } else if (!res.ok) {
      const newState = crypto.randomUUID();
      await c.env.OAUTH_STATE.put(`link:${newState}`, teamId, { expirationTtl: 600 });
      return c.html(renderApiKeyForm(newState, "", `LogClaw API returned ${res.status}. Please try again.`));
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const newState = crypto.randomUUID();
    await c.env.OAUTH_STATE.put(`link:${newState}`, teamId, { expirationTtl: 600 });
    return c.html(renderApiKeyForm(newState, "", `Connection failed: ${msg}`));
  }

  // Link the API key
  const linked = await linkApiKey(c.env.SLACK_INSTALLATIONS, teamId, apiKey);
  if (!linked) {
    return c.html(renderErrorPage("Installation not found. Please reinstall the app."));
  }

  // Clean up state
  await c.env.OAUTH_STATE.delete(`link:${linkState}`);

  return c.html(renderSuccessPage());
});

// ── HTML Renderers (same style as MCP remote auth-handler.ts) ────

function renderApiKeyForm(state: string, teamName?: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect LogClaw to Slack</title>
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
    .success-badge {
      background: #052e16;
      border: 1px solid #166534;
      color: #4ade80;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      font-size: 0.8125rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">&#x1F525;</div>
      <span class="logo-text">LogClaw</span>
    </div>
    ${teamName ? `<div class="success-badge">&#x2705; Installed to ${teamName}</div>` : ""}
    <h2>Link your LogClaw project</h2>
    <p>Enter your LogClaw API key to connect your Slack workspace to your incidents, logs, and anomalies.</p>
    ${error ? `<div class="error">${error}</div>` : ""}
    <form method="POST" action="/oauth/link">
      <input type="hidden" name="state" value="${state}" />
      <label for="api_key">API Key</label>
      <input type="password" id="api_key" name="api_key" placeholder="lc_proj_..." required autocomplete="off" />
      <p class="hint">Find your API key in the <a href="https://app.logclaw.ai" target="_blank">LogClaw Console</a> &rarr; Project Settings &rarr; API Keys</p>
      <button type="submit">Connect</button>
    </form>
  </div>
</body>
</html>`;
}

function renderSuccessPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LogClaw Connected</title>
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
      text-align: center;
    }
    .check { font-size: 3rem; margin-bottom: 1rem; }
    h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.75rem; color: #fff; }
    p { font-size: 0.875rem; color: #a3a3a3; line-height: 1.6; }
    code {
      background: #262626;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-size: 0.8125rem;
      color: #FF8A65;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">&#x1F389;</div>
    <h2>LogClaw is connected!</h2>
    <p>
      Head to any Slack channel and type<br/>
      <code>@LogClaw show me critical incidents</code><br/>
      to get started.
    </p>
  </div>
</body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LogClaw - Error</title>
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
      text-align: center;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem; color: #fff; }
    p { font-size: 0.875rem; color: #a3a3a3; line-height: 1.5; }
    a {
      display: inline-block;
      margin-top: 1.5rem;
      padding: 0.625rem 1.5rem;
      background: #FF5722;
      color: #fff;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.875rem;
    }
    a:hover { background: #E64A19; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x26A0;&#xFE0F;</div>
    <h2>Something went wrong</h2>
    <p>${message}</p>
    <a href="/oauth/install">Try Again</a>
  </div>
</body>
</html>`;
}
