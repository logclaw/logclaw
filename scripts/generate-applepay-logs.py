#!/usr/bin/env python3
"""
Generate 500 realistic OTel-standard logs simulating Apple Pay's Spring Boot
microservice architecture with Log4j2 JSON layout.

Services modeled after Apple Pay's payment processing pipeline:
  - api-gateway          (Zuul/Spring Cloud Gateway)
  - wallet-service       (Apple Wallet management)
  - payment-orchestrator (Payment flow coordination)
  - tokenization-service (DPAN ↔ FPAN token vault)
  - fraud-engine         (Real-time fraud scoring)
  - issuer-gateway       (Bank/card network integration)
  - merchant-service     (Merchant onboarding & config)
  - notification-service (Push notifications via APNs)
  - settlement-service   (End-of-day settlement batches)
  - audit-logger         (Compliance & PCI-DSS audit trail)

Each request flow generates correlated logs across 3-7 services sharing the
same trace_id, with parent/child span_ids following OTel conventions.
"""

import json, uuid, random, hashlib, sys
from datetime import datetime, timedelta, timezone

# ── OTel ID generators ──────────────────────────────────────────────────────

def trace_id():
    return uuid.uuid4().hex  # 32 hex chars

def span_id():
    return uuid.uuid4().hex[:16]  # 16 hex chars

# ── Time window: last 30 minutes ────────────────────────────────────────────

NOW = datetime.now(timezone.utc)
BASE = NOW - timedelta(minutes=30)

def rand_ts(offset_ms=0):
    delta = timedelta(milliseconds=random.randint(0, 30 * 60 * 1000) + offset_ms)
    return (BASE + delta).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

# ── Service definitions ─────────────────────────────────────────────────────

