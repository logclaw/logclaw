# LogClaw — Helm Chart Monorepo

<p align="left">
  <img src="https://img.shields.io/badge/helm-3.x-blue?logo=helm" />
  <img src="https://img.shields.io/badge/kubernetes-1.27%2B-blue?logo=kubernetes" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-green" />
</p>

Enterprise-grade Kubernetes deployment stack for LogClaw — an AI-powered log intelligence platform with real-time anomaly detection, trace-correlated incident ticketing, and GitOps-native multi-tenancy.

---

## TL;DR — Run Locally in One Command

```bash
git clone https://github.com/logclaw/logclaw.git && cd logclaw
./scripts/setup-dev.sh
```

This creates a Kind cluster, installs all operators and services, builds the dashboard, and runs a smoke test. Takes ~20 minutes on a 16 GB laptop.

---

## Architecture

```
LogClaw Stack (per tenant, namespace-isolated)
│
├── logclaw-ingestion       Vector.dev HTTP receiver (JSON log batches)
├── logclaw-kafka           Strimzi Kafka 3-broker KRaft cluster
├── logclaw-flink           ETL + enrichment + anomaly scoring
├── logclaw-opensearch      OpenSearch cluster (hot-tier log storage)
├── logclaw-bridge          Trace correlation engine + lifecycle manager
├── logclaw-ml-engine       Feast Feature Store + KServe/TorchServe + Ollama
├── logclaw-airflow         Apache Airflow (ML training DAGs)
├── logclaw-ticketing-agent AI-powered RCA + multi-platform ticketing
├── logclaw-dashboard       Next.js web UI (incidents, ingestion, config)
├── logclaw-zammad          In-cluster ITSM (zero-egress alternative)
└── logclaw-platform        ESO SecretStore, cert-manager, RBAC baseline
```

**Data flow:** Logs → Vector (ingestion) → Kafka → Bridge (ETL + anomaly + trace correlation) → OpenSearch + Ticketing Agent → Incident tickets

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

This deploys all 12 helmfile releases in dependency order. Monitor progress:
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

LogClaw ingests JSON logs via HTTP. Port-forward the ingestion service:

```bash
kubectl port-forward svc/logclaw-ingestion-dev-local 8080:8080 -n logclaw-dev-local &
```

**Send a single log:**
```bash
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: dev-local" \
  -d '{
    "timestamp": "2026-03-03T12:00:00.000Z",
    "level": "ERROR",
    "service": "payment-api",
    "message": "Connection refused to database",
    "trace_id": "abcdef1234567890abcdef1234567890",
    "span_id": "abcdef1234567890"
  }'
```

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
├── logclaw-platform/         # ESO SecretStore, cert-manager, RBAC
├── logclaw-kafka/            # Strimzi Kafka + KafkaConnect + MirrorMaker2
├── logclaw-ingestion/        # Vector.dev HTTP receiver + drop-sampling
├── logclaw-opensearch/       # OpenSearch cluster via Opster operator
├── logclaw-flink/            # Flink ETL + enrichment + anomaly jobs
├── logclaw-bridge/           # Trace correlation engine + lifecycle manager
├── logclaw-ml-engine/        # Feast + KServe/TorchServe + Ollama
├── logclaw-airflow/          # Apache Airflow
├── logclaw-ticketing-agent/  # AI-powered RCA + multi-platform ticketing
├── logclaw-dashboard/        # Next.js web UI
└── logclaw-zammad/           # In-cluster ITSM (zero-egress option)

apps/
├── dashboard/                # Next.js source (npm run dev for local development)
└── ticketing-agent/          # Python RCA microservice source

scripts/
├── setup-dev.sh              # One-command local dev setup
├── ingest-logs.sh            # Log ingestion helper
├── generate-applepay-logs.py # Generate 500 OTel sample logs (batch 1)
└── generate-applepay-logs-2.py # Generate 400 infra/security logs (batch 2)

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

When only **Zammad + Ollama** are enabled, the `needsExternalHttps` helper sets the NetworkPolicy to **zero external egress** — fully air-gapped.

### LLM Provider Abstraction
```yaml
global:
  llm:
    provider: ollama   # claude | openai | ollama | vllm | disabled
    model: llama3.2:8b
```

### Log Ingestion Format

LogClaw accepts JSON logs via HTTP POST. Required headers:
- `Content-Type: application/json`
- `X-Tenant-ID: <your-tenant-id>`

Recommended fields per log entry:
```json
{
  "timestamp": "2026-03-03T12:00:00.000Z",
  "level": "ERROR",
  "service": "my-service",
  "message": "Something went wrong",
  "trace_id": "32-char-hex-string",
  "span_id": "16-char-hex-string",
  "logger": "com.example.MyClass",
  "thread": "http-nio-8080-exec-1",
  "host": "my-service-pod-abc12",
  "environment": "production",
  "region": "us-east-1"
}
```

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
| Vector.dev | 0.38.0 |
| KServe | 0.13.0 |
| Feast | 0.40.0 |
| Next.js (Dashboard) | 16.1.6 |

---

## Development

### Dashboard (local dev server)

```bash
cd apps/dashboard
npm install
npm run dev
# → http://localhost:3000
```

### Ticketing Agent (local)

```bash
cd apps/ticketing-agent
pip install -r requirements.txt
export KAFKA_BROKERS="localhost:9092"
export OPENSEARCH_ENDPOINT="http://localhost:9200"
python main.py
# → HTTP API on :8080
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

- [Architecture](docs/architecture.md)
- [Onboarding a new tenant](docs/onboarding.md)
- [Values reference](docs/values-reference.md)

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
