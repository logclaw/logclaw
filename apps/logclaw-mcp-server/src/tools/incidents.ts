/**
 * MCP tool handlers for LogClaw incident management.
 */
import { logclawFetch } from "../client.js";

export async function listIncidents(args: Record<string, unknown>) {
  const params = new URLSearchParams();
  if (args.severity) params.set("severity", String(args.severity));
  if (args.state) params.set("state", String(args.state));
  if (args.service) params.set("service", String(args.service));
  if (args.search) params.set("search", String(args.search));
  params.set("limit", String(Math.min(Number(args.limit) || 20, 100)));

  const res = await logclawFetch<{
    data?: unknown[];
    incidents?: unknown[];
    total?: number;
  }>(`/api/incidents?${params}`);

  const incidents = res.data ?? res.incidents ?? [];
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { total: res.total ?? incidents.length, incidents },
          null,
          2,
        ),
      },
    ],
  };
}

export async function getIncident(args: Record<string, unknown>) {
  const id = String(args.incident_id);
  const res = await logclawFetch<Record<string, unknown>>(`/api/incidents/${id}`);
  const incident = "data" in res && typeof res.data === "object" && res.data !== null ? res.data : res;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(incident, null, 2),
      },
    ],
  };
}

export async function updateIncident(args: Record<string, unknown>) {
  const id = String(args.incident_id);
  const action = String(args.action);
  const body = args.note ? { note: String(args.note) } : {};

  const res = await logclawFetch<Record<string, unknown>>(
    `/api/incidents/${id}/${action}`,
    { method: "POST", body },
  );
  const incident = "data" in res && typeof res.data === "object" && res.data !== null ? res.data : res;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(incident, null, 2),
      },
    ],
  };
}

export async function bulkUpdateIncidents(args: Record<string, unknown>) {
  const ids = (args.incident_ids as string[]) ?? [];
  const action = String(args.action);
  const note = args.note ? String(args.note) : undefined;

  const results: { id: string; status: string; error?: string }[] = [];

  for (const id of ids) {
    try {
      const body = note ? { note } : {};
      await logclawFetch(`/api/incidents/${id}/${action}`, {
        method: "POST",
        body,
      });
      results.push({ id, status: "success" });
    } catch (e: any) {
      results.push({ id, status: "failed", error: e.message });
    }
  }

  const succeeded = results.filter((r) => r.status === "success").length;
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { action, total: ids.length, succeeded, failed: ids.length - succeeded, results },
          null,
          2,
        ),
      },
    ],
  };
}

export async function exportIncidents(args: Record<string, unknown>) {
  const format = String(args.format || "csv");
  const params = new URLSearchParams();
  if (args.severity) params.set("severity", String(args.severity));
  if (args.state) params.set("state", String(args.state));
  if (args.service) params.set("service", String(args.service));
  params.set("limit", String(Math.min(Number(args.limit) || 50, 100)));

  const res = await logclawFetch<{
    data?: any[];
    incidents?: any[];
    total?: number;
  }>(`/api/incidents?${params}`);

  const incidents = (res.data ?? res.incidents ?? []) as any[];

  if (format === "csv") {
    const headers = ["id", "title", "severity", "state", "service", "created_at", "updated_at"];
    const rows = incidents.map((inc) =>
      headers.map((h) => {
        const val = String(inc[h] ?? "");
        return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    return {
      content: [{ type: "text" as const, text: csv }],
    };
  }

  if (format === "markdown") {
    const header = "| ID | Title | Severity | State | Service | Created |";
    const sep = "|---|---|---|---|---|---|";
    const rows = incidents.map(
      (inc) =>
        `| ${inc.id ?? ""} | ${inc.title ?? ""} | ${inc.severity ?? ""} | ${inc.state ?? ""} | ${inc.service ?? ""} | ${inc.created_at ?? ""} |`,
    );
    return {
      content: [{ type: "text" as const, text: [header, sep, ...rows].join("\n") }],
    };
  }

  // Default: JSON
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ total: incidents.length, incidents }, null, 2),
      },
    ],
  };
}
