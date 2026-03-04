---
title: Tenant Onboarding
description: Provision a new LogClaw tenant from zero to fully operational in 30 minutes.
---

# Tenant Onboarding

This guide walks through provisioning a new LogClaw tenant from zero to fully operational. Expected time: **30 minutes** after prerequisites are met.

## Prerequisites

<AccordionGroup>
  <Accordion title="Cluster Prerequisites (one-time)" icon="server">
    **Kubernetes Cluster**
    - Kubernetes >= 1.27
    - Control plane: 4 vCPU, 8 GB RAM
    - Workers (minimum 3): 8 vCPU, 32 GB RAM each

    **Operators** (install once per cluster)
    - Strimzi Kafka Operator (`operators/strimzi/`)
    - Flink Kubernetes Operator (`operators/flink-operator/`)
    - External Secrets Operator (`operators/eso/`)
    - cert-manager (`operators/cert-manager/`)
    - OpenSearch Operator (`operators/opensearch-operator/`)

    **GitOps**
    - ArgoCD installed with `logclaw` AppProject applied
    - ArgoCD ApplicationSet `logclaw-tenants` applied
  </Accordion>

  <Accordion title="Per-Tenant Prerequisites" icon="list-check">
    - Unique `tenantId` chosen (lowercase letters, numbers, hyphens; max 40 chars)
    - Kubernetes StorageClass available (e.g. `gp3`, `standard`, `pd-ssd`)
    - Object storage bucket pre-created and accessible from cluster
    - Secrets backend configured (AWS Secrets Manager, GCP Secret Manager, Vault, or Azure Key Vault)
    - Image pull secret `logclaw-registry-pull` created (or omit if using public registry)
    - Ticketing provider credentials stored in secret backend (if ticketing agent enabled)
  </Accordion>

  <Accordion title="Access Requirements" icon="lock">
    - Write access to the LogClaw Git repository
    - ArgoCD UI or CLI access to monitor sync status
  </Accordion>
</AccordionGroup>

## Step 1: Create the Tenant Values File

Copy the template and fill in required fields:

```bash
cp gitops/tenants/_template.yaml gitops/tenants/<tenantId>.yaml
```

Set the required global values:

```yaml
tenantId: "acme-corp"

global:
  tenantName: "Acme Corporation"
  storageClass: "gp3"
  tier: "ha"                       # standard | ha | ultra-ha

  objectStorage:
    provider: "s3"                 # s3 | gcs | azure
    bucket: "logclaw-acme-corp"
    region: "us-east-1"

  secretStore:
    provider: "aws"                # aws | gcp | vault | azure
    region: "us-east-1"
```

### Enable Components

Toggle components based on your requirements:

```yaml
# Core pipeline (recommended: all enabled)
platform:       { enabled: true }   # RBAC, NetworkPolicy, SecretStore
otelCollector:  { enabled: true }   # OTLP ingestion (gRPC :4317, HTTP :4318)
kafka:          { enabled: true }   # Event bus (required by most components)
opensearch:     { enabled: true }   # Search & analytics

# Processing (choose one or both)
flink:          { enabled: true }   # High-throughput stream processing
bridge:         { enabled: true }   # OTLP ETL + anomaly + trace correlation

# AI & Operations
mlEngine:       { enabled: true }   # Feast + KServe model inference
airflow:        { enabled: true }   # ML pipeline orchestration
ticketingAgent: { enabled: true }   # AI SRE incident management
agent:          { enabled: true }   # Infrastructure health collector

# UI
dashboard:      { enabled: true }   # Next.js pipeline UI
```

<Tip>
For development environments, enable `bridge` and `dashboard` while disabling `flink`, `mlEngine`, and `airflow` to reduce resource requirements.
</Tip>

See the [Values Reference](/values-reference) for the full list of configurable fields.

## Step 2: Commit and Push

```bash
git add gitops/tenants/<tenantId>.yaml
git commit -m "feat(tenants): onboard <tenantId>"
git push origin main
```

The ArgoCD Git generator polls every 3 minutes. To trigger immediately:

```bash
argocd app get logclaw-tenants --refresh
```

## Step 3: Monitor Deployment

Watch the tenant application sync:

```bash
# List all tenant applications
argocd app list -l logclaw.io/managed-by=applicationset

# Watch sync status
argocd app get logclaw-tenant-<tenantId> --watch
```

**Expected sync wave order:**

<Steps>
  <Step title="Namespace + Platform (t=0–5m)">
    Namespace creation, RBAC, NetworkPolicy, ClusterSecretStore
  </Step>
  <Step title="Kafka (t=5–10m)">
    Strimzi reconciles KRaft cluster. Wait for `READY=True`.
  </Step>
  <Step title="OTel Collector + OpenSearch (t=10–15m)">
    Deploy in parallel. OTel Collector connects to Kafka bootstrap. OpenSearch cluster reaches green.
  </Step>
  <Step title="Flink + Bridge (t=15–20m)">
    Flink jobs enter `RUNNING` state. Bridge connects to Kafka + OpenSearch.
  </Step>
  <Step title="ML Engine + Airflow (t=20–25m)">
    KServe InferenceService ready. Airflow scheduler + webserver healthy.
  </Step>
  <Step title="Ticketing Agent + Dashboard (t=25–30m)">
    Agent validates ticketing credentials. Dashboard available on ClusterIP.
  </Step>
</Steps>

## Step 4: Verify Components

Run the built-in Helm test suite:

