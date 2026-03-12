/**
 * Cloudflare Worker environment bindings for the LogClaw Slack bot.
 */
interface Env {
  // KV namespaces
  SLACK_INSTALLATIONS: KVNamespace; // workspace_id → { botToken, teamName, logclawApiKey }
  CONVERSATIONS: KVNamespace; // channel:thread_ts → conversation history
  OAUTH_STATE: KVNamespace; // state token → team data (short TTL)

  // Slack app credentials (set via wrangler secret put)
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_SIGNING_SECRET: string;

  // OpenAI API key for the AI agent
  OPENAI_API_KEY: string;

  // LogClaw ticketing agent endpoint (set in wrangler.jsonc vars)
  LOGCLAW_ENDPOINT: string;
}
