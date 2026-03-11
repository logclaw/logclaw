#!/usr/bin/env bash
# ============================================================================
# LogClaw — GKE Production Deployment
# Usage: GCP_PROJECT_ID=<your-project> ./scripts/setup-gke.sh
# Flags: --teardown | --skip-build | --zone <zone>
# ============================================================================
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

# ── Defaults ────────────────────────────────────────────────────────────────
CLUSTER_NAME="logclaw-prod"
ZONE="us-central1-a"
REGION="us-central1"
MACHINE_TYPE="e2-standard-4"
MIN_NODES=2
MAX_NODES=4
BOOT_DISK_SIZE="100"
TENANT_ID="gke-prod"
NAMESPACE="logclaw-${TENANT_ID}"
AR_REPO="logclaw"
TEARDOWN=false
SKIP_BUILD=false

# ── Parse flags ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --teardown)  TEARDOWN=true; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --zone)      ZONE="$2"; REGION="${2%-*}"; shift 2 ;;
    *)           echo "Unknown flag: $1"; exit 1 ;;
  esac
done

info()  { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fail()  { echo -e "${RED}[FAIL]${RESET}  $*"; exit 1; }
step()  { echo -e "\n${BOLD}━━━ Step $1: $2 ━━━${RESET}"; }

# ── Require GCP_PROJECT_ID ──────────────────────────────────────────────────
if [ -z "${GCP_PROJECT_ID:-}" ]; then
  fail "GCP_PROJECT_ID is required. Usage: GCP_PROJECT_ID=my-project ./scripts/setup-gke.sh"
fi

AR_HOSTNAME="${REGION}-docker.pkg.dev"
AR_FULL="${AR_HOSTNAME}/${GCP_PROJECT_ID}/${AR_REPO}"

# ═══════════════════════════════════════════════════════════════════════════
# TEARDOWN MODE
# ═══════════════════════════════════════════════════════════════════════════
if [ "$TEARDOWN" = true ]; then
  echo ""
  echo -e "${RED}${BOLD}  ⚠  TEARDOWN MODE — This will destroy the GKE cluster and all data${RESET}"
  echo ""
  read -p "  Type 'yes' to confirm: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 0
  fi

  info "Deleting GKE cluster '${CLUSTER_NAME}'..."
  gcloud container clusters delete "${CLUSTER_NAME}" \
    --zone "${ZONE}" \
    --project "${GCP_PROJECT_ID}" \
    --quiet 2>/dev/null || warn "Cluster not found or already deleted"

  info "Deleting Artifact Registry '${AR_REPO}'..."
  gcloud artifacts repositories delete "${AR_REPO}" \
    --location "${REGION}" \
    --project "${GCP_PROJECT_ID}" \
    --quiet 2>/dev/null || warn "Registry not found or already deleted"

  ok "Teardown complete"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════
# DEPLOYMENT MODE
# ═══════════════════════════════════════════════════════════════════════════

# ── Step 0: Preflight ──────────────────────────────────────────────────────
step "0" "Preflight checks"

MISSING=()
for cmd in gcloud kubectl helm helmfile docker; do
  if ! command -v "$cmd" &>/dev/null; then
    MISSING+=("$cmd")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  fail "Missing tools: ${MISSING[*]}. Install them and re-run."
fi

# Verify gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 | grep -q "@"; then
  fail "Not authenticated with gcloud. Run: gcloud auth login"
fi

gcloud config set project "${GCP_PROJECT_ID}" --quiet
ok "All prerequisites found (project: ${GCP_PROJECT_ID})"

# ── Step 1: Enable GCP APIs ────────────────────────────────────────────────
step "1" "Enable required GCP APIs"

APIS=(
  "container.googleapis.com"
  "compute.googleapis.com"
  "artifactregistry.googleapis.com"
)

for api in "${APIS[@]}"; do
  info "Enabling ${api}..."
  gcloud services enable "${api}" --project "${GCP_PROJECT_ID}" --quiet
done
ok "All APIs enabled"

# ── Step 2: Create GKE cluster ─────────────────────────────────────────────
step "2" "Create GKE cluster"

if gcloud container clusters describe "${CLUSTER_NAME}" --zone "${ZONE}" --project "${GCP_PROJECT_ID}" &>/dev/null 2>&1; then
  ok "GKE cluster '${CLUSTER_NAME}' already exists — skipping creation"
else
  info "Creating GKE cluster '${CLUSTER_NAME}' in ${ZONE}..."
  info "  Machine type: ${MACHINE_TYPE} (4 vCPU, 16 GB each)"
  info "  Nodes: ${MIN_NODES} (autoscales to ${MAX_NODES})"
  info "  Estimated cost: ~\$0.30/hr (~\$220/month)"
  echo ""

  gcloud container clusters create "${CLUSTER_NAME}" \
    --zone "${ZONE}" \
    --project "${GCP_PROJECT_ID}" \
    --machine-type "${MACHINE_TYPE}" \
    --num-nodes "${MIN_NODES}" \
    --enable-autoscaling \
    --min-nodes "${MIN_NODES}" \
    --max-nodes "${MAX_NODES}" \
    --release-channel "regular" \
    --enable-vertical-pod-autoscaling \
    --enable-shielded-nodes \
    --shielded-secure-boot \
    --shielded-integrity-monitoring \
    --disk-type "pd-ssd" \
    --disk-size "${BOOT_DISK_SIZE}" \
    --enable-ip-alias \
    --labels "env=production,product=logclaw,managed-by=setup-gke" \
    --metadata disable-legacy-endpoints=true \
    --no-enable-basic-auth \
    --workload-pool "${GCP_PROJECT_ID}.svc.id.goog" \
    --quiet

  ok "GKE cluster created"
fi

# ── Step 3: Get credentials ────────────────────────────────────────────────
step "3" "Configure kubectl credentials"

gcloud container clusters get-credentials "${CLUSTER_NAME}" \
  --zone "${ZONE}" \
  --project "${GCP_PROJECT_ID}"

kubectl cluster-info &>/dev/null || fail "Cannot reach GKE cluster"
ok "kubectl configured for ${CLUSTER_NAME}"

# ── Step 4: Create Artifact Registry ──────────────────────────────────────
step "4" "Create Artifact Registry"

if gcloud artifacts repositories describe "${AR_REPO}" --location "${REGION}" --project "${GCP_PROJECT_ID}" &>/dev/null 2>&1; then
  ok "Artifact Registry '${AR_REPO}' already exists"
else
  info "Creating Docker repository in Artifact Registry..."
  gcloud artifacts repositories create "${AR_REPO}" \
    --repository-format docker \
    --location "${REGION}" \
    --project "${GCP_PROJECT_ID}" \
    --description "LogClaw container images" \
    --quiet
  ok "Artifact Registry created: ${AR_FULL}"
fi

# Configure Docker auth for Artifact Registry
gcloud auth configure-docker "${AR_HOSTNAME}" --quiet 2>/dev/null
ok "Docker authenticated with Artifact Registry"

# ── Step 5: Build and push Dashboard image ────────────────────────────────
step "5" "Build and push Dashboard image"

DASHBOARD_IMAGE="${AR_FULL}/dashboard:latest"

if [ "$SKIP_BUILD" = true ]; then
  warn "Skipping build (--skip-build). Using ghcr.io/logclaw/dashboard:latest"
  DASHBOARD_IMAGE="ghcr.io/logclaw/dashboard:latest"
else
  info "Building Dashboard Docker image..."
  docker build -t "${DASHBOARD_IMAGE}" apps/dashboard/ -q
  info "Pushing to Artifact Registry..."
  docker push "${DASHBOARD_IMAGE}" -q 2>/dev/null || docker push "${DASHBOARD_IMAGE}"
  ok "Dashboard image pushed: ${DASHBOARD_IMAGE}"
fi

# ── Step 6: Install cert-manager CRDs ──────────────────────────────────────
step "6" "Install cert-manager CRDs"

if kubectl get crd certificates.cert-manager.io &>/dev/null 2>&1; then
  ok "cert-manager CRDs already installed"
else
  info "Installing cert-manager CRDs..."
  kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.crds.yaml --server-side 2>/dev/null
  ok "cert-manager CRDs installed"
fi

# ── Step 7: Install operators ─────────────────────────────────────────────
step "7" "Install cluster operators (Strimzi, ESO, OpenSearch)"

info "Running helmfile for operators..."
TENANT_ID="${TENANT_ID}" helmfile --file helmfile.d/00-operators.yaml apply --suppress-diff 2>&1 | tail -5
ok "Operators installed"

# ── Step 8: Create namespace ──────────────────────────────────────────────
step "8" "Create tenant namespace"

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null
ok "Namespace ${NAMESPACE} ready"

# ── Step 9: Deploy full stack ─────────────────────────────────────────────
step "9" "Deploy full LogClaw stack"

info "Deploying all components via helmfile..."

for component in 10-platform 20-kafka 30-ingestion 40-opensearch 50-flink 60-ml-engine 70-airflow 75-bridge 80-ticketing-agent 90-dashboard; do
  info "  Deploying ${component}..."
  TENANT_ID="${TENANT_ID}" \
  STORAGE_CLASS="standard-rwo" \
    helmfile --file "helmfile.d/${component}.yaml" apply --suppress-diff 2>&1 | tail -3
done
ok "Full stack deployed"

# ── Step 10: Wait for readiness ───────────────────────────────────────────
step "10" "Waiting for all pods to be Ready"

info "Waiting up to 10 minutes..."
TIMEOUT=600
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

# ── Step 11: Wait for Dashboard LoadBalancer IP ────────────────────────────
step "11" "Waiting for Dashboard external IP"

DASHBOARD_SVC="logclaw-dashboard-${TENANT_ID}"
LB_TIMEOUT=180
LB_ELAPSED=0
DASHBOARD_IP=""

while [ $LB_ELAPSED -lt $LB_TIMEOUT ]; do
  DASHBOARD_IP=$(kubectl get svc "${DASHBOARD_SVC}" -n "${NAMESPACE}" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [ -n "$DASHBOARD_IP" ]; then
    break
  fi
  echo -ne "\r  Waiting for LoadBalancer IP... (${LB_ELAPSED}s)   "
  sleep 10
  LB_ELAPSED=$((LB_ELAPSED + 10))
done

echo ""
if [ -n "$DASHBOARD_IP" ]; then
  ok "Dashboard available at http://${DASHBOARD_IP}:3000"
else
  warn "LoadBalancer IP not yet assigned. Check: kubectl get svc ${DASHBOARD_SVC} -n ${NAMESPACE}"
fi

# ── Step 12: Ingest sample data ───────────────────────────────────────────
step "12" "Ingest sample Apple Pay OTel logs"

info "Port-forwarding OTel Collector..."
kubectl port-forward svc/logclaw-logclaw-otel-collector 4318:4318 -n "${NAMESPACE}" &>/dev/null &
PF_PID=$!
sleep 5

# Generate sample logs if scripts exist
if [ -f scripts/generate-applepay-logs.py ] && [ -f scripts/generate-applepay-logs-2.py ]; then
  info "Generating 900 sample Apple Pay OTel logs..."
  python3 scripts/generate-applepay-logs.py 2>/dev/null || true
  python3 scripts/generate-applepay-logs-2.py 2>/dev/null || true

  for logfile in scripts/applepay-otel-500.json scripts/applepay-otel-400-batch2.json; do
    if [ -f "$logfile" ]; then
      COUNT=$(python3 -c "import json; print(len(json.load(open('$logfile'))))" 2>/dev/null || echo "?")
      info "  Ingesting ${logfile} (${COUNT} logs) via OTel Collector..."
      python3 -c "
import json, urllib.request
logs = json.load(open('$logfile'))
for log in logs:
    req = urllib.request.Request('http://localhost:4318/v1/logs',
        data=json.dumps(log).encode(),
        headers={'Content-Type': 'application/json'})
    try: urllib.request.urlopen(req, timeout=5)
    except: pass
" 2>/dev/null || warn "  Some logs may have failed to ingest"
    fi
  done
  ok "Sample logs ingested via OTel Collector"
else
  warn "Log generation scripts not found — skipping sample data"
fi

kill $PF_PID 2>/dev/null || true

# ── Summary ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  LogClaw GKE Production Environment is Ready!${RESET}"
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${CYAN}Project:${RESET}     ${GCP_PROJECT_ID}"
echo -e "  ${CYAN}Cluster:${RESET}     ${CLUSTER_NAME} (${ZONE})"
echo -e "  ${CYAN}Namespace:${RESET}   ${NAMESPACE}"
echo -e "  ${CYAN}Nodes:${RESET}       ${MIN_NODES}x ${MACHINE_TYPE} (autoscales to ${MAX_NODES})"
echo ""
echo "  ── Access Services ──────────────────────────────────────"
echo ""
if [ -n "$DASHBOARD_IP" ]; then
  echo -e "  ${GREEN}Dashboard${RESET}    http://${DASHBOARD_IP}:3000"
else
  echo -e "  ${CYAN}Dashboard${RESET}    kubectl port-forward svc/${DASHBOARD_SVC} 3333:3000 -n ${NAMESPACE}"
  echo "               → http://localhost:3333"
fi
echo ""
echo -e "  ${CYAN}OpenSearch${RESET}   kubectl port-forward svc/logclaw-opensearch-${TENANT_ID} 9200:9200 -n ${NAMESPACE}"
echo "               → http://localhost:9200"
echo ""
echo -e "  ${CYAN}Airflow${RESET}      kubectl port-forward svc/logclaw-airflow-${TENANT_ID}-webserver 8080:8080 -n ${NAMESPACE}"
echo "               → http://localhost:8080 (admin/admin)"
echo ""
echo -e "  ${CYAN}OTel Collector${RESET} kubectl port-forward svc/logclaw-logclaw-otel-collector 4318:4318 -n ${NAMESPACE}"
echo "               → POST http://localhost:4318/v1/logs (OTLP HTTP)"
echo ""
echo "  ── Scaling Guide ────────────────────────────────────────"
echo ""
echo "  Current:  ~50 customers, standard tier (~\$220/month)"
echo "  Growth:   Update tenant-gke-prod.yaml:"
echo "            - tier: \"ha\"  (3x replicas for all components)"
echo "            - Kafka: replicas: 3, size: \"50Gi\""
echo "            - OpenSearch: data replicas: 3, diskSize: \"100Gi\""
echo "            - Ingestion: replicaCount: 3"
echo "            - GKE autoscaler handles node scaling automatically"
echo ""
echo "  ── Monitor ────────────────────────────────────────────"
echo ""
echo "    kubectl get pods -n ${NAMESPACE}"
echo "    kubectl logs -f deployment/logclaw-bridge-${TENANT_ID} -n ${NAMESPACE}"
echo "    kubectl top pods -n ${NAMESPACE}"
echo ""
echo -e "  ${YELLOW}Tear down:${RESET}  GCP_PROJECT_ID=${GCP_PROJECT_ID} ./scripts/setup-gke.sh --teardown"
echo ""
