#!/usr/bin/env bash
# ============================================================================
# LogClaw — Log Ingestion Helper (via OTel Collector OTLP HTTP endpoint)
# Usage:
#   ./scripts/ingest-logs.sh <json-file>           # Ingest a JSON log file
#   ./scripts/ingest-logs.sh --generate             # Generate + ingest sample logs
#   ./scripts/ingest-logs.sh --smoke                # Send a single test log
# ============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-logclaw}"
TENANT_ID="${TENANT_ID:-logclaw}"
OTEL_PORT="${OTEL_PORT:-4318}"
BATCH_SIZE="${BATCH_SIZE:-50}"

GREEN="\033[32m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

usage() {
  echo "Usage:"
  echo "  $0 <file.json>     Ingest a JSON array of logs"
  echo "  $0 --generate      Generate Apple Pay sample logs and ingest"
  echo "  $0 --smoke         Send a single test log"
  echo ""
  echo "Environment variables:"
  echo "  NAMESPACE          Kubernetes namespace (default: logclaw)"
  echo "  TENANT_ID          Tenant ID (default: logclaw)"
  echo "  OTEL_PORT          Local port for OTel Collector (default: 4318)"
  exit 1
}

ensure_port_forward() {
  if ! curl -s -o /dev/null -w "" http://localhost:${OTEL_PORT}/v1/logs 2>/dev/null; then
    echo -e "${CYAN}Starting port-forward to OTel Collector...${RESET}"
    kubectl port-forward "svc/logclaw-logclaw-otel-collector" "${OTEL_PORT}:4318" -n "${NAMESPACE}" &>/dev/null &
    PF_PID=$!
    sleep 3
    trap "kill ${PF_PID} 2>/dev/null || true" EXIT
  fi
}

smoke_test() {
  ensure_port_forward
  echo -e "${CYAN}Sending smoke test log via OTLP...${RESET}"
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:${OTEL_PORT}/v1/logs" \
    -H "Content-Type: application/json" \
    -d "{
      \"resourceLogs\": [{
        \"resource\": {\"attributes\": [{\"key\": \"service.name\", \"value\": {\"stringValue\": \"smoke-test\"}}]},
        \"scopeLogs\": [{\"logRecords\": [{
          \"timeUnixNano\": \"$(date +%s)000000000\",
          \"severityText\": \"ERROR\",
          \"body\": {\"stringValue\": \"Smoke test from ingest-logs.sh\"}
        }]}]
      }]
    }")
  if [ "$STATUS" = "200" ]; then
    echo -e "${GREEN}✓ Smoke test passed (HTTP 200)${RESET}"
  else
    echo -e "${RED}✗ Smoke test failed (HTTP ${STATUS})${RESET}"
    exit 1
  fi
}

ingest_file() {
  local FILE="$1"
  if [ ! -f "$FILE" ]; then
    echo -e "${RED}File not found: ${FILE}${RESET}"
    exit 1
  fi

  ensure_port_forward

  echo -e "${CYAN}Ingesting logs from ${FILE} via OTel Collector...${RESET}"
  python3 -c "
import json, urllib.request, time, sys

with open('${FILE}') as f:
    logs = json.load(f)

total = len(logs)
print(f'Total logs: {total}')

success = errors = 0
for i, log in enumerate(logs):
    data = json.dumps(log).encode('utf-8')
    req = urllib.request.Request(
        'http://localhost:${OTEL_PORT}/v1/logs',
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        urllib.request.urlopen(req, timeout=5)
        success += 1
    except Exception as e:
        errors += 1
        if errors <= 3:
            print(f'  Error: {e}', file=sys.stderr)
    if (i + 1) % ${BATCH_SIZE} == 0 or i == total - 1:
        pct = int((i + 1) / total * 100)
        print(f'  Progress: {i+1}/{total} ({pct}%) — success={success} errors={errors}')
        time.sleep(0.05)

print(f'\nDone! {success} ingested, {errors} errors')
sys.exit(1 if errors > 0 else 0)
"
}

generate_and_ingest() {
  echo -e "${CYAN}Generating Apple Pay sample logs...${RESET}"

  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

  if [ -f "${SCRIPT_DIR}/applepay-otel-500.json" ]; then
    echo "Found existing logs at scripts/applepay-otel-500.json"
  else
    python3 "${SCRIPT_DIR}/generate-applepay-logs.py"
  fi

  ingest_file "${SCRIPT_DIR}/applepay-otel-500.json"

  if [ -f "${SCRIPT_DIR}/applepay-otel-400-batch2.json" ]; then
    echo ""
    echo -e "${CYAN}Also ingesting batch 2 (infra/security errors)...${RESET}"
    ingest_file "${SCRIPT_DIR}/applepay-otel-400-batch2.json"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────
case "${1:-}" in
  --smoke)    smoke_test ;;
  --generate) generate_and_ingest ;;
  --help|-h)  usage ;;
  "")         usage ;;
  *)          ingest_file "$1" ;;
esac
