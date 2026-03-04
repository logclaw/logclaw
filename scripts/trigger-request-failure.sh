#!/bin/bash
# trigger-request-failure.sh — Send multi-service request traces with OTel context
#
# Simulates request lifecycle failures using OpenTelemetry trace context:
#   - trace_id  (32 hex chars)  — OTel standard
#   - span_id   (16 hex chars)  — OTel standard
#   - traceparent               — W3C header format (test case 2)
#
# Test cases:
#   1. OTel trace_id + span_id: CheckoutController → PaymentService → StripeGateway (500)
#   2. W3C traceparent format:  OrderService → InventoryService → ShippingService (timeout)
#   3. Second similar failure:  Same services, different trace — tests incident grouping
#
# Expected results:
#   - TICK-0001 created with request_flow, request_traces, root_cause
#   - TICK-0001 gets similar_count=2 after test case 3 (grouped)

VECTOR_URL="${VECTOR_URL:-http://localhost:8080}"
TENANT="dev-local"

# ── OTel ID generators ───────────────────────────────────────────────────────
# Generate a 32-char hex trace_id (OTel standard)
gen_trace_id() {
  printf '%08x%08x%08x%08x' $((RANDOM * RANDOM)) $((RANDOM * RANDOM)) $((RANDOM * RANDOM)) $((RANDOM * RANDOM))
}
# Generate a 16-char hex span_id (OTel standard)
gen_span_id() {
  printf '%08x%08x' $((RANDOM * RANDOM)) $((RANDOM * RANDOM))
}

send_logs() {
  local payload="$1"
  local label="$2"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$VECTOR_URL" \
    -H "Content-Type: application/json" \
    -d "$payload")
  echo "  [$label] sent (HTTP $status) — $(date +%H:%M:%S)"
}

echo "=== LogClaw Request Failure Trigger (OTel Traces) ==="
echo "Target: $VECTOR_URL"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Test Case 1: OTel trace_id + span_id — Payment failure (500 at StripeGateway)
# ═══════════════════════════════════════════════════════════════════════════════
echo ">>> Test 1: OTel trace_id — CheckoutController → PaymentService → StripeGateway"
TRACE1=$(gen_trace_id)
SPAN1_A=$(gen_span_id)
SPAN1_B=$(gen_span_id)
SPAN1_C=$(gen_span_id)
SPAN1_D=$(gen_span_id)
SPAN1_E=$(gen_span_id)
echo "  trace_id: $TRACE1"

TS=$(date -u +"%Y-%m-%dT%H:%M:%S")

# Log sequence: successful flow through CheckoutController and PaymentService,
# then failure at StripeGateway, error propagates back
PAYLOAD1=$(cat <<EOF
[
  {
    "timestamp": "${TS}.100Z", "level": "INFO",
    "service": "CheckoutController", "service.name": "CheckoutController",
    "trace_id": "$TRACE1", "span_id": "$SPAN1_A",
    "message": "Received checkout request for user alice@example.com",
    "http.method": "POST", "http.route": "/api/checkout",
    "http.status_code": 200, "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS}.150Z", "level": "INFO",
    "service": "CheckoutController", "service.name": "CheckoutController",
    "trace_id": "$TRACE1", "span_id": "$SPAN1_A",
    "message": "Cart validated: 3 items, total=\$149.99",
    "http.route": "/api/checkout", "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS}.200Z", "level": "INFO",
    "service": "PaymentService", "service.name": "PaymentService",
    "trace_id": "$TRACE1", "span_id": "$SPAN1_B",
    "message": "Processing payment for order ORD-78234",
    "http.method": "POST", "http.route": "/api/payments/charge",
    "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS}.250Z", "level": "INFO",
    "service": "PaymentService", "service.name": "PaymentService",
    "trace_id": "$TRACE1", "span_id": "$SPAN1_B",
    "message": "Calling StripeGateway for card ending 4242",
    "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS}.300Z", "level": "INFO",
    "service": "StripeGateway", "service.name": "StripeGateway",
    "trace_id": "$TRACE1", "span_id": "$SPAN1_C",
    "message": "Initiating Stripe charge request ch_3MqLfP2eZ",
    "http.method": "POST", "http.route": "/v1/charges",
    "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS}.800Z", "level": "ERROR",
    "service": "StripeGateway", "service.name": "StripeGateway",
    "trace_id": "$TRACE1", "span_id": "$SPAN1_C",
    "message": "Stripe API returned 500: Internal Server Error — rate limit exceeded on /v1/charges",
    "http.status_code": 500, "http.route": "/v1/charges",
    "error.type": "StripeAPIError", "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS}.810Z", "level": "ERROR",
    "service": "PaymentService", "service.name": "PaymentService",
    "trace_id": "$TRACE1", "span_id": "$SPAN1_D",
    "message": "Payment failed for order ORD-78234: upstream gateway error",
    "http.status_code": 502, "http.route": "/api/payments/charge",
    "error.type": "PaymentGatewayError", "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS}.820Z", "level": "ERROR",
    "service": "CheckoutController", "service.name": "CheckoutController",
    "trace_id": "$TRACE1", "span_id": "$SPAN1_E",
    "message": "Checkout failed for user alice@example.com — payment processing error",
    "http.status_code": 500, "http.route": "/api/checkout",
    "error.type": "CheckoutError", "tenant_id": "$TENANT"
  }
]
EOF
)

