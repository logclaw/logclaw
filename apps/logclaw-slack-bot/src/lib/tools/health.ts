/**
 * Service health check — adapted from apps/logclaw-mcp-server/src/tools/health.ts.
 */
import { createClient } from "../client.js";

type Fetch = ReturnType<typeof createClient>["logclawFetch"];

export async function serviceHealth(fetch: Fetch) {
  const results: Record<string, { status: string; latencyMs: number }> = {};

  const start = Date.now();
  try {
    await fetch("/api/incidents?limit=1");
    results.ticketing_agent = {
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    results.ticketing_agent = {
      status: `down: ${msg}`,
      latencyMs: Date.now() - start,
    };
  }

  return results;
}
