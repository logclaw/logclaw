/**
 * MCP tool handler for checking LogClaw pipeline health.
 */
import { logclawFetch } from "../client.js";

export async function serviceHealth() {
  const results: Record<string, { status: string; latencyMs: number }> = {};

  // Check ticketing agent
  const start = Date.now();
  try {
    await logclawFetch("/api/incidents?limit=1");
    results.ticketing_agent = {
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (e: any) {
    results.ticketing_agent = {
      status: `down: ${e.message}`,
      latencyMs: Date.now() - start,
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(results, null, 2),
      },
    ],
  };
}
