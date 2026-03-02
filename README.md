# LogClaw — AI-Powered Log Intelligence Platform

<p align="left">
  <img src="https://img.shields.io/badge/helm-3.x-blue?logo=helm" />
  <img src="https://img.shields.io/badge/kubernetes-1.27%2B-blue?logo=kubernetes" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-green" />
  <a href="https://github.com/logclaw/logclaw/pkgs/container/dashboard"><img src="https://img.shields.io/badge/ghcr.io-public-brightgreen?logo=github" /></a>
</p>

AI-powered log intelligence platform with real-time anomaly detection, multi-platform incident ticketing, and GitOps-native multi-tenancy. Ships logs through Kafka → OpenSearch, detects anomalies with ML, and auto-creates incidents in PagerDuty / Jira / ServiceNow / OpsGenie / Slack.

---

## Quick Start (3 commands)

### Prerequisites

| Tool | Install |
|------|---------|
| [Docker](https://docs.docker.com/get-docker/) | `brew install --cask docker` or [OrbStack](https://orbstack.dev) |
| [Kind](https://kind.sigs.k8s.io/) | `brew install kind` |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | `brew install kubectl` |
| [Helm](https://helm.sh/) + plugins | `brew install helm` |
| [Helmfile](https://github.com/helmfile/helmfile) | `brew install helmfile` |

```bash
# Install Helm plugins (one-time)
helm plugin install https://github.com/databus23/helm-diff
```

### Run LogClaw

```bash
git clone https://github.com/logclaw/logclaw.git
cd logclaw
cp .env.dev .env
make up
```

That's it. `make up` handles everything:

1. Creates a local [Kind](https://kind.sigs.k8s.io/) Kubernetes cluster
2. Installs operators (Strimzi Kafka, Flink, OpenSearch, cert-manager, ESO)
3. Generates dev secrets
4. Deploys the full stack via Helmfile
5. Sets up port-forwarding
6. Opens the dashboard in your browser

**First run takes ~15 minutes** (downloading images). Subsequent runs are faster.

### Access the stack

Once `make up` finishes:

| Service | URL | Description |
|---------|-----|-------------|
| **Dashboard** | [localhost:3333](http://localhost:3333) | AI Command Center — incidents, pipeline health, log ingestion |
| **Bridge API** | [localhost:8083](http://localhost:8083) | ETL health (`/health`, `/metrics`) |
| **Airflow** | [localhost:8082](http://localhost:8082) | DAG management (login: `admin` / `admin`) |
| **OpenSearch** | [localhost:9200](http://localhost:9200) | Log search & analytics API |
| **Ticketing Agent** | [localhost:8081](http://localhost:8081) | Incident management health |
| **Vector Ingest** | [localhost:8080](http://localhost:8080) | `POST` JSON logs here |

### Smoke test — send a log through the pipeline

```bash
# Send a test log: HTTP → Vector → Kafka → Bridge → OpenSearch
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{"message":"Payment failed: timeout","level":"ERROR","service":"payment-api"}'

# Check it landed in OpenSearch
curl -s 'http://localhost:9200/logclaw-logs-*/_search?size=1' | python3 -m json.tool
```

### Stop / restart / destroy

```bash
make down      # Stop services (keeps cluster)
make restart   # Clean restart
make nuke      # Delete everything including Kind cluster
make status    # Show pod status and endpoints
```

---

## Docker Images (Public)

All images are public on GitHub Container Registry — no authentication needed:

```bash
docker pull ghcr.io/logclaw/dashboard:latest        # Next.js AI Command Center
docker pull ghcr.io/logclaw/bridge:latest            # Kafka→OpenSearch ETL + anomaly detection
docker pull ghcr.io/logclaw/ticketing-agent:latest   # Multi-platform incident management
```

| Image | Tags | Architectures |
|-------|------|---------------|
| `ghcr.io/logclaw/dashboard` | `2.0.0`, `latest`, `sha-*` | `amd64`, `arm64` |
| `ghcr.io/logclaw/bridge` | `1.0.0`, `latest`, `sha-*` | `amd64`, `arm64` |
| `ghcr.io/logclaw/ticketing-agent` | `1.0.0`, `latest`, `sha-*` | `amd64`, `arm64` |

---

## Architecture

```
LogClaw Stack (per tenant, namespace-isolated)
│
├── logclaw-dashboard       AI Command Center — Next.js web UI
├── logclaw-bridge          Kafka→OpenSearch ETL, anomaly detection, Prometheus metrics
├── logclaw-ingestion       Vector.dev DaemonSet + PrivateLink TLS receiver
├── logclaw-kafka           Strimzi Kafka 3-broker KRaft + MirrorMaker2
├── logclaw-flink           ETL + enrichment + anomaly scoring (FlinkDeployments)
├── logclaw-opensearch      OpenSearch 3-node cluster (Opster operator)
├── logclaw-ml-engine       Feast Feature Store + KServe/TorchServe + Ollama
├── logclaw-airflow         Apache Airflow (git-sync DAGs)
├── logclaw-ticketing-agent RCA microservice → PagerDuty / Jira / ServiceNow /
│                           OpsGenie / Slack  (any combination)
└── logclaw-platform        ESO SecretStore, cert-manager, RBAC baseline
```

All charts are wired together by the **`logclaw-tenant` umbrella chart** — a single `helm install` deploys the full stack for one tenant.

### Data flow

```
Your services → Vector (DaemonSet) → Kafka (raw-logs)
                                        ↓
                              Bridge (ETL + anomaly detection)
                                        ↓
                                    OpenSearch ← Dashboard (queries)
                                        ↓
                              Kafka (anomaly-events)
                                        ↓
                              Ticketing Agent → PagerDuty / Jira / Slack / ...
```

---

## Repository Layout

```
apps/
├── dashboard/                # Next.js 16 AI Command Center (TypeScript + Tailwind CSS)
├── bridge/                   # Python ETL bridge (Kafka→OpenSearch, anomaly detection)
└── ticketing-agent/          # Python ticketing agent (Kafka consumer → incident management)

charts/
├── logclaw-tenant/           # Umbrella chart — single install entry point
├── logclaw-dashboard/        # Dashboard Helm chart (Next.js standalone)
├── logclaw-bridge/           # Bridge Helm chart (Python ETL service)
├── logclaw-platform/         # ESO SecretStore, cert-manager, RBAC
├── logclaw-kafka/            # Strimzi Kafka + KafkaConnect + MirrorMaker2
├── logclaw-ingestion/        # Vector.dev DaemonSet + PrivateLink receiver
├── logclaw-opensearch/       # OpenSearch cluster via Opster operator
├── logclaw-flink/            # Flink ETL + enrichment + anomaly jobs
├── logclaw-ml-engine/        # Feast + KServe/TorchServe + Ollama
├── logclaw-airflow/          # Apache Airflow
└── logclaw-ticketing-agent/  # Multi-platform incident ticketing

operators/                    # Cluster-level operator bootstrap (once per cluster)
gitops/                       # ArgoCD ApplicationSet + per-tenant value files
helmfile.d/                   # Ordered helmfile releases (00-operators → 80-ticketing)
```

---

## Key Features

### Multi-Platform Ticketing

5 independently-toggleable platforms with per-severity routing:

```yaml
# Example: critical → PagerDuty + Slack, medium → Jira only
config:
  routing:
    critical: ["pagerduty", "slack"]
    high: ["jira", "slack"]
    medium: ["jira"]
```

Supported: **PagerDuty** · **Jira** · **ServiceNow** · **OpsGenie** · **Slack**

### LLM Provider Abstraction

```yaml
global:
  llm:
    provider: ollama   # claude | openai | ollama | vllm | disabled
    model: llama3.2:8b
```

### Multi-Cloud Secrets

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

### Air-Gapped Mode

When only Ollama is used as the LLM provider and no external ticketing platforms are enabled, the NetworkPolicy enforces **zero external egress** — fully air-gapped.

---

## Detailed Setup Guide

<details>
<summary><b>Step-by-step manual setup (if you don't want to use <code>make up</code>)</b></summary>

### 1 — Create a local Kubernetes cluster

```bash
make kind-create
```

Creates a Kind cluster named `logclaw-dev`, installs cert-manager CRDs, and labels the node for topology scheduling.

### 2 — Install operators (once per cluster)

```bash
make install-operators
```

Installs into dedicated namespaces:

| Operator | Namespace |
|----------|-----------|
| Strimzi Kafka 0.50.1 | `strimzi-system` |
| Flink Operator 1.9.0 | `flink-system` |
| External Secrets | `external-secrets` |
| cert-manager | `cert-manager` |
| OpenSearch Operator | `opensearch-operator-system` |

### 3 — Deploy the tenant stack

```bash
make install TENANT_ID=dev-local STORAGE_CLASS=standard
```

Creates namespace, generates dev secrets, deploys all charts via Helmfile. Expect ~15 minutes on first run.

### 4 — Run Airflow DB migrations (if needed)

If Airflow pods are stuck in `Init:0/1`:

```bash
kubectl run airflow-migrate --restart=Never \
  --namespace logclaw-dev-local \
  --image=apache/airflow:2.9.2 \
  --env="AIRFLOW__DATABASE__SQL_ALCHEMY_CONN=postgresql://postgres:postgres@logclaw-airflow-dev-local-postgresql.logclaw-dev-local:5432/postgres?sslmode=disable" \
  --command -- airflow db migrate

kubectl wait --for=condition=Ready=false pod/airflow-migrate \
  -n logclaw-dev-local --timeout=120s 2>/dev/null || true
kubectl delete pod airflow-migrate -n logclaw-dev-local
kubectl delete pods -n logclaw-dev-local -l tier=airflow
```

### 5 — Create the Airflow admin user

```bash
kubectl -n logclaw-dev-local exec deploy/logclaw-airflow-dev-local-webserver -- \
  airflow users create \
    --username admin --password admin \
    --firstname LogClaw --lastname Admin \
    --role Admin --email admin@logclaw.local
```

### 6 — Port-forward all services

```bash
make ports      # Forward all services
make dashboard  # Forward + open browser
```

### 7 — Verify the stack

```bash
kubectl get pods -n logclaw-dev-local          # All pods Running
helm list -n logclaw-dev-local                 # All releases deployed
curl -s http://localhost:9200/_cluster/health   # OpenSearch health
```

</details>

---

## What Runs Locally vs. Production

| Component | Local Dev | Production |
|-----------|-----------|------------|
| Dashboard | Next.js standalone (GHCR image) | Same image, env vars point to in-cluster services |
| Bridge | Single replica, polls Kafka | Multi-replica with consumer groups |
| Kafka | Single-node KRaft, plain listener | Multi-broker, TLS + SCRAM-SHA-512 |
| OpenSearch | 3 single-replica pools | Multi-replica with zone spread |
| Flink | Operator installed, jobs **disabled** | FlinkDeployment CRDs (ETL + enrichment) |
| ML Engine | Feast with local file registry | Redis online store + S3 offline |
| KServe | **Skipped** (no CRD) | InferenceService for anomaly model |
| Airflow | Bundled PostgreSQL | Custom image, external PostgreSQL |
| Secrets | Static dev secrets (`make create-dev-secrets`) | ESO (auto-refresh from AWS/GCP/Vault) |

---

## Default Dev Credentials

| Service | Username | Password |
|---------|----------|----------|
| Airflow | `admin` | `admin` |
| OpenSearch | — | — (security disabled in dev) |
| Kafka (PLAIN) | — | — (port 9092, no auth) |
| Kafka (TLS) | `admin` | `dev-kafka-password` |
| PostgreSQL | `postgres` | `postgres` |
| Redis | — | `dev-redis-password` |

> All credentials are dev-only placeholders. Production uses External Secrets Operator.

---

## Dashboard

The LogClaw Dashboard is a **Next.js 16** web app that surfaces what the AI SRE found — incidents, anomalies, and pipeline health — so operators focus on action, not scrolling through raw logs.

| Route | Purpose |
|-------|---------|
| `/` | Overview — stat cards, pipeline flow, recent incidents, log charts |
| `/incidents` | Incident list with severity/state filters and search |
| `/incidents/:id` | Incident detail — timeline, traces, affected services |
| `/ingestion` | Drag-and-drop log upload with format validation |
| `/settings` | Service health, environment info, API reference |

### Running the dashboard outside the cluster

```bash
cd apps/dashboard
npm install
npm run dev          # http://localhost:3000 (hot-reload)
```

With `make ports` running in another terminal, the dashboard auto-connects to all cluster services via fallback URLs.

---

## End-to-End Pipeline Test

```bash
# 1. Send a log via HTTP → Vector → Kafka → Bridge → OpenSearch
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{"message":"Payment failed: timeout","level":"ERROR","service":"payment-api"}'

# 2. Verify it landed in Kafka
kubectl -n logclaw-dev-local exec logclaw-kafka-dev-local-combined-0 -- \
  bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic raw-logs --from-beginning --max-messages 5 --timeout-ms 10000

# 3. Check OpenSearch
curl -s 'http://localhost:9200/logclaw-logs-*/_search?size=5' | python3 -m json.tool

# 4. Simulate an anomaly event (triggers ticketing agent)
kubectl -n logclaw-dev-local exec -i logclaw-kafka-dev-local-combined-0 -- \
  bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic anomaly-events <<'EOF'
{"anomaly_id":"ANO-001","service":"payment-api","score":0.92,"severity":"critical","message":"Error rate spike to 15%"}
EOF
```

---

## Development

```bash
make lint              # Lint all Helm charts
make template          # Dry-run render (no cluster needed)
make validate-schema   # Validate values against JSON schemas
make test              # Helm test against installed release
make build-all         # Build all Docker images locally
make push-all          # Build + push all images to GHCR
make scan-all          # Trivy vulnerability scan
```

---

## Troubleshooting

<details>
<summary><b>Strimzi entity operator CrashLoopBackOff</b></summary>

The entity operator fails with `kafkausers` CRD not found. Helm doesn't auto-upgrade CRDs:

```bash
kubectl apply -f https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.50.1/strimzi-crds-0.50.1.yaml \
  --server-side --force-conflicts
kubectl rollout restart deployment -n strimzi-system strimzi-cluster-operator
```
</details>

<details>
<summary><b>Airflow webserver OOMKilled</b></summary>

Needs at least 1Gi memory. Check CI values are applied:

```bash
helm get values logclaw-airflow-dev-local -n logclaw-dev-local | grep -A3 memory
```
</details>

<details>
<summary><b>Airflow scheduler stuck in Init:0/1</b></summary>

Waiting for DB migrations. See [Step 4](#step-by-step-manual-setup-if-you-dont-want-to-use-make-up) in the detailed setup guide.
</details>

<details>
<summary><b>OpenSearch cluster_manager_not_discovered_exception</b></summary>

The Opster operator's bootstrap pod causes quorum issues with single-replica dev mode. Deploy a standalone single-node:

```bash
kubectl delete opensearchcluster logclaw-opensearch-dev-local -n logclaw-dev-local
kubectl delete pvc -n logclaw-dev-local -l opster.io/opensearch-cluster=logclaw-opensearch-dev-local
kubectl apply -f - <<'EOF'
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: opensearch-dev-local
  namespace: logclaw-dev-local
spec:
  serviceName: logclaw-opensearch-dev-local
  replicas: 1
  selector:
    matchLabels: { app: opensearch-dev-local }
  template:
    metadata:
      labels: { app: opensearch-dev-local }
    spec:
      initContainers:
        - name: sysctl
          image: busybox
          command: ["sysctl", "-w", "vm.max_map_count=262144"]
          securityContext: { privileged: true }
      containers:
        - name: opensearch
          image: opensearchproject/opensearch:2.14.0
          env:
            - { name: discovery.type, value: single-node }
            - { name: DISABLE_SECURITY_PLUGIN, value: "true" }
            - { name: OPENSEARCH_JAVA_OPTS, value: "-Xms512m -Xmx512m" }
          ports:
            - { containerPort: 9200, name: http }
          volumeMounts:
            - { name: data, mountPath: /usr/share/opensearch/data }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        resources: { requests: { storage: 10Gi } }
EOF
```
</details>

<details>
<summary><b>Pods stuck in Pending (topology spread)</b></summary>

Kind nodes need a zone label. `make kind-create` does this automatically, but if you see issues:

```bash
kubectl label node logclaw-dev-control-plane topology.kubernetes.io/zone=zone-a --overwrite
```
</details>

<details>
<summary><b>Vector not connecting to Kafka</b></summary>

Local dev uses a plain Kafka listener (no TLS). Verify it exists:

```bash
kubectl -n logclaw-dev-local get kafka logclaw-kafka-dev-local \
  -o jsonpath='{.spec.kafka.listeners[*].name}'
# Should include: plain
```
</details>

---

## Component Versions

| Component | Version |
|-----------|---------|
| **Dashboard** | Next.js 16 / React 19 / Tailwind CSS 4 |
| **Bridge (ETL)** | Python 3 (FastAPI) |
| **Ticketing Agent** | Python 3 (Kafka consumer) |
| Apache Kafka (Strimzi) | 4.1.1 (Strimzi 0.50.1) |
| Apache Flink | 1.19.0 |
| OpenSearch | 2.14.0 |
| External Secrets Operator | 0.10.3 |
| cert-manager | v1.16.1 |
| Apache Airflow | 2.9.2 (chart 1.14.0) |
| Vector.dev | 0.38.0 |
| KServe | 0.13.0 |
| Feast | 0.40.1 |

---

## Production Deployment (GitOps)

### Onboard a new tenant

1. Copy the template:
   ```bash
   cp gitops/tenants/_template.yaml gitops/tenants/tenant-<id>.yaml
   ```

2. Fill in the required values (`tenantId`, `tier`, `cloudProvider`, secret store config).

3. Commit and push — ArgoCD detects the new file and deploys the full stack in ~30 minutes.

### Manual install

```bash
helm install logclaw-acme charts/logclaw-tenant \
  --namespace logclaw-acme \
  --create-namespace \
  -f gitops/tenants/tenant-acme.yaml
```

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