send_logs "$PAYLOAD1" "Test 1 — OTel trace"

echo ""
sleep 3

# ═══════════════════════════════════════════════════════════════════════════════
# Test Case 2: W3C traceparent format — Shipping timeout
# ═══════════════════════════════════════════════════════════════════════════════
echo ">>> Test 2: W3C traceparent — OrderService → InventoryService → ShippingService"
TRACE2=$(gen_trace_id)
SPAN2_A=$(gen_span_id)
SPAN2_B=$(gen_span_id)
SPAN2_C=$(gen_span_id)
SPAN2_D=$(gen_span_id)
# W3C traceparent format: version-trace_id-span_id-trace_flags
TRACEPARENT="00-${TRACE2}-${SPAN2_A}-01"
echo "  traceparent: $TRACEPARENT"

TS2=$(date -u +"%Y-%m-%dT%H:%M:%S")

PAYLOAD2=$(cat <<EOF
[
  {
    "timestamp": "${TS2}.100Z", "level": "INFO",
    "service": "OrderService", "service.name": "OrderService",
    "traceparent": "$TRACEPARENT",
    "message": "New order ORD-91205 placed by bob@example.com",
    "http.method": "POST", "http.route": "/api/orders",
    "http.status_code": 201, "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS2}.200Z", "level": "INFO",
    "service": "InventoryService", "service.name": "InventoryService",
    "traceparent": "00-${TRACE2}-${SPAN2_B}-01",
    "message": "Reserving inventory for 2 items in order ORD-91205",
    "http.route": "/api/inventory/reserve",
    "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS2}.350Z", "level": "INFO",
    "service": "InventoryService", "service.name": "InventoryService",
    "traceparent": "00-${TRACE2}-${SPAN2_B}-01",
    "message": "Inventory reserved successfully for ORD-91205",
    "http.status_code": 200, "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS2}.400Z", "level": "INFO",
    "service": "ShippingService", "service.name": "ShippingService",
    "traceparent": "00-${TRACE2}-${SPAN2_C}-01",
    "message": "Calculating shipping rates for ORD-91205",
    "http.method": "POST", "http.route": "/api/shipping/calculate",
    "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS2}.900Z", "level": "WARN",
    "service": "ShippingService", "service.name": "ShippingService",
    "traceparent": "00-${TRACE2}-${SPAN2_C}-01",
    "message": "Shipping rate API slow — retrying (attempt 2/3)",
    "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS2}.950Z", "level": "ERROR",
    "service": "ShippingService", "service.name": "ShippingService",
    "traceparent": "00-${TRACE2}-${SPAN2_D}-01",
    "message": "Shipping rate API timeout after 30s — all retries exhausted",
    "http.status_code": 504, "http.route": "/api/shipping/calculate",
    "error.type": "TimeoutError", "exception.type": "java.net.SocketTimeoutException",
    "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS2}.960Z", "level": "ERROR",
    "service": "OrderService", "service.name": "OrderService",
    "traceparent": "00-${TRACE2}-${SPAN2_D}-01",
    "message": "Order ORD-91205 failed: shipping calculation unavailable",
    "http.status_code": 503, "http.route": "/api/orders",
    "error.type": "OrderProcessingError", "tenant_id": "$TENANT"
  }
]
EOF
)

