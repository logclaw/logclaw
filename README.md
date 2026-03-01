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
├── strimzi/                  # strimzi-kafka-operator 0.50.1
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
| Apache Kafka (Strimzi) | 4.1.1 (Strimzi 0.50.1) |
| Apache Flink | 1.19.0 |
| OpenSearch | 2.14.0 |
| External Secrets Operator | 0.10.3 |
| cert-manager | v1.16.1 |
| Apache Airflow | 2.9.2 (chart 1.14.0) |
| Zammad | 12.4.1 |
| Vector.dev | 0.38.0 |
| KServe | 0.13.0 |
| Feast | 0.40.1 |

---

## Running Locally

### Prerequisites

Install the required tools:

```bash
# Homebrew (macOS)
brew install helm helmfile kind kubectl

# Helm plugins
helm plugin install https://github.com/databus23/helm-diff
helm plugin install https://github.com/helm-unittest/helm-unittest
```

### 1 — Create a local Kubernetes cluster

```bash
make kind-create
```

This spins up a [kind](https://kind.sigs.k8s.io/) cluster named `logclaw-dev`, installs cert-manager CRDs, and labels the control-plane node with a topology zone (required by `topologySpreadConstraints`).

Verify:
```bash
kubectl cluster-info --context kind-logclaw-dev
```

### 2 — Install cluster-level operators (once per cluster)

```bash
make install-operators
```

Installs into dedicated namespaces:

| Operator | Namespace |
|---|---|
| Strimzi Kafka 0.50.1 | `strimzi-system` |
| Flink Kubernetes Operator 1.9.0 | `flink-system` |
| External Secrets | `external-secrets` |
| cert-manager | `cert-manager` |
| OpenSearch Operator | `opensearch-operator-system` |

Wait for all operator pods to be ready:
```bash
kubectl get pods -n strimzi-system -w
kubectl get pods -n flink-system -w
kubectl get pods -n external-secrets -w
kubectl get pods -n cert-manager -w
kubectl get pods -n opensearch-operator-system -w
```

> **Important:** After installing Strimzi, ensure the CRDs match the operator version. Helm does not auto-upgrade CRDs. If you see entity operator errors about missing `kafka.strimzi.io/v1` resources, run:
> ```bash
> kubectl apply -f https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.50.1/strimzi-crds-0.50.1.yaml \
>   --server-side --force-conflicts
> ```

### 3 — Install the full tenant stack

```bash
make install TENANT_ID=dev-local STORAGE_CLASS=standard
```

This will:
1. Create the `logclaw-dev-local` namespace
2. Generate dev secrets (OpenSearch, Airflow, Redis, Kafka credentials)
3. Run `helmfile apply` deploying all charts in dependency order

On a typical laptop (~16 GB RAM) expect:

| Time | Milestone |
|---|---|
| T+2 min | Namespace, RBAC, NetworkPolicies, secrets created |
| T+5 min | Kafka single-node KRaft cluster ready |
| T+8 min | OpenSearch 3-node cluster green |
| T+12 min | Vector ingestion pipeline connected to Kafka |
| T+15 min | Airflow scheduler + webserver running |
| T+18 min | Full stack operational (13 pods) |

Check progress:
```bash
watch kubectl get pods -n logclaw-dev-local
```

#### What runs locally vs. production

The local dev environment uses `ci/default-values.yaml` overrides to run without cloud-only CRDs:

| Component | Local Dev | Production |
|---|---|---|
| Kafka | Single-node KRaft, plain listener (port 9092) | Multi-broker, TLS + SCRAM-SHA-512 |
| OpenSearch | 3 single-replica pools | Multi-replica with zone spread |
| Flink | Operator + CRDs installed, jobs **disabled** (no app JARs) | FlinkDeployment CRDs (ETL + enrichment + anomaly) |
| ML Engine (Feast) | Runs with local file registry | Redis online store + S3 offline |
| ML Engine (KServe) | **Skipped** (no KServe CRD) | InferenceService for anomaly model |
| Airflow | `apache/airflow:2.9.2`, bundled PostgreSQL | Custom image, external PostgreSQL |
| Ticketing Agent | Python HTTP placeholder | Real agent with Kafka consumer |
| VPA | **Skipped** (no VPA CRD) | VerticalPodAutoscaler recommendations |
| Secrets | `make create-dev-secrets` (static) | ESO ExternalSecrets (auto-refresh) |

### 4 — Run Airflow DB migrations

The first time Airflow is installed, the scheduler and webserver wait for database migrations. If you deployed with `--no-hooks` or helmfile timed out, run migrations manually:

```bash
kubectl run airflow-migrate --restart=Never \
  --namespace logclaw-dev-local \
  --image=apache/airflow:2.9.2 \
  --env="AIRFLOW__DATABASE__SQL_ALCHEMY_CONN=postgresql://postgres:postgres@logclaw-airflow-dev-local-postgresql.logclaw-dev-local:5432/postgres?sslmode=disable" \
  --command -- airflow db migrate

# Wait for completion
kubectl wait --for=condition=Ready=false pod/airflow-migrate \
  -n logclaw-dev-local --timeout=120s 2>/dev/null || true

# Clean up
kubectl delete pod airflow-migrate -n logclaw-dev-local

# Restart pods waiting for migrations
kubectl delete pods -n logclaw-dev-local -l tier=airflow -l component=scheduler
kubectl delete pods -n logclaw-dev-local -l tier=airflow -l component=webserver
```

### 5 — Verify the stack

```bash
# All pods should be Running
kubectl get pods -n logclaw-dev-local

# Expected: 11 pods, all 1/1 or 2/2 Running
#   logclaw-kafka-dev-local-combined-0                          1/1  Running
#   logclaw-kafka-dev-local-entity-operator-...                 2/2  Running
#   opensearch-dev-local-0                                      1/1  Running
#   logclaw-ingestion-dev-local-...                             1/1  Running
#   logclaw-ml-engine-dev-local-feast-server-...                1/1  Running
#   logclaw-airflow-dev-local-postgresql-0                      1/1  Running
#   logclaw-airflow-dev-local-scheduler-...                     2/2  Running
#   logclaw-airflow-dev-local-webserver-...                     1/1  Running
#   logclaw-airflow-dev-local-triggerer-0                       2/2  Running
#   logclaw-airflow-dev-local-statsd-...                        1/1  Running
#   logclaw-ticketing-agent-dev-local-...                       1/1  Running

# Kafka cluster health
kubectl -n logclaw-dev-local get kafka -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}'
# → True

# OpenSearch cluster health
kubectl -n logclaw-dev-local exec opensearch-dev-local-0 -- \
  curl -s http://localhost:9200/_cluster/health | python3 -m json.tool
# → "status": "yellow" (single-node dev mode)

# Helm releases
helm list -n logclaw-dev-local
# → All 8 releases should be "deployed"
```

### 6 — Access the services

All services run inside the kind cluster. Use `kubectl port-forward` to access them from your workstation.

#### Service URL reference

| Service | Local URL | Port-Forward Command |
|---|---|---|
| Airflow Webserver | `http://localhost:8080` | `kubectl -n logclaw-dev-local port-forward svc/logclaw-airflow-dev-local-webserver 8080:8080` |
| OpenSearch API | `http://localhost:9200` | `kubectl -n logclaw-dev-local port-forward svc/logclaw-opensearch-dev-local 9200:9200` |
| Kafka Bootstrap | `localhost:9092` | `kubectl -n logclaw-dev-local port-forward svc/logclaw-kafka-dev-local-kafka-bootstrap 9092:9092` |
| Vector (log ingestion) | `http://localhost:18080` | `kubectl -n logclaw-dev-local port-forward svc/logclaw-ingestion-dev-local 18080:8080` |
| Vector (admin API) | `http://localhost:8686` | `kubectl -n logclaw-dev-local port-forward svc/logclaw-ingestion-dev-local 8686:8686` |
| Vector (Prometheus metrics) | `http://localhost:9598` | `kubectl -n logclaw-dev-local port-forward svc/logclaw-ingestion-dev-local 9598:9598` |
| Feast Feature Server | `http://localhost:6567` | `kubectl -n logclaw-dev-local port-forward svc/logclaw-ml-engine-dev-local-feast-server 6567:6567` |
| Ticketing Agent | `http://localhost:18081` | `kubectl -n logclaw-dev-local port-forward svc/logclaw-ticketing-agent-dev-local 18081:8080` |

#### Quick-start: open all services

```bash
# Run all port-forwards in background
kubectl -n logclaw-dev-local port-forward svc/logclaw-airflow-dev-local-webserver 8080:8080 &
kubectl -n logclaw-dev-local port-forward svc/logclaw-opensearch-dev-local 9200:9200 &
kubectl -n logclaw-dev-local port-forward svc/logclaw-kafka-dev-local-kafka-bootstrap 9092:9092 &
kubectl -n logclaw-dev-local port-forward svc/logclaw-ingestion-dev-local 18080:8080 &
kubectl -n logclaw-dev-local port-forward svc/logclaw-ingestion-dev-local 8686:8686 &
kubectl -n logclaw-dev-local port-forward svc/logclaw-ml-engine-dev-local-feast-server 6567:6567 &
kubectl -n logclaw-dev-local port-forward svc/logclaw-ticketing-agent-dev-local 18081:8080 &

echo "All services forwarded. Press Ctrl+C or run 'kill %1 %2 %3 %4 %5 %6 %7' to stop."
```

#### Verify each service

```bash
# Airflow — default login admin/admin
open http://localhost:8080

# OpenSearch — cluster health (dev uses HTTP, no auth)
curl -s http://localhost:9200/_cluster/health | python3 -m json.tool

# OpenSearch — search logs
curl -s http://localhost:9200/logclaw-logs-*/_count | python3 -m json.tool

# Kafka — list topics (via exec, no local client needed)
kubectl -n logclaw-dev-local exec logclaw-kafka-dev-local-combined-0 -- \
  bin/kafka-topics.sh --bootstrap-server localhost:9092 --list

# Vector — check pipeline topology
curl -s http://localhost:8686/health
curl -s http://localhost:9598/metrics | head -20

# Feast — health check
curl -s http://localhost:6567/health

# Ticketing Agent — health check
curl -s http://localhost:18081/
```

### 7 — End-to-end pipeline test

Send test logs through the full pipeline and verify each step.

```bash
# Step 1: Send logs via HTTP → Vector
curl -X POST http://localhost:18080 \
  -H "Content-Type: application/json" \
  -d '{"message": "Payment failed: timeout", "level": "ERROR", "service": "payment-api"}'

# Step 2: Verify logs landed in Kafka (raw-logs topic)
kubectl -n logclaw-dev-local exec logclaw-kafka-dev-local-combined-0 -- \
  bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic raw-logs --from-beginning --max-messages 5 --timeout-ms 10000

# Step 3: Check OpenSearch for indexed logs
curl -s 'http://localhost:9200/logclaw-logs-*/_search' \
  -H "Content-Type: application/json" \
  -d '{"size":5,"query":{"match_all":{}},"sort":[{"ingest_timestamp":{"order":"desc"}}]}' \
  | python3 -m json.tool

# Step 4: Produce an anomaly event (simulates ML engine output)
kubectl -n logclaw-dev-local exec -i logclaw-kafka-dev-local-combined-0 -- \
  bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic anomaly-events <<'EOF'
{"anomaly_id":"ANO-001","service":"payment-api","score":0.92,"severity":"critical","message":"Error rate spike to 15%"}
EOF

# Step 5: Verify anomaly event in topic
kubectl -n logclaw-dev-local exec logclaw-kafka-dev-local-combined-0 -- \
  bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic anomaly-events --from-beginning --max-messages 5 --timeout-ms 10000
```

> **Note:** In local dev, the Kafka → OpenSearch bridge (Flink) and the ticketing agent are stubs.
> Logs flow from HTTP → Vector → Kafka automatically. To test OpenSearch indexing, use the
> bulk API directly or wait for the Flink operator to be installed.

### 8 — Tear down

```bash
# Remove just the tenant stack
make uninstall TENANT_ID=dev-local

# Remove everything including the kind cluster
make kind-delete
```

### Troubleshooting

<details>
<summary><b>Strimzi entity operator CrashLoopBackOff</b></summary>

The entity operator fails with `kafkausers` CRD at `kafka.strimzi.io/v1` not found. This happens when Helm installed older CRDs and didn't upgrade them:

```bash
kubectl apply -f https://github.com/strimzi/strimzi-kafka-operator/releases/download/0.50.1/strimzi-crds-0.50.1.yaml \
  --server-side --force-conflicts
kubectl rollout restart deployment -n strimzi-system strimzi-cluster-operator
```
</details>

<details>
<summary><b>Airflow webserver OOMKilled</b></summary>

The Airflow webserver needs at least 1Gi memory. The `ci/default-values.yaml` sets the limit to 2Gi. If you see OOMKilled, check that you're using the CI values file:

```bash
helm get values logclaw-airflow-dev-local -n logclaw-dev-local | grep -A3 memory
```
</details>

<details>
<summary><b>Airflow scheduler/webserver stuck in Init:0/1</b></summary>

These pods wait for DB migrations via an init container. See [Step 4](#4--run-airflow-db-migrations) to run migrations manually.
</details>

<details>
<summary><b>OpenSearch authentication failed</b></summary>

The dev secrets use `admin:admin` credentials. If you see authentication errors, verify the secret matches:

```bash
kubectl get secret opensearch-admin-credentials -n logclaw-dev-local \
  -o jsonpath='{.data.password}' | base64 -d
# Should output: admin
```

To reset: `make create-dev-secrets TENANT_ID=dev-local`
</details>

<details>
<summary><b>Pods stuck in Pending (topology spread)</b></summary>

All charts use `topologySpreadConstraints` with zone-based scheduling. Kind nodes need the zone label:

```bash
kubectl label node logclaw-dev-control-plane topology.kubernetes.io/zone=zone-a --overwrite
```

`make kind-create` does this automatically.
</details>

<details>
<summary><b>OpenSearch cluster_manager_not_discovered_exception</b></summary>

The Opster operator creates a temporary bootstrap pod for initial cluster formation. With single-replica master pools (dev mode), the bootstrap creates a 2-node voting config then deletes itself, leaving the single master without quorum.

**Fix:** Deploy a standalone single-node OpenSearch bypassing the Opster operator:

```bash
# Delete the operator-managed cluster
kubectl delete opensearchcluster logclaw-opensearch-dev-local -n logclaw-dev-local
kubectl delete pvc -n logclaw-dev-local -l opster.io/opensearch-cluster=logclaw-opensearch-dev-local

# Deploy standalone single-node (see gitops/tenants/tenant-dev-local.yaml for the manifest)
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
    matchLabels:
      app: opensearch-dev-local
  template:
    metadata:
      labels:
        app: opensearch-dev-local
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
            - { name: cluster.name, value: logclaw-opensearch-dev-local }
          ports:
            - { containerPort: 9200, name: http }
            - { containerPort: 9300, name: transport }
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
<summary><b>Vector ingestion not connecting to Kafka</b></summary>

Local dev uses a plain (no TLS, no auth) Kafka listener on port 9092. Verify the listener exists:

```bash
kubectl -n logclaw-dev-local get kafka logclaw-kafka-dev-local \
  -o jsonpath='{.spec.kafka.listeners[*].name}'
# Should include: plain
```
</details>

---

## Development

```bash
# Lint all charts
make lint

# Render umbrella chart templates (dry-run, no cluster needed)
make template TENANT_ID=ci-test

# Diff what would change on an already-installed release
make template-diff TENANT_ID=dev-local

# Validate values against JSON schemas
make validate-schema

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
