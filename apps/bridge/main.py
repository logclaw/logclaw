"""
LogClaw Bridge Service — dev-mode replacement for Apache Flink stream processing.

Consumes OTLP-encoded log batches from Kafka, flattens each log record into
the canonical LogClaw format, performs statistical anomaly detection (z-score
on per-service error rates), and bulk-indexes enriched logs and anomaly events
into OpenSearch.

Architecture:
  Thread 1 (OTLP ETL) : raw-logs (otlp_json) -> flatten -> enriched-logs
  Thread 2 (Anomaly)   : enriched-logs -> z-score detector -> anomaly-events
  Thread 3 (Indexer)   : enriched-logs + anomaly queue -> OpenSearch bulk API
  Main thread          : HTTP health/ready/metrics server on :8080

OTLP JSON Wire Format (what arrives on raw-logs topic):
  {
    "resourceLogs": [{
      "resource": { "attributes": [{"key":"service.name","value":{"stringValue":"..."}}] },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "...",
          "severityText": "INFO",
          "body": { "stringValue": "..." },
          "attributes": [...],
          "traceId": "...",
          "spanId": "..."
        }]
      }]
    }]
  }
"""

import hashlib
import json
import logging
import os
import signal
import sys
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler

import numpy as np
from kafka import KafkaConsumer, KafkaProducer
from opensearchpy import OpenSearch, helpers as os_helpers

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# ── Infrastructure (immutable — require restart) ────────────────────────
KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9092")
KAFKA_TOPIC_RAW = os.environ.get("KAFKA_TOPIC_RAW", "raw-logs")
KAFKA_TOPIC_ENRICHED = os.environ.get("KAFKA_TOPIC_ENRICHED", "enriched-logs")
KAFKA_TOPIC_ANOMALIES = os.environ.get("KAFKA_TOPIC_ANOMALIES", "anomaly-events")
OPENSEARCH_ENDPOINT = os.environ.get("OPENSEARCH_ENDPOINT", "http://localhost:9200")
TENANT_ID = os.environ.get("TENANT_ID", "dev-local")

BUCKET_WIDTH = 10  # seconds per sliding-window bucket

# ── Runtime config (mutable via API) ────────────────────────────────────
_bridge_config_lock = threading.Lock()
_bridge_config = {
    "zscoreThreshold": float(os.environ.get("ANOMALY_ZSCORE_THRESHOLD", "2.0")),
    "windowSeconds": int(os.environ.get("ANOMALY_WINDOW_SECONDS", "300")),
    "bulkSize": int(os.environ.get("OPENSEARCH_BULK_SIZE", "500")),
    "bulkIntervalSeconds": float(os.environ.get("OPENSEARCH_BULK_INTERVAL_SECONDS", "5")),
}


def get_bridge_config() -> dict:
    with _bridge_config_lock:
        return dict(_bridge_config)


def update_bridge_config(patch: dict) -> dict:
    valid_keys = {"zscoreThreshold", "windowSeconds", "bulkSize", "bulkIntervalSeconds"}
    with _bridge_config_lock:
        for k, v in patch.items():
            if k not in valid_keys:
                continue
            if k == "zscoreThreshold":
                _bridge_config[k] = float(v)
            elif k in ("windowSeconds", "bulkSize"):
                _bridge_config[k] = int(v)
            elif k == "bulkIntervalSeconds":
                _bridge_config[k] = float(v)
        return dict(_bridge_config)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("logclaw.bridge")

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
shutdown_event = threading.Event()
anomaly_queue: deque = deque(maxlen=10_000)  # Thread 2 -> Thread 3

# Metrics counters (simple atomic-ish ints protected by the GIL)
metrics = {
    "etl_consumed": 0,
    "etl_records_received": 0,
    "etl_produced": 0,
    "etl_errors": 0,
    "anomaly_consumed": 0,
    "anomaly_detected": 0,
    "anomaly_errors": 0,
    "indexer_consumed": 0,
    "indexer_indexed": 0,
    "indexer_bulk_requests": 0,
    "indexer_errors": 0,
}

