/**
 * MCP tool handlers for searching LogClaw logs and anomalies.
 * Queries go through the auth proxy → OpenSearch.
 */
import { logclawFetch } from "../client.js";

export async function searchLogs(args: Record<string, unknown>) {
  const limit = Math.min(Number(args.limit) || 50, 200);
  const minutesAgo = Number(args.minutes_ago) || 60;
  const now = new Date().toISOString();
  const from = new Date(Date.now() - minutesAgo * 60_000).toISOString();

  const musts: object[] = [
    { range: { timestamp: { gte: from, lte: now } } },
  ];

  if (args.service) {
    musts.push({ term: { "service.keyword": String(args.service) } });
  }
  if (args.level) {
    musts.push({ term: { "level.keyword": String(args.level) } });
  }
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
    _source: [
      "timestamp",
      "service",
      "level",
      "message",
      "trace_id",
      "span_id",
      "host",
    ],
  };

  const res = await logclawFetch<any>("/api/logs/_search", {
    method: "POST",
    body,
    timeout: 20000,
  });

  const hits = res.hits?.hits ?? [];
  const logs = hits.map((h: any) => h._source);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { total: res.hits?.total?.value ?? logs.length, logs },
          null,
          2,
        ),
      },
    ],
  };
}

export async function getAnomalies(args: Record<string, unknown>) {
  const limit = Math.min(Number(args.limit) || 20, 100);
  const musts: object[] = [];

  if (args.service) {
    musts.push({ term: { "service.keyword": String(args.service) } });
  }
  if (args.severity) {
    musts.push({ term: { "severity.keyword": String(args.severity) } });
  }

  const body = {
    size: limit,
    sort: [{ timestamp: "desc" }],
    query: musts.length > 0 ? { bool: { must: musts } } : { match_all: {} },
    _source: [
      "timestamp",
      "event_id",
      "service",
      "severity",
      "anomaly_score",
      "z_score",
      "anomaly_type",
      "title",
      "description",
      "detection_mode",
      "error_rate",
      "message",
    ],
  };

  const res = await logclawFetch<any>("/api/anomalies/_search", {
    method: "POST",
    body,
    timeout: 20000,
  });

  const hits = res.hits?.hits ?? [];
  const anomalies = hits.map((h: any) => ({
    id: h._id,
    ...h._source,
  }));

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { total: res.hits?.total?.value ?? anomalies.length, anomalies },
          null,
          2,
        ),
      },
    ],
  };
}
