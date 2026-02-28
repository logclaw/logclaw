# Tenant Onboarding Guide

This guide walks through provisioning a new LogClaw tenant from zero to fully operational.
Expected time: 30 minutes after prerequisites are met.

## 1. Prerequisites Checklist

Before starting, confirm the following are in place:

**Cluster prerequisites (one-time, cluster-level)**
- [ ] Kubernetes >= 1.27 cluster with nodes meeting minimum specs:
      - Control plane: 4 vCPU, 8 GB RAM
      - Workers (minimum 3): 8 vCPU, 32 GB RAM each
- [ ] Strimzi Kafka Operator installed (`operators/strimzi/`)
- [ ] Flink Kubernetes Operator installed (`operators/flink-operator/`)
- [ ] External Secrets Operator installed (`operators/eso/`)
- [ ] cert-manager installed (`operators/cert-manager/`)
- [ ] OpenSearch Operator installed (`operators/opensearch-operator/`)
- [ ] ArgoCD installed and `logclaw` AppProject applied
- [ ] ArgoCD ApplicationSet `logclaw-tenants` applied

**Per-tenant prerequisites**
- [ ] Unique `tenantId` chosen (lowercase letters, numbers, hyphens only; max 40 chars)
- [ ] Kubernetes StorageClass available (e.g. `gp3`, `standard`)
- [ ] Object storage bucket pre-created and accessible from the cluster
- [ ] Secrets backend configured (AWS Secrets Manager, GCP Secret Manager, Vault, or Azure Key Vault)
- [ ] Image pull secret `logclaw-registry-pull` created in cluster (or omit if using public registry)
- [ ] Ticketing provider credentials stored in secret backend (if ticketing agent enabled)

**Access requirements**
- [ ] Write access to this Git repository
- [ ] ArgoCD UI or CLI access to monitor sync status

## 2. Create the Tenant Values File

Copy the template and fill in required fields:

```bash
cp gitops/tenants/_template.yaml gitops/tenants/<tenantId>.yaml
```

Open `gitops/tenants/<tenantId>.yaml` and set at minimum:

```yaml
tenantId: "acme-corp"           # REQUIRED — must be unique

global:
  tenantName: "Acme Corporation" # REQUIRED — human-readable
  storageClass: "gp3"            # REQUIRED — must exist in cluster
  tier: "ha"                     # standard | ha | ultra-ha

  objectStorage:
    provider: "s3"               # s3 | gcs | azure
    bucket: "logclaw-acme-corp"  # REQUIRED — pre-created bucket
    region: "us-east-1"

  secretStore:
    provider: "aws"              # aws | gcp | vault | azure
    region: "us-east-1"
```

Enable or disable components as needed:

```yaml
platform:       { enabled: true }
ingestion:      { enabled: true }
kafka:          { enabled: true }
flink:          { enabled: true }
opensearch:     { enabled: true }
mlEngine:       { enabled: true }
airflow:        { enabled: true }
ticketingAgent: { enabled: true }
```

Refer to `docs/values-reference.md` for the full list of configurable fields.

## 3. Commit and Push

Stage and commit only the new tenant file:

```bash
git add gitops/tenants/<tenantId>.yaml
git commit -m "feat(tenants): onboard <tenantId>"
git push origin main
```

The ArgoCD Git generator polls every 3 minutes by default. To trigger immediately:

```bash
argocd app get logclaw-tenants --refresh
```

## 4. Monitor ArgoCD

Watch the tenant application appear and sync:

```bash
# List all tenant applications
argocd app list -l logclaw.io/managed-by=applicationset

# Watch sync status for your tenant
argocd app get logclaw-tenant-<tenantId> --watch

# Stream sync logs
argocd app logs logclaw-tenant-<tenantId>
```

In the ArgoCD UI, navigate to Applications and filter by label `logclaw.io/tenant=<tenantId>`.

