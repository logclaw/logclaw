---
title: Local Development
description: Set up a local LogClaw development environment for testing and development.
---

# Local Development

This guide covers setting up LogClaw for local development and testing.

## Environment Variables

The Dashboard requires environment variables to connect to backend services. Create a `.env.local` file:

```bash
# OTel Collector — OTLP HTTP endpoint
OTEL_COLLECTOR_ENDPOINT=http://localhost:4318

# Bridge — ETL + anomaly detection + metrics
BRIDGE_ENDPOINT=http://localhost:8080

# OpenSearch — search & analytics
OPENSEARCH_ENDPOINT=http://localhost:9200
OPENSEARCH_USER=admin
OPENSEARCH_PASSWORD=admin

# Ticketing Agent — incident management
TICKETING_ENDPOINT=http://localhost:18081

# Airflow — pipeline orchestration
AIRFLOW_ENDPOINT=http://localhost:28080

# Feast — ML feature store
FEAST_ENDPOINT=http://localhost:6567

# Infrastructure Agent — cluster health
AGENT_ENDPOINT=http://localhost:8080
```

<Note>
All environment variables are consumed by the Dashboard's Next.js API proxy routes. Each backend service gets its own proxy under `/api/<service>/`.
</Note>

## Option 1: Kind Cluster (Full Stack)

The fastest way to run the full LogClaw stack locally:

```bash
# Clone and setup
git clone https://github.com/logclaw/logclaw.git
cd logclaw

# Create Kind cluster + install everything
./scripts/setup-dev.sh
```

This script:
1. Creates a Kind cluster with 3 worker nodes
2. Installs all Kubernetes operators (Strimzi, Flink, ESO, cert-manager, OpenSearch)
3. Deploys a dev tenant with all components enabled
4. Runs a smoke test

**Requirements:** Docker, Kind, Helm, kubectl (16 GB RAM recommended)

### Port Forwarding

After setup, forward ports to access services locally:

```bash
# OTel Collector (OTLP HTTP)
kubectl port-forward svc/logclaw-otel-collector 4318:4318 -n logclaw &

# Bridge
kubectl port-forward svc/logclaw-bridge 8080:8080 -n logclaw &

# OpenSearch
kubectl port-forward svc/logclaw-opensearch 9200:9200 -n logclaw &

# Dashboard
kubectl port-forward svc/logclaw-dashboard 3000:3000 -n logclaw &
```

## Option 2: Dashboard Development (Frontend Only)

For working on the Dashboard UI without the full stack:

```bash
cd apps/dashboard
cp .env.example .env.local   # Edit with your endpoints
npm install
npm run dev
```

The Dashboard starts on `http://localhost:3000`. Configure `.env.local` to point at your backend services (local Kind cluster, remote dev cluster, or mock endpoints).

## Option 3: Bridge Development (Python)

For working on the Bridge ETL service:

```bash
cd apps/bridge
pip install -r requirements.txt

# Set environment variables
export KAFKA_BROKERS=localhost:9092
export KAFKA_TOPIC_RAW=raw-logs
export KAFKA_TOPIC_ENRICHED=enriched-logs
export OPENSEARCH_ENDPOINT=http://localhost:9200
export ANOMALY_THRESHOLD=2.5
export WINDOW_SIZE=50

python main.py
```

The Bridge exposes:
- `GET /health` — health check
- `GET /metrics` — Prometheus metrics
- `GET /config` — runtime configuration
- `PATCH /config` — update runtime configuration

## Project Structure

```
logclaw/
├── apps/
│   ├── bridge/              # Python — OTLP ETL + anomaly detection
│   │   ├── main.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   ├── dashboard/           # Next.js — pipeline UI
│   │   ├── src/
│   │   │   ├── app/         # App router pages + API routes
│   │   │   ├── components/  # React components
│   │   │   └── lib/         # API client, utilities
│   │   ├── package.json
│   │   └── Dockerfile
│   └── agent/               # Go — infrastructure health collector
│       ├── main.go
│       ├── go.mod
│       └── Dockerfile
├── charts/                  # Helm sub-charts
│   ├── logclaw-tenant/      # Umbrella chart
│   ├── logclaw-otel-collector/
│   ├── logclaw-kafka/
│   ├── logclaw-bridge/
│   ├── logclaw-opensearch/
│   ├── logclaw-flink/
│   ├── logclaw-ml-engine/
│   ├── logclaw-airflow/
│   ├── logclaw-ticketing-agent/
│   ├── logclaw-platform/
│   └── logclaw-dashboard/
├── gitops/
│   └── tenants/             # Per-tenant values files
│       ├── _template.yaml
│       └── tenant-*.yaml
├── operators/               # Cluster operator manifests
├── scripts/                 # Dev scripts
└── docs/                    # This documentation
```

## Building Docker Images

### Bridge

```bash
cd apps/bridge
docker build -t logclaw/bridge:dev .
```

### Dashboard

```bash
cd apps/dashboard
docker build -t logclaw/dashboard:dev .
```

### Agent

```bash
cd apps/agent
docker build -t logclaw/agent:dev .
```

## Helm Development

### Lint a Chart

```bash
helm lint charts/logclaw-otel-collector/ \
  -f charts/logclaw-otel-collector/ci/default-values.yaml
```

### Template Rendering

```bash
helm template logclaw charts/logclaw-tenant/ \
  -f gitops/tenants/tenant-gke-prod.yaml \
  --debug
```

### Update Dependencies

After modifying sub-charts, rebuild the umbrella chart:

```bash
helm dependency update charts/logclaw-tenant/
```

<Warning>
Always run `helm dependency update` after changing sub-chart templates. The umbrella chart uses `.tgz` packages — stale packages will render old templates.
</Warning>

## Sending Test Logs

### Single Log via curl

```bash
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "test-svc"}}
        ]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "'$(date +%s)000000000'",
          "severityText": "ERROR",
          "body": {"stringValue": "Connection refused to database"},
          "attributes": [
            {"key": "environment", "value": {"stringValue": "dev"}}
          ]
        }]
      }]
    }]
  }'
```

### Batch via Dashboard

1. Open `http://localhost:3000`
2. Drag and drop a JSON file onto the upload area
3. The Dashboard converts each entry to OTLP format and sends via the proxy

Supported formats:
- **JSON** — array of log objects: `[{"message": "...", "level": "ERROR"}]`
- **NDJSON** — one JSON object per line
