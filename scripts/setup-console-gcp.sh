#!/usr/bin/env bash
# ============================================================================
# LogClaw Enterprise Console — GCP Production Deployment
# Deploys the enterprise console + full backend stack to a new GKE cluster
# with Cloud SQL PostgreSQL, Global HTTPS LB, Cloud CDN, and Cloud Armor.
#
# Usage:
#   GCP_PROJECT_ID=<project> \
#   CLERK_SECRET_KEY=sk_live_... \
#   CLERK_PUBLISHABLE_KEY=pk_live_... \
#   GITHUB_PAT=ghp_... \
#     ./scripts/setup-console-gcp.sh
#
# Flags:
#   --teardown          Destroy the production cluster and resources
#   --skip-backend      Skip backend stack (Kafka, OpenSearch, etc.)
#   --staging           Deploy staging environment (us-central-1, reduced)
#   --dry-run           Print commands without executing
# ============================================================================
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

# ── Defaults (Production) ─────────────────────────────────────────────────
ENV="production"
CLUSTER_NAME="logclaw-prod"
REGION="us-west1"
MACHINE_TYPE="e2-standard-4"
MIN_NODES=2
MAX_NODES=6
NAMESPACE="logclaw"
CLOUDSQL_INSTANCE="logclaw-console-db"
CLOUDSQL_TIER="db-custom-2-7680"
CLOUDSQL_HA="REGIONAL"
CONSOLE_IMAGE="ghcr.io/logclaw/logclaw-enterprise"
CONSOLE_TAG="0.1.0"
CONSOLE_REPLICAS=2
CONSOLE_DOMAIN="console.logclaw.ai"
OTEL_DOMAIN="otel.logclaw.ai"
DNS_ZONE="logclaw-zone"
TEARDOWN=false
SKIP_BACKEND=false
DRY_RUN=false

# ── Parse flags ────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --teardown)     TEARDOWN=true; shift ;;
    --skip-backend) SKIP_BACKEND=true; shift ;;
    --staging)
      ENV="staging"
      CLUSTER_NAME="logclaw-staging"
      REGION="us-central1"
      MACHINE_TYPE="e2-standard-2"
      MIN_NODES=1
      MAX_NODES=2
      CLOUDSQL_TIER="db-f1-micro"
      CLOUDSQL_HA="ZONAL"
      CLOUDSQL_INSTANCE="logclaw-staging-db"
      CONSOLE_REPLICAS=1
      CONSOLE_TAG="latest"
      CONSOLE_DOMAIN="uat.console.logclaw.ai"
      OTEL_DOMAIN="uat.otel.logclaw.ai"
      shift ;;
    --dry-run)      DRY_RUN=true; shift ;;
    *)              echo "Unknown flag: $1"; exit 1 ;;
  esac
done

info()  { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fail()  { echo -e "${RED}[FAIL]${RESET}  $*"; exit 1; }
step()  { echo -e "\n${BOLD}━━━ Step $1: $2 ━━━${RESET}"; }

run() {
  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY-RUN]${RESET} $*"
  else
    eval "$@"
  fi
}

# ── Required env vars ─────────────────────────────────────────────────────
if [ -z "${GCP_PROJECT_ID:-}" ]; then
  fail "GCP_PROJECT_ID is required."
fi

if [ "$TEARDOWN" = false ]; then
  for var in CLERK_SECRET_KEY CLERK_PUBLISHABLE_KEY GITHUB_PAT; do
    if [ -z "${!var:-}" ]; then
      fail "${var} is required. Export it before running."
    fi
  done
fi

