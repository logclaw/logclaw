# LogClaw Architecture — End-to-End Data Flow

## Overview

LogClaw is an AI-powered observability platform that ingests OTLP logs, detects anomalies using ML-boosted scoring, automatically creates incidents, and dispatches alerts with root cause analysis.

```
Customer App → Auth Proxy → OTel Collector → Kafka → Flink/Bridge → OpenSearch → Ticketing Agent → Email/Slack
```

---

## Service Map

```
                                    ┌──────────────────────────────────────────────────────────────┐
                                    │                    KUBERNETES CLUSTER                         │
                                    │                                                              │
  CUSTOMER APP                      │  ┌─────────────┐     ┌──────────────────┐                    │
  (any language)                    │  │ Auth Proxy  │     │  OTel Collector  │                    │
       │                            │  │ (Node.js)   │────▶│  (2 replicas)    │                    │
       │ POST /v1/logs              │  │             │     │                  │                    │
       │ Header: x-api-key          │  │ • Validate  │     │ • Receive OTLP   │                    │
       │ Body: OTLP JSON            │  │   API key   │     │ • Export to      │                    │
       │                            │  │ • Inject    │     │   Kafka          │                    │
       └───────────────────────────▶│  │   tenant_id │     │                  │                    │
                                    │  └─────────────┘     └────────┬─────────┘                    │
                                    │                               │                              │
                                    │                               ▼                              │
                                    │                    ┌─────────────────────┐                    │
                                    │                    │   KAFKA (Strimzi)   │                    │
                                    │                    │                     │                    │
                                    │                    │ • raw-logs (6 part) │                    │
                                    │                    │ • enriched-logs     │                    │
                                    │                    │ • anomaly-events    │                    │
                                    │                    │ • dead-letter-queue │                    │
                                    │                    └────────┬────────────┘                    │
                                    │                             │                                │
                                    │              ┌──────────────┼──────────────┐                  │
                                    │              ▼              ▼              ▼                  │
                                    │     ┌──────────────┐ ┌───────────┐ ┌─────────────┐           │
                                    │     │  Flink ETL   │ │  Flink    │ │   Flink     │           │
                                    │     │  (or Bridge  │ │  Enrich   │ │   Anomaly   │           │
                                    │     │   Thread 1)  │ │  (Feast)  │ │   Scorer    │           │
                                    │     └──────┬───────┘ └─────┬─────┘ └──────┬──────┘           │
                                    │            │               │              │                  │
                                    │            ▼               ▼              ▼                  │
                                    │     ┌──────────────────────────────────────────────┐          │
                                    │     │              Bridge Thread 3                │          │
                                    │     │  • Index logs to OpenSearch                 │          │
                                    │     │  • Index anomalies to OpenSearch            │          │
                                    │     │  • Group anomalies → Create incidents       │          │
                                    │     └──────────────────────┬─────────────────────┘          │
                                    │                            │                                │
                                    │                            ▼                                │
                                    │                 ┌─────────────────────┐                      │
                                    │                 │    OpenSearch       │                      │
                                    │                 │                     │                      │
                                    │                 │ • logclaw-logs-*    │                      │
                                    │                 │ • logclaw-anomalies-*│                     │
                                    │                 │ • logclaw-incidents-*│                     │
                                    │                 └────────┬────────────┘                      │
                                    │                          │                                  │
                                    │                          ▼                                  │
                                    │               ┌────────────────────┐                        │
                                    │               │  Ticketing Agent   │                        │
                                    │               │  • Root cause      │                        │
                                    │               │  • LLM enrichment  │                        │
                                    │               │  • Email/Slack/Jira│                        │
                                    │               └────────────────────┘                        │
                                    │                                                              │
                                    │  ┌─────────────┐  ┌──────────┐  ┌──────────┐                │
                                    │  │  Console    │  │ Dashboard│  │ Airflow  │                │
                                    │  │ (Next.js)   │  │ (Next.js)│  │ (DAGs)   │                │
                                    │  │ enterprise  │  │ internal │  │ ML train │                │
                                    │  └─────────────┘  └──────────┘  └──────────┘                │
                                    └──────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step: 10 Logs Through the Pipeline

### Step 1: Ingestion (Auth Proxy → OTel Collector)

Customer sends OTLP logs via HTTP POST:

```
POST https://otel.logclaw.ai/v1/logs
Header: x-api-key: lc_abc123
Body: {
  "resourceLogs": [{
    "resource": { "attributes": [{"key":"service.name","value":{"stringValue":"payment-api"}}] },
    "scopeLogs": [{
      "logRecords": [
        { "timeUnixNano": "...", "severityText": "ERROR", "body": {"stringValue": "Connection refused"} },
        ... (9 more logs)
      ]
    }]
  }]
}
```

**Auth Proxy** (Node.js, `apps/logclaw-auth-proxy/`):
1. Extracts `x-api-key` header
2. Queries PostgreSQL (`logclaw_enterprise` DB) to validate the key
3. Looks up the tenant ID associated with that API key
4. Injects `tenant_id` as a resource attribute into the OTLP payload
5. Forwards the modified payload to OTel Collector on port 4318

**OTel Collector** (`charts/logclaw-otel-collector/`):
1. Receives OTLP HTTP on port 4318
2. Applies batch processor (groups logs for efficiency)
3. Exports to Kafka topic `raw-logs` via the `kafkaexporter`

```yaml
# From otel-collector-config.yaml
exporters:
  kafka:
    brokers: ["logclaw-kafka-bootstrap:9092"]
    topic: "raw-logs"
    encoding: otlp_json