# Readiness flags per consumer group
ready_flags = {
    "etl": threading.Event(),
    "anomaly": threading.Event(),
    "indexer": threading.Event(),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_consumer(topic: str, group_id: str) -> KafkaConsumer:
    brokers = KAFKA_BROKERS.split(",")
    return KafkaConsumer(
        topic,
        bootstrap_servers=brokers,
        group_id=group_id,
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        auto_commit_interval_ms=5000,
        consumer_timeout_ms=1000,
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
        reconnect_backoff_ms=500,
        reconnect_backoff_max_ms=10000,
    )


def _make_producer() -> KafkaProducer:
    brokers = KAFKA_BROKERS.split(",")
    return KafkaProducer(
        bootstrap_servers=brokers,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        acks="all",
        retries=3,
        retry_backoff_ms=500,
    )


def _opensearch_client() -> OpenSearch:
    return OpenSearch(
        hosts=[OPENSEARCH_ENDPOINT],
        use_ssl=OPENSEARCH_ENDPOINT.startswith("https"),
        verify_certs=False,
        timeout=30,
    )


# ---------------------------------------------------------------------------
# Thread 1: OTLP ETL Consumer
# ---------------------------------------------------------------------------
def etl_consumer_loop():
    """Read OTLP-encoded log batches, flatten each record, and forward to enriched-logs."""
    log.info("OTLP ETL consumer starting (group=logclaw-bridge-etl, topic=%s)", KAFKA_TOPIC_RAW)
    consumer = None
    producer = None
    try:
        consumer = _make_consumer(KAFKA_TOPIC_RAW, "logclaw-bridge-etl")
        producer = _make_producer()
        ready_flags["etl"].set()
        log.info("OTLP ETL consumer ready")

        while not shutdown_event.is_set():
            try:
                records = consumer.poll(timeout_ms=1000)
                for tp, messages in records.items():
                    for msg in messages:
                        metrics["etl_consumed"] += 1
                        try:
                            flat_docs = _flatten_otlp(msg.value)
                            metrics["etl_records_received"] += len(flat_docs)
                            for doc in flat_docs:
                                producer.send(KAFKA_TOPIC_ENRICHED, value=doc)
                                metrics["etl_produced"] += 1
                        except Exception:
                            metrics["etl_errors"] += 1
                            log.exception("OTLP flatten error")
            except Exception:
                if not shutdown_event.is_set():
                    metrics["etl_errors"] += 1
                    log.exception("OTLP ETL poll error")
                    time.sleep(2)
    finally:
        _close_safely(consumer, "ETL consumer")
        _close_safely(producer, "ETL producer")
        log.info("OTLP ETL consumer stopped")


# ---------------------------------------------------------------------------
# OTLP JSON → flat LogClaw document translator
# ---------------------------------------------------------------------------
def _extract_otel_attr_value(attr_value: dict):
    """Extract a scalar value from an OTLP AnyValue wrapper.

    OTLP encodes attribute values as one-of wrappers, e.g.:
      {"stringValue": "foo"}  |  {"intValue": 42}  |  {"boolValue": true}
    """
    for key in ("stringValue", "intValue", "doubleValue", "boolValue"):
        if key in attr_value:
            return attr_value[key]
    if "arrayValue" in attr_value:
        return [_extract_otel_attr_value(v) for v in attr_value["arrayValue"].get("values", [])]
    if "kvlistValue" in attr_value:
        return {
            kv["key"]: _extract_otel_attr_value(kv["value"])
            for kv in attr_value["kvlistValue"].get("values", [])
        }
    return None


def _otel_attrs_to_dict(attrs: list) -> dict:
    """Convert a list of OTLP KeyValue pairs to a flat dict."""
    result = {}
    for kv in attrs:
        key = kv.get("key", "")
        value = kv.get("value", {})
        result[key] = _extract_otel_attr_value(value)
    return result


def _nano_to_iso(nano_str: str) -> str:
    """Convert OTLP timeUnixNano (string of nanoseconds) to ISO-8601."""
    try:
        ns = int(nano_str)
        dt = datetime.fromtimestamp(ns / 1e9, tz=timezone.utc)
        return dt.isoformat()
    except (ValueError, TypeError, OSError):
        return _now_iso()


def _flatten_otlp(raw: dict) -> list[dict]:
    """Flatten an OTLP JSON log batch into a list of canonical LogClaw documents.

    The OTel Collector's Kafka exporter writes one Kafka message per
    ExportLogsServiceRequest.  Each message has the structure:

        resourceLogs[] → scopeLogs[] → logRecords[]

    This function walks the nested structure, extracts resource-level
    attributes (service.name, tenant_id, etc.), scope info, and each
    individual log record — producing one flat dict per log record.
    """
    flat_docs: list[dict] = []
    resource_logs = raw.get("resourceLogs", [])

    for rl in resource_logs:
        # ── Resource-level attributes (service.name, host.name, etc.) ──
        resource = rl.get("resource", {})
        res_attrs = _otel_attrs_to_dict(resource.get("attributes", []))

        service_name = res_attrs.pop("service.name", "unknown")
        tenant_id = res_attrs.pop("tenant_id", TENANT_ID)

        for sl in rl.get("scopeLogs", []):
            scope = sl.get("scope", {})
            scope_name = scope.get("name", "")

            for lr in sl.get("logRecords", []):
                # ── Core log fields ──
                body_wrapper = lr.get("body", {})
                message = body_wrapper.get("stringValue", "")
                if not message:
                    message = json.dumps(body_wrapper) if body_wrapper else "(no message)"

                level = lr.get("severityText", "INFO").upper()
                if not level:
                    level = "INFO"
                # Normalize CRITICAL/ALERT/EMERGENCY → FATAL (six-level enum)
                if level in ("CRITICAL", "ALERT", "EMERGENCY"):
                    level = "FATAL"
                if level.startswith("WARN") and level != "WARN":
                    level = "WARN"

                timestamp = _nano_to_iso(lr.get("timeUnixNano", "0"))
                observed_ts = _nano_to_iso(lr.get("observedTimeUnixNano", "0"))

                # ── Trace context ──
                trace_id = lr.get("traceId", "")
                span_id = lr.get("spanId", "")

                # ── log_id — deterministic UUID5 for dedup ──
                if trace_id and timestamp:
                    log_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{trace_id}|{span_id}|{timestamp}"))
                else:
                    log_id = str(uuid.uuid4())

                # ── Environment ──
                environment = res_attrs.pop("deployment.environment", "") or TENANT_ID

                # ── Log record attributes ──
                log_attrs = _otel_attrs_to_dict(lr.get("attributes", []))

                # ── Build canonical flat document (conforms to enriched-log.v1 schema) ──
                doc = {
                    "@timestamp": timestamp,
                    "log_id": log_id,
                    "observed_timestamp": observed_ts,
                    "ingest_timestamp": _now_iso(),
                    "level": level,
                    "message": message,
                    "service": service_name,
                    "tenant_id": tenant_id,
                    "environment": environment,
                    "trace_id": trace_id,
                    "span_id": span_id,
                }

                # Merge log-record attributes as top-level fields
                for k, v in log_attrs.items():
                    # Avoid overwriting core fields
                    safe_key = k.replace(".", "_")
                    if safe_key not in doc:
                        doc[safe_key] = v

                # Carry resource attributes as prefixed fields
                for k, v in res_attrs.items():
                    safe_key = f"resource_{k.replace('.', '_')}"
                    if safe_key not in doc:
                        doc[safe_key] = v

                # Scope metadata
                if scope_name:
                    doc["scope_name"] = scope_name

                flat_docs.append(doc)

    # Fallback: if the message doesn't look like OTLP at all, treat it as
    # a simple flat JSON doc (backward compatibility during migration).
    if not flat_docs and not resource_logs:
        log.debug("Non-OTLP message received — applying legacy normalize")
        flat_docs.append(_normalize_legacy(raw))

    return flat_docs


def _normalize_legacy(raw: dict) -> dict:
    """Legacy normalizer for non-OTLP flat JSON messages (migration fallback)."""
    doc = dict(raw)

    # Normalize level (CRITICAL → FATAL)
    level = str(doc.get("level", "INFO")).upper()
    if level in ("CRITICAL", "ALERT", "EMERGENCY"):
        level = "FATAL"
    if level.startswith("WARN") and level != "WARN":
        level = "WARN"
    doc["level"] = level

    if "message" not in doc or not doc["message"]:
        doc["message"] = "(no message)"

    # Migrate timestamp → @timestamp
    if "timestamp" in doc and "@timestamp" not in doc:
        doc["@timestamp"] = doc.pop("timestamp")
    doc.setdefault("@timestamp", _now_iso())

    doc["ingest_timestamp"] = _now_iso()
    doc.setdefault("tenant_id", TENANT_ID)
    doc.setdefault("service", "unknown")
    doc.setdefault("environment", TENANT_ID)

    # Generate log_id if missing
    if "log_id" not in doc:
        tid = doc.get("trace_id", "")
        sid = doc.get("span_id", "")
        ts = doc.get("@timestamp", "")
        if tid and ts:
            doc["log_id"] = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{tid}|{sid}|{ts}"))
        else:
            doc["log_id"] = str(uuid.uuid4())

    return doc


# ---------------------------------------------------------------------------
# Thread 2: Anomaly Detector
# ---------------------------------------------------------------------------
class SlidingWindowBucket:
    __slots__ = ("error_count", "total_count")

    def __init__(self):
        self.error_count = 0
        self.total_count = 0


def anomaly_detector_loop():
    """Track per-service error rates and emit anomaly events on z-score spikes."""
    log.info("Anomaly detector starting (group=logclaw-bridge-anomaly, topic=%s)", KAFKA_TOPIC_ENRICHED)
    consumer = None
    producer = None
    try:
        consumer = _make_consumer(KAFKA_TOPIC_ENRICHED, "logclaw-bridge-anomaly")
        producer = _make_producer()
        ready_flags["anomaly"].set()
        log.info("Anomaly detector ready")

        # service_name -> deque of (bucket_ts, SlidingWindowBucket)
        cfg = get_bridge_config()
        windows: dict[str, deque] = defaultdict(lambda: deque(maxlen=cfg["windowSeconds"] // BUCKET_WIDTH))

        while not shutdown_event.is_set():
            try:
                records = consumer.poll(timeout_ms=1000)
                for tp, messages in records.items():
                    for msg in messages:
                        metrics["anomaly_consumed"] += 1
                        try:
                            _process_anomaly_record(msg.value, windows, producer)
                        except Exception:
                            metrics["anomaly_errors"] += 1
                            log.exception("Anomaly processing error")
            except Exception:
                if not shutdown_event.is_set():
                    metrics["anomaly_errors"] += 1
                    log.exception("Anomaly poll error")
                    time.sleep(2)
    finally:
        _close_safely(consumer, "Anomaly consumer")
        _close_safely(producer, "Anomaly producer")
        log.info("Anomaly detector stopped")


def _process_anomaly_record(doc: dict, windows: dict, producer: "KafkaProducer"):
    cfg = get_bridge_config()
    service = doc.get("service", "unknown")
    level = doc.get("level", "INFO").upper()
    is_error = level in ("ERROR", "FATAL", "CRITICAL")

    now_ts = time.time()

    window = windows[service]

    if not window or window[-1][0] != bucket_ts:
        window.append((bucket_ts, SlidingWindowBucket()))
    current_bucket = window[-1][1]
    current_bucket.total_count += 1
    if is_error:
        current_bucket.error_count += 1

    cutoff = now_ts - cfg["windowSeconds"]
    while window and window[0][0] < cutoff:
        window.popleft()

    # ═══════════════════════════════════════════════════════════════════════
    # STAGE 2c: WINDOWED STATISTICAL SIGNALS
    # Z-score is ONE signal among many, not the sole gatekeeper
    # ═══════════════════════════════════════════════════════════════════════
    # Need at least 3 buckets to compute meaningful statistics
    if len(window) < 3:
        return

    rates = []
    for _, bucket in window:
        rates.append(bucket.error_count / bucket.total_count if bucket.total_count > 0 else 0.0)

    rates_arr = np.array(rates, dtype=np.float64)
    mean = np.mean(rates_arr)
    std = np.std(rates_arr)
    current_rate = rates[-1]
    z_score: float | None = None

    if std < 1e-9:
        # FIX: std=0 (constant error rate) is no longer silently dropped.
        # A constant HIGH error rate is a sustained failure — it IS an incident.
        metrics["anomaly_std_zero_detected"] += 1
        if mean >= 0.5:
            signals["zscore:sustained_failure"] = min(mean * 2.0, 1.0)
        elif mean >= 0.1:
            signals["zscore:elevated_baseline"] = mean
        # z_score stays None — composite scoring continues below
    else:
        z_score = (current_rate - mean) / std
        if z_score >= cfg["zscoreThreshold"]:
            signals["zscore:spike"] = min(z_score / 5.0, 1.0)

    # ═══════════════════════════════════════════════════════════════════════
    # STAGE 2d: CONTEXTUAL SIGNALS (blast radius, velocity, recurrence)
    # ═══════════════════════════════════════════════════════════════════════
    if is_error:
        br = _blast_radius_signal(tenant_id, service, now_ts, cfg["blastRadiusWindowSeconds"])
        if br > 0:
            signals["context:blast_radius"] = br

        vel = _velocity_signal(window, current_bucket)
        if vel > 0:
            signals["context:velocity"] = vel

        error_template = _normalize_error(doc.get("message", ""))
        rec = _recurrence_signal(tenant_id, error_template, now_ts)
        if rec > 0:
            signals["context:recurrence"] = rec

    # ═══════════════════════════════════════════════════════════════════════
    # STAGE 3: DECISION ENGINE — emit if composite score meets threshold
    # ═══════════════════════════════════════════════════════════════════════
    if not signals:
        return

    score, severity = _compute_composite_score(signals)

    if score < cfg["compositeScoreThreshold"]:
        metrics["anomaly_below_threshold"] += 1
        return

    window_stats = {
        "current_rate": current_rate,
        "buckets": len(window),
        "mean_rate": mean,
        "std": std,
    }
    _emit_anomaly_event(
        doc, signals, score, severity, tenant_id, service,
        producer, detection_mode="windowed",
        z_score=z_score,
        window_stats=window_stats,
    )


def _classify_zscore(z: float) -> tuple[str, float]:
    if z >= 4.0:
        return "critical", 0.98
    elif z >= 3.0:
        return "high", 0.90
    elif z >= 2.5:
        return "medium", 0.80
    else:
        return "low", 0.70


# ---------------------------------------------------------------------------
# Signal-Based Incident Classification (Thread 2 helpers)
# ---------------------------------------------------------------------------

# Severity weights by log level
_SEVERITY_WEIGHTS: dict[str, float] = {
    "FATAL": 1.0,
    "CRITICAL": 0.95,
    "ERROR": 0.70,
    "WARN": 0.30,
    "WARNING": 0.30,
}

# Pattern groups — language-agnostic regex scanning exception_type + message.
# A single record can match MULTIPLE patterns (multi-signal).
_EXCEPTION_PATTERNS: list[tuple[str, re.Pattern, float]] = [
    # (name, compiled_regex, weight)
    ("oom",        re.compile(r"out.?of.?memory|oom|heap.?space|memory.?limit|gc.?overhead|java\.lang\.OutOfMemoryError", re.I), 0.95),
    ("crash",      re.compile(r"segfault|sigsegv|sigabrt|sigkill|panic:|fatal error|core.?dump|stack.?overflow|process.?died|killed", re.I), 0.95),
    ("resource",   re.compile(r"resource.?exhausted|no.?space.?left|disk.?full|too.?many.?open.?files|file.?descriptor|ulimit", re.I), 0.80),
    ("dependency", re.compile(r"service.?unavailable|bad.?gateway|upstream.?connect|upstream.?unavailable|circuit.?break|502|503|504", re.I), 0.75),
    ("db",         re.compile(r"deadlock|lock.?timeout|duplicate.?key|constraint.?violation|sql.?exception|transaction.?abort|connection.?pool.?exhausted|too.?many.?connections", re.I), 0.75),
    ("timeout",    re.compile(r"timeout|timed?.?out|deadline.?exceeded|context.?deadline|read.?timeout|write.?timeout|connect.?timeout|operation.?timed", re.I), 0.70),
    ("connection", re.compile(r"econnrefused|econnreset|broken.?pipe|connection.?refused|connection.?reset|socket.?closed|eof.?error|network.?unreachable", re.I), 0.65),
    ("auth",       re.compile(r"unauthorized|forbidden|access.?denied|invalid.?token|signature.?verification|jwt.?expired|permission.?denied", re.I), 0.40),
]

# Patterns that warrant IMMEDIATE emission without waiting for windowed stats
_IMMEDIATE_PATTERN_NAMES: frozenset[str] = frozenset({"oom", "crash", "resource"})

# Composite score category weights (must sum to 1.0)
_CATEGORY_WEIGHTS: dict[str, float] = {
    "pattern":     0.30,  # Exception/message patterns (what type of failure)
    "statistical": 0.25,  # Z-score spike or sustained failure rate
    "context":     0.15,  # Blast radius + velocity + recurrence
    "http":        0.10,  # HTTP 5xx evidence
    "severity":    0.10,  # Log level weight
    "structural":  0.10,  # Stacktrace depth + error category
}

# ── Shared state for signal tracking (Thread 2 only — no cross-thread contention) ──
_service_error_tracker: dict[str, dict[str, float]] = defaultdict(dict)   # tenant -> {svc: last_err_ts}
_error_template_history: dict = defaultdict(lambda: defaultdict(lambda: {"count": 0, "first_seen": 0.0, "last_seen": 0.0}))
_immediate_dedup: dict[tuple, float] = {}   # (tenant, service, pattern) -> last_emit_ts


def _http_signal(status_code) -> tuple[str, float]:
    """Map HTTP status code to (signal_name, weight). Returns ('', 0.0) if not incident-worthy."""
    try:
        code = int(status_code)
    except (TypeError, ValueError):
        return "", 0.0
    if code == 503:
        return "http:service_unavailable", 0.90
    elif code == 502:
        return "http:bad_gateway", 0.80
    elif code == 504:
        return "http:gateway_timeout", 0.85
    elif code >= 500:
        return "http:server_error", 0.70
    elif code == 429:
        return "http:rate_limit", 0.50
    elif code in (401, 403):
        return "http:auth_error", 0.40
    return "", 0.0


def _stacktrace_signal(stacktrace: str) -> float:
    """Estimate stacktrace depth signal weight from frame count."""
    if not stacktrace:
        return 0.0
    # Count frames for Java, Python, Go, Node.js
    frame_count = (
        stacktrace.count("\n\tat ")          # Java
        + stacktrace.count("\n  File ")      # Python
        + stacktrace.count("\ngoroutine ")   # Go
        + stacktrace.count("\n    at ")      # Node.js / Rust
    )
    if frame_count >= 16:
        return 0.30
    elif frame_count >= 6:
        return 0.15
    elif frame_count >= 2:
        return 0.05
    return 0.0


def _extract_signals(doc: dict) -> dict[str, float]:
    """Extract a signal vector {signal_name: weight} from an enriched log record.

    Pattern-based: new or unknown exception types are still scored via
    severity, HTTP code, stacktrace, and message content. Not if/else.
    """
    signals: dict[str, float] = {}
    level = doc.get("level", "INFO").upper()
    message = doc.get("message", "")
    exception_type = doc.get("exception_type", "") or ""
    exception_msg = doc.get("exception_message", "") or ""
    stacktrace = doc.get("exception_stacktrace", "") or ""
    http_status = doc.get("http_status_code")

    # Combined text for pattern matching (language-agnostic)
    combined = f"{exception_type} {exception_msg} {message}"

    # Severity signal
    sev = _SEVERITY_WEIGHTS.get(level, 0.0)
    if sev > 0:
        signals["severity"] = sev

    # Exception pattern signals (multi-match)
    for name, regex, weight in _EXCEPTION_PATTERNS:
        if regex.search(combined):
            signals[f"pattern:{name}"] = weight

    # HTTP status signal
    if http_status is not None:
        sig_name, sig_weight = _http_signal(http_status)
        if sig_name:
            signals[sig_name] = sig_weight

    # Stacktrace depth signal
    st_weight = _stacktrace_signal(stacktrace)
    if st_weight > 0:
        signals["structural:stacktrace"] = st_weight

    # Reuse existing category classifier for structural signal
    if level in ("ERROR", "FATAL", "CRITICAL"):
        cat = _classify_error(combined)
        if cat != "unknown":
            signals[f"structural:category:{cat}"] = 0.30

    return signals


def _blast_radius_signal(tenant_id: str, service: str, now: float, window_seconds: int) -> float:
    """Track how many services are simultaneously erroring per tenant."""
    tracker = _service_error_tracker[tenant_id]
    tracker[service] = now
    # Prune stale entries
    stale = [s for s, ts in tracker.items() if now - ts > window_seconds]
    for s in stale:
        del tracker[s]
    count = len(tracker)
    if count >= 5:
        return 0.90
    elif count >= 3:
        return 0.60
    elif count >= 2:
        return 0.30
    return 0.0


def _velocity_signal(window: deque, current_bucket: SlidingWindowBucket) -> float:
    """Detect rapid error acceleration vs. historical average."""
    if len(window) < 2:
        return 0.0
    prev_errors = [b.error_count for _, b in list(window)[:-1]]
    avg_prev = sum(prev_errors) / len(prev_errors) if prev_errors else 0.0
    cur = current_bucket.error_count
    if avg_prev < 1:
        if cur >= 10:
            return 0.80
        elif cur >= 5:
            return 0.60
        elif cur >= 2:
            return 0.40
        return 0.0
    ratio = cur / avg_prev
    if ratio >= 5.0:
        return 0.80
    elif ratio >= 3.0:
        return 0.50
    elif ratio >= 2.0:
        return 0.30
    return 0.0


def _recurrence_signal(tenant_id: str, error_template: str, now: float) -> float:
    """Boost score for novel error templates; dampen heavily recurring ones."""
    key = hashlib.md5(error_template.encode()).hexdigest()[:16]
    entry = _error_template_history[tenant_id][key]
    is_new = entry["count"] == 0
    entry["count"] += 1
    if is_new:
        entry["first_seen"] = now
    entry["last_seen"] = now
    # Periodic prune (every 200 records per template)
    if entry["count"] % 200 == 0:
        history = _error_template_history[tenant_id]
        stale = [k for k, v in history.items() if now - v["last_seen"] > 3600]
        for k in stale:
            del history[k]
    if is_new:
        return 0.30   # Novel pattern — boost
    elif entry["count"] <= 5:
        return 0.10   # Recently appeared
    return 0.0         # Well-known, no signal contribution


def _compute_composite_score(signals: dict[str, float]) -> tuple[float, str]:
    """Combine signal vector into a composite [0,1] score and severity label.

    Groups signals by category, takes the max per category, then computes
    a weighted sum using _CATEGORY_WEIGHTS. This avoids double-counting
    multiple signals in the same category.
    """
    buckets: dict[str, list[float]] = {k: [] for k in _CATEGORY_WEIGHTS}

    for name, weight in signals.items():
        if name.startswith("pattern:"):
            buckets["pattern"].append(weight)
        elif name.startswith("zscore:"):
            buckets["statistical"].append(weight)
        elif name.startswith("http:"):
            buckets["http"].append(weight)
        elif name in ("context:blast_radius", "context:velocity", "context:recurrence"):
            buckets["context"].append(weight)
        elif name == "severity":
            buckets["severity"].append(weight)
        else:
            buckets["structural"].append(weight)

    composite = 0.0
    for cat, weights in buckets.items():
        if weights:
            composite += max(weights) * _CATEGORY_WEIGHTS.get(cat, 0.0)

    composite = min(round(composite, 3), 1.0)

    # Critical immediate patterns (OOM, crash, resource) guarantee minimum score of 0.65.
    # The statistical/context categories are unavailable on the immediate path, so
    # we compensate to ensure these always exceed the ticketing agent threshold (0.5).
    immediate_matched = any(
        signals.get(f"pattern:{p}", 0) >= 0.80
        for p in _IMMEDIATE_PATTERN_NAMES
    )
    if immediate_matched:
        composite = max(composite, 0.65)

    if composite >= 0.85:
        severity = "critical"
    elif composite >= 0.65:
        severity = "high"
    elif composite >= 0.45:
        severity = "medium"
    else:
        severity = "low"

    return composite, severity


def _should_emit_immediately(signals: dict[str, float]) -> bool:
    """Return True when signals indicate a process is actively dying right now.

    These patterns cannot wait 30s for windowed statistics.
    """
    for name, weight in signals.items():
        if name.startswith("pattern:"):
            pattern_type = name[len("pattern:"):]
            if pattern_type in _IMMEDIATE_PATTERN_NAMES and weight >= 0.80:
                return True
    # FATAL + any pattern match
    if signals.get("severity", 0) >= 0.95:
        pattern_weights = [v for k, v in signals.items() if k.startswith("pattern:")]
        if pattern_weights and max(pattern_weights) >= 0.50:
            return True
    # Cascading failure across services
    if signals.get("context:blast_radius", 0) >= 0.60:
        return True
    return False


def _can_emit_immediate(tenant_id: str, service: str, signals: dict[str, float], now: float,
                         dedup_seconds: int) -> bool:
    """Rate-limit immediate emissions: 1 per (tenant, service, dominant_pattern) per dedup window."""
    dominant = max(
        ((k, v) for k, v in signals.items() if k.startswith("pattern:")),
        key=lambda x: x[1],
        default=("pattern:unknown", 0.0),
    )[0]
    key = (tenant_id, service, dominant)
    last = _immediate_dedup.get(key, 0.0)
    if now - last < dedup_seconds:
        return False
    _immediate_dedup[key] = now
    # Prune stale entries
    stale = [k for k, ts in _immediate_dedup.items() if now - ts > dedup_seconds * 5]
    for k in stale:
        del _immediate_dedup[k]
    return True


def _emit_anomaly_event(
    doc: dict,
    signals: dict[str, float],
    score: float,
    severity: str,
    tenant_id: str,
    service: str,
    producer: "KafkaProducer",
    detection_mode: str,
    z_score: float | None = None,
    window_stats: dict | None = None,
):
    """Build and publish a signal-enriched anomaly event to Kafka + anomaly_queue."""
    message = doc.get("message", "")
    error_template = _normalize_error(message)
    error_category = _classify_error(message)

    # Human-readable summary of top 3 signals
    top_signals = sorted(signals.items(), key=lambda x: x[1], reverse=True)[:3]
    signal_summary = ", ".join(f"{k}={v:.2f}" for k, v in top_signals)

    description = (
        f"Incident signal detected for service '{service}': "
        f"score={score:.2f}, severity={severity}, mode={detection_mode}, "
        f"signals=[{signal_summary}]"
    )

    now = _now_iso()
    anomaly_event = {
        # ── Backward-compatible fields ──
        "event_id": str(uuid.uuid4()),
        "@timestamp": now,
        "detected_at": now,
        "tenant_id": TENANT_ID,
        "anomaly_type": "error_rate_spike",
        "severity": severity,
        "service": service,
        "message": f"Error rate spike: z={z_score:.2f} rate={current_rate:.3f} for {service}",
        "description": (
            f"Error rate spike detected for service '{service}': "
            f"z-score={z_score:.2f}, current_rate={current_rate:.3f}, "
            f"mean_rate={mean:.3f}, std={std:.3f}"
        ),
        "anomaly_score": round(anomaly_score, 2),
        "affected_endpoint": doc.get("endpoint", ""),
        "affected_services": [service],
        "evidence_logs": [],
        "status": "open",
        "environment": TENANT_ID,
        "z_score": round(z_score, 2),
        "error_rate": round(current_rate, 4),
        # Signal-based detection metadata
        "detection_mode": "windowed",
        "signal_weights": {
            "severity_score": 0.0,
            "pattern_score": 0.0,
            "statistical_score": round(anomaly_score, 2),
            "z_score_raw": round(z_score, 2),
            "total": round(anomaly_score, 2),
        },
    }

    producer.send(KAFKA_TOPIC_ANOMALIES, value=anomaly_event)
    anomaly_queue.append(anomaly_event)
    metrics["anomaly_detected"] += 1
    if detection_mode == "immediate":
        metrics["anomaly_immediate_detected"] += 1
    else:
        metrics["anomaly_windowed_detected"] += 1
    log.info(
        "Anomaly [%s]: service=%s severity=%s score=%.2f signals=%d",
        detection_mode, service, severity, score, len(signals),
    )


# ---------------------------------------------------------------------------
# Thread 3: OpenSearch Indexer
# ---------------------------------------------------------------------------
def opensearch_indexer_loop():
    """Bulk-index enriched logs and anomaly events into OpenSearch."""
    cfg = get_bridge_config()
    log.info(
        "OpenSearch indexer starting (group=logclaw-bridge-indexer, topic=%s, bulk_size=%d, interval=%.1fs)",
        KAFKA_TOPIC_ENRICHED, cfg["bulkSize"], cfg["bulkIntervalSeconds"],
    )
    consumer = None
    os_client = None
    try:
        consumer = _make_consumer(KAFKA_TOPIC_ENRICHED, "logclaw-bridge-indexer")
        os_client = _opensearch_client()
        ready_flags["indexer"].set()
        log.info("OpenSearch indexer ready")

        buffer: list[dict] = []
        last_flush = time.time()

        while not shutdown_event.is_set():
            try:
                records = consumer.poll(timeout_ms=500)
                for tp, messages in records.items():
                    for msg in messages:
                        metrics["indexer_consumed"] += 1
                        doc = msg.value
                        today = datetime.now(timezone.utc).strftime("%Y.%m.%d")
                        action = {
                            "_index": f"logclaw-logs-{today}",
                            "_source": doc,
                        }
                        # Idempotent writes: use a deterministic _id so duplicate
                        # Kafka messages (e.g. from Flink restarts) overwrite instead
                        # of creating extra documents.
                        if isinstance(doc, dict):
                            doc_id = doc.get("log_id")
                            if not doc_id:
                                # Fallback: hash trace_id + span_id + @timestamp
                                tid = doc.get("trace_id", "")
                                sid = doc.get("span_id", "")
                                ts = doc.get("@timestamp", "")
                                if tid and ts:
                                    key = f"{tid}|{sid}|{ts}"
                                    doc_id = hashlib.sha256(key.encode()).hexdigest()[:20]
                            if doc_id:
                                action["_id"] = doc_id
                        buffer.append(action)

                # Drain anomaly queue into buffer
                while anomaly_queue:
                    try:
                        anomaly = anomaly_queue.popleft()
                        today = datetime.now(timezone.utc).strftime("%Y.%m.%d")
                        a_action = {
                            "_index": f"logclaw-anomalies-{today}",
                            "_source": anomaly,
                        }
                        if isinstance(anomaly, dict):
                            a_id = anomaly.get("event_id")
                            if not a_id:
                                # Deterministic fallback for anomalies
                                svc = anomaly.get("service", "")
                                ts = anomaly.get("@timestamp", "")
                                if svc and ts:
                                    key = f"anomaly|{svc}|{ts}"
                                    a_id = hashlib.sha256(key.encode()).hexdigest()[:20]
                            if a_id:
                                a_action["_id"] = a_id
                        buffer.append(a_action)
                    except IndexError:
                        break

                # Flush on size or interval (use runtime config)
                cfg = get_bridge_config()
                elapsed = time.time() - last_flush
                if len(buffer) >= cfg["bulkSize"] or (buffer and elapsed >= cfg["bulkIntervalSeconds"]):
                    _flush_bulk(os_client, buffer)
                    buffer = []
                    last_flush = time.time()

            except Exception:
                if not shutdown_event.is_set():
                    metrics["indexer_errors"] += 1
                    log.exception("Indexer loop error")
                    time.sleep(2)

        # Final flush on shutdown
        if buffer:
            _flush_bulk(os_client, buffer)

    finally:
        _close_safely(consumer, "Indexer consumer")
        log.info("OpenSearch indexer stopped")


def _flush_bulk(client: OpenSearch, actions: list[dict]):
    if not actions:
        return
    try:
        success, errors = os_helpers.bulk(client, actions, raise_on_error=False)
        metrics["indexer_indexed"] += success
        metrics["indexer_bulk_requests"] += 1
        if errors:
            metrics["indexer_errors"] += len(errors)
            log.warning("Bulk index had %d errors out of %d actions", len(errors), len(actions))
            for err in errors[:3]:
                log.warning("Bulk error detail: %s", err)
        else:
            log.debug("Bulk indexed %d documents", success)
    except Exception:
        metrics["indexer_errors"] += 1
        log.exception("Bulk index request failed (%d actions)", len(actions))


# ---------------------------------------------------------------------------
# HTTP Health Server
# ---------------------------------------------------------------------------
class HealthHandler(BaseHTTPRequestHandler):
    """HTTP handler for /health, /ready, /metrics, and /config."""

    # ── CORS preflight ──────────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    # ── GET ──────────────────────────────────────────────────────────
    def do_GET(self):
        if self.path == "/health":
            self._respond_json(200, {
                "status": "healthy",
                "service": "logclaw-bridge",
                "tenant_id": TENANT_ID,
                "timestamp": _now_iso(),
            })
        elif self.path == "/ready":
            all_ready = all(f.is_set() for f in ready_flags.values())
            if all_ready:
                self._respond_json(200, {
                    "status": "ready",
                    "consumers": {k: v.is_set() for k, v in ready_flags.items()},
                })
            else:
                self._respond_json(503, {
                    "status": "not_ready",
                    "consumers": {k: v.is_set() for k, v in ready_flags.items()},
                })
        elif self.path == "/metrics":
            self._respond_metrics()
        elif self.path == "/config":
            self._respond_json(200, get_bridge_config())
        else:
            self._respond_json(404, {"error": "not found"})

    # ── PATCH ────────────────────────────────────────────────────────
    def do_PATCH(self):
        if self.path == "/config":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length else {}
                updated = update_bridge_config(body)
                log.info("Bridge config updated via API: %s", updated)
                self._respond_json(200, updated)
            except (json.JSONDecodeError, ValueError) as e:
                self._respond_json(400, {"error": str(e)})
        else:
            self._respond_json(404, {"error": "not found"})

    # ── Helpers ──────────────────────────────────────────────────────
    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond_json(self, code: int, body: dict):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(payload)

    def _respond_metrics(self):
        lines = []
        for key, value in metrics.items():
            prom_name = f"logclaw_bridge_{key}_total"
            lines.append(f"# TYPE {prom_name} counter")
            lines.append(f"{prom_name} {value}")
        # Readiness gauge
        for name, flag in ready_flags.items():
            prom_name = f"logclaw_bridge_ready_{name}"
            lines.append(f"# TYPE {prom_name} gauge")
            lines.append(f"{prom_name} {1 if flag.is_set() else 0}")
        body = "\n".join(lines) + "\n"
        payload = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        """Suppress default stderr logging; use structured logger instead."""
        log.debug("HTTP %s", format % args)


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------
def _close_safely(resource, name: str):
    if resource is None:
        return
    try:
        resource.close()
    except Exception:
        log.debug("Error closing %s (ignored)", name)


# ---------------------------------------------------------------------------
# Main entry-point
# ---------------------------------------------------------------------------
def main():
    cfg = get_bridge_config()
    log.info("=" * 60)
    log.info("LogClaw Bridge Service starting")
    log.info("  KAFKA_BROKERS          = %s", KAFKA_BROKERS)
    log.info("  KAFKA_TOPIC_RAW        = %s", KAFKA_TOPIC_RAW)
    log.info("  KAFKA_TOPIC_ENRICHED   = %s", KAFKA_TOPIC_ENRICHED)
    log.info("  KAFKA_TOPIC_ANOMALIES  = %s", KAFKA_TOPIC_ANOMALIES)
    log.info("  OPENSEARCH_ENDPOINT    = %s", OPENSEARCH_ENDPOINT)
    log.info("  TENANT_ID              = %s", TENANT_ID)
    log.info("  ANOMALY_ZSCORE_THRESH  = %.1f", cfg["zscoreThreshold"])
    log.info("  ANOMALY_WINDOW_SECONDS = %d", cfg["windowSeconds"])
    log.info("  OPENSEARCH_BULK_SIZE   = %d", cfg["bulkSize"])
    log.info("  OPENSEARCH_BULK_INTRVL = %.1fs", cfg["bulkIntervalSeconds"])
    log.info("=" * 60)

    # Validate required env vars
    if not os.environ.get("KAFKA_BROKERS"):
        log.warning("KAFKA_BROKERS not set; using default localhost:9092")
    if not os.environ.get("OPENSEARCH_ENDPOINT"):
        log.warning("OPENSEARCH_ENDPOINT not set; using default http://localhost:9200")

    # Start worker threads
    threads = [
        threading.Thread(target=etl_consumer_loop, name="otlp-etl-consumer", daemon=True),
        threading.Thread(target=anomaly_detector_loop, name="anomaly-detector", daemon=True),
        threading.Thread(target=opensearch_indexer_loop, name="opensearch-indexer", daemon=True),
    ]
    for t in threads:
        t.start()
        log.info("Started thread: %s", t.name)

    # Start HTTP health server
    server = HTTPServer(("0.0.0.0", 8080), HealthHandler)
    server_thread = threading.Thread(target=server.serve_forever, name="http-health", daemon=True)
    server_thread.start()
    log.info("Health server listening on :8080")

    # Graceful shutdown on SIGINT/SIGTERM
    def _shutdown(signum, frame):
        sig_name = signal.Signals(signum).name
        log.info("Received %s — initiating graceful shutdown", sig_name)
        shutdown_event.set()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # Block main thread until shutdown signal is received
    log.info("Bridge service running — waiting for shutdown signal")
    while not shutdown_event.is_set():
        try:
            shutdown_event.wait(timeout=1.0)
        except (KeyboardInterrupt, SystemExit):
            shutdown_event.set()
            break

    log.info("Shutdown signal received — stopping worker threads")

    # Give worker threads time to finish gracefully
    for t in threads:
        t.join(timeout=10)
        if t.is_alive():
            log.warning("Thread %s did not stop within 10s", t.name)

    server.shutdown()
    log.info("LogClaw Bridge Service stopped")


if __name__ == "__main__":
    main()