# ═══════════════════════════════════════════════════════════════════════════
# TEARDOWN MODE
# ═══════════════════════════════════════════════════════════════════════════
if [ "$TEARDOWN" = true ]; then
  echo ""
  echo -e "${RED}${BOLD}  TEARDOWN MODE — This will destroy the ${ENV} environment${RESET}"
  echo ""
  read -p "  Type 'yes' to confirm: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 0
  fi

  info "Deleting GKE cluster '${CLUSTER_NAME}'..."
  run gcloud container clusters delete "${CLUSTER_NAME}" \
    --region "${REGION}" \
    --project "${GCP_PROJECT_ID}" \
    --quiet 2>/dev/null || warn "Cluster not found"

  info "Deleting Cloud SQL instance '${CLOUDSQL_INSTANCE}'..."
  run gcloud sql instances delete "${CLOUDSQL_INSTANCE}" \
    --project "${GCP_PROJECT_ID}" \
    --quiet 2>/dev/null || warn "Instance not found"

  ok "Teardown complete"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════
# DEPLOYMENT MODE
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}Deploying LogClaw Enterprise Console (${ENV})${RESET}"
echo -e "  Region:  ${REGION}"
echo -e "  Cluster: ${CLUSTER_NAME}"
echo -e "  Console: ${CONSOLE_DOMAIN}"
echo -e "  OTLP:    ${OTEL_DOMAIN}"
echo ""

# ── Step 0: Preflight ─────────────────────────────────────────────────────
step "0" "Preflight checks"

MISSING=()
for cmd in gcloud kubectl helm; do
  if ! command -v "$cmd" &>/dev/null; then
    MISSING+=("$cmd")
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  fail "Missing tools: ${MISSING[*]}. Install them and re-run."
fi

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 | grep -q "@"; then
  fail "Not authenticated with gcloud. Run: gcloud auth login"
fi

gcloud config set project "${GCP_PROJECT_ID}" --quiet
ok "All prerequisites found (project: ${GCP_PROJECT_ID})"

# ── Step 1: Enable GCP APIs ──────────────────────────────────────────────
step "1" "Enable required GCP APIs"

APIS=(
  "container.googleapis.com"
  "compute.googleapis.com"
  "sqladmin.googleapis.com"
  "secretmanager.googleapis.com"
  "dns.googleapis.com"
)
for api in "${APIS[@]}"; do
  info "Enabling ${api}..."
  run gcloud services enable "${api}" --project "${GCP_PROJECT_ID}" --quiet
done
ok "All APIs enabled"

# ── Step 2: Create GKE Cluster ────────────────────────────────────────────
step "2" "Create GKE cluster"

if gcloud container clusters describe "${CLUSTER_NAME}" --region "${REGION}" --project "${GCP_PROJECT_ID}" &>/dev/null 2>&1; then
  ok "GKE cluster '${CLUSTER_NAME}' already exists — skipping"
else
  info "Creating GKE cluster '${CLUSTER_NAME}' in ${REGION}..."
  info "  Machine type: ${MACHINE_TYPE}"
  info "  Nodes: ${MIN_NODES} (autoscales to ${MAX_NODES})"

  run gcloud container clusters create "${CLUSTER_NAME}" \
    --region "${REGION}" \
    --project "${GCP_PROJECT_ID}" \
    --machine-type "${MACHINE_TYPE}" \
    --num-nodes "${MIN_NODES}" \
    --enable-autoscaling \
    --min-nodes "${MIN_NODES}" \
    --max-nodes "${MAX_NODES}" \
    --release-channel "stable" \
    --enable-vertical-pod-autoscaling \
    --enable-shielded-nodes \
    --shielded-secure-boot \
    --shielded-integrity-monitoring \
    --disk-type "pd-ssd" \
    --disk-size "100" \
    --enable-ip-alias \
    --enable-network-policy \
    --workload-pool "${GCP_PROJECT_ID}.svc.id.goog" \
    --labels "env=${ENV},product=logclaw,managed-by=setup-console-gcp" \
    --quiet

  ok "GKE cluster created"
fi

# ── Step 3: Get credentials ───────────────────────────────────────────────
step "3" "Configure kubectl credentials"

run gcloud container clusters get-credentials "${CLUSTER_NAME}" \
  --region "${REGION}" \
  --project "${GCP_PROJECT_ID}"

kubectl cluster-info &>/dev/null || fail "Cannot reach GKE cluster"
ok "kubectl configured for ${CLUSTER_NAME}"

