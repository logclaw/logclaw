/**
 * Cloudflare Worker environment bindings.
 */
interface Env {
  // Durable Object binding for MCP sessions
  MCP_OBJECT: DurableObjectNamespace;

  // KV for OAuth token storage
  OAUTH_KV: KVNamespace;

  // LogClaw auth proxy endpoint
  LOGCLAW_ENDPOINT: string;

  // Cookie encryption key (set via wrangler secret)
  COOKIE_ENCRYPTION_KEY: string;
}
