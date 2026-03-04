---
title: Dashboard
description: Next.js web UI for log ingestion, incident management, anomaly visualization, and pipeline monitoring.
---

# Dashboard

The LogClaw Dashboard is a **Next.js** web application providing a complete operational UI for the LogClaw platform.

## Features

<CardGroup cols={2}>
  <Card title="Log Ingestion" icon="upload">
    Drag-and-drop JSON/NDJSON file upload. Automatically converts to OTLP format and sends via the OTel Collector proxy.
  </Card>
  <Card title="Pipeline Monitoring" icon="chart-line">
    Real-time throughput visualization: Ingest → Stream → Process → Index → Detect → ML → Orchestrate → Ticketing.
  </Card>
  <Card title="Incident Management" icon="bell">
    View, acknowledge, resolve, and escalate incidents. Configure ticketing platforms and routing rules.
  </Card>
  <Card title="Anomaly Visualization" icon="chart-scatter">
    Time-series charts showing anomaly scores, affected services, error rate trends, and blast radius.
  </Card>
</CardGroup>

## Architecture

The Dashboard acts as a **proxy gateway** to all backend services. Each backend gets its own API route:

| Proxy Route | Backend Service | Environment Variable |
|-------------|----------------|---------------------|
| `/api/otel/*` | OTel Collector | `OTEL_COLLECTOR_ENDPOINT` |
| `/api/bridge/*` | Bridge | `BRIDGE_ENDPOINT` |
| `/api/opensearch/*` | OpenSearch | `OPENSEARCH_ENDPOINT` |
| `/api/ticketing/*` | Ticketing Agent | `TICKETING_ENDPOINT` |
| `/api/airflow/*` | Airflow | `AIRFLOW_ENDPOINT` |
| `/api/feast/*` | Feast | `FEAST_ENDPOINT` |
| `/api/agent/*` | Infrastructure Agent | `AGENT_ENDPOINT` |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OTEL_COLLECTOR_ENDPOINT` | Yes | `http://localhost:4318` | OTel Collector HTTP endpoint |
| `BRIDGE_ENDPOINT` | Yes | `http://localhost:8080` | Bridge service endpoint |
| `OPENSEARCH_ENDPOINT` | Yes | `http://localhost:9200` | OpenSearch cluster URL |
| `OPENSEARCH_USER` | No | — | OpenSearch Basic Auth username |
| `OPENSEARCH_PASSWORD` | No | — | OpenSearch Basic Auth password |
| `TICKETING_ENDPOINT` | No | `http://localhost:18081` | Ticketing Agent endpoint |
| `AIRFLOW_ENDPOINT` | No | `http://localhost:28080` | Airflow webserver endpoint |
| `FEAST_ENDPOINT` | No | `http://localhost:6567` | Feast feature server endpoint |
| `AGENT_ENDPOINT` | No | `http://localhost:8080` | Infrastructure Agent endpoint |

## Log File Upload

The Dashboard supports drag-and-drop log file upload:

1. **Drag** a JSON or NDJSON file onto the upload area
2. The Dashboard parses each log entry
3. Converts entries to **OTLP format** using the built-in `logsToOtlp()` converter
4. Sends the OTLP payload to `/api/otel/v1/logs` (proxied to OTel Collector)

**Supported formats:**

| Format | Description | Example |
|--------|-------------|---------|
| JSON | Array of log objects | `[{"message": "...", "level": "ERROR"}]` |
| NDJSON | One JSON object per line | `{"message": "..."}\n{"message": "..."}` |

**Recognized fields:**

| Field | Mapping |
|-------|---------|
| `message` or `msg` or `body` | OTLP `body.stringValue` |
| `level` or `severity` | OTLP `severityText` |
| `timestamp` or `time` or `@timestamp` | OTLP `timeUnixNano` |
| `service` or `service.name` | OTLP resource attribute |
| `trace_id` or `traceId` | OTLP `traceId` |
| `span_id` or `spanId` | OTLP `spanId` |

## Pipeline Flow

The pipeline monitoring view shows real-time throughput across two rows:

**Data Pipeline:**
- **Ingest** (OTel Collector) → **Stream** (Kafka) → **Process** (Bridge/Flink) → **Index** (OpenSearch)

**AI & Operations:**
- **Detect** (Anomaly Engine) → **ML** (Feast/KServe) → **Orchestrate** (Airflow) → **Ticketing** (AI Agent)

Each stage shows:
- Current count (formatted with K/M suffixes)
- Data size where applicable
- Health status indicator (green/amber/red with animated ping)

## Ticketing Configuration

The Dashboard provides a UI for configuring ticketing platforms:

### Supported Platforms

| Platform | Required Fields |
|----------|----------------|
| **PagerDuty** | `routingKey` |
| **Jira** | `baseUrl`, `apiToken`, `userEmail` |
| **ServiceNow** | `instanceUrl`, `username`, `password` |
| **OpsGenie** | `apiKey` |
| **Slack** | `webhookUrl` |

### Configuration Endpoints

All configuration changes are persisted via the Ticketing Agent's runtime config API:

```bash
# Update PagerDuty settings
PATCH /api/ticketing/api/v1/config/platforms
{
  "pagerduty": {
    "enabled": true,
    "routingKey": "your-pagerduty-routing-key"
  }
}

# Update severity routing
PATCH /api/ticketing/api/v1/config/routing
{
  "critical": ["pagerduty", "slack"],
  "high": ["jira", "slack"],
  "medium": ["jira"],
  "low": ["slack"]
}
```

## Deployment

### Helm Values

```yaml
logclaw-dashboard:
  image:
    repository: "ghcr.io/logclaw/dashboard"
    tag: "latest"
  service:
    type: ClusterIP    # ClusterIP or LoadBalancer
    port: 3000
```

### Docker

```bash
cd apps/dashboard
docker build -t logclaw/dashboard:latest .
docker run -p 3000:3000 \
  -e OTEL_COLLECTOR_ENDPOINT=http://otel:4318 \
  -e BRIDGE_ENDPOINT=http://bridge:8080 \
  -e OPENSEARCH_ENDPOINT=http://opensearch:9200 \
  logclaw/dashboard:latest
```