SERVICES = {
    "api-gateway": {
        "loggers": [
            "com.apple.pay.gateway.filter.AuthenticationFilter",
            "com.apple.pay.gateway.filter.RateLimitFilter",
            "com.apple.pay.gateway.routing.PaymentRouter",
            "com.apple.pay.gateway.handler.GlobalExceptionHandler",
            "org.springframework.cloud.gateway.handler.RoutePredicateHandlerMapping",
        ],
        "threads": ["reactor-http-nio-1", "reactor-http-nio-2", "reactor-http-nio-3",
                     "boundedElastic-1", "boundedElastic-2"],
    },
    "wallet-service": {
        "loggers": [
            "com.apple.pay.wallet.controller.WalletController",
            "com.apple.pay.wallet.service.CardProvisioningService",
            "com.apple.pay.wallet.service.DeviceBindingService",
            "com.apple.pay.wallet.repository.WalletRepository",
            "org.springframework.data.jpa.repository.support.SimpleJpaRepository",
        ],
        "threads": ["http-nio-8081-exec-1", "http-nio-8081-exec-2",
                     "scheduling-1", "HikariPool-1-connection-1"],
    },
    "payment-orchestrator": {
        "loggers": [
            "com.apple.pay.orchestrator.service.PaymentFlowService",
            "com.apple.pay.orchestrator.saga.PaymentSagaManager",
            "com.apple.pay.orchestrator.client.TokenizationClient",
            "com.apple.pay.orchestrator.client.FraudClient",
            "com.apple.pay.orchestrator.client.IssuerClient",
            "org.springframework.statemachine.support.DefaultStateMachineExecutor",
        ],
        "threads": ["http-nio-8082-exec-1", "http-nio-8082-exec-2",
                     "saga-executor-1", "saga-executor-2", "ForkJoinPool.commonPool-worker-1"],
    },
    "tokenization-service": {
        "loggers": [
            "com.apple.pay.token.service.TokenVaultService",
            "com.apple.pay.token.service.DpanFpanMapper",
            "com.apple.pay.token.crypto.HsmCryptoProvider",
            "com.apple.pay.token.repository.TokenRepository",
            "org.springframework.vault.core.VaultTemplate",
        ],
        "threads": ["http-nio-8083-exec-1", "hsm-worker-1", "hsm-worker-2",
                     "vault-refresh-1"],
    },
    "fraud-engine": {
        "loggers": [
            "com.apple.pay.fraud.service.RealTimeScoringService",
            "com.apple.pay.fraud.model.TransactionRiskModel",
            "com.apple.pay.fraud.rules.VelocityCheckRule",
            "com.apple.pay.fraud.rules.GeoAnomalyRule",
            "com.apple.pay.fraud.client.DeviceTrustClient",
            "org.springframework.kafka.listener.KafkaMessageListenerContainer",
        ],
        "threads": ["http-nio-8084-exec-1", "ml-scorer-1", "ml-scorer-2",
                     "kafka-consumer-1"],
    },
    "issuer-gateway": {
        "loggers": [
            "com.apple.pay.issuer.client.VisaNetClient",
            "com.apple.pay.issuer.client.MastercardClient",
            "com.apple.pay.issuer.service.AuthorizationService",
            "com.apple.pay.issuer.retry.CircuitBreakerManager",
            "io.github.resilience4j.circuitbreaker.internal.CircuitBreakerStateMachine",
        ],
        "threads": ["http-nio-8085-exec-1", "http-nio-8085-exec-2",
                     "resilience4j-bulkhead-1", "okhttp-dispatcher-1"],
    },
    "merchant-service": {
        "loggers": [
            "com.apple.pay.merchant.service.MerchantConfigService",
            "com.apple.pay.merchant.service.TerminalRegistryService",
            "com.apple.pay.merchant.repository.MerchantRepository",
            "org.springframework.cache.interceptor.CacheInterceptor",
        ],
        "threads": ["http-nio-8086-exec-1", "cache-refresh-1"],
    },
    "notification-service": {
        "loggers": [
            "com.apple.pay.notification.service.ApnsService",
            "com.apple.pay.notification.service.TransactionReceiptService",
            "com.apple.pay.notification.template.ReceiptTemplateEngine",
            "org.springframework.kafka.listener.KafkaMessageListenerContainer",
        ],
        "threads": ["kafka-consumer-1", "apns-sender-1", "apns-sender-2"],
    },
    "settlement-service": {
        "loggers": [
            "com.apple.pay.settlement.batch.DailySettlementJob",
            "com.apple.pay.settlement.service.ReconciliationService",
            "com.apple.pay.settlement.client.AchClient",
            "org.springframework.batch.core.step.tasklet.TaskletStep",
        ],
        "threads": ["scheduling-1", "batch-worker-1", "batch-worker-2"],
    },
    "audit-logger": {
        "loggers": [
            "com.apple.pay.audit.service.PciAuditService",
            "com.apple.pay.audit.service.ComplianceEventService",
            "com.apple.pay.audit.sink.OpenSearchSink",
            "org.springframework.kafka.listener.KafkaMessageListenerContainer",
        ],
        "threads": ["kafka-consumer-1", "audit-writer-1"],
    },
}

# ── Merchant/user data pools ────────────────────────────────────────────────

MERCHANTS = [
    ("MCH-7291", "Whole Foods Market", "grocery"),
    ("MCH-4420", "Target", "retail"),
    ("MCH-8833", "Uber", "rideshare"),
    ("MCH-1155", "Starbucks", "food_beverage"),
    ("MCH-6607", "Amazon", "ecommerce"),
    ("MCH-3344", "Walgreens", "pharmacy"),
    ("MCH-9901", "Shell", "gas_station"),
    ("MCH-2278", "Netflix", "subscription"),
    ("MCH-5500", "DoorDash", "food_delivery"),
    ("MCH-7789", "Delta Airlines", "travel"),
]

CARD_NETWORKS = ["visa", "mastercard", "amex", "discover"]
REGIONS = ["us-west-2", "us-east-1", "eu-west-1", "ap-northeast-1"]
DEVICE_TYPES = ["iPhone 15 Pro", "iPhone 14", "iPhone 15", "Apple Watch Ultra 2",
                "Apple Watch Series 9", "iPad Pro M4", "MacBook Pro M3"]
CURRENCIES = ["USD", "USD", "USD", "EUR", "GBP", "JPY"]  # weighted toward USD

# ── Log builder ─────────────────────────────────────────────────────────────

