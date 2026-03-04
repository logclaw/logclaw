---
title: Architecture
description: Deployment model, data flow, and component roles for the LogClaw platform.
---

# Architecture

## Deployment Model

LogClaw uses a **namespace-per-tenant, dedicated-instance** model. Every tenant receives its own isolated Kubernetes namespace (`logclaw-<tenantId>`) containing a full, dedicated copy of every component. There is no shared data plane between tenants.

Cluster-scoped operators (Strimzi, Flink Operator, ESO, cert-manager, OpenSearch Operator) are installed once per cluster and watch all tenant namespaces via label selectors. Tenant workloads are provisioned and reconciled through ArgoCD ApplicationSet, which generates one ArgoCD Application per tenant values file committed to `gitops/tenants/`.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Log Sources                                  │
│   Apps, Infrastructure, Cloud Services, CI/CD, Kubernetes Pods      │
└──────────────┬──────────────────────────┬───────────────────────────┘
               │ OTLP/gRPC :4317          │ OTLP/HTTP :4318
               ▼                          ▼
        ┌──────────────────────────────────────┐
        │       logclaw-otel-collector         │
        │   OTLP receiver → batch → enrich    │
        │   (tenant_id injection, batching)    │
        └──────────────────┬───────────────────┘
                           │ Kafka produce (otlp_json, lz4)
                           ▼
        ┌──────────────────────────────────────┐
        │          logclaw-kafka               │
        │   KRaft mode (Strimzi)               │
        │   Topics: raw-logs, enriched-logs    │
        └──────┬──────────────────┬────────────┘
               │                  │
     ┌─────────▼──────┐   ┌──────▼────────────────────────────────┐
     │ logclaw-flink  │   │         logclaw-bridge                │
     │ Stream jobs    │   │  Thread 1: OTLP ETL (flatten→enrich) │
     │ (production)   │   │  Thread 2: Anomaly detection (Z-score)│
     │                │   │  Thread 3: OpenSearch indexer          │
     │                │   │  Thread 4: Request lifecycle engine    │
     └────────────────┘   │           (5-layer trace correlation) │
                          └──────┬────────────────┬───────────────┘
                                 │                │
                    ┌────────────▼──┐    ┌────────▼──────────────┐
                    │  OpenSearch   │    │  logclaw-ticketing    │
                    │  (search +   │    │  AI SRE Agent         │
                    │   analytics) │    │  (PagerDuty, Jira,    │
                    └──────┬───────┘    │   ServiceNow, etc.)   │
                           │            └───────────────────────┘
                    ┌──────▼───────┐
                    │  Dashboard   │◄── logclaw-agent
                    │  (Next.js)   │    (infra health metrics)
                    └──────────────┘
