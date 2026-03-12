/**
 * Incident management tools — adapted from apps/logclaw-mcp-server/src/tools/incidents.ts.
 * Returns raw JSON objects instead of MCP content wrappers.
 */
import { createClient } from "../client.ts";

type Fetch = ReturnType<typeof createClient>["logclawFetch"];

export async function listIncidents(
  fetch: Fetch,
  args: Record<string, unknown>,
) {
  const params = new URLSearchParams();
  if (args.severity) params.set("severity", String(args.severity));
  if (args.state) params.set("state", String(args.state));
  if (args.service) params.set("service", String(args.service));
  if (args.search) params.set("search", String(args.search));
  params.set("limit", String(Math.min(Number(args.limit) || 20, 100)));

  const res = await fetch<{
    data?: unknown[];
    incidents?: unknown[];
    total?: number;
  }>(`/api/incidents?${params}`);

  const incidents = res.data ?? res.incidents ?? [];
  return { total: (res as Record<string, unknown>).total ?? incidents.length, incidents };
}

export async function getIncident(
  fetch: Fetch,
  args: Record<string, unknown>,
) {
  const id = String(args.incident_id);
  const res = await fetch<Record<string, unknown>>(`/api/incidents/${id}`);
  return "data" in res && typeof res.data === "object" && res.data !== null
    ? res.data
    : res;
}

export async function updateIncident(
  fetch: Fetch,
  args: Record<string, unknown>,
) {
  const id = String(args.incident_id);
  const action = String(args.action);
  const body = args.note ? { note: String(args.note) } : {};

  const res = await fetch<Record<string, unknown>>(
    `/api/incidents/${id}/${action}`,
    { method: "POST", body },
  );
  return "data" in res && typeof res.data === "object" && res.data !== null
    ? res.data
    : res;
}

export async function forwardIncident(
  fetch: Fetch,
  args: Record<string, unknown>,
) {
  const id = String(args.incident_id);
  const platform = String(args.platform);

  const res = await fetch<Record<string, unknown>>(
    `/api/incidents/${id}/forward`,
    { method: "POST", body: { platform } },
  );
  return res;
}

export async function bulkUpdateIncidents(
  fetch: Fetch,
  args: Record<string, unknown>,
) {
  const ids = (args.incident_ids as string[]) ?? [];
  const action = String(args.action);
  const note = args.note ? String(args.note) : undefined;

  const results: { id: string; status: string; error?: string }[] = [];
  for (const id of ids) {
    try {
      const body = note ? { note } : {};
      await fetch(`/api/incidents/${id}/${action}`, { method: "POST", body });
      results.push({ id, status: "success" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id, status: "failed", error: msg });
    }
  }

  const succeeded = results.filter((r) => r.status === "success").length;
  return { action, total: ids.length, succeeded, failed: ids.length - succeeded, results };
}
