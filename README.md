# LogClaw

**AI SRE that deploys in your VPC.** Real-time anomaly detection, trace-correlated incident tickets, and AI root cause analysis — your logs never leave your infrastructure.

<p align="left">
  <img src="https://img.shields.io/badge/license-Apache%202.0-green" />
  <img src="https://img.shields.io/badge/helm-3.x-blue?logo=helm" />
  <img src="https://img.shields.io/badge/kubernetes-1.27%2B-blue?logo=kubernetes" />
  <img src="https://img.shields.io/badge/docker-compose-blue?logo=docker" />
  <a href="https://console.logclaw.ai"><img src="https://img.shields.io/badge/try-managed%20cloud-orange" /></a>
</p>

<p align="center">
  <img src="docs/screenshots/overview.png" alt="LogClaw Dashboard — real-time log monitoring with AI anomaly detection" width="800" />
</p>

---

## TL;DR — Try It

### Option A: Managed Cloud (no install — fastest)

Try the full experience instantly at **[console.logclaw.ai](https://console.logclaw.ai)** — includes AI root cause analysis, API key management, multi-tenant isolation, and the complete incident pipeline. No Docker required.

### Option B: Docker Compose (self-hosted, no Kubernetes)

```bash
curl -O https://raw.githubusercontent.com/logclaw/logclaw/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/logclaw/logclaw/main/otel-collector-config.yaml
docker compose up -d
```

Open **http://localhost:3000** — the LogClaw stack is running:
- Dashboard (`:3000`) — incidents, log ingestion, config
- OTel Collector (`:4317` gRPC, `:4318` HTTP) — send logs via OTLP
- Bridge (`:8080`) — anomaly detection + trace correlation
- Ticketing Agent (`:18081`) — AI-powered incident management
- OpenSearch (`:9200`) — log storage + search
- Kafka (`:9092`) — event bus

All images are pulled from `ghcr.io/logclaw/` — no registry auth required.

> **Note:** The local stack runs in single-tenant mode with LLM-powered root cause analysis disabled. For AI RCA, API key management, and multi-tenant isolation, use the [managed cloud](https://console.logclaw.ai) or deploy to Kubernetes with `LLM_PROVIDER=claude|openai|ollama`.

### Option C: Kind Cluster (full Kubernetes stack)

```bash
git clone https://github.com/logclaw/logclaw.git && cd logclaw
./scripts/setup-dev.sh
```

This creates a Kind cluster, installs all operators and services, builds the dashboard, and runs a smoke test. Takes ~20 minutes on a 16 GB laptop.

### Container Images

All LogClaw images are published to GHCR as public packages:

| Service | Image | Latest Stable |
|---------|-------|---------------|
| Dashboard | `ghcr.io/logclaw/logclaw-dashboard` | `stable` / `2.5.0` |
| Bridge | `ghcr.io/logclaw/logclaw-bridge` | `stable` / `1.3.0` |
| Ticketing Agent | `ghcr.io/logclaw/logclaw-ticketing-agent` | `stable` / `1.5.0` |
| Flink Jobs | `ghcr.io/logclaw/logclaw-flink-jobs` | `stable` / `0.1.1` |

Pull any image directly:
```bash
docker pull ghcr.io/logclaw/logclaw-dashboard:stable
```

---

## See It in Action

<table>
  <tr>
    <td align="center"><b>Incident Management</b></td>
    <td align="center"><b>AI Root Cause Analysis</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/incidents.png" alt="Incident list with severity and blast radius" width="400" /></td>
    <td><img src="docs/screenshots/ai-analysis.png" alt="AI-powered root cause analysis" width="400" /></td>
  </tr>
  <tr>
    <td align="center"><b>Log Ingestion</b></td>
    <td align="center"><b>Dashboard Overview</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/ingestion.png" alt="OTLP log ingestion pipeline" width="400" /></td>
    <td><img src="docs/screenshots/overview.png" alt="LogClaw dashboard overview" width="400" /></td>
  </tr>
</table>

> **Live demo:** [console.logclaw.ai](https://console.logclaw.ai) | **Video walkthrough:** [logclaw.ai](https://logclaw.ai)

---

## Open Source vs Cloud vs Enterprise

| Capability | Open Source (free) | Cloud ($0.30/GB) | Enterprise (custom) |
|---|---|---|---|
| **Log Ingestion (OTLP)** | Unlimited | 1 GB/day free | Unlimited |
| **Anomaly Detection** | Z-score statistical | Z-score + ML pipeline | Z-score + ML + custom models |
| **AI Root Cause Analysis** | BYO LLM (Ollama/OpenAI/Claude) | Included | Included + fine-tuned models |
| **Incident Ticketing** | PagerDuty, Jira, ServiceNow, OpsGenie, Slack, Zammad | All 6 platforms | All 6 + custom connectors |
| **Dashboard** | Full UI (logs, incidents, config) | Full UI + hosted | Full UI + white-label option |
| **Authentication** | None (open access) | Clerk OAuth + org management | SSO (SAML/OIDC) + RBAC |
| **Multi-tenancy** | Single tenant | Multi-org, multi-project, multi-env | Full namespace isolation per tenant |
| **API Keys** | N/A | Per-project, SHA-256 hashed, revocable | Per-project + custom scoping |
| **Data Residency** | Your infrastructure | LogClaw-managed cloud | Your VPC (AWS/Azure/GCP) |
| **Secrets Encryption** | At rest (OpenSearch) | At rest + in transit | AES-256-GCM for secrets + full TLS |
| **Config Management** | Env vars | 6-tab settings UI | UI + API + GitOps |
| **Retention** | Configurable via Helm | 9-day logs, 97-day incidents | Custom retention policies |
| **Air-Gapped Mode** | Yes (Zammad + Ollama) | No | Yes |
| **MCP Server** | Self-hosted | Hosted (mcp.logclaw.ai) | Both |
| **Support** | GitHub Issues | Email (support@logclaw.ai) | Dedicated SRE team + SLA |
| **Pricing** | Free forever (Apache 2.0) | $0.30/GB ingested | Custom |

> **No per-seat fees. No per-host fees. AI features included at every tier.**

<p align="center">
  <a href="https://console.logclaw.ai"><b>Start Free (Cloud)</b></a> &nbsp;|&nbsp;
  <a href="#tldr--try-it"><b>Deploy from GitHub (OSS)</b></a> &nbsp;|&nbsp;
  <a href="https://calendly.com/robelkidin/logclaw"><b>Book a Demo (Enterprise)</b></a>
</p>

---

## Architecture

> All components below are included in every tier — Open Source, Cloud, and Enterprise.

```
LogClaw Stack (per tenant, namespace-isolated)
│
├── logclaw-auth-proxy       API key validation + tenant ID injection
├── logclaw-otel-collector   OpenTelemetry Collector (OTLP gRPC + HTTP)
├── logclaw-ingestion        Vector.dev edge ingestion (optional)
├── logclaw-kafka            Strimzi Kafka 3-broker KRaft cluster
├── logclaw-flink            ETL + enrichment + anomaly scoring
├── logclaw-opensearch       OpenSearch cluster (hot-tier log storage)
├── logclaw-bridge           OTLP ETL + trace correlation + lifecycle manager
├── logclaw-ml-engine        Feast Feature Store + KServe/TorchServe + Ollama
├── logclaw-airflow          Apache Airflow (ML training DAGs)
├── logclaw-ticketing-agent  AI-powered RCA + multi-platform ticketing
├── logclaw-agent            In-cluster infrastructure health collector
├── logclaw-dashboard        Next.js web UI (ingestion, incidents, config, dark mode)
└── logclaw-console          Enterprise SaaS console (multi-tenant)
```

**Data flow:** Logs → Auth Proxy (API key + tenant injection) → OTel Collector (OTLP ingestion) → Kafka → Bridge (ETL + anomaly + trace correlation) → OpenSearch + Ticketing Agent → Incident tickets

All charts are wired together by the **`logclaw-tenant` umbrella chart** — a single `helm install` deploys the full stack for one tenant.

---

## Quick Start (Production / ArgoCD)

### Prerequisites

One-time cluster setup (operators, run once per cluster):

```bash
helmfile -f helmfile.d/00-operators.yaml apply
```

### Onboard a new tenant

1. Copy the template:
   ```bash
   cp gitops/tenants/_template.yaml gitops/tenants/tenant-<id>.yaml
   ```

2. Fill in the required values (`tenantId`, `tier`, `cloudProvider`, secret store config).

3. Commit and push — ArgoCD will detect the new file and deploy the full stack in ~30 minutes.

### Manual install (dev/staging)

```bash
helm install logclaw-acme charts/logclaw-tenant \
  --namespace logclaw-acme \
  --create-namespace \
  -f gitops/tenants/tenant-acme.yaml
```

---

## Running Locally (Step by Step)

> Prefer the one-command setup? Run `./scripts/setup-dev.sh` and skip to [Step 6](#6--send-logs).

### Prerequisites

```bash
# macOS (Homebrew)
brew install helm helmfile kind kubectl node python3

# Helm plugins
helm plugin install https://github.com/databus23/helm-diff
helm plugin install https://github.com/helm-unittest/helm-unittest

# Docker Desktop must be running
open -a Docker
```

### 1 — Create a local Kubernetes cluster

```bash
make kind-create
```

Verify:
```bash
kubectl cluster-info --context kind-logclaw-dev
```

### 2 — Install cluster-level operators

```bash
make install-operators
```

Wait for operators to be ready (~3 min):
```bash
kubectl get pods -n strimzi-system -w
kubectl get pods -n opensearch-operator-system -w
```

### 3 — Install the full tenant stack

```bash
make install TENANT_ID=dev-local STORAGE_CLASS=standard
```

This deploys all 16 helmfile releases in dependency order. Monitor progress:
```bash
watch kubectl get pods -n logclaw-dev-local
```

| Time | Milestone |
|---|---|
| T+2 min | Namespace, RBAC, NetworkPolicies |
| T+6 min | Kafka broker ready |
| T+10 min | OpenSearch cluster green |
| T+15 min | Bridge + Ticketing Agent running |
| T+20 min | Full stack operational |

### 4 — Build and deploy the Dashboard

The dashboard requires a Docker image build:
```bash
docker build -t logclaw-dashboard:dev apps/dashboard/
kind load docker-image logclaw-dashboard:dev --name logclaw-dev

helm upgrade --install logclaw-dashboard-dev-local charts/logclaw-dashboard \
  --namespace logclaw-dev-local \
  --set global.tenantId=dev-local \
  -f charts/logclaw-dashboard/ci/default-values.yaml
```

### 5 — Access the services

```bash
# Dashboard (main UI)
kubectl port-forward svc/logclaw-dashboard-dev-local 3333:3000 -n logclaw-dev-local
open http://localhost:3333

# OpenSearch (query API)
kubectl port-forward svc/logclaw-opensearch-dev-local 9200:9200 -n logclaw-dev-local

# Airflow (ML pipelines)
kubectl port-forward svc/logclaw-airflow-dev-local-webserver 8080:8080 -n logclaw-dev-local
open http://localhost:8080   # admin / admin
```

### 6 — Send logs

LogClaw ingests logs via **OTLP (OpenTelemetry Protocol)** — the CNCF industry standard. Port-forward the OTel Collector:

```bash
kubectl port-forward svc/logclaw-otel-collector-dev-local 4318:4318 -n logclaw-dev-local &
```

**Send a single log via OTLP HTTP:**
```bash
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "payment-api"}}
        ]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "'$(date +%s)000000000'",
          "severityText": "ERROR",
          "body": {"stringValue": "Connection refused to database"},
          "traceId": "abcdef1234567890abcdef1234567890",
          "spanId": "abcdef12345678"
        }]
      }]
    }]
  }'
```

Any OpenTelemetry SDK or agent can send logs to LogClaw — no custom integration needed. See [OTLP Integration Guide](docs/otlp-integration.md) for SDK examples.

**Generate and ingest 900 sample Apple Pay logs:**
```bash
# Generate sample OTel logs
python3 scripts/generate-applepay-logs.py    # → 500 payment flow logs
python3 scripts/generate-applepay-logs-2.py  # → 400 infra/security errors

# Ingest them
./scripts/ingest-logs.sh scripts/applepay-otel-500.json
./scripts/ingest-logs.sh scripts/applepay-otel-400-batch2.json
```

Or use the helper script:
```bash
./scripts/ingest-logs.sh --generate   # generates + ingests all sample logs
./scripts/ingest-logs.sh --smoke      # single test log
```

### 7 — See it in action

After ingesting error logs, the Bridge detects anomalies and the Ticketing Agent creates incident tickets. View them:

```bash
# Watch Bridge trace correlation in real-time
kubectl logs -f deployment/logclaw-bridge-dev-local -n logclaw-dev-local

# Check auto-created incidents
kubectl port-forward svc/logclaw-opensearch-dev-local 9200:9200 -n logclaw-dev-local &
curl -s 'http://localhost:9200/logclaw-incidents-*/_search?size=5&sort=created_at:desc' | python3 -m json.tool

# Or use the Dashboard
open http://localhost:3333/incidents
```

### 8 — Tear down

```bash
# Remove just the tenant
make uninstall TENANT_ID=dev-local

# Remove everything including the Kind cluster
make kind-delete
```

---

## Repository Layout

```
charts/
├── logclaw-tenant/           # Umbrella chart — single install entry point
├── logclaw-auth-proxy/       # API key validation + tenant ID injection
├── logclaw-otel-collector/   # OpenTelemetry Collector (OTLP gRPC + HTTP)
├── logclaw-ingestion/        # Vector.dev edge ingestion
├── logclaw-kafka/            # Strimzi Kafka + KafkaConnect + MirrorMaker2
├── logclaw-flink/            # Flink ETL + enrichment + anomaly jobs
├── logclaw-opensearch/       # OpenSearch cluster via Opster operator
├── logclaw-bridge/           # OTLP ETL + trace correlation + lifecycle manager
├── logclaw-ml-engine/        # Feast + KServe/TorchServe + Ollama
├── logclaw-airflow/          # Apache Airflow
├── logclaw-ticketing-agent/  # AI-powered RCA + multi-platform ticketing
├── logclaw-agent/            # In-cluster infrastructure health agent
├── logclaw-dashboard/        # Next.js web UI
└── logclaw-console/          # Enterprise SaaS console

apps/
├── bridge/                # Python — OTLP ETL + anomaly detection + trace correlation
├── agent/                 # Go — infrastructure health collector
├── dashboard/             # Next.js — web UI (incidents, logs, config, dark mode)
├── ticketing-agent/       # Python — AI-powered RCA + multi-platform ticketing
├── flink-jobs/            # Java — Flink stream processing jobs
├── logclaw-auth-proxy/    # TypeScript/Express — API key validation + tenant injection
├── logclaw-slack-bot/     # TypeScript/Hono — Slack incident bot (Cloudflare Workers)
├── logclaw-mcp-server/    # TypeScript — MCP server for AI coding tools (8 tools)
└── logclaw-mcp-remote/    # TypeScript — remote MCP client (OAuth 2.1)

cli/                        # Go CLI (logclaw start/stop/status)

scripts/
├── setup-dev.sh                # One-command local dev setup (Kind cluster)
├── setup-gke.sh                # GKE production cluster setup
├── ingest-logs.sh              # Log ingestion helper (--generate, --smoke)
├── generate-applepay-logs.py   # Generate 500 OTel sample logs (batch 1)
├── generate-applepay-logs-2.py # Generate 400 infra/security logs (batch 2)
├── trigger-anomaly.sh          # Trigger test anomaly for demo
└── trigger-request-failure.sh  # Trigger test request failure for demo

operators/                    # Cluster-level operator bootstrap (once per cluster)
├── strimzi/                  # strimzi-kafka-operator 0.41.0
├── flink-operator/           # flink-kubernetes-operator 1.9.0
├── opensearch-operator/      # opensearch-operator 2.6.1
├── eso/                      # external-secrets 0.10.3
└── cert-manager/             # cert-manager v1.16.1

helmfile.d/                   # Ordered helmfile releases (00-operators → 90-dashboard)
gitops/                       # ArgoCD ApplicationSet + per-tenant value files
tests/                        # Helm chart tests + integration test pods
docs/                         # Architecture, onboarding, values reference
```

---

## Key Features

> For a side-by-side comparison across tiers, see [Open Source vs Cloud vs Enterprise](#open-source-vs-cloud-vs-enterprise) above.

### Trace-Correlated AI Ticket Engine

The Bridge runs a 5-layer trace correlation engine:

1. **ETL Consumer** — Consumes enriched logs from Kafka
2. **Anomaly Detector** — Statistical anomaly scoring on error rates
3. **OpenSearch Indexer** — Indexes logs for search and correlation
4. **Lifecycle Engine** — Traces causal chains across services, computes blast radius, creates/deduplicates incidents

When an anomaly is detected, the system:
- Queries all logs sharing the same `trace_id`
- Builds a causal chain showing error propagation across services
- Computes blast radius (% of services affected)
- Creates a deduplicated incident ticket with full trace context

### Multi-Platform Ticketing

The `logclaw-ticketing-agent` supports **6 independently-toggleable platforms** simultaneously:

| Platform | Type | Egress |
|---|---|---|
| PagerDuty | SaaS | External HTTPS |
| Jira | SaaS | External HTTPS |
| ServiceNow | SaaS | External HTTPS |
| OpsGenie | SaaS | External HTTPS |
| Slack | SaaS | External HTTPS |
| Zammad | In-cluster | Zero external egress |

Per-severity routing (`critical → PagerDuty`, `medium → Jira`, etc.) is configurable via `config.routing.*`.

### Air-Gapped Mode

When paired with **Zammad** (external ITSM chart) and **Ollama** for local LLM inference, the `needsExternalHttps` helper sets the NetworkPolicy to **zero external egress** — fully air-gapped. No logs, tickets, or model calls leave the cluster.

### LLM Provider Abstraction
```yaml
global:
  llm:
    provider: ollama   # claude | openai | ollama | vllm | disabled
    model: llama3.2:8b
```

### Dashboard

The Dashboard provides:
- **Dark mode** — system-aware with manual toggle (Light/Dark/System), persisted in localStorage
- **Drag-and-drop upload** supporting JSON, NDJSON, CSV, and plain text files
- **Bulk incident actions** — select multiple incidents and acknowledge/resolve/escalate in batch
- **CSV export** — download incidents as a CSV file
- **Loading skeletons** — smooth animated placeholders during data fetches
- **Error boundaries** — graceful crash recovery with retry UI
- **LLM fallback badge** — indicates when AI RCA is unavailable and rule-based fallback was used
- **Incident auto-deduplication** — prevents duplicate incidents for the same anomaly

### Log Ingestion — OTLP Native

LogClaw uses **OTLP (OpenTelemetry Protocol)** as its sole ingestion protocol — the CNCF industry standard supported by every major observability vendor (Datadog, Splunk, Grafana, AWS, GCP, Azure).

**Supported transports:**
- **gRPC** — `<collector>:4317` (recommended for high-throughput)
- **HTTP/JSON** — `<collector>:4318/v1/logs`

Any OpenTelemetry SDK, agent, or collector can send logs directly to LogClaw without custom integrations. The OTel Collector enriches each log with `tenant_id`, batches them, and writes to Kafka using `otlp_json` encoding.

```json
{
  "resourceLogs": [{
    "resource": {
      "attributes": [
        {"key": "service.name", "value": {"stringValue": "my-service"}},
        {"key": "host.name", "value": {"stringValue": "my-service-pod-abc12"}}
      ]
    },
    "scopeLogs": [{
      "logRecords": [{
        "timeUnixNano": "1709510400000000000",
        "severityText": "ERROR",
        "body": {"stringValue": "Something went wrong"},
        "traceId": "abcdef1234567890abcdef1234567890",
        "spanId": "abcdef12345678",
        "attributes": [
          {"key": "environment", "value": {"stringValue": "production"}}
        ]
      }]
    }]
  }]
}
```

See [OTLP Integration Guide](docs/otlp-integration.md) for Python, Java, and Node.js SDK examples.

### MCP Server — AI Coding Tools

The `logclaw-mcp-server` connects AI coding tools to LogClaw incidents, logs, and anomalies via the [Model Context Protocol](https://modelcontextprotocol.io). Published as an npm package with **8 tools**.

```bash
npx logclaw-mcp-server
```

Works with **Claude Code**, **Cursor**, **Windsurf**, and any MCP-compatible client. Also available as a hosted server at `https://mcp.logclaw.ai` (OAuth 2.1, no install needed).

See [MCP Integration Guide](docs/integrations/mcp.mdx) for setup instructions.

### Slack Bot — Incident Notifications

The `logclaw-slack-bot` delivers real-time incident notifications to Slack with rich Block Kit formatting, DM support, and OAuth. Runs on Cloudflare Workers.

See [Integrations](docs/integrations.mdx) for setup.

### Auth Proxy — API Key Validation

The `logclaw-auth-proxy` sits between ingress and the OTel Collector. It validates API keys against PostgreSQL, injects `tenant_id` into OTLP payloads, and enforces rate limits (200 req/min unauthenticated, 6000 req/min per tenant). Stateless and horizontally scalable.

---

## Component Versions

| Component | Version |
|---|---|
| Apache Kafka (Strimzi) | 3.7.0 |
| Apache Flink | 1.19.0 |
| OpenSearch | 2.14.0 |
| External Secrets Operator | 0.10.3 |
| cert-manager | v1.16.1 |
| Apache Airflow | 1.14.0 |
| Zammad | 12.4.1 |
| OpenTelemetry Collector Contrib | 0.114.0 |
| KServe | 0.13.0 |
| Feast | 0.40.0 |
| Next.js (Dashboard) | 16.1.6 |

---

## Development

### Dashboard (Next.js)

```bash
cd apps/dashboard
npm install
npm run dev
# → http://localhost:3000
```

### Bridge (Python)

```bash
cd apps/bridge
pip install -r requirements.txt
export KAFKA_BROKERS="localhost:9092"
export OPENSEARCH_ENDPOINT="http://localhost:9200"
python main.py
# → HTTP API on :8080 (/health, /metrics, /config)
```

See [Bridge docs](docs/components/bridge.md) for configuration reference.

### Ticketing Agent (Python)

```bash
cd apps/ticketing-agent
pip install -r requirements.txt
export KAFKA_BROKERS="localhost:9092"
export OPENSEARCH_ENDPOINT="http://localhost:9200"
python main.py
# → HTTP API on :8080
```

### Agent (Go)

```bash
cd apps/agent
go run main.go
# → HTTP API on :8080 (/health, /ready, /metrics)
```

### Auth Proxy (TypeScript)

```bash
cd apps/logclaw-auth-proxy
npm install
npm run dev
# → HTTP API on :4318
```

Requires a PostgreSQL database with API keys. See [API Keys docs](docs/api-keys.mdx).

### MCP Server (TypeScript)

```bash
cd apps/logclaw-mcp-server
npm install && npm run build
LOGCLAW_API_KEY=lc_proj_test npx .
```

### Helm Charts

```bash
# Lint all charts
make lint

# Render templates (dry-run, no cluster needed)
make template TENANT_ID=ci-test

# Diff current vs new
make template-diff TENANT_ID=dev-local

# Package charts as .tgz
make package

# Push to OCI registry
make push HELM_REGISTRY=oci://ghcr.io/logclaw/charts
```

---

## Docs

Full documentation is available at [docs.logclaw.ai](https://docs.logclaw.ai).

**Getting Started:**
- [Quick Start — Send Logs](docs/quickstart-send-logs.mdx)
- [API Keys](docs/api-keys.mdx)
- [Local Development](docs/local-development.md)
- [Architecture](docs/architecture.md)

**Components:**
- [Bridge](docs/components/bridge.md) — anomaly detection + trace correlation
- [Dashboard](docs/components/dashboard.md) — web UI
- [Ticketing Agent](docs/components/ticketing-agent.md) — multi-platform incident routing
- [OTel Collector](docs/components/otel-collector.md) — OTLP ingestion
- [Incident Classification](docs/components/incident-classification.md) — composite scoring

**Integrations:**
- [Integrations Overview](docs/integrations.mdx) — PagerDuty, Jira, ServiceNow, OpsGenie, Slack
- [MCP Server](docs/integrations/mcp.mdx) — Claude Code, Cursor, Windsurf

**Reference:**
- [OTLP Integration Guide](docs/otlp-integration.md) — Python, Java, Node.js, Go SDK examples
- [Values Reference](docs/values-reference.md) — Helm chart configuration
- [Onboarding a New Tenant](docs/onboarding.md)
- [API Reference](docs/api-reference/overview.md)

**Enterprise:**
- [Enterprise Console](https://console.logclaw.ai) — multi-org, API key management, project settings

---

## Contributing

We welcome contributions! Please read our guidelines before opening a PR:

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

Use the [issue templates](.github/ISSUE_TEMPLATE/) for bug reports and feature requests.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