def build_log(ts, svc, level, message, tid, sid, logger=None, thread=None, extra=None):
    svc_def = SERVICES[svc]
    entry = {
        "timestamp": ts,
        "level": level,
        "service": svc,
        "message": message,
        "trace_id": tid,
        "span_id": sid,
        "logger": logger or random.choice(svc_def["loggers"]),
        "thread": thread or random.choice(svc_def["threads"]),
        "host": f"{svc}-{random.choice(['7d4f9', 'a2b8c', '3e1d7', 'f9c2a'])}.pod",
        "environment": "production",
        "source_type": "spring-boot",
    }
    if extra:
        entry.update(extra)
    return entry

# ── Request flow generators ─────────────────────────────────────────────────

logs = []

def successful_payment(base_offset):
    """Normal Apple Pay tap-to-pay flow: 7 services, ~12 log lines."""
    tid = trace_id()
    merchant = random.choice(MERCHANTS)
    amount = round(random.uniform(1.50, 499.99), 2)
    currency = random.choice(CURRENCIES)
    card_net = random.choice(CARD_NETWORKS)
    device = random.choice(DEVICE_TYPES)
    user_id = f"U-{random.randint(100000, 999999)}"
    dpan = f"DPAN-{random.randint(1000, 9999)}-****-{random.randint(1000, 9999)}"
    txn_id = f"TXN-{uuid.uuid4().hex[:12].upper()}"
    region = random.choice(REGIONS)
    fraud_score = round(random.uniform(0.01, 0.35), 3)

    s1, s2, s3, s4, s5, s6, s7 = [span_id() for _ in range(7)]
    t = base_offset
    extra = {"merchant_id": merchant[0], "region": region}

    entries = [
        # Gateway receives NFC tap
        build_log(rand_ts(t), "api-gateway", "INFO",
            f"POST /v1/payments/authorize - device={device} merchant={merchant[1]} user={user_id}",
            tid, s1, "com.apple.pay.gateway.routing.PaymentRouter", extra=extra),
        build_log(rand_ts(t+15), "api-gateway", "INFO",
            f"Authentication passed: Bearer token valid, scope=payment:authorize, user={user_id}",
            tid, s1, "com.apple.pay.gateway.filter.AuthenticationFilter", extra=extra),

        # Wallet lookup
        build_log(rand_ts(t+30), "wallet-service", "INFO",
            f"Device binding verified: user={user_id} device={device} dpan={dpan}",
            tid, s2, "com.apple.pay.wallet.service.DeviceBindingService", extra=extra),

        # Payment orchestration starts
        build_log(rand_ts(t+50), "payment-orchestrator", "INFO",
            f"Payment saga initiated: txn={txn_id} amount={amount} {currency} merchant={merchant[0]} network={card_net}",
            tid, s3, "com.apple.pay.orchestrator.saga.PaymentSagaManager", extra={**extra, "transaction_id": txn_id}),

        # Tokenization: DPAN → FPAN
        build_log(rand_ts(t+80), "tokenization-service", "INFO",
            f"Token detokenized: dpan={dpan} → FPAN resolved via HSM, ttl=300s",
            tid, s4, "com.apple.pay.token.service.DpanFpanMapper", extra=extra),

        # Fraud scoring
        build_log(rand_ts(t+120), "fraud-engine", "INFO",
            f"Risk assessment: txn={txn_id} score={fraud_score} velocity=OK geo=MATCH device_trust=HIGH decision=APPROVE",
            tid, s5, "com.apple.pay.fraud.service.RealTimeScoringService",
            extra={**extra, "fraud_score": fraud_score}),

        # Issuer authorization
        build_log(rand_ts(t+180), "issuer-gateway", "INFO",
            f"Authorization request sent to {card_net.upper()} network: txn={txn_id} amount={amount} {currency}",
            tid, s6, f"com.apple.pay.issuer.client.{'VisaNetClient' if card_net == 'visa' else 'MastercardClient'}",
            extra=extra),
        build_log(rand_ts(t+350), "issuer-gateway", "INFO",
            f"Authorization approved: txn={txn_id} auth_code=A{random.randint(10000,99999)} response_time={random.randint(120,280)}ms",
            tid, s6, "com.apple.pay.issuer.service.AuthorizationService", extra=extra),

        # Orchestrator completes
        build_log(rand_ts(t+380), "payment-orchestrator", "INFO",
            f"Payment saga completed: txn={txn_id} state=AUTHORIZED total_time={t+380}ms",
            tid, s3, "com.apple.pay.orchestrator.saga.PaymentSagaManager",
            extra={**extra, "transaction_id": txn_id, "duration_ms": t+380}),

        # Gateway responds
        build_log(rand_ts(t+400), "api-gateway", "INFO",
            f"POST /v1/payments/authorize → 200 OK txn={txn_id} latency={t+400}ms",
            tid, s1, "com.apple.pay.gateway.routing.PaymentRouter",
            extra={**extra, "duration_ms": t+400, "http_status": 200}),

        # Async: notification + audit
        build_log(rand_ts(t+450), "notification-service", "INFO",
            f"Push receipt sent: user={user_id} device={device} merchant={merchant[1]} amount={amount} {currency}",
            tid, s7, "com.apple.pay.notification.service.ApnsService", extra=extra),
        build_log(rand_ts(t+500), "audit-logger", "INFO",
            f"PCI audit trail recorded: txn={txn_id} event=PAYMENT_AUTHORIZED merchant={merchant[0]} amount={amount} {currency}",
            tid, s7, "com.apple.pay.audit.service.PciAuditService", extra=extra),
    ]
    return entries