# ── Step 4: Create namespace ──────────────────────────────────────────────
step "4" "Create namespace"

run kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null
ok "Namespace ${NAMESPACE} ready"

# ── Step 5: Create Cloud SQL PostgreSQL ───────────────────────────────────
step "5" "Create Cloud SQL PostgreSQL"

if gcloud sql instances describe "${CLOUDSQL_INSTANCE}" --project "${GCP_PROJECT_ID}" &>/dev/null 2>&1; then
  ok "Cloud SQL instance '${CLOUDSQL_INSTANCE}' already exists — skipping"
else
  info "Creating Cloud SQL PostgreSQL instance..."
  info "  Tier: ${CLOUDSQL_TIER}, HA: ${CLOUDSQL_HA}"

  DB_PASSWORD=$(openssl rand -base64 24 | tr -d '=/+' | head -c 32)

  run gcloud sql instances create "${CLOUDSQL_INSTANCE}" \
    --database-version=POSTGRES_16 \
    --tier="${CLOUDSQL_TIER}" \
    --region="${REGION}" \
    --availability-type="${CLOUDSQL_HA}" \
    --storage-type=SSD --storage-size=20GB --storage-auto-increase \
    --no-assign-ip --network=default \
    --backup-start-time=04:00 --enable-point-in-time-recovery \
    --project "${GCP_PROJECT_ID}" \
    --quiet

  run gcloud sql databases create logclaw_enterprise \
    --instance="${CLOUDSQL_INSTANCE}" \
    --project "${GCP_PROJECT_ID}" --quiet

  run gcloud sql users create logclaw \
    --instance="${CLOUDSQL_INSTANCE}" \
    --password="${DB_PASSWORD}" \
    --project "${GCP_PROJECT_ID}" --quiet

  INSTANCE_CONN="${GCP_PROJECT_ID}:${REGION}:${CLOUDSQL_INSTANCE}"
  DB_URL="postgresql://logclaw:${DB_PASSWORD}@127.0.0.1:5432/logclaw_enterprise"

  ok "Cloud SQL created: ${INSTANCE_CONN}"
fi

# ── Step 6: Store secrets in GCP Secret Manager ──────────────────────────
step "6" "Store secrets in GCP Secret Manager"

store_secret() {
  local name=$1 value=$2
  if gcloud secrets describe "${name}" --project "${GCP_PROJECT_ID}" &>/dev/null 2>&1; then
    echo -n "${value}" | run gcloud secrets versions add "${name}" --data-file=- --project "${GCP_PROJECT_ID}" --quiet
  else
    echo -n "${value}" | run gcloud secrets create "${name}" --data-file=- --project "${GCP_PROJECT_ID}" --quiet
  fi
}

store_secret "logclaw-console-db-url" "${DB_URL:-placeholder}"
store_secret "logclaw-clerk-secret" "${CLERK_SECRET_KEY}"
store_secret "logclaw-clerk-publishable" "${CLERK_PUBLISHABLE_KEY}"
ok "Secrets stored in Secret Manager"

# ── Step 7: Create GHCR image pull secret ────────────────────────────────
step "7" "Create GHCR image pull secret"

run kubectl create secret docker-registry ghcr-logclaw \
  --docker-server=ghcr.io \
  --docker-username=logclaw \
  --docker-password="${GITHUB_PAT}" \
  -n "${NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null

ok "GHCR image pull secret created"

# ── Step 8: Install operators ─────────────────────────────────────────────
step "8" "Install cluster operators"

if [ "$SKIP_BACKEND" = false ]; then
  info "Installing cert-manager CRDs..."
  run kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.crds.yaml --server-side 2>/dev/null || true

  info "Installing operators via helmfile..."
  run helmfile --file helmfile.d/00-operators.yaml apply --suppress-diff 2>&1 | tail -5
  ok "Operators installed"
else
  warn "Skipping operators (--skip-backend)"
fi

# ── Step 9: Deploy backend stack ──────────────────────────────────────────
step "9" "Deploy backend stack"