```

### Step 2: Kafka (Message Bus)

Kafka stores logs in topics with configurable retention:

```
Topic: raw-logs          | 6 partitions | 48h retention   | All raw OTLP logs
Topic: enriched-logs     | 6 partitions | 48h retention   | Flat JSON + ML features
Topic: anomaly-events    | 3 partitions | 7 day retention  | Only scored anomalies
Topic: dead-letter-queue | 1 partition  | 30 day retention | Unparseable/failed logs
```

Each consumer (Flink job or Bridge thread) has its own **consumer group** with tracked offsets. If a service restarts, it resumes from the last committed offset — no data loss.

### Step 3: Flink ETL (Unwrap OTLP → Flat JSON)

**What it does:** Converts the deeply nested OTLP format into a flat, searchable JSON record.

**Input** (from `raw-logs` topic — nested OTLP):
```
resourceLogs[]
  └─ resource.attributes[]        ← service.name, tenant_id, etc.
     └─ scopeLogs[]
        └─ logRecords[]           ← the actual log
           ├─ timeUnixNano
           ├─ severityText
           ├─ body.stringValue
           ├─ attributes[]
           ├─ traceId
           └─ spanId
```

**Output** (to `enriched-logs` topic — flat JSON):
```json
{
  "@timestamp": "2024-03-19T12:00:00Z",
  "log_id": "f47ac10b-...",
  "level": "ERROR",
  "message": "Connection refused to redis:6379",
  "service": "payment-api",
  "tenant_id": "acme-corp",
  "trace_id": "abc123",
  "span_id": "def456"
}
```

**What ETL does (that's all):**
1. Unwrap the 3-level OTLP nesting → flat record
2. Generate deterministic `log_id` (UUID5 from trace+span+timestamp) for OpenSearch idempotency
3. Normalize severity (`CRITICAL` → `FATAL`)
4. Flatten attribute keys (`service.name` → `service_name`) — dots cause nested objects in OpenSearch
5. If unparseable → send to `dead-letter-queue`

**Source:** `apps/flink-jobs/logclaw-etl/` (Java) or `apps/bridge/` Thread 1 (Python)

### Step 4: Flink Enrichment (Add ML Features from Feast)

**What it does:** Reads flat JSON from `enriched-logs`, queries Feast for ML features, writes back with added fields.

**Before:**
```json
{ "level": "ERROR", "message": "Connection refused to redis:6379", "service": "payment-api" }
```

**After (4 ML features added):**
```json
{
  "level": "ERROR",
  "message": "Connection refused to redis:6379",
  "service": "payment-api",
  "ml_error_rate_1h": 0.12,
  "ml_p99_latency_1h": 2400,
  "ml_request_rate_1h": 15000,
  "ml_anomaly_history_count": 3,
  "enriched": true
}
```

These features let the Anomaly Scorer make better decisions — "this service already has a 12% error rate and 3 past anomalies."

**Source:** `apps/flink-jobs/logclaw-enrichment/` (Java) or Bridge Thread 1 (Python)

### Step 5: Flink Anomaly Scorer

**Scoring Algorithm:**

```
1. BASE SCORE (severity)
   DEBUG/TRACE → 0.0 (skip)   INFO → 0.0   WARN → 0.1   ERROR → 0.3   FATAL → 0.5