def card_declined(base_offset):
    """Card declined by issuer — 3xx response from network."""
    tid = trace_id()
    merchant = random.choice(MERCHANTS)
    amount = round(random.uniform(50.00, 2500.00), 2)
    currency = "USD"
    card_net = random.choice(CARD_NETWORKS)
    user_id = f"U-{random.randint(100000, 999999)}"
    txn_id = f"TXN-{uuid.uuid4().hex[:12].upper()}"
    dpan = f"DPAN-{random.randint(1000, 9999)}-****-{random.randint(1000, 9999)}"
    decline_code = random.choice(["05-DO_NOT_HONOR", "51-INSUFFICIENT_FUNDS",
                                   "14-INVALID_CARD", "54-EXPIRED_CARD",
                                   "61-EXCEEDS_LIMIT"])
    s1, s2, s3, s4 = [span_id() for _ in range(4)]
    t = base_offset
    extra = {"merchant_id": merchant[0], "region": random.choice(REGIONS)}

    entries = [
        build_log(rand_ts(t), "api-gateway", "INFO",
            f"POST /v1/payments/authorize - device=iPhone 15 Pro merchant={merchant[1]} user={user_id}",
            tid, s1, extra=extra),
        build_log(rand_ts(t+50), "payment-orchestrator", "INFO",
            f"Payment saga initiated: txn={txn_id} amount={amount} {currency} merchant={merchant[0]}",
            tid, s2, "com.apple.pay.orchestrator.saga.PaymentSagaManager", extra=extra),
        build_log(rand_ts(t+100), "tokenization-service", "INFO",
            f"Token detokenized: dpan={dpan} → FPAN resolved via HSM",
            tid, s3, "com.apple.pay.token.service.DpanFpanMapper", extra=extra),
        build_log(rand_ts(t+200), "issuer-gateway", "WARN",
            f"Authorization declined by {card_net.upper()}: txn={txn_id} code={decline_code} amount={amount} {currency}",
            tid, s4, "com.apple.pay.issuer.service.AuthorizationService", extra=extra),
        build_log(rand_ts(t+220), "payment-orchestrator", "WARN",
            f"Payment saga failed: txn={txn_id} reason=ISSUER_DECLINED code={decline_code}",
            tid, s2, "com.apple.pay.orchestrator.saga.PaymentSagaManager", extra=extra),
        build_log(rand_ts(t+250), "api-gateway", "INFO",
            f"POST /v1/payments/authorize → 402 Payment Required txn={txn_id} decline={decline_code}",
            tid, s1, extra={**extra, "http_status": 402}),
        build_log(rand_ts(t+300), "audit-logger", "INFO",
            f"PCI audit trail recorded: txn={txn_id} event=PAYMENT_DECLINED code={decline_code}",
            tid, s4, "com.apple.pay.audit.service.PciAuditService", extra=extra),
    ]
    return entries

