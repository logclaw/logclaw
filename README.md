# LogClaw — Helm Chart Monorepo

<p align="left">
  <img src="https://img.shields.io/badge/helm-3.x-blue?logo=helm" />
  <img src="https://img.shields.io/badge/kubernetes-1.27%2B-blue?logo=kubernetes" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-green" />
</p>

Enterprise-grade Kubernetes deployment stack for LogClaw — an AI-powered log intelligence platform with real-time anomaly detection, multi-platform incident ticketing, and GitOps-native multi-tenancy.

---

## Architecture

```
LogClaw Stack (per tenant, namespace-isolated)
│
├── logclaw-ingestion       Vector.dev DaemonSet + PrivateLink TLS receiver
├── logclaw-kafka           Strimzi Kafka 3-broker KRaft + MirrorMaker2
├── logclaw-flink           ETL + enrichment + anomaly scoring (FlinkDeployments)
├── logclaw-opensearch      OpenSearch 3-node cluster (Opster operator)
├── logclaw-ml-engine       Feast Feature Store + KServe/TorchServe + Ollama
├── logclaw-airflow         Apache Airflow (git-sync DAGs)
├── logclaw-ticketing-agent RCA microservice → PagerDuty / Jira / ServiceNow /
│                           OpsGenie / Zammad / Slack  (any combination)
├── logclaw-zammad          In-cluster ITSM (zero-egress ticketing alternative)
└── logclaw-platform        ESO SecretStore, cert-manager, RBAC baseline
```

All charts are wired together by the **`logclaw-tenant` umbrella chart** — a single `helm install` deploys the full stack for one tenant.

---

## Quick Start

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

## Repository Layout

```
charts/
├── logclaw-tenant/           # Umbrella chart — single install entry point
├── logclaw-platform/         # ESO SecretStore, cert-manager, RBAC
├── logclaw-kafka/            # Strimzi Kafka + KafkaConnect + MirrorMaker2
├── logclaw-ingestion/        # Vector.dev DaemonSet + PrivateLink receiver
├── logclaw-opensearch/       # OpenSearch cluster via Opster operator
├── logclaw-flink/            # Flink ETL + enrichment + anomaly jobs
├── logclaw-ml-engine/        # Feast + KServe/TorchServe + Ollama
├── logclaw-airflow/          # Apache Airflow
├── logclaw-ticketing-agent/  # Multi-platform incident ticketing
└── logclaw-zammad/           # In-cluster ITSM (zero-egress option)

operators/                    # Cluster-level operator bootstrap (once per cluster)
├── strimzi/                  # strimzi-kafka-operator 0.41.0
├── flink-operator/           # flink-kubernetes-operator 1.9.0
├── opensearch-operator/      # opensearch-operator 2.6.1
├── eso/                      # external-secrets 0.10.3
└── cert-manager/             # cert-manager v1.16.1

gitops/
├── argocd/                   # ApplicationSet + AppProject for multi-tenant GitOps
└── tenants/                  # Per-tenant value files (_template.yaml + examples)

helmfile.d/                   # Ordered helmfile releases (00-operators → 80-ticketing)
tests/                        # Helm chart tests + integration test pods
docs/                         # Architecture, onboarding, values reference
```

---

## Key Features

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

### Multi-Cloud Secret Management
```yaml
global:
  secretStore:
    provider: aws    # aws | gcp | vault | azure
```

### Tiered Deployments
```yaml
global:
  tier: ha   # standard | ha | ultra-ha
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

---

## Development

```bash
# Lint all charts
make lint

# Render umbrella chart (dry-run)
make template TENANT_ID=ci-test

# Full local install on kind
make kind-create
make install-operators
make install TENANT_ID=dev-local

# Run Helm tests
make test TENANT_ID=dev-local
```

---

## Docs

- [Architecture](docs/architecture.md)
- [Onboarding a new tenant](docs/onboarding.md)
- [Values reference](docs/values-reference.md)

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