2. PATTERN BOOST (regex on message)
   "OutOfMemory|OOM" → +0.3    "timeout" → +0.2    "connection refused" → +0.2
   "NPE|segfault" → +0.25      "disk full" → +0.3   "SSL|TLS" → +0.15

3. ML BOOST (from Feast)
   ml_error_rate_1h > 0.10 → +0.15    ml_error_rate_1h > 0.25 → +0.25
   ml_p99_latency_1h > 2000ms → +0.10  ml_anomaly_history > 2 → +0.10

4. FINAL = BASE + PATTERN + ML (capped at 1.0)
5. score >= 0.5 → EMIT    score < 0.5 → DROP
```

**Example: 10 Logs**

```
Log 1:  INFO  "Request completed 200 OK"           0.0  → DROP
Log 2:  WARN  "Slow query took 3200ms"             0.1  → DROP
Log 3:  ERROR "Connection refused to redis:6379"    0.5  → ANOMALY
Log 4:  ERROR "Request timeout after 30s"           0.5  → ANOMALY
Log 5:  ERROR "Failed to parse JSON response"       0.3  → DROP
Log 6:  ERROR "Failed to parse JSON" (ml_error=0.30) 0.55 → ANOMALY (ML boost!)
Log 7:  FATAL "OutOfMemoryError: heap space"        0.8  → ANOMALY
Log 8:  WARN  "SSL cert expires in 7 days"          0.25 → DROP
Log 9:  WARN  "SSL cert expires" (ml_error=0.12)    0.50 → ANOMALY (ML boost!)
Log 10: DEBUG "Entering processPayment()"           SKIP
```

**Result: 10 logs → 5 anomalies** (Logs 6 and 9 only passed because of ML enrichment)

**Source:** `apps/flink-jobs/logclaw-anomaly-scorer/` (Java) or Bridge Thread 2 (Python)

### Step 6: Bridge Thread 3 (Index + Incidents)

**Flink stops at writing to `anomaly-events`. Bridge Thread 3 picks up:**

1. **Index all enriched logs** → `logclaw-logs-{tenant}` in OpenSearch
2. **Index anomaly events** → `logclaw-anomalies-{tenant}` in OpenSearch
3. **Group anomalies by service + 5-min window** → if >= 3 → **create Incident**

```
Log 3 (redis, 0.50) ──┐
Log 4 (redis, 0.50) ──┤ Same service, 5-min window → 3 anomalies → INCIDENT
Log 7 (heap,  0.80) ──┘

Log 6 + Log 9 (different services, 1 each) → no incident yet
```

**Source:** `apps/bridge/` (Python, also embedded in `charts/logclaw-bridge/templates/configmap-app.yaml`)

### Step 7: Ticketing Agent (Root Cause + Alerts)

Polls OpenSearch for `status=open` incidents:

```
1. ROOT CAUSE ANALYSIS
   Query logs ±10 min window → find first error, correlated traces, deploys

2. LLM ENRICHMENT (if configured)
   Send samples to OpenAI/Ollama → get remediation suggestion + causal chain

3. SEVERITY CLASSIFICATION
   1 service + score < 0.6 → "medium"
   2+ services or score > 0.7 → "high"
   3+ services or FATAL → "critical"

4. DISPATCH
   Email (Resend) | Slack (webhook) | Jira (API) | PagerDuty (API)