```

## Component Details

### OTel Collector — Ingestion Gateway

The OpenTelemetry Collector is the **sole entry point** for all log data. It accepts OTLP over both gRPC (`:4317`) and HTTP (`:4318`), the CNCF industry standard supported by Datadog, Splunk, Grafana, AWS, GCP, and Azure.

**Pipeline:** `otlp receiver` → `memory_limiter` → `resource processor` (inject `tenant_id`) → `batch` → `kafka exporter` (`otlp_json`, lz4 compression)

### Kafka — Event Bus

Apache Kafka (Strimzi, KRaft mode — no ZooKeeper) provides the durable event bus. Two primary topics:

| Topic | Producer | Consumer | Format |
|-------|----------|----------|--------|
| `raw-logs` | OTel Collector | Bridge / Flink | OTLP JSON |
| `enriched-logs` | Bridge / Flink | Ticketing Agent | Flat JSON (normalized) |

### Bridge — ETL + Intelligence Engine

The Bridge is a Python service running 4 concurrent threads:

| Thread | Role | Details |
|--------|------|---------|
| **OTLP ETL** | Flatten OTLP JSON → normalized documents | Unwraps `resourceLogs → scopeLogs → logRecords`, extracts body, severity, traceId, spanId, timestamps |
| **Anomaly Detection** | Z-score based anomaly scoring | Sliding window over error rates per service, configurable threshold and window size |
| **OpenSearch Indexer** | Bulk index enriched documents | Reads from `enriched-logs`, writes to `logclaw-logs-YYYY.MM.dd` indices |
| **Request Lifecycle** | 5-layer trace correlation engine | Groups logs by traceId → builds request timelines → computes blast radius → generates incident context |

<Note>
**Bridge vs Flink:** The Bridge provides trace correlation, anomaly detection, and OpenSearch indexing in a single lightweight Python service. For high-throughput production, Flink handles stream processing. For dev/demo and early-stage deployments, the Bridge is simpler — no Flink Operator needed. Enable both for maximum capability.
</Note>

### OpenSearch — Search & Analytics

OpenSearch provides full-text search, log analytics, and visualization. Deployed with dedicated master and data nodes for production tiers. Index pattern: `logclaw-logs-YYYY.MM.dd` with automatic ILM policies.

### Ticketing Agent — AI SRE

The Ticketing Agent consumes anomalies from Kafka, correlates them with trace data, and creates deduplicated incident tickets across 6 platforms:

- **PagerDuty** — severity-based routing with auto-acknowledgment
- **Jira** — project/issue type mapping with custom fields
- **ServiceNow** — CMDB integration with assignment groups
- **OpsGenie** — team-based routing with schedules
- **Slack** — webhook notifications with thread updates
- **Zammad** — in-cluster ticketing (self-hosted option)

### ML Engine — Model Inference

Feast Feature Store + KServe InferenceService for serving anomaly detection models. Airflow orchestrates retraining DAGs that pull features from Feast, train models, and deploy updated InferenceServices.

### Infrastructure Agent — Cluster Health

A Go-based sidecar that collects infrastructure health metrics:

| Collector | Data Source | Metrics |
|-----------|-------------|---------|
| **Kafka** | Strimzi CRDs | Consumer lag, broker status, topic health |
| **Flink** | Flink Operator CRDs | Job state, task manager status |
| **OpenSearch** | OpenSearch REST API | Cluster health, index stats, node stats |
| **ESO** | External Secrets CRDs | Secret sync status, last sync time |

Exposes `/health`, `/ready`, and `/metrics` endpoints consumed by the Dashboard.

### Dashboard — Web UI

Next.js application providing:
- **Log ingestion** — drag-and-drop JSON/NDJSON file upload via OTLP proxy
- **Pipeline monitoring** — real-time throughput visualization (Ingest → Stream → Process → Index)
- **Incident management** — view, acknowledge, resolve, escalate incidents
- **Anomaly visualization** — charts showing anomaly scores and affected services
- **System configuration** — runtime config for ticketing platforms, anomaly thresholds, LLM settings

## Multi-Cloud Abstraction

LogClaw abstracts provider-specific details through two global configuration surfaces:

<CardGroup cols={2}>
  <Card title="Object Storage" icon="bucket">
    `s3` — AWS S3 or S3-compatible (MinIO, Ceph)
    `gcs` — Google Cloud Storage
    `azure` — Azure Blob Storage
  </Card>
  <Card title="Secret Management" icon="key">
    `aws` — AWS Secrets Manager (ESO)
    `gcp` — Google Secret Manager
    `vault` — HashiCorp Vault
    `azure` — Azure Key Vault
  </Card>
</CardGroup>

The same Helm chart works across AWS, GCP, Azure, and on-prem clusters. Only the provider, region, and bucket/endpoint fields differ.

## Tier Profiles

| Setting | standard | ha | ultra-ha |
|---------|----------|-----|----------|
| Kafka brokers | 1 | 3 | 5 |
| Kafka storage / broker | 100 Gi | 1 Ti | 2 Ti |
| OpenSearch masters | 1 | 3 | 3 |
| OpenSearch data nodes | 1 | 3 | 5 |
| OpenSearch disk / node | 100 Gi | 1 Ti | 2 Ti |
| OTel Collector replicas | 1 | 3 | 5 |
| Flink task managers | 1 | 2 | 4 |
| Ticketing agent replicas | 1 | 2 | 3 |
| ML Engine replicas | 1 | 2 | 3 |
| PodDisruptionBudget | No | Yes | Yes |
| TopologySpread | No | Zone | Zone + Node |
