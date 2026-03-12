/**
 * Block Kit formatters for Slack rich messages.
 *
 * Converts raw tool results from the AI agent loop into
 * Slack Block Kit blocks for visually rich responses.
 */
import type { ToolResult } from "./lib/agent.js";

// ── Emoji Maps ───────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
};

const STATE_EMOJI: Record<string, string> = {
  identified: "🔍",
  acknowledged: "👀",
  investigating: "🔬",
  mitigated: "🛡️",
  resolved: "✅",
};

const LEVEL_EMOJI: Record<string, string> = {
  FATAL: "💀",
  ERROR: "🔴",
  WARN: "🟡",
  INFO: "🔵",
  DEBUG: "⚪",
  TRACE: "⚪",
};

// ── Block Kit Types (no Slack SDK) ───────────────────────────────

interface TextObject {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

interface Block {
  type: string;
  text?: TextObject;
  fields?: TextObject[];
  elements?: Array<TextObject | Record<string, unknown>>;
  block_id?: string;
}

// ── Main Entry Point ─────────────────────────────────────────────

export function buildBlocks(toolResults: ToolResult[]): Block[] {
  const blocks: Block[] = [];

  for (const { name, result } of toolResults) {
    let formatted: Block[];
    switch (name) {
      case "list_incidents":
        formatted = formatIncidentList(result);
        break;
      case "get_incident":
        formatted = formatIncidentDetail(result);
        break;
      case "search_logs":
        formatted = formatLogResults(result);
        break;
      case "get_anomalies":
        formatted = formatAnomalyResults(result);
        break;
      case "service_health":
        formatted = formatHealthStatus(result);
        break;
      case "bulk_update":
        formatted = formatBulkUpdate(result);
        break;
      default:
        // update_incident, forward_incident: LLM text is sufficient
        formatted = [];
    }
    blocks.push(...formatted);
  }

  // Slack hard limit: max 50 blocks per message
  return blocks.slice(0, 50);
}

// ── Incident List ────────────────────────────────────────────────

function formatIncidentList(data: unknown): Block[] {
  const { total, incidents } = data as {
    total: number;
    incidents: Array<Record<string, unknown>>;
  };
  if (!incidents?.length) return [];

  const blocks: Block[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Incidents (${total})`, emoji: true },
    },
  ];

  for (const inc of incidents.slice(0, 10)) {
    const sev = String(inc.severity || "medium");
    const state = String(inc.state || "identified");
    const id = String(inc.id || inc.incident_id || "");
    const title = String(inc.title || "Untitled");
    const service = String(inc.service || "unknown");
    const created = inc.created_at ? formatTimestamp(String(inc.created_at)) : "";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${SEVERITY_EMOJI[sev] || "⚪"} \`${id}\` *${truncate(title, 80)}*`,
      },
      fields: [
        { type: "mrkdwn", text: `*Severity:* ${sev}` },
        { type: "mrkdwn", text: `*State:* ${STATE_EMOJI[state] || ""} ${state}` },
        { type: "mrkdwn", text: `*Service:* ${service}` },
        ...(created ? [{ type: "mrkdwn" as const, text: `*Created:* ${created}` }] : []),
      ],
    });
  }

  if (incidents.length > 10) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `_…and ${incidents.length - 10} more incidents_` }],
    });
  }

  return blocks;
}

// ── Incident Detail ──────────────────────────────────────────────

function formatIncidentDetail(data: unknown): Block[] {
  const inc = data as Record<string, unknown>;
  const sev = String(inc.severity || "medium");
  const state = String(inc.state || "identified");
  const id = String(inc.id || inc.incident_id || "");
  const title = String(inc.title || "Untitled");

  const blocks: Block[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${SEVERITY_EMOJI[sev] || "⚪"} ${id}: ${truncate(title, 100)}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Severity:* ${sev}` },
        { type: "mrkdwn", text: `*State:* ${STATE_EMOJI[state] || ""} ${state}` },
        { type: "mrkdwn", text: `*Service:* ${inc.service || "unknown"}` },
        { type: "mrkdwn", text: `*Created:* ${formatTimestamp(String(inc.created_at || ""))}` },
      ],
    },
  ];

  // Root cause
  const rootCause = inc.rootCause || inc.root_cause;
  if (rootCause) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Root Cause*\n${truncate(String(rootCause), 2900)}` },
    });
  }

  // Suggested fix
  const suggestedFix = inc.suggestedFix || inc.suggested_fix;
  if (suggestedFix) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Suggested Fix*\n${truncate(String(suggestedFix), 2900)}` },
    });
  }

  // Evidence logs (up to 5 in a code block)
  const evidence = (inc.evidence || inc.evidence_logs) as Array<Record<string, unknown>> | undefined;
  if (evidence?.length) {
    const lines = evidence.slice(0, 5).map((e) => {
      const ts = String(e.timestamp || "").slice(11, 19);
      const lvl = String(e.level || "").padEnd(5);
      const msg = truncate(String(e.message || ""), 120);
      return `${ts} ${lvl} ${msg}`;
    });
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Evidence Logs*\n\`\`\`${lines.join("\n")}\`\`\`` },
    });
  }

  // Timeline (last 5 entries)
  const timeline = inc.timeline as Array<Record<string, unknown>> | undefined;
  if (timeline?.length) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Timeline*" } });
    for (const entry of timeline.slice(-5)) {
      const ts = formatTimestamp(String(entry.timestamp || entry.time || ""));
      const action = String(entry.action || entry.event || "");
      const note = entry.note ? ` — ${truncate(String(entry.note), 200)}` : "";
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `${ts}  *${action}*${note}` }],
      });
    }
  }

  return blocks;
}