def fraud_block(base_offset):
    """High fraud score blocks the transaction."""
    tid = trace_id()
    merchant = random.choice(MERCHANTS)
    amount = round(random.uniform(800.00, 9999.99), 2)
    user_id = f"U-{random.randint(100000, 999999)}"
    txn_id = f"TXN-{uuid.uuid4().hex[:12].upper()}"
    fraud_score = round(random.uniform(0.85, 0.99), 3)
    s1, s2, s3 = [span_id() for _ in range(3)]
    t = base_offset
    extra = {"merchant_id": merchant[0], "region": random.choice(REGIONS)}

    entries = [
        build_log(rand_ts(t), "api-gateway", "INFO",
            f"POST /v1/payments/authorize - merchant={merchant[1]} user={user_id} amount={amount}",
            tid, s1, extra=extra),
        build_log(rand_ts(t+50), "payment-orchestrator", "INFO",
            f"Payment saga initiated: txn={txn_id} amount={amount} USD",
            tid, s2, extra=extra),
        build_log(rand_ts(t+120), "fraud-engine", "ERROR",
            f"Transaction blocked by fraud engine: txn={txn_id} score={fraud_score} "
            f"triggers=[VELOCITY_BREACH, GEO_ANOMALY, AMOUNT_SPIKE] decision=BLOCK",
            tid, s3, "com.apple.pay.fraud.service.RealTimeScoringService",
            extra={**extra, "fraud_score": fraud_score}),
        build_log(rand_ts(t+140), "fraud-engine", "WARN",
            f"Velocity check failed: user={user_id} txn_count_1h=12 threshold=5 geo_distance=4200km",
            tid, s3, "com.apple.pay.fraud.rules.VelocityCheckRule", extra=extra),
        build_log(rand_ts(t+160), "payment-orchestrator", "ERROR",
            f"Payment saga aborted: txn={txn_id} reason=FRAUD_BLOCKED score={fraud_score}",
            tid, s2, "com.apple.pay.orchestrator.saga.PaymentSagaManager", extra=extra),
        build_log(rand_ts(t+180), "api-gateway", "WARN",
            f"POST /v1/payments/authorize → 403 Forbidden txn={txn_id} reason=fraud_block",
            tid, s1, extra={**extra, "http_status": 403}),
        build_log(rand_ts(t+200), "notification-service", "INFO",
            f"Fraud alert push sent: user={user_id} device=iPhone 15 Pro message='Suspicious transaction blocked'",
            tid, s3, "com.apple.pay.notification.service.ApnsService", extra=extra),
        build_log(rand_ts(t+250), "audit-logger", "WARN",
            f"PCI audit trail: txn={txn_id} event=FRAUD_BLOCK score={fraud_score} user={user_id}",
            tid, s3, "com.apple.pay.audit.service.PciAuditService", extra=extra),
    ]
    return entries

