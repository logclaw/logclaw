# Values Reference

This document describes all top-level `global.*` values accepted by the LogClaw umbrella
chart (`logclaw-tenant`) and propagated to every sub-chart.

## global.*

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `global.tenantId` | string | Yes | — | Unique tenant identifier. Lowercase letters, numbers, hyphens only. Max 40 characters. Used as a label, resource name suffix, and namespace component. |
| `global.tenantName` | string | Yes | — | Human-readable display name for the tenant. Shown in dashboards and alert messages. |
| `global.storageClass` | string | Yes | — | Name of the Kubernetes StorageClass used for all persistent volumes (Kafka, OpenSearch, Airflow). Must exist in the cluster before install. |
| `global.storageClassHighThroughput` | string | No | `""` (falls back to `storageClass`) | StorageClass optimised for high IOPS. Used for Kafka broker disks and OpenSearch data nodes when set. Recommended: `io2` on AWS, `pd-ssd` on GCP. |
| `global.tier` | string | No | `"ha"` | Deployment tier controlling replica counts and resource profiles. One of: `standard` (single replicas, minimal resources), `ha` (3 replicas, production resources), `ultra-ha` (5+ replicas, maximum resources). |
| `global.objectStorage.provider` | string | No | `"s3"` | Object storage backend. One of: `s3`, `gcs`, `azure`. Determines the credential format and SDK used by Flink checkpointing and ML engine model storage. |
| `global.objectStorage.bucket` | string | Yes | — | Name of the pre-created object storage bucket. Must be accessible from the cluster with appropriate IAM/service-account permissions. |
| `global.objectStorage.region` | string | No | `"us-east-1"` | Cloud region of the bucket. Required for AWS S3 and GCS. Ignored for Azure and self-hosted S3. |
| `global.objectStorage.endpoint` | string | No | `""` | Custom S3-compatible endpoint URL. Set for MinIO (`http://minio.minio.svc:9000`) or other self-hosted S3. Leave empty for AWS S3. |
| `global.secretStore.provider` | string | No | `"aws"` | Secret management backend for External Secrets Operator. One of: `aws`, `gcp`, `vault`, `azure`. Determines the ESO ClusterSecretStore type created for the tenant. |
| `global.secretStore.region` | string | No | `"us-east-1"` | AWS region for Secrets Manager. Used only when `provider=aws`. |
| `global.secretStore.projectId` | string | No | `""` | GCP project ID. Used only when `provider=gcp`. |
| `global.secretStore.vaultAddress` | string | No | `""` | HashiCorp Vault server address (e.g. `https://vault.example.com:8200`). Used only when `provider=vault`. |
| `global.imagePullSecrets` | list | No | `[]` | List of Kubernetes image pull secret names (`[{name: "my-secret"}]`). Applied to all workload pods across all sub-charts. |
| `global.monitoring.enabled` | bool | No | `true` | When `true`, enables ServiceMonitor and PrometheusRule resources for all sub-charts. Requires Prometheus Operator CRDs to be present. |
| `global.clusterDomain` | string | No | `"cluster.local"` | Kubernetes cluster DNS domain. Used to construct internal service FQDNs. Change only if your cluster uses a custom domain. |

## Component Enable Flags

These top-level boolean maps control which sub-charts are rendered by the umbrella chart.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `platform.enabled` | bool | No | `true` | Deploy `logclaw-platform` (API gateway, RBAC, NetworkPolicy). Disabling also disables the ingress entry point. |
| `ingestion.enabled` | bool | No | `true` | Deploy `logclaw-ingestion` (OpenTelemetry Collector). Disable if you use a separate log shipping solution. |
| `kafka.enabled` | bool | No | `true` | Deploy `logclaw-kafka` (Strimzi Kafka cluster). Required by `flink` and `ticketingAgent`. |
| `flink.enabled` | bool | No | `true` | Deploy `logclaw-flink` (stream processing jobs). Requires `kafka.enabled=true`. |
| `opensearch.enabled` | bool | No | `true` | Deploy `logclaw-opensearch` (search cluster + dashboards). Required by `ticketingAgent`. |
| `mlEngine.enabled` | bool | No | `true` | Deploy `logclaw-ml-engine` (KServe InferenceService). Requires GPU nodes or CPU-only inference image override. |
| `airflow.enabled` | bool | No | `true` | Deploy `logclaw-airflow` (pipeline orchestration). |
| `ticketingAgent.enabled` | bool | No | `true` | Deploy `logclaw-ticketing-agent` (AI SRE agent). Requires `kafka.enabled=true` and `opensearch.enabled=true`. |