Expected sync wave order:
1. Namespace creation and labeling
2. `logclaw-platform` (RBAC, NetworkPolicy)
3. `logclaw-kafka` (Strimzi reconciles Kafka cluster)
4. `logclaw-ingestion`, `logclaw-opensearch` (parallel)
5. `logclaw-flink` (depends on Kafka)
6. `logclaw-ml-engine`, `logclaw-airflow` (parallel)
7. `logclaw-ticketing-agent`

## 5. Verify Each Component

Run the built-in Helm test suite after ArgoCD reports Healthy:

```bash
helm test logclaw-<tenantId> \
  --namespace logclaw-<tenantId> \
  --timeout 5m \
  --logs
```

Verify each component individually:

**Kafka**
```bash
kubectl get kafka -n logclaw-<tenantId>
# Expected: READY=True, REPLICAS=3 (ha tier)
```

**OpenSearch**
```bash
kubectl get opensearchcluster -n logclaw-<tenantId>
# Expected: state=Ready
curl -sk https://logclaw-opensearch.<tenantId>.svc:9200/_cluster/health \
  -u admin:$PASS | jq .status
# Expected: "green"
```

**Flink**
```bash
kubectl get flinkdeployment -n logclaw-<tenantId>
# Expected: LIFECYCLE_STATE=STABLE, JOB_STATE=RUNNING
```

**Ingestion**
```bash
kubectl get pods -n logclaw-<tenantId> -l app.kubernetes.io/name=logclaw-ingestion
# Expected: all pods Running
```

**ML Engine**
```bash
kubectl get inferenceservice -n logclaw-<tenantId>
# Expected: READY=True
```

**Airflow**
```bash
kubectl get pods -n logclaw-<tenantId> -l component=webserver
# Expected: Running
```

**Ticketing Agent**
```bash
kubectl logs -n logclaw-<tenantId> -l app.kubernetes.io/name=logclaw-ticketing-agent \
  --tail=20
# Expected: "Connected to Kafka", "Ticketing provider validated"
```

## 6. Troubleshooting

**ArgoCD Application stuck in Progressing**
```bash
argocd app get logclaw-tenant-<tenantId>
# Check "Conditions" section for error details
kubectl describe application logclaw-tenant-<tenantId> -n argocd
```

**Kafka not reaching Ready state**
```bash
kubectl describe kafka logclaw-<tenantId>-kafka -n logclaw-<tenantId>
kubectl logs -n strimzi-system -l name=strimzi-cluster-operator --tail=50
# Common causes: StorageClass not found, PVC provisioning failure, resource limits too low
```

**OpenSearch cluster health red**
```bash
kubectl describe opensearchcluster -n logclaw-<tenantId>
kubectl logs -n opensearch-operator-system -l control-plane=controller-manager --tail=50
# Common causes: Insufficient memory (requires 2Gi per data node minimum), disk pressure
```

**Flink job not RUNNING**
```bash
kubectl describe flinkdeployment -n logclaw-<tenantId>
kubectl logs -n logclaw-<tenantId> -l app=logclaw-flink-anomaly --tail=50
# Common causes: Kafka bootstrap unreachable, object storage credentials invalid
```

**External Secrets not syncing**
```bash
kubectl get externalsecret -n logclaw-<tenantId>
kubectl describe externalsecret -n logclaw-<tenantId>
# Check SecretStore connectivity: kubectl get clustersecretstore
# Common causes: IAM role not attached, wrong region, missing permissions
```

**Ticketing agent failing to connect**
```bash
kubectl logs -n logclaw-<tenantId> -l app.kubernetes.io/name=logclaw-ticketing-agent
# Check environment variables are set from ExternalSecret
kubectl get secret logclaw-ticketing-credentials -n logclaw-<tenantId>
```

**Force ArgoCD hard refresh and re-sync**
```bash
argocd app get logclaw-tenant-<tenantId> --hard-refresh
argocd app sync logclaw-tenant-<tenantId> --force
```