send_logs "$PAYLOAD2" "Test 2 — W3C traceparent"

echo ""
sleep 3

# ═══════════════════════════════════════════════════════════════════════════════
# Test Case 3: Second similar payment failure — tests incident grouping
# ═══════════════════════════════════════════════════════════════════════════════
echo ">>> Test 3: Grouping test — similar CheckoutController → PaymentService → StripeGateway failure"
TRACE3=$(gen_trace_id)
SPAN3_A=$(gen_span_id)
SPAN3_B=$(gen_span_id)
SPAN3_C=$(gen_span_id)
echo "  trace_id: $TRACE3 (should group with Test 1)"

TS3=$(date -u +"%Y-%m-%dT%H:%M:%S")

PAYLOAD3=$(cat <<EOF
[
  {
    "timestamp": "${TS3}.100Z", "level": "INFO",
    "service": "CheckoutController", "service.name": "CheckoutController",
    "trace_id": "$TRACE3", "span_id": "$SPAN3_A",
    "message": "Received checkout request for user charlie@example.com",
    "http.method": "POST", "http.route": "/api/checkout",
    "http.status_code": 200, "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS3}.200Z", "level": "INFO",
    "service": "PaymentService", "service.name": "PaymentService",
    "trace_id": "$TRACE3", "span_id": "$SPAN3_B",
    "message": "Processing payment for order ORD-78290",
    "http.method": "POST", "http.route": "/api/payments/charge",
    "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS3}.500Z", "level": "ERROR",
    "service": "StripeGateway", "service.name": "StripeGateway",
    "trace_id": "$TRACE3", "span_id": "$SPAN3_C",
    "message": "Stripe API returned 500: Internal Server Error — rate limit exceeded on /v1/charges",
    "http.status_code": 500, "http.route": "/v1/charges",
    "error.type": "StripeAPIError", "tenant_id": "$TENANT"
  },
  {
    "timestamp": "${TS3}.510Z", "level": "ERROR",
    "service": "CheckoutController", "service.name": "CheckoutController",
    "trace_id": "$TRACE3", "span_id": "$SPAN3_A",
    "message": "Checkout failed for user charlie@example.com — payment processing error",
    "http.status_code": 500, "http.route": "/api/checkout",
    "error.type": "CheckoutError", "tenant_id": "$TENANT"
  }
]
EOF
)

send_logs "$PAYLOAD3" "Test 3 — grouping"

echo ""
echo ">>> Waiting 35s for lifecycle timeout + pipeline processing..."
sleep 35

echo ""
echo "=== Verification ==="
echo ""

# Check ticketing agent for created tickets
TICKET_URL="${TICKET_URL:-http://localhost:3333/api/ticketing/api/v1/incidents}"
echo ">>> Checking tickets at: $TICKET_URL"
TICKETS=$(curl -s "$TICKET_URL?limit=5")
if [ $? -eq 0 ] && [ -n "$TICKETS" ]; then
  echo "$TICKETS" | python3 -m json.tool 2>/dev/null || echo "$TICKETS"
else
  echo "  (Could not reach ticketing API — check port-forward)"
fi

echo ""
echo "=== Expected Results ==="
echo "  1. TICK-NNNN for StripeGateway failure (request_failure type)"
echo "     - request_flow: [CheckoutController, PaymentService, StripeGateway]"
echo "     - similar_count: 2 (grouped with Test 3)"
echo "     - root_cause: StripeAPIError at StripeGateway"
echo "  2. TICK-NNNN for ShippingService timeout (request_failure type)"
echo "     - request_flow: [OrderService, InventoryService, ShippingService]"
echo "     - root_cause: TimeoutError at ShippingService"
echo "  3. Test 1 trace_id: $TRACE1"
echo "     Test 2 trace_id: $TRACE2"
echo "     Test 3 trace_id: $TRACE3 (grouped with Test 1)"
echo ""
echo "=== Done! ==="