## Per-Chart Override Syntax

Each sub-chart can be overridden using its chart name as the top-level key:

```yaml
logclaw-kafka:
  kafka:
    replicas: 5
    storage:
      volumes:
        - id: 0
          type: persistent-claim
          size: "2Ti"
          deleteClaim: false

logclaw-opensearch:
  opensearch:
    data:
      replicas: 5
      diskSize: "2Ti"
    masters:
      replicas: 3

logclaw-ingestion:
  replicaCount: 10
  autoscaling:
    enabled: true
    minReplicas: 10
    maxReplicas: 50
    targetCPUUtilizationPercentage: 60

logclaw-ticketing-agent:
  config:
    pagerduty:
      enabled: true
    jira:
      enabled: true
      baseUrl: "https://yourorg.atlassian.net"
      projectKey: "SRE"
    servicenow:
      enabled: true
      instance: "yourorg"
    anomaly:
      minimumScore: 0.85
      lookbackWindow: "15m"

logclaw-ml-engine:
  model:
    name: "logclaw-anomaly-v2"
    storageUri: "s3://your-bucket/models/anomaly-v2"
  resources:
    requests:
      cpu: "2"
      memory: "4Gi"
    limits:
      nvidia.com/gpu: "1"

logclaw-airflow:
  airflow:
    dags:
      gitSync:
        enabled: true
        repo: "git@github.com:yourorg/logclaw-dags.git"
        branch: "main"
        sshKeySecret: "airflow-git-ssh-key"
```

## Tier Profiles

| Setting | standard | ha | ultra-ha |
|---|---|---|---|
| Kafka brokers | 1 | 3 | 5 |
| Kafka storage per broker | 100Gi | 1Ti | 2Ti |
| OpenSearch masters | 1 | 3 | 3 |
| OpenSearch data nodes | 1 | 3 | 5 |
| OpenSearch disk per data node | 100Gi | 1Ti | 2Ti |
| Ingestion replicas | 1 | 3 | 5 |
| Flink task managers | 1 | 2 | 4 |
| Ticketing agent replicas | 1 | 2 | 3 |
| ML Engine replicas | 1 | 2 | 3 |
| PodDisruptionBudget | No | Yes | Yes |
| TopologySpreadConstraints | No | Yes (zone) | Yes (zone+node) |

## Environment Variable Substitution (Helmfile)

When using `helmfile`, the following environment variables are consumed by `helmfile.d/` releases:

| Variable | Used By | Default | Description |
|---|---|---|---|
| `TENANT_ID` | all helmfile.d files | `dev-local` | Tenant identifier, injected into release names and namespaces |
| `STORAGE_CLASS` | `10-platform`, `20-kafka`, `40-opensearch` | `standard` | Overrides `global.storageClass` |
| `KAFKA_BROKERS` | `30-ingestion`, `50-flink`, `80-ticketing-agent` | `logclaw-kafka-kafka-bootstrap:9093` | Kafka bootstrap server address |
| `OBJECT_STORAGE_BUCKET` | `50-flink`, `60-ml-engine` | `logclaw-dev-local` | Object storage bucket name |
| `OBJECT_STORAGE_PROVIDER` | `50-flink` | `s3` | Object storage provider |
| `OPENSEARCH_ENDPOINT` | `80-ticketing-agent` | `https://logclaw-opensearch:9200` | OpenSearch base URL |
| `HELM_REGISTRY` | `make push` | — | OCI registry target, e.g. `ghcr.io/yourorg/charts` |