// ── Log Results ──────────────────────────────────────────────────

function formatLogResults(data: unknown): Block[] {
  const { total, logs } = data as { total: number; logs: Array<Record<string, unknown>> };
  if (!logs?.length) return [];

  const blocks: Block[] = [
    { type: "header", text: { type: "plain_text", text: `Log Results (${total})`, emoji: true } },
  ];

  const lines = logs.slice(0, 20).map((log) => {
    const ts = String(log.timestamp || "").slice(11, 19);
    const svc = truncate(String(log.service || ""), 15).padEnd(15);
    const lvl = (LEVEL_EMOJI[String(log.level || "")] || "  ") + " " + String(log.level || "").padEnd(5);
    const msg = truncate(String(log.message || ""), 80);
    return `${ts} │ ${svc} │ ${lvl} │ ${msg}`;
  });

  const header = "TIME     │ SERVICE         │ LEVEL   │ MESSAGE";
  const separator = "─".repeat(78);
  let codeBlock = `${header}\n${separator}\n${lines.join("\n")}`;
  if (codeBlock.length > 2900) {
    codeBlock = codeBlock.slice(0, 2900) + "\n…";
  }

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "```" + codeBlock + "```" },
  });

  if (logs.length > 20) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `_Showing 20 of ${total} logs_` }],
    });
  }

  return blocks;
}

// ── Anomaly Results ──────────────────────────────────────────────

function formatAnomalyResults(data: unknown): Block[] {
  const { total, anomalies } = data as {
    total: number;
    anomalies: Array<Record<string, unknown>>;
  };
  if (!anomalies?.length) return [];

  const blocks: Block[] = [
    { type: "header", text: { type: "plain_text", text: `Anomalies Detected (${total})`, emoji: true } },
  ];

  for (const a of anomalies.slice(0, 10)) {
    const sev = String(a.severity || "medium");
    const zScore = Number(a.z_score || a.anomaly_score || 0).toFixed(1);
    const service = String(a.service || "unknown");
    const title = String(a.title || a.anomaly_type || "anomaly");
    const desc = a.description ? truncate(String(a.description), 200) : "";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${SEVERITY_EMOJI[sev] || "⚪"} *${truncate(title, 80)}*${desc ? `\n${desc}` : ""}`,
      },
      fields: [
        { type: "mrkdwn", text: `*Z-Score:* \`${zScore}\`` },
        { type: "mrkdwn", text: `*Severity:* ${sev}` },
        { type: "mrkdwn", text: `*Service:* ${service}` },
        { type: "mrkdwn", text: `*Detected:* ${formatTimestamp(String(a.timestamp || ""))}` },
      ],
    });
  }

  if (anomalies.length > 10) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `_…and ${anomalies.length - 10} more anomalies_` }],
    });
  }

  return blocks;
}

// ── Health Status ────────────────────────────────────────────────

function formatHealthStatus(data: unknown): Block[] {
  const services = data as Record<string, { status: string; latencyMs: number }>;

  const blocks: Block[] = [
    { type: "header", text: { type: "plain_text", text: "Service Health", emoji: true } },
  ];

  for (const [name, info] of Object.entries(services)) {
    const isHealthy = info.status === "healthy";
    const statusEmoji = isHealthy ? "🟢" : "🔴";
    const latencyEmoji = info.latencyMs < 500 ? "🟢" : info.latencyMs < 2000 ? "🟡" : "🔴";

    blocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Service:* ${name.replace(/_/g, " ")}` },
        { type: "mrkdwn", text: `*Status:* ${statusEmoji} ${info.status}` },
        { type: "mrkdwn", text: `*Latency:* ${latencyEmoji} \`${info.latencyMs}ms\`` },
      ],
    });
  }

  return blocks;
}

// ── Bulk Update ──────────────────────────────────────────────────

function formatBulkUpdate(data: unknown): Block[] {
  const { action, total, succeeded, failed, results } = data as {
    action: string;
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{ id: string; status: string; error?: string }>;
  };

  const emoji = failed === 0 ? "✅" : failed < total ? "⚠️" : "❌";

  const blocks: Block[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} Bulk ${action}: ${succeeded}/${total} succeeded`,
        emoji: true,
      },
    },
  ];

  if (failed > 0 && results?.length) {
    const failures = results
      .filter((r) => r.status === "failed")
      .map((r) => `• \`${r.id}\`: ${r.error || "unknown error"}`)
      .join("\n");
    if (failures) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Failures:*\n${truncate(failures, 2900)}` },
      });
    }
  }

  return blocks;
}

// ── Helpers ──────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
    const month = d.toLocaleString("en-US", { month: "short" });
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${month} ${day}, ${hh}:${mm}`;
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}
