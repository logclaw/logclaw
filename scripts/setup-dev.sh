#!/usr/bin/env bash
# ============================================================================
# LogClaw — One-Command Local Development Setup
# Usage: ./scripts/setup-dev.sh
# ============================================================================
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

CLUSTER_NAME="logclaw-dev"
NAMESPACE="logclaw-dev-local"
TENANT_ID="dev-local"

info()  { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fail()  { echo -e "${RED}[FAIL]${RESET}  $*"; exit 1; }
step()  { echo -e "\n${BOLD}━━━ Step $1: $2 ━━━${RESET}"; }

# ── Preflight checks ──────────────────────────────────────────────────
step "0" "Preflight checks"

MISSING=()
for cmd in docker kind kubectl helm helmfile node python3; do
  if ! command -v "$cmd" &>/dev/null; then
    MISSING+=("$cmd")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  warn "Missing tools: ${MISSING[*]}"
  echo ""
  echo "Install with Homebrew (macOS):"
  echo "  brew install helm helmfile kind kubectl node python3"
  echo "  Docker Desktop: https://docker.com/products/docker-desktop"
  fail "Please install missing tools and re-run."
fi

if ! docker info &>/dev/null; then
  fail "Docker is not running. Start Docker Desktop first."
fi

ok "All prerequisites found"

# ── Step 1: Kind cluster ──────────────────────────────────────────────
step "1" "Create Kind cluster"

if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  ok "Kind cluster '${CLUSTER_NAME}' already exists — skipping creation"
else
  info "Creating Kind cluster '${CLUSTER_NAME}'..."
  kind create cluster --name "${CLUSTER_NAME}" --wait 60s
  ok "Kind cluster created"
fi

kubectl cluster-info --context "kind-${CLUSTER_NAME}" &>/dev/null || fail "Cannot reach cluster"
ok "Cluster reachable"

# ── Step 2: Cert-Manager CRDs ────────────────────────────────────────
step "2" "Install cert-manager CRDs"

if kubectl get crd certificates.cert-manager.io &>/dev/null 2>&1; then
  ok "cert-manager CRDs already installed"
else
  info "Installing cert-manager CRDs..."
  kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.crds.yaml --server-side 2>/dev/null
  ok "cert-manager CRDs installed"
fi

# ── Step 3: Operators ─────────────────────────────────────────────────
step "3" "Install cluster operators (Strimzi, ESO, OpenSearch)"

info "Running helmfile for operators..."
TENANT_ID="${TENANT_ID}" helmfile --file helmfile.d/00-operators.yaml apply --suppress-diff 2>&1 | tail -5
ok "Operators installed"

# ── Step 4: Namespace + Platform ──────────────────────────────────────
step "4" "Create tenant namespace and platform resources"

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null
ok "Namespace ${NAMESPACE} ready"

# ── Step 5: Core infrastructure ──────────────────────────────────────
step "5" "Deploy core infrastructure (Kafka, OpenSearch, Ingestion)"

for component in 20-kafka 30-ingestion 40-opensearch; do
  info "Deploying ${component}..."
  TENANT_ID="${TENANT_ID}" STORAGE_CLASS=standard helmfile --file "helmfile.d/${component}.yaml" apply --suppress-diff 2>&1 | tail -3
done
ok "Core infrastructure deployed"

# ── Step 6: ML Engine + Airflow ──────────────────────────────────────
step "6" "Deploy ML Engine and Airflow"

for component in 60-ml-engine 70-airflow; do
  info "Deploying ${component}..."
  TENANT_ID="${TENANT_ID}" helmfile --file "helmfile.d/${component}.yaml" apply --suppress-diff 2>&1 | tail -3
done
ok "ML Engine and Airflow deployed"

# ── Step 7: Bridge + Ticketing Agent ─────────────────────────────────
step "7" "Deploy Bridge and Ticketing Agent"

for component in 75-bridge 80-ticketing-agent; do
  info "Deploying ${component}..."
  TENANT_ID="${TENANT_ID}" helmfile --file "helmfile.d/${component}.yaml" apply --suppress-diff 2>&1 | tail -3
done
ok "Bridge and Ticketing Agent deployed"

# ── Step 8: Dashboard ────────────────────────────────────────────────
step "8" "Build and deploy Dashboard"

info "Building Dashboard Docker image..."
docker build -t logclaw-dashboard:dev apps/dashboard/ -q
kind load docker-image logclaw-dashboard:dev --name "${CLUSTER_NAME}"
TENANT_ID="${TENANT_ID}" helmfile --file helmfile.d/90-dashboard.yaml apply --suppress-diff 2>&1 | tail -3
ok "Dashboard deployed"

# ── Step 9: Wait for readiness ───────────────────────────────────────
step "9" "Waiting for all pods to be Ready"

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
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  warn "Timeout — some pods may still be starting. Check: kubectl get pods -n ${NAMESPACE}"
fi

# ── Step 10: Smoke test ──────────────────────────────────────────────
step "10" "Smoke test — send a test log"

info "Port-forwarding ingestion service..."
kubectl port-forward svc/logclaw-ingestion-${TENANT_ID} 8080:8080 -n "${NAMESPACE}" &>/dev/null &
PF_PID=$!
sleep 3

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  -d '{"timestamp":"2026-03-03T12:00:00Z","level":"ERROR","service":"test-service","message":"Smoke test log from setup script","trace_id":"00000000000000000000000000000001","span_id":"0000000000000001"}' 2>/dev/null || echo "000")