```bash
helm test logclaw-<tenantId> \
  --namespace logclaw-<tenantId> \
  --timeout 5m \
  --logs
```

### Individual Component Checks

<Tabs>
  <Tab title="Kafka">
    ```bash
    kubectl get kafka -n logclaw-<tenantId>
    # Expected: READY=True, REPLICAS=3 (ha tier)
    ```
  </Tab>
  <Tab title="OTel Collector">
    ```bash
    kubectl get pods -n logclaw-<tenantId> \
      -l app.kubernetes.io/name=logclaw-otel-collector
    # Expected: all pods Running

    # Test OTLP endpoint
    kubectl port-forward svc/logclaw-otel-collector 4318:4318 \
      -n logclaw-<tenantId>
    curl -s -o /dev/null -w "%{http_code}" \
      -X POST http://localhost:4318/v1/logs \
      -H "Content-Type: application/json" \
      -d '{"resourceLogs":[]}'
    # Expected: 200
    ```
  </Tab>
  <Tab title="OpenSearch">
    ```bash
    kubectl get opensearchcluster -n logclaw-<tenantId>
    # Expected: state=Ready

    kubectl port-forward svc/logclaw-opensearch 9200:9200 \
      -n logclaw-<tenantId>
    curl -sk https://localhost:9200/_cluster/health | jq .status
    # Expected: "green"
    ```
  </Tab>
  <Tab title="Bridge">
    ```bash
    kubectl get pods -n logclaw-<tenantId> \
      -l app.kubernetes.io/name=logclaw-bridge
    # Expected: Running

    kubectl port-forward svc/logclaw-bridge 8080:8080 \
      -n logclaw-<tenantId>
    curl http://localhost:8080/health
    # Expected: {"status": "ok", ...}
    ```
  </Tab>
  <Tab title="Ticketing Agent">
    ```bash
    kubectl logs -n logclaw-<tenantId> \
      -l app.kubernetes.io/name=logclaw-ticketing-agent \
      --tail=20
    # Expected: "Connected to Kafka", "Ticketing provider validated"
    ```
  </Tab>
  <Tab title="Dashboard">
    ```bash
    kubectl port-forward svc/logclaw-dashboard 3000:3000 \
      -n logclaw-<tenantId>
    # Open http://localhost:3000
    ```
  </Tab>
  <Tab title="Flink">
    ```bash
    kubectl get flinkdeployment -n logclaw-<tenantId>
    # Expected: LIFECYCLE_STATE=STABLE, JOB_STATE=RUNNING
    ```
  </Tab>
  <Tab title="Agent">
    ```bash
    kubectl get pods -n logclaw-<tenantId> \
      -l app.kubernetes.io/name=logclaw-agent
    # Expected: Running

    kubectl port-forward svc/logclaw-agent 8080:8080 \
      -n logclaw-<tenantId>
    curl http://localhost:8080/health
    # Expected: {"status": "ok"}
    ```
  </Tab>
</Tabs>

## Step 5: Send Your First Logs

After verification, send a test log via OTLP HTTP:

```bash
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "onboarding-test"}}
        ]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "'$(date +%s)000000000'",
          "severityText": "INFO",
          "body": {"stringValue": "Tenant onboarding complete!"}
        }]
      }]
    }]
  }'
```

Verify it appears in OpenSearch:

```bash
curl -sk https://localhost:9200/logclaw-logs-*/_search \
  -H "Content-Type: application/json" \
  -d '{"query":{"match":{"service":"onboarding-test"}}}'
```

## Troubleshooting

<AccordionGroup>
  <Accordion title="ArgoCD Application stuck in Progressing">
    ```bash
    argocd app get logclaw-tenant-<tenantId>
    kubectl describe application logclaw-tenant-<tenantId> -n argocd
    ```
    Check the "Conditions" section for error details.
  </Accordion>

  <Accordion title="Kafka not reaching Ready state">
    ```bash
    kubectl describe kafka logclaw-<tenantId>-kafka -n logclaw-<tenantId>
    kubectl logs -n strimzi-system -l name=strimzi-cluster-operator --tail=50
    ```
    **Common causes:** StorageClass not found, PVC provisioning failure, resource limits too low.
  </Accordion>

  <Accordion title="OpenSearch cluster health red">
    ```bash
    kubectl describe opensearchcluster -n logclaw-<tenantId>
    kubectl logs -n opensearch-operator-system \
      -l control-plane=controller-manager --tail=50
    ```
    **Common causes:** Insufficient memory (2 Gi minimum per data node), disk pressure.
  </Accordion>

  <Accordion title="Flink job not RUNNING">
    ```bash
    kubectl describe flinkdeployment -n logclaw-<tenantId>
    kubectl logs -n logclaw-<tenantId> -l app=logclaw-flink-anomaly --tail=50
    ```
    **Common causes:** Kafka bootstrap unreachable, object storage credentials invalid.
  </Accordion>

  <Accordion title="External Secrets not syncing">
    ```bash
    kubectl get externalsecret -n logclaw-<tenantId>
    kubectl describe externalsecret -n logclaw-<tenantId>
    kubectl get clustersecretstore
    ```
    **Common causes:** IAM role not attached, wrong region, missing permissions.
  </Accordion>

  <Accordion title="Force re-sync">
    ```bash
    argocd app get logclaw-tenant-<tenantId> --hard-refresh
    argocd app sync logclaw-tenant-<tenantId> --force
    ```
  </Accordion>
</AccordionGroup>
