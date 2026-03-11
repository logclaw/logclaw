/**
 * LogClaw Remote MCP Server — Cloudflare Workers Durable Object.
 *
 * Registers all 8 LogClaw tools with safety annotations.
 * The API key comes from authenticated OAuth session props.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { createLogClawClient } from "./client.js";

export type Props = {
  apiKey: string;
  tenantId: string;
  keyPrefix: string;
};

export class LogClawMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "logclaw",
    version: "1.0.5",
  });

  async init() {
    const { logclawFetch } = createLogClawClient(
      this.env.LOGCLAW_ENDPOINT,
      this.props!.apiKey,
    );

    // ── Tool 1: List incidents ─────────────────────────────────

    this.server.tool(
      "logclaw_list_incidents",
      "List and filter LogClaw incidents. Returns summaries with ID, title, severity, state, service, timestamps.",
      {
        severity: z.enum(["critical", "high", "medium", "low"]).optional().describe("Filter by severity level"),
        state: z.enum(["triggered", "identified", "acknowledged", "investigating", "mitigated", "resolved"]).optional().describe("Filter by incident state"),
        service: z.string().optional().describe("Filter by service name"),
        search: z.string().optional().describe("Full-text search across title, service, description"),
        limit: z.number().optional().describe("Max results (default: 20, max: 100)"),
      },
      { readOnlyHint: true },
      async (args) => {
        const params = new URLSearchParams();
        if (args.severity) params.set("severity", String(args.severity));
        if (args.state) params.set("state", String(args.state));
        if (args.service) params.set("service", String(args.service));
        if (args.search) params.set("search", String(args.search));
        params.set("limit", String(Math.min(Number(args.limit) || 20, 100)));

        const res = await logclawFetch<{ data?: unknown[]; incidents?: unknown[]; total?: number }>(
          `/api/incidents?${params}`,
        );
        const incidents = res.data ?? res.incidents ?? [];
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ total: res.total ?? incidents.length, incidents }, null, 2),
          }],
        };
      },
    );

    // ── Tool 2: Get incident details ───────────────────────────

    this.server.tool(
      "logclaw_get_incident",
      "Get full incident details including root cause, causal chain, evidence logs, traces, timeline, blast radius, and suggested fix.",
      {
        incident_id: z.string().describe('Incident ID (e.g. "TICK-0037")'),
      },
      { readOnlyHint: true },
      async (args) => {
        const res = await logclawFetch<{ data?: unknown }>(`/api/incidents/${args.incident_id}`);
        const incident = res.data ?? res;
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(incident, null, 2),
          }],
        };
      },
    );

    // ── Tool 3: Update incident ────────────────────────────────

    this.server.tool(
      "logclaw_update_incident",
      "Transition an incident state (acknowledge, investigate, mitigate, resolve) or add a timeline note.",
      {
        incident_id: z.string().describe('Incident ID (e.g. "TICK-0037")'),
        action: z.enum(["acknowledge", "investigate", "mitigate", "resolve"]).describe("State transition action"),
        note: z.string().optional().describe("Optional note for the timeline"),
      },
      { readOnlyHint: false, destructiveHint: false },
      async (args) => {
        const body = args.note ? { note: String(args.note) } : {};
        const res = await logclawFetch<{ data?: unknown }>(
          `/api/incidents/${args.incident_id}/${args.action}`,
          { method: "POST", body },
        );
        const incident = res.data ?? res;
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(incident, null, 2),
          }],
        };
      },
    );

    // ── Tool 4: Search logs ────────────────────────────────────

    this.server.tool(
      "logclaw_search_logs",
      "Search raw logs in LogClaw. Filter by service, level, time range, and query. Returns entries with timestamp, service, level, message, trace_id.",
      {
        service: z.string().optional().describe("Filter by service name"),
        level: z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]).optional().describe("Filter by log level"),
        query: z.string().optional().describe("Full-text search across log messages"),
        minutes_ago: z.number().optional().describe("Look back N minutes (default: 60)"),
        limit: z.number().optional().describe("Max results (default: 50, max: 200)"),
      },
      { readOnlyHint: true },
      async (args) => {
        const limit = Math.min(Number(args.limit) || 50, 200);
        const minutesAgo = Number(args.minutes_ago) || 60;
        const now = new Date().toISOString();
        const from = new Date(Date.now() - minutesAgo * 60_000).toISOString();

        const musts: object[] = [
          { range: { timestamp: { gte: from, lte: now } } },
        ];
        if (args.service) musts.push({ term: { "service.keyword": String(args.service) } });
        if (args.level) musts.push({ term: { "level.keyword": String(args.level) } });
        if (args.query) {
          musts.push({
            multi_match: {
              query: String(args.query),
              fields: ["message", "service", "host"],
            },
          });
        }

        const body = {
          size: limit,
          sort: [{ timestamp: "desc" }],
          query: { bool: { must: musts } },
          _source: ["timestamp", "service", "level", "message", "trace_id", "span_id", "host"],
        };

        const res = await logclawFetch<any>("/api/logs/_search", {
          method: "POST",
          body,
          timeout: 20000,
        });

        const hits = res.hits?.hits ?? [];
        const logs = hits.map((h: any) => h._source);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ total: res.hits?.total?.value ?? logs.length, logs }, null, 2),
          }],
        };
      },
    );

    // ── Tool 5: Get anomalies ──────────────────────────────────

    this.server.tool(
      "logclaw_get_anomalies",
      "Get recent anomaly detections. Anomalies are auto-detected using Z-score analysis on error rates. Returns score, detection mode, service.",
      {
        service: z.string().optional().describe("Filter by service name"),
        severity: z.enum(["critical", "high", "medium", "low"]).optional().describe("Filter by severity"),
        limit: z.number().optional().describe("Max results (default: 20, max: 100)"),
      },
      { readOnlyHint: true },
      async (args) => {
        const limit = Math.min(Number(args.limit) || 20, 100);
        const musts: object[] = [];
        if (args.service) musts.push({ term: { "service.keyword": String(args.service) } });
        if (args.severity) musts.push({ term: { "severity.keyword": String(args.severity) } });

        const body = {
          size: limit,
          sort: [{ timestamp: "desc" }],
          query: musts.length > 0 ? { bool: { must: musts } } : { match_all: {} },
          _source: [
            "timestamp", "event_id", "service", "severity", "anomaly_score",
            "z_score", "anomaly_type", "title", "description", "detection_mode",
            "error_rate", "message",
          ],
        };

        const res = await logclawFetch<any>("/api/anomalies/_search", {
          method: "POST",
          body,
          timeout: 20000,
        });

        const hits = res.hits?.hits ?? [];
        const anomalies = hits.map((h: any) => ({ id: h._id, ...h._source }));
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ total: res.hits?.total?.value ?? anomalies.length, anomalies }, null, 2),
          }],
        };
      },
    );

    // ── Tool 6: Service health ─────────────────────────────────

    this.server.tool(
      "logclaw_service_health",
      "Check the health status of LogClaw pipeline services (ticketing agent, etc). Returns status and latency.",
      {},
      { readOnlyHint: true },
      async () => {
        const results: Record<string, { status: string; latencyMs: number }> = {};
        const start = Date.now();
        try {
          await logclawFetch("/api/incidents?limit=1");
          results.ticketing_agent = { status: "healthy", latencyMs: Date.now() - start };
        } catch (e: any) {
          results.ticketing_agent = { status: `down: ${e.message}`, latencyMs: Date.now() - start };
        }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          }],
        };
      },
    );

    // ── Tool 7: Bulk update ──────────────────────────────────

    this.server.tool(
      "logclaw_bulk_update",
      "Update multiple incidents at once. Acknowledge, investigate, mitigate, or resolve several incidents in a single call.",
      {
        incident_ids: z.array(z.string()).describe('Array of incident IDs (e.g. ["TICK-0037", "TICK-0038"])'),
        action: z.enum(["acknowledge", "investigate", "mitigate", "resolve"]).describe("State transition action"),
        note: z.string().optional().describe("Optional note for each incident timeline"),
      },
      { readOnlyHint: false, destructiveHint: false },
      async (args) => {
        const ids = args.incident_ids as string[];
        const results: { id: string; status: string; error?: string }[] = [];

        for (const id of ids) {
          try {
            const body = args.note ? { note: String(args.note) } : {};
            await logclawFetch(`/api/incidents/${id}/${args.action}`, { method: "POST", body });
            results.push({ id, status: "success" });
          } catch (e: any) {
            results.push({ id, status: "failed", error: e.message });
          }
        }

        const succeeded = results.filter((r) => r.status === "success").length;
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ action: args.action, total: ids.length, succeeded, failed: ids.length - succeeded, results }, null, 2),
          }],
        };
      },
    );

    // ── Tool 8: Export incidents ──────────────────────────────

    this.server.tool(
      "logclaw_export_incidents",
      "Export incidents in CSV, markdown table, or JSON format for easy copy-paste or sharing.",
      {
        format: z.enum(["csv", "markdown", "json"]).optional().describe("Export format (default: csv)"),
        severity: z.enum(["critical", "high", "medium", "low"]).optional().describe("Filter by severity"),
        state: z.enum(["triggered", "identified", "acknowledged", "investigating", "mitigated", "resolved"]).optional().describe("Filter by state"),
        service: z.string().optional().describe("Filter by service name"),
        limit: z.number().optional().describe("Max results (default: 50, max: 100)"),
      },
      { readOnlyHint: true },
      async (args) => {
        const format = String(args.format || "csv");
        const params = new URLSearchParams();
        if (args.severity) params.set("severity", String(args.severity));
        if (args.state) params.set("state", String(args.state));
        if (args.service) params.set("service", String(args.service));
        params.set("limit", String(Math.min(Number(args.limit) || 50, 100)));

        const res = await logclawFetch<{ data?: any[]; incidents?: any[]; total?: number }>(
          `/api/incidents?${params}`,
        );
        const incidents = (res.data ?? res.incidents ?? []) as any[];

        if (format === "csv") {
          const headers = ["id", "title", "severity", "state", "service", "created_at", "updated_at"];
          const rows = incidents.map((inc) =>
            headers.map((h) => {
              const val = String(inc[h] ?? "");
              return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
            }).join(","),
          );
          return { content: [{ type: "text" as const, text: [headers.join(","), ...rows].join("\n") }] };
        }

        if (format === "markdown") {
          const header = "| ID | Title | Severity | State | Service | Created |";
          const sep = "|---|---|---|---|---|---|";
          const rows = incidents.map(
            (inc) => `| ${inc.id ?? ""} | ${inc.title ?? ""} | ${inc.severity ?? ""} | ${inc.state ?? ""} | ${inc.service ?? ""} | ${inc.created_at ?? ""} |`,
          );
          return { content: [{ type: "text" as const, text: [header, sep, ...rows].join("\n") }] };
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ total: incidents.length, incidents }, null, 2),
          }],
        };
      },
    );
  }
}