def issuer_timeout(base_offset):
    """Issuer gateway times out talking to card network — cascading failure."""
    tid = trace_id()
    merchant = random.choice(MERCHANTS)
    amount = round(random.uniform(10.00, 300.00), 2)
    card_net = random.choice(["visa", "mastercard"])
    user_id = f"U-{random.randint(100000, 999999)}"
    txn_id = f"TXN-{uuid.uuid4().hex[:12].upper()}"
    s1, s2, s3, s4, s5 = [span_id() for _ in range(5)]
    t = base_offset
    extra = {"merchant_id": merchant[0], "region": random.choice(REGIONS)}
    timeout_ms = random.choice([5000, 10000, 15000, 30000])

    entries = [
        build_log(rand_ts(t), "api-gateway", "INFO",
            f"POST /v1/payments/authorize - merchant={merchant[1]} user={user_id}",
            tid, s1, extra=extra),
        build_log(rand_ts(t+50), "payment-orchestrator", "INFO",
            f"Payment saga initiated: txn={txn_id} amount={amount} USD network={card_net}",
            tid, s2, extra=extra),
        build_log(rand_ts(t+80), "tokenization-service", "INFO",
            f"Token detokenized: DPAN-****-{random.randint(1000,9999)} → FPAN resolved",
            tid, s3, extra=extra),
        build_log(rand_ts(t+120), "fraud-engine", "INFO",
            f"Risk assessment: txn={txn_id} score=0.08 decision=APPROVE",
            tid, s4, extra=extra),
        build_log(rand_ts(t+200), "issuer-gateway", "INFO",
            f"Authorization request sent to {card_net.upper()} network: txn={txn_id}",
            tid, s5, extra=extra),
        build_log(rand_ts(t+200+timeout_ms), "issuer-gateway", "ERROR",
            f"java.net.SocketTimeoutException: Connect to {card_net}-api.network.visa.com:443 timed out after {timeout_ms}ms "
            f"- txn={txn_id} retries_exhausted=3/3",
            tid, s5, "com.apple.pay.issuer.client.VisaNetClient", extra=extra),
        build_log(rand_ts(t+200+timeout_ms+20), "issuer-gateway", "ERROR",
            f"CircuitBreaker '{card_net}-auth' state transition: CLOSED → OPEN "
            f"(failure_rate=85.0% threshold=50.0% buffered_calls=20)",
            tid, s5, "io.github.resilience4j.circuitbreaker.internal.CircuitBreakerStateMachine",
            extra=extra),
        build_log(rand_ts(t+200+timeout_ms+40), "payment-orchestrator", "ERROR",
            f"Payment saga failed: txn={txn_id} reason=ISSUER_TIMEOUT after {timeout_ms}ms "
            f"network={card_net} circuit_breaker=OPEN",
            tid, s2, "com.apple.pay.orchestrator.saga.PaymentSagaManager", extra=extra),
        build_log(rand_ts(t+200+timeout_ms+60), "api-gateway", "ERROR",
            f"POST /v1/payments/authorize → 504 Gateway Timeout txn={txn_id} "
            f"upstream=issuer-gateway latency={200+timeout_ms+60}ms",
            tid, s1, "com.apple.pay.gateway.handler.GlobalExceptionHandler",
            extra={**extra, "http_status": 504, "duration_ms": 200+timeout_ms+60}),
        build_log(rand_ts(t+200+timeout_ms+100), "audit-logger", "ERROR",
            f"PCI audit trail: txn={txn_id} event=PAYMENT_FAILED reason=ISSUER_TIMEOUT network={card_net}",
            tid, s5, extra=extra),
    ]
    return entries

def hsm_crypto_failure(base_offset):
    """HSM hardware security module failure in tokenization — FATAL cascade."""
    tid = trace_id()
    user_id = f"U-{random.randint(100000, 999999)}"
    txn_id = f"TXN-{uuid.uuid4().hex[:12].upper()}"
    merchant = random.choice(MERCHANTS)
    s1, s2, s3 = [span_id() for _ in range(3)]
    t = base_offset
    extra = {"merchant_id": merchant[0], "region": random.choice(REGIONS)}
    hsm_slot = random.choice(["HSM-SLOT-01", "HSM-SLOT-02", "HSM-SLOT-03"])

    entries = [
        build_log(rand_ts(t), "api-gateway", "INFO",
            f"POST /v1/payments/authorize - merchant={merchant[1]} user={user_id}",
            tid, s1, extra=extra),
        build_log(rand_ts(t+50), "payment-orchestrator", "INFO",
            f"Payment saga initiated: txn={txn_id} amount={round(random.uniform(5,500),2)} USD",
            tid, s2, extra=extra),
        build_log(rand_ts(t+100), "tokenization-service", "ERROR",
            f"HSM detokenization failed: slot={hsm_slot} error=PKCS11_CKR_DEVICE_ERROR "
            f"dpan=DPAN-****-{random.randint(1000,9999)} - hardware security module unresponsive",
            tid, s3, "com.apple.pay.token.crypto.HsmCryptoProvider", extra=extra),
        build_log(rand_ts(t+110), "tokenization-service", "FATAL",
            f"Critical: Token vault unavailable - all HSM slots exhausted. "
            f"Affected slots: [HSM-SLOT-01, HSM-SLOT-02, HSM-SLOT-03]. "
            f"No DPAN→FPAN resolution possible. Immediate escalation required.",
            tid, s3, "com.apple.pay.token.service.TokenVaultService", extra=extra),
        build_log(rand_ts(t+130), "payment-orchestrator", "ERROR",
            f"Payment saga aborted: txn={txn_id} reason=TOKEN_VAULT_UNAVAILABLE "
            f"compensating_action=ROLLBACK",
            tid, s2, "com.apple.pay.orchestrator.saga.PaymentSagaManager", extra=extra),
        build_log(rand_ts(t+150), "api-gateway", "ERROR",
            f"POST /v1/payments/authorize → 503 Service Unavailable txn={txn_id} "
            f"upstream=tokenization-service reason=hsm_failure",
            tid, s1, "com.apple.pay.gateway.handler.GlobalExceptionHandler",
            extra={**extra, "http_status": 503}),
        build_log(rand_ts(t+200), "audit-logger", "ERROR",
            f"PCI audit CRITICAL: txn={txn_id} event=HSM_FAILURE slot={hsm_slot} "
            f"impact=TOKEN_VAULT_DOWN escalation=P1",
            tid, s3, extra=extra),
    ]
    return entries

