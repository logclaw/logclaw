#!/usr/bin/env python3
"""
Generate 400 OTel-standard Apple Pay logs — Batch 2: Infrastructure & Security Errors
Different error patterns from batch 1 (which covered payment flow errors).
This batch focuses on: TLS failures, DB deadlocks, OOM, DNS failures, cache storms,
key rotation failures, Kafka backpressure, webhook failures, JWT expiry, PCI violations.
"""

import json
import random
import uuid
import hashlib
from datetime import datetime, timedelta, timezone

random.seed(42_002)

# ── Services (same Apple Pay architecture) ──────────────────────────────
SERVICES = {
    "api-gateway":            {"host": "api-gw",      "logger_base": "com.apple.pay.gateway"},
    "wallet-service":         {"host": "wallet",       "logger_base": "com.apple.pay.wallet"},
    "payment-orchestrator":   {"host": "pay-orch",     "logger_base": "com.apple.pay.orchestrator"},
    "tokenization-service":   {"host": "token-svc",    "logger_base": "com.apple.pay.tokenization"},
    "fraud-engine":           {"host": "fraud-eng",    "logger_base": "com.apple.pay.fraud"},
    "issuer-gateway":         {"host": "issuer-gw",    "logger_base": "com.apple.pay.issuer"},
    "merchant-service":       {"host": "merchant-svc", "logger_base": "com.apple.pay.merchant"},
    "notification-service":   {"host": "notif-svc",    "logger_base": "com.apple.pay.notification"},
    "settlement-service":     {"host": "settle-svc",   "logger_base": "com.apple.pay.settlement"},
    "audit-logger":           {"host": "audit-log",    "logger_base": "com.apple.pay.audit"},
}

REGIONS = ["us-west-2", "us-east-1", "eu-west-1"]
THREADS = [
    "http-nio-8443-exec-{}", "kafka-consumer-{}", "scheduler-{}",
    "async-pool-{}", "grpc-worker-{}", "db-pool-thread-{}",
    "cache-refresh-{}", "health-check-{}", "tls-handshake-{}"
]
MERCHANTS = [
    ("MCH-1001", "Starbucks"),    ("MCH-1002", "Target"),
    ("MCH-1003", "Uber"),         ("MCH-1004", "DoorDash"),
    ("MCH-1005", "Nike"),         ("MCH-1006", "Best Buy"),
    ("MCH-1007", "Walgreens"),    ("MCH-1008", "Costco"),
    ("MCH-1009", "Spotify"),      ("MCH-1010", "Netflix"),
]

BASE_TIME = datetime(2026, 3, 3, 4, 0, 0, tzinfo=timezone.utc)