kill $PF_PID 2>/dev/null || true

if [ "$STATUS" = "200" ]; then
  ok "Log ingestion working (HTTP ${STATUS})"
else
  warn "Ingestion returned HTTP ${STATUS} — may need a moment to start"
fi

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  LogClaw dev environment is ready!${RESET}"
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo ""
echo "  Access the services:"
echo ""
echo -e "  ${CYAN}Dashboard${RESET}        kubectl port-forward svc/logclaw-dashboard-${TENANT_ID} 3000:3000 -n ${NAMESPACE}"
echo "                   → http://localhost:3000"
echo ""
echo -e "  ${CYAN}Log Ingestion${RESET}    kubectl port-forward svc/logclaw-ingestion-${TENANT_ID} 8080:8080 -n ${NAMESPACE}"
echo "                   → POST http://localhost:8080 (Header: X-Tenant-ID: ${TENANT_ID})"
echo ""
echo -e "  ${CYAN}OpenSearch${RESET}       kubectl port-forward svc/logclaw-opensearch-${TENANT_ID} 9200:9200 -n ${NAMESPACE}"
echo "                   → http://localhost:9200"
echo ""
echo -e "  ${CYAN}Airflow${RESET}          kubectl port-forward svc/logclaw-airflow-${TENANT_ID}-webserver 8080:8080 -n ${NAMESPACE}"
echo "                   → http://localhost:8080 (admin/admin)"
echo ""
echo "  Generate sample logs:"
echo ""
echo "    python3 scripts/generate-applepay-logs.py     # 500 Apple Pay OTel logs"
echo "    python3 scripts/generate-applepay-logs-2.py   # 400 infra/security error logs"
echo ""
echo "  Ingest logs:"
echo ""
echo "    kubectl port-forward svc/logclaw-ingestion-${TENANT_ID} 8080:8080 -n ${NAMESPACE} &"
echo '    curl -X POST http://localhost:8080 \'
echo '      -H "Content-Type: application/json" \'
echo "      -H \"X-Tenant-ID: ${TENANT_ID}\" \\"
echo '      -d @scripts/applepay-otel-500.json'
echo ""
echo "  Monitor pods:"
echo ""
echo "    kubectl get pods -n ${NAMESPACE}"
echo "    kubectl logs -f deployment/logclaw-bridge-${TENANT_ID} -n ${NAMESPACE}"
echo ""
echo -e "  ${YELLOW}Tear down:${RESET}  make uninstall TENANT_ID=${TENANT_ID} && make kind-delete"
echo ""