```

**Source:** `apps/ticketing-agent/` (Python, also in configmap)

---

## Airflow, Feast & Redis: The ML Feature Pipeline

Airflow's **sole purpose** in LogClaw is to run periodic feature computation DAGs. It does not orchestrate any other services or ETL — that's Flink/Bridge's job.

### How Features Get Into Redis

```
  OpenSearch                    Airflow DAG                     Redis
  (logclaw-logs-*)              (runs every 1h)                 (Feast online store)
       │                             │                              │
       │  Query: aggregate logs      │                              │
       │  per service per hour       │                              │
       │  ─────────────────────▶     │                              │
       │                             │                              │
       │  Returns:                   │  Computes features:          │
       │  • error count last 1h      │  • error_rate_1h             │
       │  • total count last 1h      │  • p99_latency_1h            │
       │  • latency percentiles      │  • request_rate_1h           │
       │  • past anomaly count       │  • anomaly_history_count     │
       │                             │                              │
       │                             │  feast materialize:          │
       │                             │  ──────────────────────────▶ │
       │                             │                              │
       │                             │  Key: "payment-api"          │
       │                             │  Val: {                      │
       │                             │    error_rate_1h: 0.12,      │
       │                             │    p99_latency_1h: 2400,     │
       │                             │    request_rate_1h: 15000,   │
       │                             │    anomaly_history_count: 3  │
       │                             │  }                           │
```

### How Flink Enrichment Reads Features (Real-Time)

```
  Kafka                     Flink Enrichment              Redis (Feast)
  (enriched-logs)           (or Bridge Thread 1)          (online store)
       │                             │                         │
       │  Log: {                     │                         │
       │    service: "payment-api",  │                         │
       │    level: "ERROR"           │                         │
       │  }                          │                         │
       │  ─────────────────────▶     │                         │
       │                             │  GET features for       │
       │                             │  "payment-api"          │
       │                             │  ───────────────────▶   │
       │                             │                         │
       │                             │  ◀─── {                 │
       │                             │    error_rate_1h: 0.12, │
       │                             │    p99_latency_1h: 2400 │
       │                             │  }                      │
       │                             │                         │
       │  ◀──── Enriched log: {      │                         │
       │    service: "payment-api",  │                         │
       │    ml_error_rate_1h: 0.12,  │                         │
       │    ml_p99_latency_1h: 2400  │                         │
       │  }                          │                         │
```

### The Full Feature Cycle

```
1. Logs flow in → indexed to OpenSearch (by Bridge Thread 3)
2. Airflow (hourly DAG) → queries OpenSearch aggregates → computes features → writes to Redis via Feast
3. Flink Enrichment → for each log, looks up service name in Redis via Feast → appends ML features
4. Anomaly Scorer → uses those features to boost/reduce the anomaly score
```

### Why Redis and Not OpenSearch Directly?

- **Redis**: Sub-millisecond per key lookup (0.1ms). Perfect for per-log real-time enrichment.
- **OpenSearch**: 10-50ms per query. Too slow when enriching thousands of logs per second.
- Feast is the abstraction layer — defines the feature schema, handles Redis read/write, and provides a clean API for the Flink job to call.

### What Airflow Runs

| DAG | Schedule | What It Does |
|-----|----------|-------------|
| `feature_compute` | Every 1 hour | Queries OpenSearch for per-service aggregates, computes 4 ML features, writes to Redis via `feast materialize` |

That's the only DAG. Airflow is intentionally lightweight here — one scheduler pod, one webserver pod, no workers (uses KubernetesExecutor for DAG runs).

---

## Flink vs Bridge

| | **Flink** | **Bridge** |
|---|---|---|
| Language | Java (3 JARs) | Python (1 file, 3 threads) |
| Pods | 6+ (3 JM + 3 TM) | 1 |
| Requires | Flink Operator + node pool | Nothing extra |
| Scaling | Horizontal (parallelism) | Vertical only |
| Guarantees | Exactly-once (RocksDB checkpoints) | At-least-once (in-memory) |
| Cost | ~4 CPU, 6Gi RAM | ~200m CPU, 256Mi RAM |
| Use case | Production at scale | Dev, staging, small tenants |

Bridge always runs — it handles **indexing + incident creation** that Flink doesn't do. When Flink is also enabled, Bridge Threads 1+2 duplicate Flink's work but output is idempotent (same `log_id` → OpenSearch overwrites).

---

## Flink Runtime

Flink is a **stream processing engine** (not batch like Spring Batch). Jobs run continuously.

```
Our code (Java JARs) → loaded into Flink runtime (apache/flink:1.19)