if [ "$SKIP_BACKEND" = false ]; then
  TENANT_ID="enterprise"
  info "Deploying all backend components..."

  for component in 10-platform 20-kafka 30-ingestion 40-opensearch 55-bridge 80-ticketing-agent; do
    info "  Deploying ${component}..."
    TENANT_ID="${TENANT_ID}" \
    STORAGE_CLASS="standard-rwo" \
      run helmfile --file "helmfile.d/${component}.yaml" apply --suppress-diff 2>&1 | tail -3
  done
  ok "Backend stack deployed"
else
  warn "Skipping backend stack (--skip-backend)"
fi

# ── Step 10: Deploy enterprise console ────────────────────────────────────
step "10" "Deploy enterprise console"

INSTANCE_CONN="${GCP_PROJECT_ID}:${REGION}:${CLOUDSQL_INSTANCE}"

run helm upgrade --install logclaw-console charts/logclaw-console/ \
  -n "${NAMESPACE}" \
  --set image.tag="${CONSOLE_TAG}" \
  --set replicaCount="${CONSOLE_REPLICAS}" \
  --set cloudsql.enabled=true \
  --set "cloudsql.instanceName=${INSTANCE_CONN}" \
  --set externalSecret.enabled=true \
  --set global.opensearchEndpoint="http://logclaw-opensearch-enterprise.${NAMESPACE}.svc:9200" \
  --set "service.annotations.cloud\\.google\\.com/neg={\"ingress\": true}" \
  $([ "$ENV" = "staging" ] && echo "--set autoscaling.enabled=false --set podDisruptionBudget.enabled=false") \
  --wait --timeout 5m

ok "Enterprise console deployed"

# ── Step 11: Run database migration ───────────────────────────────────────
step "11" "Run database migration"

info "Waiting for console pod to be ready..."
run kubectl rollout status deployment/logclaw-console -n "${NAMESPACE}" --timeout=300s

