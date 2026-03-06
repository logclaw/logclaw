---
title: Dashboard
description: Next.js web UI for log ingestion, incident management, anomaly visualization, and pipeline monitoring.
---

# Dashboard

The LogClaw Dashboard is a **Next.js** web application providing a complete operational UI for the LogClaw platform.

## Features

<CardGroup cols={2}>
  <Card title="Log Ingestion" icon="upload">
    Drag-and-drop file upload supporting JSON, NDJSON, CSV, and plain text formats. Automatically converts to OTLP format and sends via the OTel Collector proxy. Includes tabbed code examples for cURL, Python, Node.js, Go, and Java.
  </Card>
  <Card title="Pipeline Monitoring" icon="chart-line">
    Real-time throughput visualization: Ingest → Stream → Process → Index → Detect → ML → Orchestrate → Ticketing.
  </Card>
  <Card title="Incident Management" icon="bell">
    View, acknowledge, resolve, and escalate incidents. Bulk actions (acknowledge/resolve/escalate multiple), CSV export, full-text search, and auto-deduplication. Configure ticketing platforms and routing rules.
  </Card>
  <Card title="Anomaly Visualization" icon="chart-scatter">
    Time-series charts showing anomaly scores, affected services, error rate trends, and blast radius.
  </Card>
  <Card title="Dark Mode" icon="moon">
    System-aware dark mode with manual toggle (Light / Dark / System). Persisted via localStorage. Accessible from the navigation bar.
  </Card>
  <Card title="Error Resilience" icon="shield">
    Error boundaries catch component crashes and display retry UI. Loading skeletons provide visual feedback during data fetches. LLM fallback badge indicates when AI RCA is unavailable.
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

1. **Drag** a file onto the upload area (or click to browse)
2. The Dashboard parses each log entry based on file format
3. Converts entries to **OTLP format** using the built-in `logsToOtlp()` converter
4. Sends the OTLP payload to `/api/otel/v1/logs` (proxied to OTel Collector)

**Supported formats:**

| Format | Extension | Description | Example |
|--------|-----------|-------------|---------|
| JSON | `.json` | Array or single log object | `[{"message": "...", "level": "ERROR"}]` |
| NDJSON | `.ndjson` | One JSON object per line | `{"message": "..."}\n{"message": "..."}` |
| CSV | `.csv` | Header row required, auto-mapped columns | `message,level,service\n"Error",ERROR,api` |
| Text | `.txt`, `.log` | One log message per line | `2024-03-01 ERROR Connection timeout` |

**Recognized fields:**

| Field | Mapping |
|-------|---------|
| `message` or `msg` or `body` | OTLP `body.stringValue` |
| `level` or `severity` | OTLP `severityText` |
| `timestamp` or `time` or `@timestamp` | OTLP `timeUnixNano` |
| `service` or `service.name` | OTLP resource attribute |
| `trace_id` or `traceId` | OTLP `traceId` |
| `span_id` or `spanId` | OTLP `spanId` |

## Incident Management Features

### Bulk Actions

Select multiple incidents using checkboxes and perform batch operations:
- **Bulk Acknowledge** — acknowledge all selected incidents at once
- **Bulk Resolve** — resolve all selected incidents at once
- **Bulk Escalate** — escalate all selected incidents at once

The selection toolbar appears when one or more incidents are checked, showing the count and available actions.

### CSV Export

Export the current incident list as a CSV file. The export includes all visible columns: ID, title, severity, status, service, anomaly score, affected services, and timestamps. Click the download button in the incidents toolbar.

### Full-Text Search

Filter incidents by typing in the search bar. Searches across incident title, service name, and affected services in real-time.

### Incident Audit Trail

Each incident detail page shows a complete audit trail of state changes (created → acknowledged → escalated → resolved) with timestamps. View the audit log on the incident detail page under the "Audit Trail" section.

### Auto-Deduplication

The Ticketing Agent automatically deduplicates incoming anomalies to prevent duplicate incidents. Anomalies with the same service and severity within the configured lookback window are merged into the existing incident.

### LLM Fallback Badge

When the configured LLM provider is unreachable, incidents are created using rule-based fallback RCA. These incidents display a "Fallback" badge on the detail page to indicate that AI-generated root cause analysis was not available.

## Dark Mode

The Dashboard supports three theme modes:
- **Light** — default light theme
- **Dark** — dark theme with adjusted surfaces, text colors, borders, and shadows
- **System** — follows the operating system preference

Toggle the theme from the navigation bar using the Sun/Moon/Monitor dropdown. The preference is persisted in `localStorage`.

## Loading Skeletons

All data-driven pages display animated skeleton placeholders while fetching data:
- **Home page** — stat card skeletons, bar chart skeletons, pipeline flow skeletons
- **Incidents list** — incident card skeletons
- **Incident detail** — full-page skeleton with header, timeline, and analysis placeholders

## Error Boundaries

React error boundaries wrap all major page sections. When a component crashes:
- An error message with the component name is displayed
- A **Retry** button allows the user to attempt re-rendering
- The rest of the page continues to function normally

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
