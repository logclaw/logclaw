# LogClaw Architecture Overview

## Deployment Model

LogClaw uses a **namespace-per-tenant, dedicated-instance** model. Every tenant receives
its own isolated Kubernetes namespace (`logclaw-<tenantId>`) containing a full, dedicated
copy of every component. There is no shared data plane between tenants.

Cluster-scoped operators (Strimzi, Flink Operator, ESO, cert-manager, OpenSearch Operator)
are installed once per cluster and watch all tenant namespaces via label selectors. Tenant
workloads are provisioned and reconciled through ArgoCD ApplicationSet, which generates one
ArgoCD Application per tenant values file committed to `gitops/tenants/`.

## Data Flow

```
External Log Sources (apps, infra, cloud)
           |
           v
  +-----------------+
  | logclaw-ingestion|  HTTP/gRPC/syslog ingest
  |  (Collector)    |  schema validation, enrichment
  +-----------------+
           |  Kafka produce
           v
  +-----------------+
  |  logclaw-kafka  |  Apache Kafka (KRaft mode)
  |  (Event Bus)    |  multi-topic, per-tenant
  +-----------------+
        |         |
        |         +-----> logclaw-flink (stream processing)
        |         |            |  anomaly scores, aggregations
        |         |            v
        |         +-----> logclaw-bridge (trace correlation,
        |                      |  dev/demo alternative to Flink)
        |                      v
        |              logclaw-opensearch
        |              (search + analytics)
        |                      |
        v                      v
  logclaw-platform       logclaw-ml-engine
  (RBAC, NetworkPolicy,  (KServe inference,
   SecretStore)           model serving)
                               |
                        logclaw-airflow
                        (ML pipeline DAGs,
                         retraining jobs)
                               |
                        logclaw-ticketing-agent
                        (AI SRE: PagerDuty,
                         Jira, ServiceNow)
                               |
                        logclaw-dashboard
                        (Next.js UI: incidents,
                         anomaly viz, log ingestion)
```

## Component Roles

| Chart | Role | Key Technology |
|---|---|---|
| `logclaw-platform` | API gateway, tenant dashboard, RBAC bootstrap | Kubernetes Ingress, OIDC |
| `logclaw-ingestion` | Multi-protocol log collector and forwarder | OpenTelemetry Collector |
| `logclaw-kafka` | Durable event bus, log retention | Strimzi KRaft Kafka |
| `logclaw-flink` | Real-time stream processing, anomaly detection | Apache Flink |
| `logclaw-opensearch` | Log search, dashboards, alerting | OpenSearch + Dashboards |
| `logclaw-ml-engine` | Model inference serving | KServe InferenceService |
| `logclaw-airflow` | ML pipeline orchestration, DAG scheduling | Apache Airflow |
| `logclaw-ticketing-agent` | AI SRE agent, ticket creation and routing | Python, LangChain |
| `logclaw-bridge` | Trace correlation engine, anomaly detection, lifecycle manager | Python, Kafka consumer |
| `logclaw-dashboard` | Pipeline UI: log ingestion, incident management, anomaly viz | Next.js 16 |

> **Bridge vs Flink:** The Bridge provides trace correlation, anomaly detection, and OpenSearch indexing
> in a single lightweight Python service. In production, Flink handles high-throughput stream processing.
> For dev/demo environments and early-stage deployments, the Bridge is a simpler alternative that runs
> without the Flink Operator. Enable both for maximum capability — they process complementary Kafka topics.

## Multi-Cloud Abstraction

LogClaw abstracts provider-specific details through two global configuration surfaces:

**Object Storage** (`global.objectStorage`):
- `provider: s3` — AWS S3 or any S3-compatible endpoint (MinIO, Ceph)
- `provider: gcs` — Google Cloud Storage
- `provider: azure` — Azure Blob Storage

**Secret Management** (`global.secretStore`):
- `provider: aws` — AWS Secrets Manager via ESO ClusterSecretStore
- `provider: gcp` — Google Secret Manager
- `provider: vault` — HashiCorp Vault
- `provider: azure` — Azure Key Vault

The same Helm chart values file works across AWS, GCP, Azure, and on-prem clusters.
Only the `provider`, `region`/`projectId`, and bucket/endpoint fields differ.

## 30-Minute Tenant Onboarding Flow

```
t=0m   Operator copies _template.yaml -> gitops/tenants/<tenantId>.yaml
       fills required fields, commits and pushes to main branch

t=1m   ArgoCD ApplicationSet detects new file via Git generator
       creates ArgoCD Application: logclaw-tenant-<tenantId>

t=2m   ArgoCD begins sync: creates namespace logclaw-<tenantId>
       applies namespace labels (PSA, tenant metadata)

t=5m   logclaw-platform deploys: RBAC, NetworkPolicy, ClusterSecretStore

t=8m   logclaw-kafka deploys: KafkaNodePool + Kafka CR reconciled by Strimzi
       ZooKeeper-free KRaft cluster initialises

t=12m  logclaw-ingestion deploys: OTel Collector connects to Kafka bootstrap

t=15m  logclaw-opensearch deploys: OpenSearch cluster reaches green status

t=18m  logclaw-flink deploys: FlinkDeployment CR reconciled,
       anomaly detection job enters RUNNING state

t=22m  logclaw-ml-engine deploys: KServe InferenceService becomes Ready

t=25m  logclaw-airflow deploys: Airflow webserver + scheduler healthy

t=28m  logclaw-ticketing-agent deploys: agent connects to Kafka,
       validates ticketing provider credentials

t=29m  logclaw-bridge deploys (if enabled): trace correlation engine
       connects to Kafka + OpenSearch

t=30m  logclaw-dashboard deploys (if enabled): Next.js UI available
       on ClusterIP or LoadBalancer

t=30m  All ArgoCD Application health checks green
       Tenant is fully operational
```