def tid():   return uuid.uuid4().hex
def sid():   return uuid.uuid4().hex[:16]
def txn():   return f"TXN-{uuid.uuid4().hex[:12].upper()}"
def ts(off): return (BASE_TIME + timedelta(seconds=off)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

def make_log(timestamp_offset, service, level, message, trace_id, span_id,
             logger_suffix="", extra_fields=None):
    svc = SERVICES[service]
    thread = random.choice(THREADS).format(random.randint(1, 20))
    logger = f"{svc['logger_base']}.{logger_suffix}" if logger_suffix else svc["logger_base"]
    pod_id = hashlib.md5(f"{service}-{random.randint(1,5)}".encode()).hexdigest()[:5]
    merchant = random.choice(MERCHANTS)

    log = {
        "timestamp":   ts(timestamp_offset),
        "level":       level,
        "message":     message,
        "service":     service,
        "trace_id":    trace_id,
        "span_id":     span_id,
        "logger":      logger,
        "thread":      thread,
        "host":        f"{svc['host']}-{pod_id}.pod",
        "environment": "production",
        "region":      random.choice(REGIONS),
        "source_type": "spring-boot",
        "merchant_id": merchant[0],
    }
    if extra_fields:
        log.update(extra_fields)
    return log


# ═══════════════════════════════════════════════════════════════════════
#  FLOW DEFINITIONS — 10 new error scenarios
# ═══════════════════════════════════════════════════════════════════════

def flow_tls_cert_expiry(base_off):
    """TLS certificate expired on issuer-gateway → cascading SSL handshake failures"""
    t, s1, s2, s3, s4 = tid(), sid(), sid(), sid(), sid()
    tx = txn()
    return [
        make_log(base_off,      "api-gateway",          "INFO",  f"POST /v1/payments/authorize - merchant=Target user=U-{random.randint(100000,999999)}", t, s1, "filter.AuthenticationFilter"),
        make_log(base_off+1,    "payment-orchestrator",  "INFO",  f"Payment saga initiated: txn={tx} amount={random.uniform(10,500):.2f} USD network=mastercard", t, s2, "saga.PaymentSagaOrchestrator"),
        make_log(base_off+2,    "tokenization-service",  "INFO",  f"Token resolved: DPAN-****-{random.randint(1000,9999)} → FPAN via HSM vault", t, s3, "hsm.TokenVaultService"),
        make_log(base_off+3,    "issuer-gateway",        "ERROR", f"javax.net.ssl.SSLHandshakeException: PKIX path validation failed: java.security.cert.CertPathValidatorException: validity check failed - certificate expired at 2026-03-02T23:59:59Z for CN=issuer-api.mastercard.com", t, s4, "tls.MutualTlsHandler"),
        make_log(base_off+3,    "issuer-gateway",        "ERROR", f"TLS handshake failed to mastercard-auth.issuer.net:8443 - cert serial=0x{random.randint(100000,999999):06X} issuer=DigiCert SHA2 Extended Validation", t, s4, "tls.CertificateValidator"),
        make_log(base_off+4,    "payment-orchestrator",  "ERROR", f"Payment saga failed: txn={tx} reason=SSL_HANDSHAKE_FAILURE upstream=issuer-gateway error=certificate_expired", t, s2, "saga.PaymentSagaOrchestrator"),
        make_log(base_off+5,    "api-gateway",           "ERROR", f"POST /v1/payments/authorize → 502 Bad Gateway txn={tx} upstream=issuer-gateway error=ssl_handshake_failed latency=3420ms", t, s1, "handler.PaymentHandler"),
        make_log(base_off+6,    "audit-logger",          "ERROR", f"PCI audit trail: txn={tx} event=SSL_FAILURE cert_cn=issuer-api.mastercard.com expired_at=2026-03-02T23:59:59Z", t, s4, "service.PciAuditService"),
    ]

def flow_db_deadlock(base_off):
    """PostgreSQL deadlock between settlement and wallet services"""
    t, s1, s2, s3 = tid(), sid(), sid(), sid()
    batch = f"BATCH-{random.randint(100000,999999)}"
    return [
        make_log(base_off,      "settlement-service",    "INFO",  f"Settlement batch started: {batch} records=1250 total=847293.50 USD", t, s1, "batch.SettlementBatchProcessor"),
        make_log(base_off+1,    "settlement-service",    "WARN",  f"Long-running transaction detected: {batch} lock_wait_time=4200ms table=merchant_settlements row_lock_count=847", t, s1, "db.TransactionMonitor"),
        make_log(base_off+2,    "wallet-service",        "WARN",  f"Connection pool exhaustion approaching: active=48/50 pending=12 avg_checkout_time=3800ms", t, s2, "db.HikariPoolMonitor"),
        make_log(base_off+3,    "settlement-service",    "ERROR", f"org.postgresql.util.PSQLException: ERROR: deadlock detected - Process {random.randint(10000,99999)} waits for ShareLock on transaction {random.randint(100000,999999)}; blocked by process {random.randint(10000,99999)}", t, s1, "db.PostgresExceptionHandler"),
        make_log(base_off+3,    "settlement-service",    "ERROR", f"Deadlock on table merchant_settlements: batch={batch} conflicting_query='UPDATE merchant_settlements SET status=$1 WHERE merchant_id=$2 AND settlement_date=$3'", t, s1, "db.DeadlockRetryInterceptor"),
        make_log(base_off+4,    "wallet-service",        "ERROR", f"java.sql.SQLTransientConnectionException: HikariPool-1 - Connection is not available, request timed out after 30000ms (total=50, active=50, idle=0, waiting=23)", t, s2, "db.HikariPoolMonitor"),
        make_log(base_off+5,    "audit-logger",          "ERROR", f"Settlement batch failed: {batch} error=DEADLOCK_DETECTED affected_merchants=47 rollback_initiated=true", t, s3, "service.PciAuditService"),
    ]

def flow_oom_kill(base_off):
    """Fraud engine OOM during ML model scoring with large batch"""
    t, s1, s2, s3, s4 = tid(), sid(), sid(), sid(), sid()
    tx = txn()
    return [
        make_log(base_off,      "api-gateway",           "INFO",  f"POST /v1/payments/authorize - merchant=DoorDash user=U-{random.randint(100000,999999)}", t, s1, "filter.AuthenticationFilter"),
        make_log(base_off+1,    "fraud-engine",          "WARN",  f"JVM heap usage critical: used=3891MB/4096MB (95.0%) - GC overhead 47% in last 60s", t, s2, "monitoring.JvmMemoryMonitor"),
        make_log(base_off+1,    "fraud-engine",          "WARN",  f"GC pause time exceeded threshold: G1 Young Gen pause=2340ms (threshold=500ms) allocation_rate=890MB/s", t, s2, "monitoring.GarbageCollectionMonitor"),
        make_log(base_off+2,    "fraud-engine",          "ERROR", f"java.lang.OutOfMemoryError: Java heap space - failed to allocate 268435456 bytes for TensorFlow Lite model inference batch_size=500 model=fraud_score_v3.tflite", t, s2, "ml.FraudModelInferenceService"),
        make_log(base_off+2,    "fraud-engine",          "FATAL", f"FATAL: OOM killer invoked - PID {random.randint(1,100)} (java) score={random.randint(900,999)} total_vm={random.randint(5000,6000)}MB rss={random.randint(4000,4500)}MB - service will restart", t, s2, "core.ShutdownHook"),
        make_log(base_off+3,    "payment-orchestrator",  "ERROR", f"Fraud check timeout: txn={tx} service=fraud-engine error=connection_reset latency=5000ms fallback=MANUAL_REVIEW", t, s3, "saga.FraudCheckStep"),
        make_log(base_off+4,    "api-gateway",           "ERROR", f"POST /v1/payments/authorize → 503 Service Unavailable txn={tx} upstream=fraud-engine error=connection_reset", t, s1, "handler.PaymentHandler"),
        make_log(base_off+5,    "notification-service",  "WARN",  f"Alert dispatched: CRITICAL fraud-engine OOM - PagerDuty incident=INC-{random.randint(10000,99999)} escalation=P1", t, s4, "alert.PagerDutyIntegration"),
    ]

def flow_dns_resolution_failure(base_off):
    """DNS resolution failure for external Visa API endpoint"""
    t, s1, s2, s3 = tid(), sid(), sid(), sid()
    tx = txn()
    return [
        make_log(base_off,      "api-gateway",           "INFO",  f"POST /v1/payments/authorize - merchant=Nike user=U-{random.randint(100000,999999)}", t, s1, "filter.AuthenticationFilter"),
        make_log(base_off+1,    "payment-orchestrator",  "INFO",  f"Payment saga initiated: txn={tx} amount={random.uniform(50,300):.2f} USD network=visa", t, s2, "saga.PaymentSagaOrchestrator"),
        make_log(base_off+2,    "issuer-gateway",        "ERROR", f"java.net.UnknownHostException: Failed to resolve 'visa-auth-api.visa.com': Name or service not known - DNS server=10.96.0.10 search_domain=logclaw-dev-local.svc.cluster.local", t, s3, "net.DnsResolutionService"),
        make_log(base_off+2,    "issuer-gateway",        "ERROR", f"DNS resolution failed after 3 retries with exponential backoff (1s, 2s, 4s) for visa-auth-api.visa.com - nameserver=coredns timeout=5s ndots=5", t, s3, "net.DnsRetryHandler"),
        make_log(base_off+3,    "payment-orchestrator",  "ERROR", f"Payment saga failed: txn={tx} reason=DNS_RESOLUTION_FAILURE upstream=issuer-gateway target=visa-auth-api.visa.com", t, s2, "saga.PaymentSagaOrchestrator"),
        make_log(base_off+4,    "api-gateway",           "ERROR", f"POST /v1/payments/authorize → 502 Bad Gateway txn={tx} error=dns_failure upstream=issuer-gateway latency=7120ms", t, s1, "handler.PaymentHandler"),
    ]

def flow_redis_cache_storm(base_off):
    """Redis cache eviction storm causing thundering herd on tokenization"""
    t, s1, s2, s3, s4 = tid(), sid(), sid(), sid(), sid()
    return [
        make_log(base_off,      "tokenization-service",  "WARN",  f"Redis memory pressure: used_memory=3.8GB/4.0GB evicted_keys=12847 eviction_policy=allkeys-lru keyspace_hits_ratio=0.23", t, s1, "cache.RedisHealthMonitor"),
        make_log(base_off+1,    "tokenization-service",  "WARN",  f"Cache miss rate spike: current=78.2% baseline=5.1% window=60s - thundering herd risk detected for token_vault keyspace", t, s1, "cache.CacheMissRateMonitor"),
        make_log(base_off+2,    "tokenization-service",  "ERROR", f"io.lettuce.core.RedisCommandTimeoutException: Command timed out after 3000ms - connection=redis-cluster-token-vault.redis.svc:6379 command=MGET keys=250", t, s2, "cache.RedisTokenCacheService"),
        make_log(base_off+3,    "tokenization-service",  "ERROR", f"Token vault fallback to HSM direct: cache_miss=true hsm_latency=890ms tokens_requested=250 rate_limit_remaining=47/100", t, s2, "hsm.HsmDirectAccessFallback"),
        make_log(base_off+4,    "payment-orchestrator",  "WARN",  f"Tokenization latency degraded: p99=4200ms (normal=120ms) - upstream=tokenization-service circuit_breaker_state=HALF_OPEN", t, s3, "saga.TokenizationStep"),
        make_log(base_off+5,    "api-gateway",           "WARN",  f"Upstream latency SLA breach: service=tokenization-service p99=4200ms threshold=2000ms - auto-scaling triggered", t, s4, "monitoring.LatencySlaMonitor"),
    ]

def flow_encryption_key_rotation_failure(base_off):
    """KMS key rotation failure causing tokenization to reject new transactions"""
    t, s1, s2, s3, s4 = tid(), sid(), sid(), sid(), sid()
    tx = txn()
    key_id = f"arn:aws:kms:us-west-2:123456789:key/{uuid.uuid4()}"
    return [
        make_log(base_off,      "tokenization-service",  "INFO",  f"Scheduled KMS key rotation started: key_alias=alias/apple-pay-token-key rotation_interval=90d", t, s1, "crypto.KmsKeyRotationScheduler"),
        make_log(base_off+1,    "tokenization-service",  "ERROR", f"com.amazonaws.services.kms.model.KMSInternalException: Key rotation failed for {key_id} - RotateKeyOnDemand throttled: Rate exceeded (Service: AWSKMS; Status Code: 400)", t, s1, "crypto.KmsKeyRotationScheduler"),
        make_log(base_off+2,    "tokenization-service",  "ERROR", f"Encryption key state INCONSISTENT: primary_key_version=v7 active_key_version=v6 - new tokenization requests blocked until resolution", t, s2, "crypto.KeyStateValidator"),
        make_log(base_off+3,    "payment-orchestrator",  "ERROR", f"Tokenization rejected: txn={tx} error=KEY_STATE_INCONSISTENT service=tokenization-service retry_after=300s", t, s3, "saga.TokenizationStep"),
        make_log(base_off+4,    "api-gateway",           "ERROR", f"POST /v1/payments/authorize → 503 Service Unavailable txn={tx} reason=tokenization_key_rotation_failure", t, s4, "handler.PaymentHandler"),
        make_log(base_off+5,    "audit-logger",          "FATAL", f"SECURITY ALERT: KMS key rotation failure - key_alias=alias/apple-pay-token-key state=INCONSISTENT action_required=MANUAL_INTERVENTION pci_impact=HIGH", t, s1, "service.SecurityAuditService"),
        make_log(base_off+6,    "notification-service",  "WARN",  f"Security alert dispatched: KMS key rotation failure - channels=[pagerduty, slack-#security-oncall, email-security-team@apple.com]", t, s1, "alert.SecurityAlertDispatcher"),
    ]

def flow_kafka_backpressure(base_off):
    """Kafka consumer lag causing event processing backpressure"""
    t, s1, s2, s3, s4 = tid(), sid(), sid(), sid(), sid()
    return [
        make_log(base_off,      "payment-orchestrator",  "WARN",  f"Kafka consumer lag critical: topic=payment-events partition=3 lag=284750 consumer_group=pay-orch-group commit_rate=1200/s produce_rate=8500/s", t, s1, "kafka.ConsumerLagMonitor"),
        make_log(base_off+1,    "payment-orchestrator",  "WARN",  f"Event processing backpressure: queue_depth=50000/50000 (full) rejected_events=347 in_last_60s drop_policy=NEWEST", t, s1, "kafka.BackpressureHandler"),
        make_log(base_off+2,    "payment-orchestrator",  "ERROR", f"org.apache.kafka.clients.consumer.CommitFailedException: Commit cannot be completed since the group has already rebalanced and assigned the partitions to another member - generation=47 member_id=pay-orch-{uuid.uuid4().hex[:8]}", t, s2, "kafka.KafkaConsumerManager"),
        make_log(base_off+3,    "settlement-service",    "WARN",  f"Settlement event delay: expected_latency=500ms actual_latency=47200ms topic=settlement-events lag_source=payment-orchestrator", t, s3, "event.SettlementEventConsumer"),
        make_log(base_off+4,    "notification-service",  "ERROR", f"Payment notification dropped: topic=notification-events partition=0 offset=8847291 reason=consumer_lag_exceeded_threshold lag=312000 threshold=100000", t, s4, "kafka.NotificationConsumer"),
        make_log(base_off+5,    "audit-logger",          "WARN",  f"Audit event pipeline degraded: events_behind=284750 estimated_catchup_time=237s processing_rate=1200/s", t, s1, "kafka.AuditEventConsumer"),
    ]

def flow_webhook_delivery_failure(base_off):
    """Webhook delivery failures to merchant endpoints"""
    t, s1, s2, s3 = tid(), sid(), sid(), sid()
    tx = txn()
    merchant = random.choice(MERCHANTS)
    webhook_url = f"https://api.{merchant[1].lower().replace(' ', '')}.com/webhooks/applepay"
    return [
        make_log(base_off,      "notification-service",  "INFO",  f"Webhook dispatch: txn={tx} event=payment.completed merchant={merchant[0]} url={webhook_url}", t, s1, "webhook.WebhookDispatchService"),
        make_log(base_off+1,    "notification-service",  "WARN",  f"Webhook delivery failed (attempt 1/5): txn={tx} url={webhook_url} status=503 response_time=12400ms", t, s1, "webhook.WebhookRetryHandler"),
        make_log(base_off+5,    "notification-service",  "WARN",  f"Webhook delivery failed (attempt 2/5): txn={tx} url={webhook_url} error=java.net.SocketTimeoutException: Read timed out after 15000ms", t, s1, "webhook.WebhookRetryHandler"),
        make_log(base_off+20,   "notification-service",  "WARN",  f"Webhook delivery failed (attempt 3/5): txn={tx} url={webhook_url} status=502 body='Bad Gateway'", t, s1, "webhook.WebhookRetryHandler"),
        make_log(base_off+60,   "notification-service",  "ERROR", f"Webhook delivery failed (attempt 4/5): txn={tx} url={webhook_url} error=javax.net.ssl.SSLException: Connection reset by peer", t, s1, "webhook.WebhookRetryHandler"),
        make_log(base_off+120,  "notification-service",  "ERROR", f"Webhook delivery EXHAUSTED: txn={tx} merchant={merchant[0]} url={webhook_url} total_attempts=5 moved_to_dead_letter_queue=webhook-dlq", t, s1, "webhook.WebhookDeadLetterHandler"),
        make_log(base_off+121,  "merchant-service",      "WARN",  f"Merchant webhook health degraded: merchant={merchant[0]} ({merchant[1]}) success_rate=12.5% last_24h failures=42/48 endpoint={webhook_url}", t, s2, "health.MerchantWebhookHealthCheck"),
        make_log(base_off+122,  "audit-logger",          "WARN",  f"Webhook SLA breach: merchant={merchant[0]} sla_target=99.5% actual=12.5% escalation=merchant-relations-team", t, s3, "service.SlaComplianceMonitor"),
    ]

def flow_jwt_session_expiry(base_off):
    """JWT token validation failures causing auth cascade"""
    t, s1, s2, s3 = tid(), sid(), sid(), sid()
    user_id = f"U-{random.randint(100000, 999999)}"
    return [
        make_log(base_off,      "api-gateway",           "WARN",  f"JWT validation failed: user={user_id} error=token_expired exp=2026-03-03T03:45:00Z now=2026-03-03T04:02:17Z clock_skew_tolerance=60s", t, s1, "auth.JwtTokenValidator"),
        make_log(base_off+0,    "api-gateway",           "INFO",  f"Token refresh initiated: user={user_id} grant_type=refresh_token device_id=iPhone15,3 os=iOS-18.3", t, s1, "auth.TokenRefreshHandler"),
        make_log(base_off+1,    "wallet-service",        "ERROR", f"Token refresh rejected: user={user_id} reason=refresh_token_revoked revoked_at=2026-03-03T03:50:00Z revocation_reason=suspicious_activity ip_mismatch=true", t, s2, "auth.RefreshTokenService"),
        make_log(base_off+2,    "api-gateway",           "ERROR", f"Authentication failed: user={user_id} action=token_refresh error=REFRESH_TOKEN_REVOKED response=401 device=iPhone15,3", t, s1, "auth.AuthenticationFailureHandler"),
        make_log(base_off+3,    "fraud-engine",          "WARN",  f"Suspicious auth pattern: user={user_id} failed_refreshes=3 in_window=300s ip_addresses=2 geolocations=[US-CA, RO-B] risk_score=0.87", t, s3, "detector.AuthAnomalyDetector"),
        make_log(base_off+4,    "audit-logger",          "WARN",  f"Security event: AUTH_ANOMALY user={user_id} action=account_locked reason=suspicious_refresh_pattern geo_anomaly=true", t, s2, "service.SecurityAuditService"),
    ]

def flow_pci_compliance_violation(base_off):
    """PCI-DSS compliance violation detected during routine scan"""
    t, s1, s2, s3, s4 = tid(), sid(), sid(), sid(), sid()
    return [
        make_log(base_off,      "audit-logger",          "INFO",  f"PCI-DSS compliance scan initiated: scan_id=SCAN-{random.randint(10000,99999)} scope=cardholder_data_environment", t, s1, "compliance.PciComplianceScanner"),
        make_log(base_off+2,    "audit-logger",          "ERROR", f"PCI-DSS VIOLATION [Req 3.4]: Unmasked PAN detected in log output - service=merchant-service log_line_hash=sha256:{hashlib.sha256(str(random.random()).encode()).hexdigest()[:16]} field=response_body", t, s1, "compliance.PanDetectionEngine"),
        make_log(base_off+2,    "audit-logger",          "FATAL", f"CRITICAL COMPLIANCE: PAN data exposure in merchant-service response logs - immediate remediation required - QSA notification triggered", t, s1, "compliance.PciViolationHandler"),
        make_log(base_off+3,    "merchant-service",      "ERROR", f"PCI violation remediation: emergency log redaction applied - affected_log_entries=23 time_range=2026-03-03T03:45:00Z/2026-03-03T04:00:00Z pattern=\\b[3-6]\\d{{3}}[- ]?\\d{{4}}[- ]?\\d{{4}}[- ]?\\d{{4}}\\b", t, s2, "security.PanRedactionService"),
        make_log(base_off+4,    "notification-service",  "WARN",  f"Compliance alert dispatched: PCI-DSS Req 3.4 violation - channels=[pagerduty-P1, email-compliance@apple.com, slack-#pci-incidents]", t, s3, "alert.ComplianceAlertDispatcher"),
        make_log(base_off+5,    "tokenization-service",  "INFO",  f"Emergency token rotation initiated for affected merchant data scope - rotation_batch_size=500 estimated_completion=180s", t, s4, "crypto.EmergencyTokenRotation"),
    ]

def flow_load_balancer_health_flap(base_off):
    """Load balancer health check flapping causing intermittent 503s"""
    t, s1, s2, s3, s4 = tid(), sid(), sid(), sid(), sid()
    return [
        make_log(base_off,      "api-gateway",           "WARN",  f"Health check probe slow: endpoint=/actuator/health response_time=4800ms threshold=3000ms healthy_threshold=3 consecutive_failures=2", t, s1, "health.HealthCheckEndpoint"),
        make_log(base_off+1,    "api-gateway",           "ERROR", f"Removed from load balancer pool: instance=api-gw-{random.randint(1,5)} reason=health_check_timeout consecutive_failures=3 deregistration_delay=30s", t, s1, "health.LoadBalancerRegistration"),
        make_log(base_off+5,    "api-gateway",           "INFO",  f"Health check recovered: endpoint=/actuator/health response_time=45ms - re-registering with load balancer", t, s1, "health.HealthCheckEndpoint"),
        make_log(base_off+8,    "api-gateway",           "WARN",  f"Health check flapping detected: state_changes=7 in_window=300s pattern=healthy→unhealthy→healthy→unhealthy current=UNHEALTHY", t, s2, "health.HealthFlapDetector"),
        make_log(base_off+9,    "payment-orchestrator",  "WARN",  f"Upstream availability degraded: service=api-gateway healthy_instances=2/5 connection_errors=127 in_last_60s", t, s3, "monitoring.UpstreamHealthMonitor"),
        make_log(base_off+10,   "fraud-engine",          "WARN",  f"Request routing instability: retries_to_api-gateway=45 in_last_60s retry_budget_remaining=23% circuit_state=HALF_OPEN", t, s4, "resilience.RetryBudgetMonitor"),
    ]


# ═══════════════════════════════════════════════════════════════════════
#  Generate 400 logs
# ═══════════════════════════════════════════════════════════════════════

FLOWS = [
    (flow_tls_cert_expiry,               0.15, "tls_cert_expiry"),
    (flow_db_deadlock,                   0.10, "db_deadlock"),
    (flow_oom_kill,                      0.10, "oom_kill"),
    (flow_dns_resolution_failure,        0.10, "dns_failure"),
    (flow_redis_cache_storm,             0.10, "redis_cache_storm"),
    (flow_encryption_key_rotation_failure, 0.08, "key_rotation_failure"),
    (flow_kafka_backpressure,            0.10, "kafka_backpressure"),
    (flow_webhook_delivery_failure,      0.10, "webhook_failure"),
    (flow_jwt_session_expiry,            0.09, "jwt_expiry"),
    (flow_pci_compliance_violation,      0.04, "pci_violation"),
    (flow_load_balancer_health_flap,     0.04, "lb_health_flap"),
]

all_logs = []
offset = 0
trace_count = 0

while len(all_logs) < 400:
    # Pick flow by weight
    weights = [w for _, w, _ in FLOWS]
    flow_fn, _, flow_name = random.choices(FLOWS, weights=weights, k=1)[0]

    logs = flow_fn(offset)
    remaining = 400 - len(all_logs)

    if len(logs) <= remaining:
        all_logs.extend(logs)
        trace_count += 1
    else:
        all_logs.extend(logs[:remaining])
        trace_count += 1

    offset += random.randint(15, 90)

# Sort by timestamp
all_logs.sort(key=lambda x: x["timestamp"])

# Stats
levels = {}
services = {}
traces = set()
flow_types = {}
for l in all_logs:
    levels[l["level"]] = levels.get(l["level"], 0) + 1
    services[l["service"]] = services.get(l["service"], 0) + 1
    traces.add(l["trace_id"])

print(f"Generated {len(all_logs)} logs")
print(f"Unique traces: {len(traces)}")
print(f"Level distribution: {json.dumps(levels, indent=2)}")
print(f"Service distribution: {json.dumps(services, indent=2)}")

out_path = "scripts/applepay-otel-400-batch2.json"
with open(out_path, "w") as f:
    json.dump(all_logs, f, indent=2)
print(f"\nSaved to {out_path}")