def rate_limit_hit(base_offset):
    """API gateway rate-limits a merchant."""
    tid = trace_id()
    merchant = random.choice(MERCHANTS)
    user_id = f"U-{random.randint(100000, 999999)}"
    s1 = span_id()
    t = base_offset
    extra = {"merchant_id": merchant[0], "region": random.choice(REGIONS)}
    rps = random.randint(500, 2000)

    entries = [
        build_log(rand_ts(t), "api-gateway", "WARN",
            f"Rate limit exceeded: merchant={merchant[0]} ({merchant[1]}) "
            f"current_rps={rps} limit=100 window=60s bucket=merchant_tier_standard",
            tid, s1, "com.apple.pay.gateway.filter.RateLimitFilter", extra=extra),
        build_log(rand_ts(t+5), "api-gateway", "INFO",
            f"POST /v1/payments/authorize → 429 Too Many Requests merchant={merchant[0]} "
            f"retry_after=30s",
            tid, s1, "com.apple.pay.gateway.handler.GlobalExceptionHandler",
            extra={**extra, "http_status": 429}),
    ]
    return entries

def settlement_batch(base_offset):
    """Daily settlement batch processing logs."""
    tid = trace_id()
    batch_id = f"BATCH-{datetime.now().strftime('%Y%m%d')}-{random.randint(100,999)}"
    s1, s2 = [span_id() for _ in range(2)]
    t = base_offset
    txn_count = random.randint(50000, 500000)
    total_amount = round(txn_count * random.uniform(15.0, 85.0), 2)
    region = random.choice(REGIONS)
    extra = {"region": region, "batch_id": batch_id}

    entries = [
        build_log(rand_ts(t), "settlement-service", "INFO",
            f"Daily settlement batch started: batch={batch_id} region={region} "
            f"transactions={txn_count} total_amount={total_amount} USD",
            tid, s1, "com.apple.pay.settlement.batch.DailySettlementJob", extra=extra),
        build_log(rand_ts(t+2000), "settlement-service", "INFO",
            f"Reconciliation complete: batch={batch_id} matched={txn_count-random.randint(0,5)} "
            f"discrepancies={random.randint(0,5)} duration={random.randint(45,180)}s",
            tid, s2, "com.apple.pay.settlement.service.ReconciliationService", extra=extra),
        build_log(rand_ts(t+3000), "settlement-service", "INFO",
            f"ACH file submitted: batch={batch_id} file=NACHA-{batch_id}.ach "
            f"entries={txn_count} total={total_amount} USD status=ACCEPTED",
            tid, s2, "com.apple.pay.settlement.client.AchClient", extra=extra),
    ]
    return entries

