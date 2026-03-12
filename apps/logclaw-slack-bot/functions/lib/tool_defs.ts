/**
 * OpenAI function-calling tool definitions.
 * Converted from the MCP server Zod schemas (apps/logclaw-mcp-server/src/index.ts).
 */

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_incidents",
      description:
        "List and filter incidents. Returns summaries with ID, title, severity, state, service, timestamps.",
      parameters: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
            description: "Filter by severity level",
          },
          state: {
            type: "string",
            enum: ["identified", "acknowledged", "investigating", "mitigated", "resolved"],
            description: "Filter by incident state",
          },
          service: { type: "string", description: "Filter by service name" },
          search: { type: "string", description: "Full-text search across title, service, description" },
          limit: { type: "number", description: "Max results (default: 20, max: 100)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_incident",
      description:
        "Get full incident details including root cause, causal chain, evidence logs, timeline, and suggested fix.",
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: 'Incident ID (e.g. "TICK-0037")' },
        },
        required: ["incident_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_incident",
      description:
        "Transition an incident state (acknowledge, investigate, mitigate, resolve) or add a timeline note.",
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: 'Incident ID (e.g. "TICK-0037")' },
          action: {
            type: "string",
            enum: ["acknowledge", "investigate", "mitigate", "resolve"],
            description: "State transition action",
          },
          note: { type: "string", description: "Optional note for the timeline" },
        },
        required: ["incident_id", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forward_incident",
      description:
        "Forward an incident to an external ticketing/alerting platform (PagerDuty, Jira, ServiceNow, OpsGenie, or Slack webhook).",
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: 'Incident ID (e.g. "TICK-0037")' },
          platform: {
            type: "string",
            enum: ["pagerduty", "jira", "servicenow", "opsgenie", "slack"],
            description: "Target platform",
          },
        },
        required: ["incident_id", "platform"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_logs",
      description:
        "Search raw logs. Filter by service, level, time range, and query. Returns entries with timestamp, service, level, message.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Filter by service name" },
          level: {
            type: "string",
            enum: ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"],
            description: "Filter by log level",
          },
          query: { type: "string", description: "Full-text search across log messages" },
          minutes_ago: { type: "number", description: "Look back N minutes (default: 60)" },
          limit: { type: "number", description: "Max results (default: 50, max: 200)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_anomalies",
      description:
        "Get recent anomaly detections (auto-detected via Z-score analysis on error rates). Returns score, service, severity.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Filter by service name" },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
            description: "Filter by severity",
          },
          limit: { type: "number", description: "Max results (default: 20, max: 100)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "service_health",
      description: "Check the health status of the LogClaw pipeline (ticketing agent). Returns status and latency.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "bulk_update",
      description:
        "Update multiple incidents at once. Acknowledge, investigate, mitigate, or resolve several incidents in a single call.",
      parameters: {
        type: "object",
        properties: {
          incident_ids: {
            type: "array",
            items: { type: "string" },
            description: 'Array of incident IDs (e.g. ["TICK-0037", "TICK-0038"])',
          },
          action: {
            type: "string",
            enum: ["acknowledge", "investigate", "mitigate", "resolve"],
            description: "State transition action",
          },
          note: { type: "string", description: "Optional note for each incident" },
        },
        required: ["incident_ids", "action"],
      },
    },
  },
];