Each JAR's main():
  1. StreamExecutionEnvironment.getExecutionEnvironment()
  2. KafkaSource<String> (reads from topic)
  3. .map() / .flatMap() — our business logic
  4. KafkaSink<String> (writes to topic)
  5. env.execute() — runs forever

Flink manages: parallelism, checkpointing, exactly-once, failure recovery
```

---

## Kubernetes & Helm

### Chart Structure

```
charts/
├── logclaw-tenant/          # Umbrella — deploys all subcharts
├── logclaw-kafka/           # Strimzi Kafka CR + KafkaTopic CRs
├── logclaw-opensearch/      # OpenSearch StatefulSet
├── logclaw-otel-collector/  # OTel Collector Deployment
├── logclaw-bridge/          # Bridge (Python source in ConfigMap)
├── logclaw-ticketing-agent/ # Ticketing Agent (Python in ConfigMap)
├── logclaw-dashboard/       # Internal dashboard (Next.js)
├── logclaw-flink/           # 3 Flink job Deployments
├── logclaw-airflow/         # Scheduler + Webserver
├── logclaw-ml-engine/       # Feast + Redis
├── logclaw-auth-proxy/      # Separate release
└── logclaw-console/         # Enterprise console, separate release
```

### How `helm upgrade` Works

1. Helm diffs rendered templates vs cluster state
2. **Deployments**: Rolling update (new ReplicaSet up, old down, zero downtime)
3. **StatefulSets**: Pods updated one at a time (ordered)
4. **ConfigMaps**: Updated in-place; pods restart if Deployment has checksum annotation
5. **CRDs** (Kafka, OpenSearch): Operator reconciles (Strimzi rolls brokers one by one)
6. **Success**: Release revision stored as K8s Secret
7. **Failure**: `helm rollback logclaw <revision>` restores previous state

### ConfigMap = Deployment Artifact

For Python services, source code is embedded in ConfigMap:
```yaml
# charts/logclaw-bridge/templates/configmap-app.yaml
data:
  main.py: |
    #!/usr/bin/env python3
    from kafka import KafkaConsumer, KafkaProducer
    ...
```

**Both `apps/` source AND the configmap must be kept in sync on every change.**

### Values Per Environment

```
deployments/
├── us-west-prod-values.yaml        # Flink ON, 100Gi disks, production
├── us-east-prod-values.yaml        # Flink OFF, 50Gi disks, test
├── us-west-console-values.yaml     # Console for us-west
├── us-east-console-values.yaml     # Console for us-east
└── local-orbstack-values.yaml      # Minimal, no TLS, no ingress
```

---

## External Dependencies

| Service | Image | Version |
|---------|-------|---------|
| Kafka | `strimzi/kafka` | 0.50.0 + Kafka 4.0.0 |
| OpenSearch | `opensearchproject/opensearch` | 2.14.0 |
| OTel Collector | `otel/opentelemetry-collector-contrib` | 0.114.0 |
| Feast | `feastdev/feature-server` | 0.40.0 |
| PostgreSQL | `bitnami/postgresql` | latest |
| Redis | `bitnami/redis` | latest |
| Airflow | `apache/airflow` | 2.9.3 |
| Flink | `apache/flink` | 1.19 |

---

## Summary: 10 Logs → 1 Email Alert

```
10 raw logs from payment-api
       │
       ▼ Auth Proxy: validate API key, inject tenant_id
       ▼ OTel Collector: batch → Kafka
       │
  [raw-logs]
       │
       ▼ Flink ETL: unwrap OTLP → flat JSON
       │
  [enriched-logs]
       │
       ▼ Flink Enrichment: add Feast ML features
       │
  [enriched-logs] (with ml_error_rate, ml_p99_latency, etc.)
       │
       ▼ Flink Anomaly: score each log (0.0–1.0)
       │
       │  5 logs >= 0.5 → emitted
       │  5 logs < 0.5  → dropped
       │
  [anomaly-events]
       │
       ▼ Bridge: index to OpenSearch + group by service
       │
       │  3 anomalies from payment-api in 5 min → CREATE INCIDENT
       │
  [OpenSearch: logclaw-incidents-prod]
       │
       ▼ Ticketing Agent: root cause + LLM + dispatch
       │
  Email: "[HIGH] INC-2024-00142: payment-api — Redis pool exhausted"
```
