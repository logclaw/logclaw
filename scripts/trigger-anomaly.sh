#!/bin/bash
# trigger-anomaly.sh — Send traffic pattern that triggers the bridge anomaly detector
#
# Strategy: Send 5 baseline batches with low error rate (10%), then 1 spike batch
# with 100% errors. The z-score anomaly detector needs >= 3 buckets and z >= 2.0.
#
# Buckets are 10s wide; we wait 12s between batches to land in different buckets.
# Expected rates:  [0.1, 0.1, 0.1, 0.1, 0.1, 1.0]
# Expected z-score: ~2.50  (threshold = 2.0)

VECTOR_URL="${VECTOR_URL:-http://localhost:8080}"
SERVICE="payment-gateway"  # service name for anomaly tracking

generate_baseline_batch() {
  local batch_num=$1
  local ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local logs="["
  # 18 INFO logs
  for i in $(seq 1 18); do
    logs+="{\"timestamp\":\"$ts\",\"service\":\"$SERVICE\",\"level\":\"INFO\",\"message\":\"Request processed successfully (batch=$batch_num seq=$i)\",\"host\":\"web-server-0$((i % 3 + 1))\",\"endpoint\":\"/api/v1/payments\",\"response_time_ms\":$((50 + RANDOM % 200)),\"tenant_id\":\"dev-local\",\"http.status_code\":200},"
  done
  # 2 ERROR logs
  for i in $(seq 1 2); do
    logs+="{\"timestamp\":\"$ts\",\"service\":\"$SERVICE\",\"level\":\"ERROR\",\"message\":\"Connection timeout to database (batch=$batch_num error=$i)\",\"host\":\"web-server-0$((i % 3 + 1))\",\"endpoint\":\"/api/v1/payments\",\"response_time_ms\":$((5000 + RANDOM % 5000)),\"tenant_id\":\"dev-local\"},"
  done
  # Remove trailing comma and close array
  logs="${logs%,}]"
  echo "$logs"
}

generate_spike_batch() {
  local ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local logs="["
  # 20 ERROR/FATAL logs
  for i in $(seq 1 15); do
    logs+="{\"timestamp\":\"$ts\",\"service\":\"$SERVICE\",\"level\":\"ERROR\",\"message\":\"CRITICAL: Database connection pool exhausted - all connections failed (spike seq=$i)\",\"host\":\"web-server-0$((i % 3 + 1))\",\"endpoint\":\"/api/v1/payments\",\"response_time_ms\":30000,\"tenant_id\":\"dev-local\"},"
  done
  for i in $(seq 1 5); do
    logs+="{\"timestamp\":\"$ts\",\"service\":\"$SERVICE\",\"level\":\"FATAL\",\"message\":\"FATAL: Service crash - unrecoverable database failure (spike fatal=$i)\",\"host\":\"web-server-0$((i % 3 + 1))\",\"endpoint\":\"/api/v1/payments\",\"response_time_ms\":0,\"tenant_id\":\"dev-local\"},"
  done
  logs="${logs%,}]"
  echo "$logs"
}

echo "=== LogClaw Anomaly Trigger Script ==="
echo "Target: $VECTOR_URL"
echo "Service: $SERVICE"
echo ""

# Phase 1: Baseline traffic (5 batches, 12s apart)
echo ">>> Phase 1: Sending baseline traffic (5 batches x 20 logs, 10% error rate)"
for batch in 1 2 3 4 5; do
  payload=$(generate_baseline_batch $batch)
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$VECTOR_URL" \
    -H "Content-Type: application/json" \
    -d "$payload")
  echo "  Batch $batch/5 sent (HTTP $status) — $(date +%H:%M:%S)"
  if [ "$batch" -lt 5 ]; then
    echo "  Waiting 12s for next bucket..."
    sleep 12
  fi
done

echo ""
echo ">>> Phase 2: Waiting 12s before spike..."
sleep 12

# Phase 2: Error spike (1 batch of all errors)
echo ">>> Phase 2: Sending ERROR SPIKE (20 ERROR/FATAL logs)"
payload=$(generate_spike_batch)
status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$VECTOR_URL" \
  -H "Content-Type: application/json" \
  -d "$payload")
echo "  Spike batch sent (HTTP $status) — $(date +%H:%M:%S)"

echo ""
echo ">>> Waiting 15s for pipeline processing..."
sleep 15

echo ""
echo "=== Done! Check anomaly-events topic and ticketing agent ==="
