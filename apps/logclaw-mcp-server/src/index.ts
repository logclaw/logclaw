#!/usr/bin/env node

/**
 * LogClaw MCP Server
 *
 * Exposes LogClaw incidents, logs, and anomalies as MCP tools for AI coding
 * tools (Claude Code, Cursor, Windsurf, etc.).
 *
 * Environment variables:
 *   LOGCLAW_ENDPOINT  — Base URL of the LogClaw auth proxy
 *   LOGCLAW_API_KEY   — API key for authentication
 *
 * Usage:
 *   LOGCLAW_API_KEY=lc_proj_... npx logclaw-mcp-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { listIncidents, getIncident, updateIncident, bulkUpdateIncidents, exportIncidents } from "./tools/incidents.js";
import { searchLogs, getAnomalies } from "./tools/logs.js";
import { serviceHealth } from "./tools/health.js";

// ── Create MCP Server ───────────────────────────────────────

const server = new McpServer({
  name: "logclaw",
  version: "1.0.6",
});

// ── Register tools ──────────────────────────────────────────

server.tool(
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
  async (args) => listIncidents(args),
);

server.tool(
  "logclaw_get_incident",
  "Get full incident details including root cause, causal chain, evidence logs, traces, timeline, blast radius, and suggested fix.",
  {
    incident_id: z.string().describe('Incident ID (e.g. "TICK-0037")'),
  },
  { readOnlyHint: true },
  async (args) => getIncident(args),
);

server.tool(
  "logclaw_update_incident",
  "Transition an incident state (acknowledge, investigate, mitigate, resolve) or add a timeline note.",
  {
    incident_id: z.string().describe('Incident ID (e.g. "TICK-0037")'),
    action: z.enum(["acknowledge", "investigate", "mitigate", "resolve"]).describe("State transition action"),
    note: z.string().optional().describe("Optional note for the timeline"),
  },
  { readOnlyHint: false, destructiveHint: false },
  async (args) => updateIncident(args),
);

server.tool(
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
  async (args) => searchLogs(args),
);

server.tool(
  "logclaw_get_anomalies",
  "Get recent anomaly detections. Anomalies are auto-detected using Z-score analysis on error rates. Returns score, detection mode, service.",
  {
    service: z.string().optional().describe("Filter by service name"),
    severity: z.enum(["critical", "high", "medium", "low"]).optional().describe("Filter by severity"),
    limit: z.number().optional().describe("Max results (default: 20, max: 100)"),
  },
  { readOnlyHint: true },
  async (args) => getAnomalies(args),
);

server.tool(
  "logclaw_service_health",
  "Check the health status of LogClaw pipeline services (ticketing agent, etc). Returns status and latency.",
  {},
  { readOnlyHint: true },
  async () => serviceHealth(),
);

server.tool(
  "logclaw_bulk_update",
  "Update multiple incidents at once. Acknowledge, investigate, mitigate, or resolve several incidents in a single call.",
  {
    incident_ids: z.array(z.string()).describe('Array of incident IDs (e.g. ["TICK-0037", "TICK-0038"])'),
    action: z.enum(["acknowledge", "investigate", "mitigate", "resolve"]).describe("State transition action"),
    note: z.string().optional().describe("Optional note for each incident timeline"),
  },
  { readOnlyHint: false, destructiveHint: false },
  async (args) => bulkUpdateIncidents(args),
);

server.tool(
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
  async (args) => exportIncidents(args),
);

// ── Start stdio transport ───────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LogClaw MCP Server started (stdio)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
