/**
 * LogClaw Slack Bot — Cloudflare Worker entry point.
 *
 * Multi-tenant Slack app: any company installs via "Add to Slack",
 * links their LogClaw API key, and interacts with @LogClaw in Slack.
 *
 * Routes:
 *   /oauth/install   — Start Slack OAuth install flow
 *   /oauth/callback  — Slack redirect after approval
 *   /oauth/link      — Link LogClaw API key to workspace
 *   /events          — Slack Events API webhook (app_mention)
 *   /health          — Health check
 */
import { Hono } from "hono";
import { oauthApp } from "./oauth.js";
import { eventsApp } from "./events.js";

const app = new Hono<{ Bindings: Env }>();

// OAuth install + API key linking
app.route("/oauth", oauthApp);

// Slack Events API
app.route("/", eventsApp);

// Health check
app.get("/health", (c) => c.json({ ok: true, service: "logclaw-slack-bot" }));

// Catch-all
app.all("*", (c) => c.json({ error: "Not found" }, 404));

export default app;