def merchant_config_update(base_offset):
    """Merchant config update with cache refresh."""
    tid = trace_id()
    merchant = random.choice(MERCHANTS)
    s1 = span_id()
    t = base_offset
    extra = {"merchant_id": merchant[0], "region": random.choice(REGIONS)}

    entries = [
        build_log(rand_ts(t), "merchant-service", "INFO",
            f"Merchant config updated: id={merchant[0]} ({merchant[1]}) "
            f"category={merchant[2]} changes=[terminal_limit, daily_cap]",
            tid, s1, "com.apple.pay.merchant.service.MerchantConfigService", extra=extra),
        build_log(rand_ts(t+20), "merchant-service", "INFO",
            f"Cache invalidated and refreshed: key=merchant:{merchant[0]} "
            f"ttl=3600s nodes_notified=3",
            tid, s1, "org.springframework.cache.interceptor.CacheInterceptor", extra=extra),
    ]
    return entries

def db_connection_pool_warning(base_offset):
    """HikariCP connection pool warning."""
    tid = trace_id()
    svc = random.choice(["wallet-service", "merchant-service", "settlement-service"])
    s1 = span_id()
    t = base_offset
    active = random.randint(18, 20)
    pending = random.randint(5, 30)

    entries = [
        build_log(rand_ts(t), svc, "WARN",
            f"HikariPool-1 - Connection pool near exhaustion: "
            f"active={active}/20 idle=0 pending={pending} "
            f"max_wait_ms={random.randint(5000, 30000)} "
            f"consider increasing maximumPoolSize",
            tid, s1,
            "com.zaxxer.hikari.pool.HikariPool",
            thread="HikariPool-1-housekeeper"),
    ]
    return entries

# ── Generate 500 logs ───────────────────────────────────────────────────────

random.seed(42)  # reproducible

# Distribution:
#   ~55% successful payments (30 flows × ~12 logs = ~360)
#   ~8% card declined (6 flows × ~7 logs = ~42)
#   ~5% fraud blocks (3 flows × ~8 logs = ~24)
#   ~5% issuer timeouts (3 flows × ~10 logs = ~30)
#   ~3% HSM failures (2 flows × ~7 logs = ~14)
#   ~3% rate limits (8 flows × ~2 logs = ~16)
#   ~3% settlement (3 flows × ~3 logs = ~9)
#   ~2% merchant config (4 flows × ~2 logs = ~8)
#   ~1% DB pool warnings (5 × ~1 logs = ~5)

offset = 0
for _ in range(30):
    logs.extend(successful_payment(offset))
    offset += random.randint(20000, 60000)

for _ in range(6):
    logs.extend(card_declined(offset))
    offset += random.randint(10000, 40000)

for _ in range(3):
    logs.extend(fraud_block(offset))
    offset += random.randint(15000, 50000)

for _ in range(3):
    logs.extend(issuer_timeout(offset))
    offset += random.randint(20000, 60000)

for _ in range(2):
    logs.extend(hsm_crypto_failure(offset))
    offset += random.randint(10000, 30000)

for _ in range(8):
    logs.extend(rate_limit_hit(offset))
    offset += random.randint(5000, 15000)

for _ in range(3):
    logs.extend(settlement_batch(offset))
    offset += random.randint(30000, 60000)

for _ in range(4):
    logs.extend(merchant_config_update(offset))
    offset += random.randint(5000, 10000)

for _ in range(5):
    logs.extend(db_connection_pool_warning(offset))
    offset += random.randint(3000, 8000)

# Sort by timestamp and trim to exactly 500
logs.sort(key=lambda x: x["timestamp"])
logs = logs[:500]

# ── Output ──────────────────────────────────────────────────────────────────

output_path = sys.argv[1] if len(sys.argv) > 1 else "applepay-otel-500.json"
with open(output_path, "w") as f:
    json.dump(logs, f, indent=2)

# Stats
levels = {}
services = {}
traces = set()
for l in logs:
    levels[l["level"]] = levels.get(l["level"], 0) + 1
    services[l["service"]] = services.get(l["service"], 0) + 1
    traces.add(l["trace_id"])

print(f"Generated {len(logs)} logs → {output_path}")
print(f"  Unique traces: {len(traces)}")
print(f"  Levels: {dict(sorted(levels.items()))}")
print(f"  Services: {dict(sorted(services.items()))}")