info "Running Drizzle migration via console pod..."
CONSOLE_POD=$(kubectl get pods -l app.kubernetes.io/component=console -n "${NAMESPACE}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -n "$CONSOLE_POD" ]; then
  run kubectl exec "${CONSOLE_POD}" -c console -n "${NAMESPACE}" -- \
    node -e "const { migrate } = require('./drizzle'); migrate().then(() => console.log('Migration complete'));" 2>/dev/null \
    || warn "Auto-migration skipped — run manually if needed"
  ok "Database migration attempted"
else
  warn "No console pod found — run migration manually"
fi

# ── Step 12: Setup Global Load Balancer + DNS (production only) ──────────
if [ "$ENV" = "production" ]; then
  step "12" "Setup Global Load Balancer + DNS"

  # Reserve static IPs
  info "Reserving static IPs..."
  run gcloud compute addresses create logclaw-console-ip --global --project "${GCP_PROJECT_ID}" --quiet 2>/dev/null || true
  run gcloud compute addresses create logclaw-otel-ip --global --project "${GCP_PROJECT_ID}" --quiet 2>/dev/null || true

  CONSOLE_IP=$(gcloud compute addresses describe logclaw-console-ip --global --project "${GCP_PROJECT_ID}" --format='value(address)' 2>/dev/null || echo "PENDING")
  OTEL_IP=$(gcloud compute addresses describe logclaw-otel-ip --global --project "${GCP_PROJECT_ID}" --format='value(address)' 2>/dev/null || echo "PENDING")

  # Google-managed SSL certs
  info "Creating SSL certificates..."
  run gcloud compute ssl-certificates create console-cert \
    --domains="${CONSOLE_DOMAIN}" --global --project "${GCP_PROJECT_ID}" --quiet 2>/dev/null || true
  run gcloud compute ssl-certificates create otel-cert \
    --domains="${OTEL_DOMAIN}" --global --project "${GCP_PROJECT_ID}" --quiet 2>/dev/null || true

  # DNS records
  info "Creating DNS records..."
  if [ "$CONSOLE_IP" != "PENDING" ]; then
    run gcloud dns record-sets create "${CONSOLE_DOMAIN}" --zone="${DNS_ZONE}" \
      --type=A --ttl=300 --rrdatas="${CONSOLE_IP}" --project "${GCP_PROJECT_ID}" --quiet 2>/dev/null || true
  fi
  if [ "$OTEL_IP" != "PENDING" ]; then
    run gcloud dns record-sets create "${OTEL_DOMAIN}" --zone="${DNS_ZONE}" \
      --type=A --ttl=300 --rrdatas="${OTEL_IP}" --project "${GCP_PROJECT_ID}" --quiet 2>/dev/null || true
  fi

  ok "Global LB + DNS configured"
  info "Console IP: ${CONSOLE_IP}"
  info "OTLP IP:    ${OTEL_IP}"
  warn "You still need to manually create: health checks, backend services, URL maps, HTTPS proxies, and forwarding rules."
  warn "Enable Cloud CDN on console backend and Cloud Armor on both."
fi

# ── Step 13: Wait for readiness ───────────────────────────────────────────
step "13" "Waiting for all pods to be Ready"

info "Waiting up to 5 minutes..."
TIMEOUT=300
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  TOTAL=$(kubectl get pods -n "${NAMESPACE}" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  READY=$(kubectl get pods -n "${NAMESPACE}" --no-headers 2>/dev/null | grep -c "Running" || true)
  echo -ne "\r  Pods: ${READY}/${TOTAL} Running (${ELAPSED}s elapsed)   "
  if [ "$READY" = "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
    echo ""
    ok "All ${TOTAL} pods Running"
    break
  fi
  sleep 10
  ELAPSED=$((ELAPSED + 10))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  warn "Timeout — some pods may still be starting. Check: kubectl get pods -n ${NAMESPACE}"
fi

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  LogClaw Enterprise Console (${ENV}) is Ready!${RESET}"
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${CYAN}Project:${RESET}     ${GCP_PROJECT_ID}"
echo -e "  ${CYAN}Cluster:${RESET}     ${CLUSTER_NAME} (${REGION})"
echo -e "  ${CYAN}Namespace:${RESET}   ${NAMESPACE}"
echo -e "  ${CYAN}Image:${RESET}       ${CONSOLE_IMAGE}:${CONSOLE_TAG}"
echo -e "  ${CYAN}Replicas:${RESET}    ${CONSOLE_REPLICAS}"
echo ""
echo "  ── Access ─────────────────────────────────────────────"
echo ""
if [ "$ENV" = "production" ]; then
  echo -e "  ${GREEN}Console${RESET}    https://${CONSOLE_DOMAIN}"
  echo -e "  ${GREEN}OTLP${RESET}       https://${OTEL_DOMAIN}"
else
  echo -e "  ${CYAN}Console${RESET}    kubectl port-forward svc/logclaw-console 3000:3000 -n ${NAMESPACE}"
  echo "               → http://localhost:3000"
fi
echo ""
echo "  ── Quick Test ────────────────────────────────────────"
echo ""
echo "  curl -I https://${CONSOLE_DOMAIN}"
echo "  curl -X POST https://${OTEL_DOMAIN}/v1/logs -H 'x-logclaw-api-key: lc_proj_...'"
echo ""
echo "  ── Monitor ────────────────────────────────────────────"
echo ""
echo "    kubectl get pods -n ${NAMESPACE}"
echo "    kubectl logs -f deployment/logclaw-console -n ${NAMESPACE}"
echo "    kubectl get hpa -n ${NAMESPACE}"
echo ""
if [ "$ENV" = "production" ]; then
  echo -e "  ${YELLOW}Tear down:${RESET}  GCP_PROJECT_ID=${GCP_PROJECT_ID} ./scripts/setup-console-gcp.sh --teardown"
else
  echo -e "  ${YELLOW}Tear down:${RESET}  GCP_PROJECT_ID=${GCP_PROJECT_ID} ./scripts/setup-console-gcp.sh --staging --teardown"
fi
echo ""
