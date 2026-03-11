/**
 * LogClaw Remote MCP Server — Cloudflare Worker entry point.
 *
 * Wraps the MCP server with OAuth 2.1 via workers-oauth-provider.
 * Users authenticate by entering their LogClaw API key, which is
 * encrypted and stored — the MCP client only receives an opaque token.
 *
 * Endpoints:
 *   /            — Streamable HTTP MCP transport
 *   /authorize   — OAuth authorization (API key form)
 *   /token       — OAuth token exchange
 *   /register    — Dynamic client registration (RFC 7591)
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { LogClawMCP } from "./mcp-server.js";
import { AuthHandler } from "./auth-handler.js";

// Re-export the Durable Object class so Cloudflare can instantiate it
export { LogClawMCP };

export default new OAuthProvider({
  apiHandler: LogClawMCP.serve("/"),
  apiRoute: "/",
  defaultHandler: AuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
