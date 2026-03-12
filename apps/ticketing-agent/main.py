import os, sys, json, time, threading, hashlib, uuid, traceback, ssl, base64
from datetime import datetime, timezone, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse, parse_qs

# Trust internal cluster TLS certificates (self-signed by OpenSearch operator).
# Set OPENSEARCH_VERIFY_CERTS=true to enforce CA validation (opt-in for production).
_os_ssl_ctx = None
if os.environ.get("OPENSEARCH_VERIFY_CERTS", "false").lower() != "true":
    _os_ssl_ctx = ssl.create_default_context()
    _os_ssl_ctx.check_hostname = False
    _os_ssl_ctx.verify_mode = ssl.CERT_NONE

# ── Infrastructure (immutable — require restart) ─────────────────────
KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC_ANOMALIES", "anomaly-events")
KAFKA_GROUP = os.environ.get("KAFKA_CONSUMER_GROUP", "logclaw-ticketing-agent")
OS_ENDPOINT = os.environ.get("OPENSEARCH_ENDPOINT", "http://localhost:9200")
OS_USERNAME = os.environ.get("OPENSEARCH_USERNAME", "")
OS_PASSWORD = os.environ.get("OPENSEARCH_PASSWORD", "")
_os_auth_header = ""
if OS_USERNAME:
    _os_auth_header = "Basic " + base64.b64encode(
        f"{OS_USERNAME}:{OS_PASSWORD}".encode()
    ).decode()
TENANT_ID = os.environ.get("TENANT_ID", "dev-local")
API_VERSION = "v1"
ENGINE_VERSION = "2.1.0"

# ── Runtime config (mutable via API) ─────────────────────────────────
_config_lock = threading.Lock()

# Secret fields — masked in GET responses
_SECRET_FIELDS = {"apiToken", "routingKey", "apiKey", "password", "webhookUrl"}

_config = {
    "platforms": {
        "pagerduty": {
            "enabled": os.environ.get("PAGERDUTY_ENABLED", "false").lower() == "true",
            "apiUrl": os.environ.get("PAGERDUTY_API_URL", "https://events.pagerduty.com"),
            "routingKey": os.environ.get("PAGERDUTY_ROUTING_KEY", ""),
        },
        "jira": {
            "enabled": os.environ.get("JIRA_ENABLED", "false").lower() == "true",
            "baseUrl": os.environ.get("JIRA_BASE_URL", ""),
            "projectKey": os.environ.get("JIRA_PROJECT_KEY", "OPS"),
            "issueType": os.environ.get("JIRA_ISSUE_TYPE", "Bug"),
            "userEmail": os.environ.get("JIRA_USER_EMAIL", ""),
            "apiToken": os.environ.get("JIRA_API_TOKEN", ""),
        },
        "servicenow": {
            "enabled": os.environ.get("SERVICENOW_ENABLED", "false").lower() == "true",
            "instanceUrl": os.environ.get("SERVICENOW_INSTANCE_URL", ""),
            "table": os.environ.get("SERVICENOW_TABLE", "incident"),
            "username": os.environ.get("SERVICENOW_USERNAME", ""),
            "password": os.environ.get("SERVICENOW_PASSWORD", ""),
            "assignmentGroup": os.environ.get("SERVICENOW_ASSIGNMENT_GROUP", ""),
        },
        "opsgenie": {
            "enabled": os.environ.get("OPSGENIE_ENABLED", "false").lower() == "true",
            "apiUrl": os.environ.get("OPSGENIE_API_URL", "https://api.opsgenie.com"),
            "apiKey": os.environ.get("OPSGENIE_API_KEY", ""),
            "team": os.environ.get("OPSGENIE_TEAM", ""),
        },
        "slack": {
            "enabled": os.environ.get("SLACK_ENABLED", "false").lower() == "true",
            "webhookUrl": os.environ.get("SLACK_WEBHOOK_URL", ""),
            "channel": os.environ.get("SLACK_CHANNEL", "#logclaw-alerts"),
        },
    },
    "routing": {
        "critical": [],
        "high": [],
        "medium": [],
        "low": [],
    },
    "anomaly": {
        "minimumScore": float(os.environ.get("ANOMALY_MINIMUM_SCORE", "0.5")),
        "deduplicationWindowMinutes": int(os.environ.get("ANOMALY_DEDUPLICATION_WINDOW_MINUTES", "15")),
        "contextWindowSeconds": int(os.environ.get("ANOMALY_CONTEXT_WINDOW_SECONDS", "300")),
        "maxLogLinesInTicket": int(os.environ.get("ANOMALY_MAX_LOG_LINES_IN_TICKET", "50")),
        "incidentRetentionDays": int(os.environ.get("INCIDENT_RETENTION_DAYS", "97")),
    },
    "llm": {
        "provider": os.environ.get("LLM_PROVIDER", "disabled"),
        "model": os.environ.get("LLM_MODEL", ""),
        "endpoint": os.environ.get("LLM_ENDPOINT", ""),
        "api_key": os.environ.get("LLM_API_KEY", ""),
        "providers": [],  # Ordered fallback chain — populated by _init_provider_chain()
    },
}


def get_config(mask_secrets=False):
    """Return a deep copy of the config. Optionally mask secret fields."""
    with _config_lock:
        cfg = json.loads(json.dumps(_config))
    if mask_secrets:
        for platform in cfg.get("platforms", {}).values():
            for key in list(platform.keys()):
                if key in _SECRET_FIELDS and platform[key]:
                    platform[key] = "****"
        # Mask LLM API keys
        if cfg.get("llm", {}).get("api_key"):
            cfg["llm"]["api_key"] = "****"
        for p in cfg.get("llm", {}).get("providers", []):
            if p.get("api_key"):
                p["api_key"] = "****"
    return cfg


def update_config_section(section, updates):
    """Merge updates into a config section."""
    with _config_lock:
        if section in _config and isinstance(_config[section], dict):
            if section == "platforms":
                # Deep merge per-platform
                for name, settings in updates.items():
                    if name in _config["platforms"]:
                        _config["platforms"][name].update(settings)
            else:
                _config[section].update(updates)


# ── Industry-standard incident states (ITIL + PagerDuty + FireHydrant) ─
VALID_STATES = ["identified", "acknowledged", "investigating", "mitigated", "resolved"]
VALID_SEVERITIES = ["critical", "high", "medium", "low"]
VALID_URGENCIES = ["high", "medium", "low"]
VALID_PLATFORMS = {"pagerduty", "jira", "servicenow", "opsgenie", "slack"}
VALID_LLM_PROVIDERS = {"ollama", "claude", "openai", "vllm", "disabled"}

# ITIL Priority Matrix: severity x urgency
PRIORITY_MATRIX = {
    ("critical", "high"): "P1", ("critical", "medium"): "P1", ("critical", "low"): "P2",
    ("high", "high"): "P2", ("high", "medium"): "P2", ("high", "low"): "P3",
    ("medium", "high"): "P3", ("medium", "medium"): "P3", ("medium", "low"): "P4",
    ("low", "high"): "P4", ("low", "medium"): "P4", ("low", "low"): "P5",
}
INCIDENT_INDEX = f"logclaw-incidents-{TENANT_ID}"

consumer_ready = threading.Event()
lock = threading.Lock()
stats = {"consumed": 0, "created": 0, "skipped": 0, "webhooks_sent": 0, "webhooks_failed": 0, "llm_calls": 0, "llm_failures": 0}
llm_provider_stats = {}  # {"openai:gpt-4o-mini": {"success": 0, "failure": 0, "skipped": 0}, ...}


def _track_provider_stat(cb_key, outcome):
    """Track per-provider+model LLM call outcome."""
    if cb_key not in llm_provider_stats:
        llm_provider_stats[cb_key] = {"success": 0, "failure": 0, "skipped": 0}
    llm_provider_stats[cb_key][outcome] += 1

# ── Audit Trail ──────────────────────────────────────────────────────────
_audit_log = []  # In-memory ring buffer of recent audit entries
_AUDIT_MAX = 500

def audit_record(incident_id, action, actor="system", details=None):
    """Append an immutable audit record for incident state changes."""
    entry = {
        "timestamp": now_iso(),
        "incident_id": incident_id,
        "action": action,
        "actor": actor,
        "details": details or {},
    }
    with lock:
        _audit_log.append(entry)
        if len(_audit_log) > _AUDIT_MAX:
            del _audit_log[:len(_audit_log) - _AUDIT_MAX]
    return entry


import logging as _stdlib_logging


def _setup_otel_logging():
    try:
        from opentelemetry._logs import set_logger_provider
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
        from opentelemetry.instrumentation.logging import LoggingInstrumentor
        from opentelemetry.sdk._logs import LoggerProvider
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor, ConsoleLogExporter
        from opentelemetry.sdk.resources import Resource

        resource = Resource.create({
            "service.name": os.environ.get("OTEL_SERVICE_NAME", "logclaw-ticketing-agent"),
        })
        provider = LoggerProvider(resource=resource)
        endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "")
        if endpoint:
            provider.add_log_record_processor(
                BatchLogRecordProcessor(OTLPLogExporter(endpoint=f"{endpoint}/v1/logs"))
            )
        provider.add_log_record_processor(BatchLogRecordProcessor(ConsoleLogExporter()))
        set_logger_provider(provider)
        _stdlib_logging.basicConfig(level=_stdlib_logging.INFO, stream=sys.stdout)
        LoggingInstrumentor().instrument(set_logging_format=True)
    except ImportError:
        _stdlib_logging.basicConfig(level=_stdlib_logging.INFO, stream=sys.stdout)


_setup_otel_logging()
_tkt_logger = _stdlib_logging.getLogger("logclaw.ticketing-agent")


def log(m, level="info", **extra):
    getattr(_tkt_logger, level, _tkt_logger.info)(
        m, extra={"tenant_id": TENANT_ID, **extra}
    )


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def gen_request_id():
    return str(uuid.uuid4())[:8]


# ── OpenSearch helpers ─────────────────────────────────────────────────
def os_req(method, path, body=None):
    url = f"{OS_ENDPOINT}/{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if _os_auth_header:
        headers["Authorization"] = _os_auth_header
    req = Request(url, data, headers, method=method)
    resp = urlopen(req, timeout=10, context=_os_ssl_ctx).read()
    if not resp:
        return {}
    return json.loads(resp)


def ensure_index():
    try:
        os_req("HEAD", INCIDENT_INDEX)
    except HTTPError as e:
        if e.code == 404:
            mapping = {
                "settings": {"number_of_shards": 1, "number_of_replicas": 1},
                "mappings": {
                    "properties": {
                        "id": {"type": "keyword"},
                        "number": {"type": "integer"},
                        "title": {"type": "text", "fields": {"raw": {"type": "keyword"}}},
                        "description": {"type": "text"},
                        "severity": {"type": "keyword"},
                        "urgency": {"type": "keyword"},
                        "priority": {"type": "keyword"},
                        "state": {"type": "keyword"},
                        "service": {"type": "keyword"},
                        "environment": {"type": "keyword"},
                        "anomaly_type": {"type": "keyword"},
                        "anomaly_score": {"type": "float"},
                        "correlation_id": {"type": "keyword"},
                        "affected_endpoint": {"type": "keyword"},
                        "impact": {"type": "text"},
                        "root_cause": {"type": "text"},
                        "commander": {"type": "keyword"},
                        "assigned_to": {"type": "keyword"},
                        "communication_channel": {"type": "keyword"},
                        "runbook_url": {"type": "keyword"},
                        "created_at": {"type": "date"},
                        "updated_at": {"type": "date"},
                        "detected_at": {"type": "date"},
                        "acknowledged_at": {"type": "date"},
                        "mitigated_at": {"type": "date"},
                        "resolved_at": {"type": "date"},
                        "tenant_id": {"type": "keyword"},
                        "timeline": {
                            "type": "nested",
                            "properties": {
                                "id": {"type": "keyword"},
                                "timestamp": {"type": "date"},
                                "type": {"type": "keyword"},
                                "state": {"type": "keyword"},
                                "message": {"type": "text"},
                                "actor": {"type": "keyword"},
                            },
                        },
                        "evidence_logs": {
                            "type": "nested",
                            "properties": {
                                "timestamp": {"type": "keyword"},
                                "level": {"type": "keyword"},
                                "message": {"type": "text"},
                                "service": {"type": "keyword"},
                            },
                        },
                        "external_refs": {
                            "type": "nested",
                            "properties": {
                                "system": {"type": "keyword"},
                                "ref_id": {"type": "keyword"},
                                "url": {"type": "keyword"},
                                "synced_at": {"type": "date"},
                            },
                        },
                        "tags": {"type": "keyword"},
                        "custom_fields": {"type": "object", "enabled": True},
                        "trace_id": {"type": "keyword"},
                        "span_ids": {"type": "keyword"},
                        "request_flow": {"type": "keyword"},
                        "affected_services": {"type": "keyword"},
                        "request_traces": {
                            "type": "nested",
                            "properties": {
                                "trace_id": {"type": "keyword"},
                                "error_message": {"type": "text"},
                                "timestamp": {"type": "date"},
                                "logs": {
                                    "type": "nested",
                                    "properties": {
                                        "timestamp": {"type": "date"},
                                        "service": {"type": "keyword"},
                                        "level": {"type": "keyword"},
                                        "message": {"type": "text"},
                                        "span_id": {"type": "keyword"},
                                        "duration_ms": {"type": "integer"},
                                        "raw_log": {"type": "text", "index": False},
                                        "host": {"type": "keyword"},
                                        "endpoint": {"type": "keyword"},
                                    },
                                },
                            },
                        },
                        "reproduce_steps": {"type": "text"},
                        "similar_count": {"type": "integer"},
                        "error_type": {"type": "keyword"},
                        "status_code": {"type": "integer"},
                    }
                },
            }
            os_req("PUT", INCIDENT_INDEX, mapping)
            log(f"Created index {INCIDENT_INDEX}")
        else:
            raise


# ── Sequence counter for TICK-NNNN ──────────────────────────────────────
_seq_lock = threading.Lock()
_seq_counter = [0]

def _init_sequence():
    try:
        r = os_req("POST", f"{INCIDENT_INDEX}/_search", {
            "size": 1, "sort": [{"number": "desc"}],
            "query": {"match_all": {}}, "_source": ["number"]
        })
        hits = r.get("hits", {}).get("hits", [])
        if hits:
            _seq_counter[0] = hits[0]["_source"].get("number", 0)
    except Exception:
        pass

def next_incident_number():
    with _seq_lock:
        _seq_counter[0] += 1
        return _seq_counter[0]


# ── CRUD ───────────────────────────────────────────────────────────────
def save_incident(incident):
    os_req("PUT", f"{INCIDENT_INDEX}/_doc/{incident['id']}", incident)
    os_req("POST", f"{INCIDENT_INDEX}/_refresh")


def get_incident(iid):
    try:
        r = os_req("GET", f"{INCIDENT_INDEX}/_doc/{iid}")
        return r.get("_source")
    except HTTPError:
        return None


def delete_incident(iid):
    try:
        os_req("DELETE", f"{INCIDENT_INDEX}/_doc/{iid}")
        os_req("POST", f"{INCIDENT_INDEX}/_refresh")
        return True
    except HTTPError:
        return False


def search_incidents(params):
    limit = min(int(params.get("limit", [50])[0]), 200)
    offset = int(params.get("offset", [0])[0])
    if "size" in params:
        limit = min(int(params["size"][0]), 200)
    if "from" in params:
        offset = int(params["from"][0])
    state = params.get("state", [None])[0]
    severity = params.get("severity", [None])[0]
    urgency = params.get("urgency", [None])[0]
    service = params.get("service", [None])[0]
    priority = params.get("priority", [None])[0]
    q = params.get("q", [None])[0]
    search = params.get("search", [None])[0]
    tenant_id = params.get("tenant_id", [None])[0]
    sort_by = params.get("sort", ["created_at"])[0]
    sort_dir = params.get("order", ["desc"])[0]
    musts = []
    # tenant_id is the company identifier — always filter to isolate tenants
    # Use bool/should to handle both mapping types: pure keyword and text+keyword subfield
    if tenant_id:
        musts.append({"bool": {"should": [{"term": {"tenant_id": tenant_id}}, {"term": {"tenant_id.keyword": tenant_id}}], "minimum_should_match": 1}})
    if state and state != "all":
        musts.append({"term": {"state": state}})
    if severity:
        musts.append({"term": {"severity": severity}})
    if urgency:
        musts.append({"term": {"urgency": urgency}})
    if service:
        musts.append({"term": {"service": service}})
    if priority:
        musts.append({"term": {"priority": priority}})
    if q or search:
        musts.append({"multi_match": {"query": q or search, "fields": ["title", "description", "service", "tags"]}})
    body = {"size": limit, "from": offset, "sort": [{sort_by: sort_dir}]}
    if musts:
        body["query"] = {"bool": {"must": musts}}
    else:
        body["query"] = {"match_all": {}}
    try:
        r = os_req("POST", f"{INCIDENT_INDEX}/_search", body)
        hits = r.get("hits", {})
        total = hits.get("total", {}).get("value", 0)
        items = [h["_source"] for h in hits.get("hits", [])]
        return {
            "data": items,
            "pagination": {
                "total": total,
                "limit": limit,
                "offset": offset,
                "has_more": (offset + limit) < total,
            },
            "total": total,
            "incidents": items,
        }
    except Exception:
        return {"data": [], "pagination": {"total": 0, "limit": limit, "offset": offset, "has_more": False}, "total": 0, "incidents": []}


def get_stats():
    try:
        r = os_req("POST", f"{INCIDENT_INDEX}/_search", {
            "size": 0,
            "aggs": {
                "by_state": {"terms": {"field": "state", "size": 10}},
                "by_severity": {"terms": {"field": "severity", "size": 10}},
                "by_urgency": {"terms": {"field": "urgency", "size": 10}},
                "by_priority": {"terms": {"field": "priority", "size": 10}},
                "by_service": {"terms": {"field": "service", "size": 20}},
            },
        })
        total = r.get("hits", {}).get("total", {}).get("value", 0)
        aggs = r.get("aggregations", {})
        return {
            "total": total,
            "by_state": {b["key"]: b["doc_count"] for b in aggs.get("by_state", {}).get("buckets", [])},
            "by_severity": {b["key"]: b["doc_count"] for b in aggs.get("by_severity", {}).get("buckets", [])},
            "by_urgency": {b["key"]: b["doc_count"] for b in aggs.get("by_urgency", {}).get("buckets", [])},
            "by_priority": {b["key"]: b["doc_count"] for b in aggs.get("by_priority", {}).get("buckets", [])},
            "by_service": {b["key"]: b["doc_count"] for b in aggs.get("by_service", {}).get("buckets", [])},
            **stats,
        }
    except Exception:
        return {"total": 0, "by_state": {}, "by_severity": {}, "by_urgency": {}, "by_priority": {}, "by_service": {}, **stats}


def purge_old_incidents():
    """Delete incidents older than incidentRetentionDays. Fire-and-forget safe."""
    days = get_config()["anomaly"]["incidentRetentionDays"]
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    try:
        r = os_req("POST", f"{INCIDENT_INDEX}/_delete_by_query?conflicts=proceed", {
            "query": {"range": {"created_at": {"lt": cutoff}}}
        })
        deleted = r.get("deleted", 0)
        if deleted:
            log(f"Purged {deleted} incidents older than {days}d")
    except Exception as e:
        log(f"Incident purge failed: {e}")


_last_purge = 0.0


# ── MTTR Metrics (FireHydrant-style) ───────────────────────────────────
def get_mttr(params):
    days = int(params.get("days", [30])[0])
    service = params.get("service", [None])[0]
    severity = params.get("severity", [None])[0]
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    musts = [
        {"term": {"state": "resolved"}},
        {"range": {"resolved_at": {"gte": cutoff}}},
    ]
    if service:
        musts.append({"term": {"service": service}})
    if severity:
        musts.append({"term": {"severity": severity}})
    try:
        r = os_req("POST", f"{INCIDENT_INDEX}/_search", {
            "size": 500, "query": {"bool": {"must": musts}},
            "_source": ["created_at", "detected_at", "acknowledged_at", "mitigated_at", "resolved_at", "severity", "service"],
        })
        incidents = [h["_source"] for h in r.get("hits", {}).get("hits", [])]
        if not incidents:
            return {"period_days": days, "resolved_count": 0, "mttr": None, "mtta": None, "mttm": None}
        def delta_mins(a, b):
            if not a or not b:
                return None
            try:
                ta = datetime.fromisoformat(a.replace("Z", "+00:00"))
                tb = datetime.fromisoformat(b.replace("Z", "+00:00"))
                return max(0, (tb - ta).total_seconds() / 60)
            except Exception:
                return None
        ttr_vals, tta_vals, ttm_vals = [], [], []
        for inc in incidents:
            r_mins = delta_mins(inc.get("created_at"), inc.get("resolved_at"))
            if r_mins is not None:
                ttr_vals.append(r_mins)
            a_mins = delta_mins(inc.get("created_at"), inc.get("acknowledged_at"))
            if a_mins is not None:
                tta_vals.append(a_mins)
            m_mins = delta_mins(inc.get("created_at"), inc.get("mitigated_at"))
            if m_mins is not None:
                ttm_vals.append(m_mins)
        def calc_stats(vals):
            if not vals:
                return None
            vals.sort()
            n = len(vals)
            avg = sum(vals) / n
            median = vals[n // 2]
            p95 = vals[int(n * 0.95)] if n >= 5 else vals[-1]
            return {"avg_minutes": round(avg, 1), "median_minutes": round(median, 1), "p95_minutes": round(p95, 1), "min_minutes": round(vals[0], 1), "max_minutes": round(vals[-1], 1), "sample_size": n}
        return {
            "period_days": days,
            "resolved_count": len(incidents),
            "mttr": calc_stats(ttr_vals),
            "mtta": calc_stats(tta_vals),
            "mttm": calc_stats(ttm_vals),
        }
    except Exception:
        return {"period_days": days, "resolved_count": 0, "mttr": None, "mtta": None, "mttm": None}


# ── Log context from OpenSearch ────────────────────────────────────────
def os_context(service, tenant_id=None):
    cfg = get_config()
    max_lines = cfg["anomaly"]["maxLogLinesInTicket"]
    must = [{"term": {"service": service}}, {"terms": {"level": ["ERROR", "FATAL", "WARN"]}}]
    if tenant_id:
        must.append({"bool": {"should": [{"term": {"tenant_id": tenant_id}}, {"term": {"tenant_id.keyword": tenant_id}}], "minimum_should_match": 1}})
    q = {
        "size": max_lines,
        "query": {"bool": {"must": must}},
        "sort": [{"_doc": "desc"}],
    }
    try:
        r = os_req("POST", "logclaw-logs-*/_search", q)
        return [h["_source"] for h in r.get("hits", {}).get("hits", [])]
    except Exception:
        return []


# ── LLM Provider Chain + Circuit Breaker ─────────────────────────────

_PROVIDER_ENDPOINTS = {
    "claude": "https://api.anthropic.com",
    "openai": "https://api.openai.com",
}
_PROVIDER_DEFAULT_MODELS = {
    "claude": "claude-3-5-haiku-latest",
    "openai": "gpt-4o-mini",
    "ollama": "llama3.2:8b",
}

# Circuit breaker — keyed by "provider:model"
_circuit_breakers = {}
_CB_FAILURE_THRESHOLD = int(os.environ.get("LLM_CB_FAILURE_THRESHOLD", "3"))
_CB_COOLDOWN_SECONDS = int(os.environ.get("LLM_CB_COOLDOWN_SECONDS", "60"))


def _cb_key(name, model):
    return f"{name}:{model}"


def _cb_is_open(key):
    """Check if circuit breaker is tripped (provider+model should be skipped)."""
    cb = _circuit_breakers.get(key)
    if not cb or not cb.get("tripped_at"):
        return False
    elapsed = time.time() - cb["tripped_at"]
    if elapsed >= _CB_COOLDOWN_SECONDS:
        cb["tripped_at"] = None
        cb["failures"] = 0
        return False
    return True


def _cb_record_failure(key):
    """Record a failure. Trip breaker if threshold reached."""
    cb = _circuit_breakers.setdefault(key, {"failures": 0, "tripped_at": None})
    cb["failures"] += 1
    if cb["failures"] >= _CB_FAILURE_THRESHOLD:
        cb["tripped_at"] = time.time()
        log(f"Circuit breaker TRIPPED for {key} after {cb['failures']} consecutive failures")


def _cb_record_success(key):
    """Record success. Reset breaker state."""
    cb = _circuit_breakers.get(key)
    if cb:
        cb["failures"] = 0
        cb["tripped_at"] = None


def _build_provider_entry(name, model=None):
    """Build a provider chain entry dict."""
    return {
        "name": name,
        "model": model or _PROVIDER_DEFAULT_MODELS.get(name, ""),
        "endpoint": _PROVIDER_ENDPOINTS.get(name, os.environ.get("LLM_ENDPOINT", "")),
        "api_key": "",   # Empty = use default keys; user can override via API
        "enabled": True,
    }


def _init_provider_chain():
    """Build the provider fallback chain from env vars.
    LLM_PROVIDERS: comma-separated 'provider:model' pairs, e.g.
      'openai:gpt-4o-mini,openai:gpt-4o,claude:claude-3-5-haiku-latest,claude:claude-sonnet-4-20250514'
    Falls back to single LLM_PROVIDER for backward compat."""
    providers_env = os.environ.get("LLM_PROVIDERS", "")

    if providers_env:
        chain = []
        for entry in providers_env.split(","):
            entry = entry.strip()
            if ":" in entry:
                name, model = entry.split(":", 1)
            else:
                name, model = entry, ""
            name = name.strip().lower()
            model = model.strip()
            if name and name != "disabled" and name in VALID_LLM_PROVIDERS:
                chain.append(_build_provider_entry(name, model))
        with _config_lock:
            _config["llm"]["providers"] = chain
            if chain:
                _config["llm"]["provider"] = chain[0]["name"]
    else:
        # Legacy single-provider mode
        provider = _config["llm"]["provider"]
        if provider and provider != "disabled":
            with _config_lock:
                _config["llm"]["providers"] = [
                    _build_provider_entry(provider, _config["llm"].get("model", ""))
                ]


# Initialize chain at module load
_init_provider_chain()


# ── LLM Integration — Universal Caller + Trace Analysis ──────────────

def _resolve_api_key(provider_name, provider_entry=None):
    """Resolve API key with priority: user runtime key > LogClaw default key > legacy env.
    User keys come from dashboard PATCH (per-provider or legacy single).
    Default keys come from DEFAULT_ANTHROPIC_API_KEY / DEFAULT_OPENAI_API_KEY env vars.
    Legacy keys come from ANTHROPIC_API_KEY / OPENAI_API_KEY / LLM_API_KEY env vars."""
    # 1. Per-provider user-provided runtime key (from dashboard)
    if provider_entry:
        runtime_key = provider_entry.get("api_key", "")
        if runtime_key and runtime_key != "****":
            return runtime_key
    # 2. Legacy single-provider runtime key
    cfg = get_config()
    legacy_key = cfg["llm"].get("api_key", "")
    if legacy_key and legacy_key != "****":
        return legacy_key
    # 3. LogClaw's default API keys (set by operator via Helm/K8s secrets)
    if provider_name == "claude":
        default_key = os.environ.get("DEFAULT_ANTHROPIC_API_KEY", "")
        if default_key:
            return default_key
        return os.environ.get("ANTHROPIC_API_KEY", os.environ.get("LLM_API_KEY", ""))
    if provider_name == "openai":
        default_key = os.environ.get("DEFAULT_OPENAI_API_KEY", "")
        if default_key:
            return default_key
        return os.environ.get("OPENAI_API_KEY", os.environ.get("LLM_API_KEY", ""))
    return os.environ.get("LLM_API_KEY", "")


def _call_single_llm(provider_name, endpoint, model, api_key, prompt, system="",
                      temperature=None, max_tokens=None, timeout_s=None):
    """Call a single LLM provider+model. Returns response text or raises Exception."""
    if temperature is None:
        temperature = float(os.environ.get("LLM_TEMPERATURE", "0.1"))
    if max_tokens is None:
        max_tokens = int(os.environ.get("LLM_MAX_TOKENS", "2048"))
    if timeout_s is None:
        timeout_s = int(os.environ.get("LLM_TIMEOUT_SECONDS", "30"))

    if provider_name in ("ollama", "vllm"):
        url = endpoint.rstrip("/") + "/v1/chat/completions"
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        payload = json.dumps({
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        })
        req = Request(url, data=payload.encode(),
                     headers={"Content-Type": "application/json"}, method="POST")
        resp = json.loads(urlopen(req, timeout=timeout_s).read())
        text = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not text:
            raise ValueError(f"{provider_name} returned empty response")
        return text

    elif provider_name == "claude":
        import anthropic
        if not api_key:
            raise ValueError("No API key for claude")
        base_url = endpoint.rstrip("/") if endpoint != "https://api.anthropic.com" else None
        client = anthropic.Anthropic(api_key=api_key, base_url=base_url, timeout=float(timeout_s))
        kwargs = {
            "model": model or "claude-3-5-haiku-latest",
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        message = client.messages.create(**kwargs)
        text = message.content[0].text if message.content else ""
        if not text:
            raise ValueError("Claude returned empty response")
        return text

    elif provider_name == "openai":
        import openai
        if not api_key:
            raise ValueError("No API key for openai")
        client = openai.OpenAI(
            api_key=api_key,
            base_url=endpoint.rstrip("/") + "/v1" if endpoint else None,
            timeout=float(timeout_s),
        )
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        response = client.chat.completions.create(
            model=model or "gpt-4o-mini",
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        text = response.choices[0].message.content or ""
        if not text:
            raise ValueError("OpenAI returned empty response")
        return text

    else:
        raise ValueError(f"Unknown provider: {provider_name}")


def _call_llm(prompt, system=""):
    """Universal LLM caller with multi-provider+model fallback and circuit breaker.
    Tries providers in chain order, skipping circuit-broken ones.
    Returns response text or empty string if all providers fail/disabled."""
    cfg = get_config()
    providers = cfg["llm"].get("providers", [])

    # Backward compat: if no providers chain, build from legacy single provider
    if not providers:
        legacy = cfg["llm"]["provider"]
        if legacy == "disabled" or not legacy:
            return ""
        providers = [{
            "name": legacy,
            "model": cfg["llm"].get("model", ""),
            "endpoint": cfg["llm"].get("endpoint", ""),
            "api_key": cfg["llm"].get("api_key", ""),
            "enabled": True,
        }]

    if not providers:
        return ""

    stats["llm_calls"] += 1
    last_error = None

    for i, p in enumerate(providers):
        name = p["name"]
        model = p.get("model", "")
        endpoint = p.get("endpoint", "")

        if not p.get("enabled", True):
            continue
        if not endpoint:
            continue

        key = _cb_key(name, model)

        # Circuit breaker check
        if _cb_is_open(key):
            log(f"LLM {key} skipped (circuit breaker open)")
            _track_provider_stat(key, "skipped")
            continue

        api_key = _resolve_api_key(name, p)

        try:
            result = _call_single_llm(
                provider_name=name,
                endpoint=endpoint,
                model=model,
                api_key=api_key,
                prompt=prompt,
                system=system,
            )
            # Success
            _cb_record_success(key)
            _track_provider_stat(key, "success")
            if i > 0:
                log(f"LLM fallback succeeded: {key} (after {i} skipped/failed provider(s))")
            return result

        except Exception as e:
            last_error = e
            _cb_record_failure(key)
            _track_provider_stat(key, "failure")
            log(f"LLM call failed ({key}): {e}")

    # All providers failed
    stats["llm_failures"] += 1
    log(f"All LLM providers exhausted. Last error: {last_error}")
    return ""


def _find_similar_resolved_incidents(service, error_template):
    """Query OpenSearch for resolved incidents with similar error patterns (Layer 5: Historical)."""
    try:
        q = {
            "size": 3,
            "query": {"bool": {
                "must": [
                    {"term": {"service": service}},
                    {"terms": {"state": ["mitigated", "resolved"]}},
                ],
                "should": [
                    {"match": {"description": {"query": error_template, "boost": 2}}},
                    {"match": {"root_cause": {"query": error_template, "boost": 3}}},
                    {"match": {"title": {"query": error_template}}},
                ],
                "minimum_should_match": 1,
            }},
            "sort": [{"created_at": "desc"}],
            "_source": ["id", "title", "root_cause", "resolved_at", "service", "severity", "tags"],
        }
        r = os_req("POST", f"{INCIDENT_INDEX}/_search", q)
        return [h["_source"] for h in r.get("hits", {}).get("hits", [])]
    except Exception:
        return []


def _analyze_trace_with_llm(event):
    """Chain-of-thought RCA using LLM with pre-computed causal analysis and historical context.
    Returns dict with title, root_cause, impact, reproduce_steps, severity, suggested_fix, tags."""
    defaults = {
        "title": "",
        "root_cause": "",
        "impact": "",
        "reproduce_steps": [],
        "severity": event.get("severity", "high"),
        "suggested_fix": "",
        "error_pattern": "",
        "tags": [],
    }

    cfg = get_config()
    if cfg["llm"]["provider"] == "disabled" and not cfg["llm"].get("providers"):
        return defaults

    # Build structured trace log lines
    trace_lines = []
    for entry in event.get("request_trace", []):
        ts = entry.get("timestamp", "?")
        svc = entry.get("service", "?")
        lvl = entry.get("level", "INFO")
        msg = entry.get("message", "")
        span = entry.get("span_id", "")
        trace_lines.append(f"  [{ts}] [{svc}] [{lvl}] {msg} (span:{span})")
    trace_block = "\n".join(trace_lines) if trace_lines else "  (no trace data)"

    # Build historical context
    similar = event.get("_similar_incidents", [])
    history_lines = []
    for inc in similar[:3]:
        history_lines.append(
            f"  - {inc.get('id', '?')}: {inc.get('title', '?')} "
            f"(root_cause: {(inc.get('root_cause') or 'unknown')[:100]})"
        )
    history_block = "\n".join(history_lines) if history_lines else "  (no similar past incidents)"

    # Causal analysis context
    causal_chain = event.get("causal_chain", [])
    blast = event.get("blast_radius", {})

    system = (
        "You are an expert Site Reliability Engineer performing root cause analysis "
        "on production incidents. You have deep knowledge of distributed systems, "
        "microservice architectures, and common failure patterns. "
        "Analyze the provided trace data using systematic reasoning. Think step by step."
    )

    prompt = f"""## Incident Context
A request failure was detected in a microservice architecture.

## Causal Analysis (pre-computed from trace data)
- Root cause service: {event.get('root_cause_service', 'unknown')}
- Causal chain: {' -> '.join(causal_chain) if causal_chain else 'unknown'}
- Error category: {event.get('error_category', 'unknown')}
- Blast radius: {blast.get('impact_score', 0) * 100:.0f}% of services affected
- Downstream impact: {', '.join(blast.get('affected_downstream', []))}

## Request Trace (chronological — all logs from this request lifecycle)
{trace_block}

## Error Details
- Primary error: {event.get('raw_error_message', event.get('error_message', 'unknown'))}
- Normalized pattern: {event.get('error_message', 'unknown')}
- Services in request flow: {' -> '.join(event.get('request_flow', []))}

## Similar Past Incidents
{history_block}

## Task
Perform a thorough root cause analysis. Think step by step:
1. What is the sequence of events that led to this failure?
2. What is the fundamental root cause (not just the symptom)?
3. What is the business/user impact?
4. How can this be reproduced for debugging?
5. What is the recommended fix?

Return ONLY a valid JSON object (no markdown, no code fences):
{{"title": "Short incident title (under 120 chars)", "root_cause": "Detailed root cause (2-4 sentences)", "impact": "User/business impact (1-2 sentences)", "reproduce_steps": ["Step 1", "Step 2"], "severity": "critical|high|medium|low", "suggested_fix": "Recommended remediation (1-2 sentences)", "error_pattern": "Generalized failure mode description", "tags": ["tag1", "tag2"]}}"""

    response = _call_llm(prompt, system)
    if not response:
        return defaults

    # Parse JSON from LLM response (handle potential markdown fences)
    text = response.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    try:
        result = json.loads(text)
        # Validate and merge with defaults
        for key in defaults:
            if key not in result:
                result[key] = defaults[key]
        return result
    except (json.JSONDecodeError, ValueError) as e:
        log(f"LLM response parse error: {e} — response: {text[:200]}")
        return defaults


# ── Deduplication & grouping ──────────────────────────────────────────
dedup_registry = {}

def find_groupable_ticket(dedup_key):
    now = time.time()
    entry = dedup_registry.get(dedup_key)
    if entry and now < entry["expires"] and entry["trace_count"] < 5:
        return entry
    return None

def append_trace_to_ticket(entry, event):
    ticket = get_incident(entry["ticket_id"])
    if not ticket:
        return
    now = now_iso()
    if event.get("anomaly_type") == "request_failure" and event.get("request_trace"):
        traces = ticket.get("request_traces", [])
        traces.append({
            "trace_id": event.get("trace_id", str(uuid.uuid4())[:8]),
            "span_ids": event.get("span_ids", []),
            "logs": event["request_trace"],
            "error_message": event.get("error_message", ""),
            "timestamp": event.get("timestamp", now),
        })
        ticket["request_traces"] = traces[:5]
    ticket["similar_count"] = ticket.get("similar_count", 1) + 1
    ticket["updated_at"] = now
    ticket["timeline"].append({
        "id": gen_request_id(),
        "timestamp": now,
        "type": "grouped",
        "state": ticket["state"],
        "message": f"Similar event grouped (total: {ticket['similar_count']})",
        "actor": "system",
    })
    save_incident(ticket)
    entry["trace_count"] += 1
    log(f"Grouped trace into {entry['ticket_id']} (traces: {entry['trace_count']})")

def is_dup_key(dedup_key):
    now = time.time()
    entry = dedup_registry.get(dedup_key)
    if entry and now < entry["expires"]:
        return True
    return False


def find_recent_duplicate_in_os(service, error_template, window_minutes, tenant_id=None):
    """Check OpenSearch for unresolved incidents with matching service + error within the dedup window.
    Catches duplicates across pod restarts when in-memory registry is empty."""
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=window_minutes)).isoformat()
        must_clauses = [
            {"term": {"service": service}},
            {"range": {"created_at": {"gte": cutoff}}},
            {"terms": {"state": ["identified", "acknowledged", "investigating"]}},
        ]
        if tenant_id:
            must_clauses.append({"bool": {"should": [{"term": {"tenant_id": tenant_id}}, {"term": {"tenant_id.keyword": tenant_id}}], "minimum_should_match": 1}})
        q = {
            "size": 1,
            "query": {"bool": {"must": must_clauses, "must_not": [
                {"terms": {"state": ["resolved", "mitigated"]}},
            ], "should": [
                {"match": {"title": {"query": error_template[:100], "minimum_should_match": "60%"}}},
                {"match": {"description": {"query": error_template[:100], "minimum_should_match": "60%"}}},
            ], "minimum_should_match": 1}},
            "sort": [{"created_at": "desc"}],
            "_source": ["id", "title", "state", "similar_count"],
        }
        r = os_req("POST", f"{INCIDENT_INDEX}/_search", q)
        hits = r.get("hits", {}).get("hits", [])
        if hits:
            return hits[0]["_source"]
    except Exception:
        pass
    return None


# ── Webhook integrations (with severity-based routing) ────────────────
def send_webhooks(incident):
    cfg = get_config()
    severity = incident.get("severity", "medium")
    routing = cfg["routing"]
    platforms = cfg["platforms"]

    # Determine which platforms should receive this severity
    targets = routing.get(severity, [])

    def should_send(platform_name):
        p = platforms.get(platform_name, {})
        if not p.get("enabled", False):
            return False
        if not targets:  # empty = backward compat (all enabled platforms)
            return True
        return platform_name in targets

    ext_refs = []

    if should_send("slack"):
        slack_cfg = platforms["slack"]
        webhook_url = slack_cfg.get("webhookUrl", "")
        channel = slack_cfg.get("channel", "#logclaw-alerts")
        if webhook_url:
            try:
                sev_emoji = {"critical": ":rotating_light:", "high": ":warning:", "medium": ":large_orange_diamond:", "low": ":information_source:"}.get(incident["severity"], ":bell:")
                iid = incident["id"]
                svc = incident["service"]
                sev = incident["severity"]
                prio = incident.get("priority", "P3")
                text = f"{sev_emoji} *{incident['title']}*\nService: `{svc}` | Priority: {prio} | Severity: {sev}\nID: `{iid}`"
                payload = {"channel": channel, "username": "LogClaw", "icon_emoji": ":shield:", "text": text}
                req = Request(webhook_url, json.dumps(payload).encode(), {"Content-Type": "application/json"}, method="POST")
                urlopen(req, timeout=5)
                stats["webhooks_sent"] += 1
                ext_refs.append({"system": "slack", "ref_id": channel, "url": "", "synced_at": now_iso()})
            except Exception as e:
                stats["webhooks_failed"] += 1
                log(f"  Slack error: {e}")

    if should_send("pagerduty"):
        pd_cfg = platforms["pagerduty"]
        routing_key = pd_cfg.get("routingKey", "")
        api_url = pd_cfg.get("apiUrl", "https://events.pagerduty.com")
        if routing_key:
            try:
                sev_map = {"critical": "critical", "high": "error", "medium": "warning", "low": "info"}
                payload = {
                    "routing_key": routing_key,
                    "event_action": "trigger",
                    "dedup_key": incident["id"],
                    "payload": {
                        "summary": incident["title"],
                        "severity": sev_map.get(incident["severity"], "warning"),
                        "source": f"logclaw-{TENANT_ID}",
                        "component": incident["service"],
                        "custom_details": {"anomaly_score": incident["anomaly_score"], "priority": incident.get("priority"), "correlation_id": incident.get("correlation_id")},
                    },
                }
                req = Request(f"{api_url}/v2/enqueue", json.dumps(payload).encode(), {"Content-Type": "application/json"}, method="POST")
                r = json.loads(urlopen(req, timeout=10).read())
                ext_refs.append({"system": "pagerduty", "ref_id": r.get("dedup_key", incident["id"]), "url": "", "synced_at": now_iso()})
                stats["webhooks_sent"] += 1
            except Exception as e:
                stats["webhooks_failed"] += 1
                log(f"  PagerDuty error: {e}")

    if should_send("jira"):
        jira_cfg = platforms["jira"]
        base_url = jira_cfg.get("baseUrl", "")
        api_token = jira_cfg.get("apiToken", "")
        user_email = jira_cfg.get("userEmail", "")
        project_key = jira_cfg.get("projectKey", "OPS")
        issue_type = jira_cfg.get("issueType", "Bug")
        if base_url and api_token and user_email:
            try:
                import base64
                auth = base64.b64encode(f"{user_email}:{api_token}".encode()).decode()
                priority_map = {"critical": "Highest", "high": "High", "medium": "Medium", "low": "Low"}
                sev = incident["severity"]
                payload = {
                    "fields": {
                        "project": {"key": project_key},
                        "summary": incident["title"],
                        "description": f"LogClaw Incident {incident['id']}\n\nPriority: {incident.get('priority', 'P3')}\nSeverity: {sev}\nService: {incident['service']}\nCorrelation: {incident.get('correlation_id', 'N/A')}\n\n{incident['description']}",
                        "issuetype": {"name": issue_type},
                        "priority": {"name": priority_map.get(sev, "Medium")},
                        "labels": ["logclaw", f"sev-{sev}", incident["service"]],
                    }
                }
                req = Request(f"{base_url}/rest/api/2/issue", json.dumps(payload).encode(), {"Content-Type": "application/json", "Authorization": f"Basic {auth}"}, method="POST")
                r = json.loads(urlopen(req, timeout=10).read())
                jira_key = r.get("key", "")
                ext_refs.append({"system": "jira", "ref_id": jira_key, "url": f"{base_url}/browse/{jira_key}", "synced_at": now_iso()})
                stats["webhooks_sent"] += 1
            except Exception as e:
                stats["webhooks_failed"] += 1
                log(f"  Jira error: {e}")

    if should_send("servicenow"):
        snow_cfg = platforms["servicenow"]
        instance_url = snow_cfg.get("instanceUrl", "")
        snow_user = snow_cfg.get("username", "")
        snow_pass = snow_cfg.get("password", "")
        table = snow_cfg.get("table", "incident")
        assignment_group = snow_cfg.get("assignmentGroup", "")
        if instance_url and snow_user and snow_pass:
            try:
                import base64
                auth = base64.b64encode(f"{snow_user}:{snow_pass}".encode()).decode()
                sev_map = {"critical": "1", "high": "2", "medium": "3", "low": "4"}
                payload = {
                    "short_description": incident["title"],
                    "description": incident["description"],
                    "severity": sev_map.get(incident["severity"], "3"),
                    "urgency": {"high": "1", "medium": "2", "low": "3"}.get(incident.get("urgency", "medium"), "2"),
                    "impact": {"critical": "1", "high": "1", "medium": "2", "low": "3"}.get(incident["severity"], "2"),
                    "category": "LogClaw",
                    "caller_id": "logclaw",
                    "correlation_id": incident.get("correlation_id", ""),
                    "assignment_group": assignment_group,
                }
                req = Request(f"{instance_url}/api/now/table/{table}", json.dumps(payload).encode(), {"Content-Type": "application/json", "Authorization": f"Basic {auth}", "Accept": "application/json"}, method="POST")
                r = json.loads(urlopen(req, timeout=10).read())
                result = r.get("result", {})
                snow_number = result.get("number", "")
                snow_sysid = result.get("sys_id", "")
                ext_refs.append({"system": "servicenow", "ref_id": snow_number, "url": f"{instance_url}/nav_to.do?uri=incident.do?sys_id={snow_sysid}", "synced_at": now_iso()})
                stats["webhooks_sent"] += 1
            except Exception as e:
                stats["webhooks_failed"] += 1
                log(f"  ServiceNow error: {e}")

    if should_send("opsgenie"):
        og_cfg = platforms["opsgenie"]
        og_key = og_cfg.get("apiKey", "")
        og_api_url = og_cfg.get("apiUrl", "https://api.opsgenie.com")
        og_team = og_cfg.get("team", "")
        if og_key:
            try:
                priority_map = {"critical": "P1", "high": "P2", "medium": "P3", "low": "P4"}
                payload = {
                    "message": incident["title"],
                    "alias": incident["id"],
                    "description": incident["description"],
                    "priority": priority_map.get(incident["severity"], "P3"),
                    "source": f"logclaw-{TENANT_ID}",
                    "tags": ["logclaw", incident["service"], incident["severity"]],
                    "details": {"anomaly_score": str(incident["anomaly_score"]), "service": incident["service"], "correlation_id": incident.get("correlation_id", "")},
                }
                if og_team:
                    payload["responders"] = [{"name": og_team, "type": "team"}]
                req = Request(f"{og_api_url}/v2/alerts", json.dumps(payload).encode(), {"Content-Type": "application/json", "Authorization": f"GenieKey {og_key}"}, method="POST")
                r = json.loads(urlopen(req, timeout=10).read())
                ext_refs.append({"system": "opsgenie", "ref_id": r.get("requestId", ""), "url": "", "synced_at": now_iso()})
                stats["webhooks_sent"] += 1
            except Exception as e:
                stats["webhooks_failed"] += 1
                log(f"  OpsGenie error: {e}")

    return ext_refs


def forward_to_platform(incident, platform):
    """Forward a single incident to a specific platform (manual dispatch)."""
    cfg = get_config()
    platforms = cfg["platforms"]
    p_cfg = platforms.get(platform, {})

    if not p_cfg.get("enabled", False):
        return {"ok": False, "error": f"{platform} is not enabled"}

    ext_ref = None

    if platform == "slack":
        webhook_url = p_cfg.get("webhookUrl", "")
        channel = p_cfg.get("channel", "#logclaw-alerts")
        if not webhook_url:
            return {"ok": False, "error": "Slack webhookUrl not configured"}
        try:
            sev_emoji = {"critical": ":rotating_light:", "high": ":warning:", "medium": ":large_orange_diamond:", "low": ":information_source:"}.get(incident["severity"], ":bell:")
            text = f"{sev_emoji} *[Manual Forward] {incident['title']}*\nService: `{incident['service']}` | Priority: {incident.get('priority', 'P3')} | Severity: {incident['severity']}\nID: `{incident['id']}`"
            payload = {"channel": channel, "username": "LogClaw", "icon_emoji": ":shield:", "text": text}
            req = Request(webhook_url, json.dumps(payload).encode(), {"Content-Type": "application/json"}, method="POST")
            urlopen(req, timeout=5)
            stats["webhooks_sent"] += 1
            ext_ref = {"system": "slack", "ref_id": channel, "url": "", "synced_at": now_iso()}
        except Exception as e:
            stats["webhooks_failed"] += 1
            return {"ok": False, "error": str(e)}

    elif platform == "pagerduty":
        routing_key = p_cfg.get("routingKey", "")
        api_url = p_cfg.get("apiUrl", "https://events.pagerduty.com")
        if not routing_key:
            return {"ok": False, "error": "PagerDuty routingKey not configured"}
        try:
            sev_map = {"critical": "critical", "high": "error", "medium": "warning", "low": "info"}
            payload = {
                "routing_key": routing_key, "event_action": "trigger",
                "dedup_key": f"manual-{incident['id']}",
                "payload": {
                    "summary": f"[Manual] {incident['title']}",
                    "severity": sev_map.get(incident["severity"], "warning"),
                    "source": f"logclaw-{TENANT_ID}", "component": incident["service"],
                    "custom_details": {"anomaly_score": incident.get("anomaly_score"), "priority": incident.get("priority")},
                },
            }
            req = Request(f"{api_url}/v2/enqueue", json.dumps(payload).encode(), {"Content-Type": "application/json"}, method="POST")
            r = json.loads(urlopen(req, timeout=10).read())
            ext_ref = {"system": "pagerduty", "ref_id": r.get("dedup_key", incident["id"]), "url": "", "synced_at": now_iso()}
            stats["webhooks_sent"] += 1
        except Exception as e:
            stats["webhooks_failed"] += 1
            return {"ok": False, "error": str(e)}

    elif platform == "jira":
        base_url = p_cfg.get("baseUrl", "")
        api_token = p_cfg.get("apiToken", "")
        user_email = p_cfg.get("userEmail", "")
        project_key = p_cfg.get("projectKey", "OPS")
        issue_type = p_cfg.get("issueType", "Bug")
        if not (base_url and api_token and user_email):
            return {"ok": False, "error": "Jira credentials incomplete"}
        try:
            auth = base64.b64encode(f"{user_email}:{api_token}".encode()).decode()
            priority_map = {"critical": "Highest", "high": "High", "medium": "Medium", "low": "Low"}
            sev = incident["severity"]
            payload = {
                "fields": {
                    "project": {"key": project_key}, "summary": f"[LogClaw] {incident['title']}",
                    "description": f"LogClaw Incident {incident['id']}\n\nPriority: {incident.get('priority', 'P3')}\nSeverity: {sev}\nService: {incident['service']}\n\n{incident.get('description', '')}",
                    "issuetype": {"name": issue_type}, "priority": {"name": priority_map.get(sev, "Medium")},
                    "labels": ["logclaw", f"sev-{sev}", incident["service"]],
                }
            }
            req = Request(f"{base_url}/rest/api/2/issue", json.dumps(payload).encode(), {"Content-Type": "application/json", "Authorization": f"Basic {auth}"}, method="POST")
            r = json.loads(urlopen(req, timeout=10).read())
            jira_key = r.get("key", "")
            ext_ref = {"system": "jira", "ref_id": jira_key, "url": f"{base_url}/browse/{jira_key}", "synced_at": now_iso()}
            stats["webhooks_sent"] += 1
        except Exception as e:
            stats["webhooks_failed"] += 1
            return {"ok": False, "error": str(e)}

    elif platform == "servicenow":
        instance_url = p_cfg.get("instanceUrl", "")
        snow_user = p_cfg.get("username", "")
        snow_pass = p_cfg.get("password", "")
        table = p_cfg.get("table", "incident")
        assignment_group = p_cfg.get("assignmentGroup", "")
        if not (instance_url and snow_user and snow_pass):
            return {"ok": False, "error": "ServiceNow credentials incomplete"}
        try:
            auth = base64.b64encode(f"{snow_user}:{snow_pass}".encode()).decode()
            sev_map = {"critical": "1", "high": "2", "medium": "3", "low": "4"}
            payload = {
                "short_description": f"[LogClaw] {incident['title']}", "description": incident.get("description", ""),
                "severity": sev_map.get(incident["severity"], "3"), "category": "LogClaw",
                "caller_id": "logclaw", "correlation_id": incident.get("correlation_id", ""),
                "assignment_group": assignment_group,
            }
            req = Request(f"{instance_url}/api/now/table/{table}", json.dumps(payload).encode(), {"Content-Type": "application/json", "Authorization": f"Basic {auth}", "Accept": "application/json"}, method="POST")
            r = json.loads(urlopen(req, timeout=10).read())
            result = r.get("result", {})
            ext_ref = {"system": "servicenow", "ref_id": result.get("number", ""), "url": f"{instance_url}/nav_to.do?uri=incident.do?sys_id={result.get('sys_id', '')}", "synced_at": now_iso()}
            stats["webhooks_sent"] += 1
        except Exception as e:
            stats["webhooks_failed"] += 1
            return {"ok": False, "error": str(e)}

    elif platform == "opsgenie":
        og_key = p_cfg.get("apiKey", "")
        og_api_url = p_cfg.get("apiUrl", "https://api.opsgenie.com")
        og_team = p_cfg.get("team", "")
        if not og_key:
            return {"ok": False, "error": "OpsGenie apiKey not configured"}
        try:
            priority_map = {"critical": "P1", "high": "P2", "medium": "P3", "low": "P4"}
            payload = {
                "message": f"[Manual] {incident['title']}", "alias": f"manual-{incident['id']}",
                "description": incident.get("description", ""),
                "priority": priority_map.get(incident["severity"], "P3"),
                "source": f"logclaw-{TENANT_ID}", "tags": ["logclaw", "manual", incident["service"]],
                "details": {"anomaly_score": str(incident.get("anomaly_score", 0)), "service": incident["service"]},
            }
            if og_team:
                payload["responders"] = [{"name": og_team, "type": "team"}]
            req = Request(f"{og_api_url}/v2/alerts", json.dumps(payload).encode(), {"Content-Type": "application/json", "Authorization": f"GenieKey {og_key}"}, method="POST")
            r = json.loads(urlopen(req, timeout=10).read())
            ext_ref = {"system": "opsgenie", "ref_id": r.get("requestId", ""), "url": "", "synced_at": now_iso()}
            stats["webhooks_sent"] += 1
        except Exception as e:
            stats["webhooks_failed"] += 1
            return {"ok": False, "error": str(e)}

    else:
        return {"ok": False, "error": f"Unknown platform: {platform}"}

    return {"ok": True, "external_ref": ext_ref}


# ── Incident processing ────────────────────────────────────────────────
def process(event):
    cfg = get_config()
    min_score = cfg["anomaly"]["minimumScore"]
    dedup_mins = cfg["anomaly"]["deduplicationWindowMinutes"]

    score = event.get("anomaly_score", 0)
    if score < min_score:
        stats["skipped"] += 1
        return
    svc = event.get("service", "unknown")
    atype = event.get("anomaly_type", "unknown")

    if atype == "request_failure":
        # Semantic fingerprinting: normalized error template + category + root cause service
        error_template = event.get("error_message", "")  # already normalized by bridge
        error_category = event.get("error_category", "unknown")
        root_svc = event.get("root_cause_service", svc)
        fingerprint = f"{root_svc}:{error_category}:{error_template}"
        dedup_key = f"{root_svc}:request_failure:{hashlib.md5(fingerprint.encode()).hexdigest()[:12]}"
    else:
        dedup_key = f"{svc}:{atype}"

    existing = find_groupable_ticket(dedup_key)
    if existing:
        append_trace_to_ticket(existing, event)
        return

    if is_dup_key(dedup_key):
        stats["skipped"] += 1
        return

    # Persistent dedup: check OpenSearch for unresolved incidents with similar error
    if atype == "request_failure":
        error_template = event.get("error_message", "")
        os_dup = find_recent_duplicate_in_os(svc, error_template, dedup_mins, tenant_id=event.get("tenant_id"))
        if os_dup:
            # Re-register in memory so subsequent events are caught faster
            dedup_registry[dedup_key] = {
                "ticket_id": os_dup["id"],
                "expires": time.time() + dedup_mins * 60,
                "trace_count": os_dup.get("similar_count", 1),
            }
            append_trace_to_ticket(dedup_registry[dedup_key], event)
            log(f"Persistent dedup: grouped into existing {os_dup['id']}")
            return

    create_ticket(event, dedup_key, dedup_mins)


def create_ticket(event, dedup_key, dedup_mins=15):
    cfg = get_config()
    max_lines = cfg["anomaly"]["maxLogLinesInTicket"]
    now = now_iso()
    svc = event.get("service", "unknown")
    atype = event.get("anomaly_type", "unknown")
    sev = event.get("severity", "medium")
    urgency = "high" if sev in ("critical", "high") else "medium" if sev == "medium" else "low"
    priority = PRIORITY_MATRIX.get((sev, urgency), "P3")
    num = next_incident_number()
    iid = f"TICK-{num:04d}"

    # ── AI-powered analysis for request_failure ────────────────────────
    ai_analysis = {}
    if atype == "request_failure":
        # Layer 5: Find similar resolved incidents for historical context
        root_svc = event.get("root_cause_service", svc)
        error_template = event.get("error_message", "")
        similar_incidents = _find_similar_resolved_incidents(root_svc, error_template)
        event["_similar_incidents"] = similar_incidents

        # LLM chain-of-thought analysis
        ai_analysis = _analyze_trace_with_llm(event)
        log(f"  AI analysis: title={ai_analysis.get('title', '')[:60]}")

    # ── Title ──────────────────────────────────────────────────────────
    if atype == "request_failure":
        root_svc = event.get("root_cause_service", svc)
        error_cat = event.get("error_category", "unknown")
        title = ai_analysis.get("title") or f"Request failure in {root_svc}: {error_cat}"
        title = title[:200]  # safety limit
    else:
        raw_desc = event.get("description", "anomaly")[:120]
        title = f"[{sev.upper()}] {svc} - {raw_desc}"

    # ── Severity override from AI ──────────────────────────────────────
    if ai_analysis.get("severity") and atype == "request_failure":
        ai_sev = ai_analysis["severity"]
        if ai_sev in VALID_SEVERITIES:
            # FATAL always stays critical regardless of AI
            trigger_level = event.get("severity", "high")
            if trigger_level == "critical":
                sev = "critical"
            else:
                sev = ai_sev
            urgency = "high" if sev in ("critical", "high") else "medium" if sev == "medium" else "low"
            priority = PRIORITY_MATRIX.get((sev, urgency), "P3")

    request_traces = []
    if event.get("request_trace"):
        request_traces.append({
            "trace_id": event.get("trace_id", str(uuid.uuid4())[:8]),
            "span_ids": event.get("span_ids", []),
            "logs": event["request_trace"],
            "error_message": event.get("error_message", ""),
            "timestamp": event.get("timestamp", now),
        })

    # ── Reproduce steps ────────────────────────────────────────────────
    reproduce_steps = ai_analysis.get("reproduce_steps", [])
    if not reproduce_steps and event.get("request_trace"):
        for trace_log in event["request_trace"]:
            svc_name = trace_log.get("service", "unknown")
            msg = trace_log.get("message", "")
            level = trace_log.get("level", "INFO")
            endpoint = trace_log.get("endpoint", "")
            if level in ("ERROR", "FATAL"):
                reproduce_steps.append(f"{svc_name} fails: {msg[:80]}")
            elif endpoint:
                reproduce_steps.append(f"Request reaches {svc_name} ({endpoint})")
            else:
                reproduce_steps.append(f"{svc_name}: {msg[:60]}")

    # ── Tags ───────────────────────────────────────────────────────────
    tags = [svc, atype, sev]
    if atype == "request_failure":
        error_cat = event.get("error_category", "")
        if error_cat and error_cat != "unknown":
            tags.append(error_cat)
        tags.extend(ai_analysis.get("tags", []))
        # Deduplicate
        tags = list(dict.fromkeys(tags))

    # ── Custom fields (causal chain, blast radius) ─────────────────────
    custom_fields = {}
    if atype == "request_failure":
        custom_fields["causal_chain"] = event.get("causal_chain", [])
        custom_fields["blast_radius"] = event.get("blast_radius", {})
        custom_fields["error_category"] = event.get("error_category", "unknown")
        custom_fields["root_cause_service"] = event.get("root_cause_service", svc)
        if ai_analysis.get("suggested_fix"):
            custom_fields["suggested_fix"] = ai_analysis["suggested_fix"]
        if ai_analysis.get("error_pattern"):
            custom_fields["error_pattern"] = ai_analysis["error_pattern"]

    # ── Evidence logs ──────────────────────────────────────────────────
    evidence_logs = []
    if atype == "request_failure" and event.get("request_trace"):
        # Use actual trace logs as evidence (not generic service query)
        for entry in event["request_trace"]:
            evidence_logs.append({
                "timestamp": entry.get("timestamp", ""),
                "level": entry.get("level", "INFO"),
                "message": entry.get("message", ""),
                "service": entry.get("service", "unknown"),
            })

    incident = {
        "id": iid, "number": num,
        "severity": sev, "urgency": urgency, "priority": priority,
        "state": "identified",
        "title": title,
        "description": event.get("description", ""),
        "service": svc,
        "environment": event.get("tenant_id", TENANT_ID),
        "anomaly_type": atype,
        "anomaly_score": event.get("anomaly_score", 0),
        "correlation_id": event.get("event_id", str(uuid.uuid4())),
        "trace_id": event.get("trace_id"),
        "span_ids": event.get("span_ids", []),
        "request_flow": event.get("request_flow", []),
        "affected_services": event.get("affected_services", [svc]),
        "request_traces": request_traces,
        "root_cause": ai_analysis.get("root_cause") or event.get("root_cause"),
        "reproduce_steps": reproduce_steps,
        "similar_count": 1,
        "affected_endpoint": event.get("endpoint", event.get("affected_endpoint", "")),
        "error_type": event.get("error_type", event.get("error_category")),
        "status_code": event.get("status_code"),
        "impact": ai_analysis.get("impact"),
        "commander": None, "assigned_to": None,
        "communication_channel": None, "runbook_url": None,
        "evidence_logs": evidence_logs,
        "created_at": now, "updated_at": now, "detected_at": now,
        "acknowledged_at": None, "mitigated_at": None, "resolved_at": None,
        "tenant_id": event.get("tenant_id", TENANT_ID),
        "timeline": [
            {"id": gen_request_id(), "timestamp": now, "type": "state_change", "state": "identified", "message": f"Anomaly detected: {event.get('description', 'unknown anomaly')[:100]}", "actor": "system"}
        ],
        "external_refs": [], "tags": tags,
        "custom_fields": custom_fields,
    }

    if atype == "error_rate_spike":
        evidence = os_context(svc, tenant_id=event.get("tenant_id"))
        incident["evidence_logs"] = evidence[:max_lines]

    ext_refs = send_webhooks(incident)
    if ext_refs:
        incident["external_refs"] = ext_refs

    # Mark if LLM was unavailable (fallback mode)
    if atype == "request_failure" and not ai_analysis.get("root_cause"):
        incident["custom_fields"]["llm_fallback"] = True

    save_incident(incident)
    audit_record(iid, "created", details={"severity": sev, "priority": priority, "service": svc})

    dedup_registry[dedup_key] = {
        "ticket_id": iid,
        "expires": time.time() + dedup_mins * 60,
        "trace_count": 1,
    }

    with lock:
        stats["created"] += 1
    log(f"Ticket {iid} ({priority}): {title}")


# ── Kafka consumer loop ────────────────────────────────────────────────
def kafka_loop():
    log(f"Kafka: {KAFKA_BROKERS} / {KAFKA_TOPIC}")
    try:
        from kafka import KafkaConsumer
        c = KafkaConsumer(
            KAFKA_TOPIC,
            bootstrap_servers=KAFKA_BROKERS.split(","),
            group_id=KAFKA_GROUP,
            auto_offset_reset="earliest",
            value_deserializer=lambda m: json.loads(m.decode()),
            consumer_timeout_ms=1000,
            session_timeout_ms=30000,
            max_poll_records=100,
        )
        consumer_ready.set()
        log("Kafka consumer ready")
        global _last_purge
        purge_old_incidents()
        _last_purge = time.time()
        while True:
            for tp, msgs in c.poll(timeout_ms=2000).items():
                for msg in msgs:
                    stats["consumed"] += 1
                    try:
                        process(msg.value)
                    except Exception as e:
                        log(f"Process error: {e}")
            if time.time() - _last_purge >= 86400:
                purge_old_incidents()
                _last_purge = time.time()
            time.sleep(0.5)
    except ImportError:
        log("kafka-python-ng not installed, HTTP-only mode")
        consumer_ready.set()
    except Exception as e:
        log(f"Kafka error: {e}")
        consumer_ready.set()
        time.sleep(10)
        kafka_loop()


# ── Platform / LLM connection tests ───────────────────────────────────

# Required fields per platform — must be non-empty to be considered configured
PLATFORM_REQUIRED_FIELDS = {
    "pagerduty": ["routingKey"],
    "jira": ["baseUrl", "apiToken", "userEmail"],
    "servicenow": ["instanceUrl", "username", "password"],
    "opsgenie": ["apiKey"],
    "slack": ["webhookUrl"],
}


def test_platform_connection(platform: str) -> dict:
    """Perform a lightweight connectivity test for the given platform.
    Returns {"ok": bool, "message": str, "latency_ms": int}."""
    cfg = get_config()
    pcfg = cfg["platforms"].get(platform, {})

    # Check required fields first
    required = PLATFORM_REQUIRED_FIELDS.get(platform, [])
    missing = [f for f in required if not pcfg.get(f) or pcfg[f] == "****"]
    if missing:
        return {"ok": False, "message": f"Missing required fields: {', '.join(missing)}", "latency_ms": 0}

    import time as _t
    start = _t.time()
    try:
        if platform == "slack":
            # Slack: post a test message to the webhook
            url = pcfg["webhookUrl"]
            payload = json.dumps({
                "channel": pcfg.get("channel", "#logclaw-alerts"),
                "username": "LogClaw",
                "icon_emoji": ":white_check_mark:",
                "text": ":white_check_mark: LogClaw connection test successful",
            })
            req = Request(url, data=payload.encode(), headers={"Content-Type": "application/json"}, method="POST")
            resp = urlopen(req, timeout=8)
            ms = int((_t.time() - start) * 1000)
            return {"ok": True, "message": f"Slack webhook responded {resp.status}", "latency_ms": ms}

        elif platform == "pagerduty":
            # PagerDuty: send a change event (non-alerting) to validate the routing key
            url = pcfg.get("apiUrl", "https://events.pagerduty.com") + "/v2/change/enqueue"
            payload = json.dumps({
                "routing_key": pcfg["routingKey"],
                "payload": {
                    "summary": "LogClaw connection test",
                    "timestamp": now_iso(),
                    "source": f"logclaw-{TENANT_ID}",
                },
            })
            req = Request(url, data=payload.encode(), headers={"Content-Type": "application/json"}, method="POST")
            resp = urlopen(req, timeout=10)
            ms = int((_t.time() - start) * 1000)
            return {"ok": True, "message": f"PagerDuty responded {resp.status}", "latency_ms": ms}

        elif platform == "jira":
            # Jira: GET /rest/api/2/myself to validate credentials
            url = pcfg["baseUrl"].rstrip("/") + "/rest/api/2/myself"
            import base64 as _b64
            creds = _b64.b64encode(f'{pcfg["userEmail"]}:{pcfg["apiToken"]}'.encode()).decode()
            req = Request(url, headers={"Authorization": f"Basic {creds}", "Accept": "application/json"}, method="GET")
            resp = urlopen(req, timeout=10)
            data = json.loads(resp.read())
            ms = int((_t.time() - start) * 1000)
            display = data.get("displayName", data.get("emailAddress", "OK"))
            return {"ok": True, "message": f"Authenticated as {display}", "latency_ms": ms}

        elif platform == "servicenow":
            # ServiceNow: GET table with limit=0 to test auth
            url = pcfg["instanceUrl"].rstrip("/") + f'/api/now/table/{pcfg.get("table", "incident")}?sysparm_limit=0'
            import base64 as _b64
            creds = _b64.b64encode(f'{pcfg["username"]}:{pcfg["password"]}'.encode()).decode()
            req = Request(url, headers={"Authorization": f"Basic {creds}", "Accept": "application/json"}, method="GET")
            resp = urlopen(req, timeout=10)
            ms = int((_t.time() - start) * 1000)
            return {"ok": True, "message": f"ServiceNow responded {resp.status}", "latency_ms": ms}

        elif platform == "opsgenie":
            # OpsGenie: GET /v2/heartbeats to test auth
            url = pcfg.get("apiUrl", "https://api.opsgenie.com") + "/v2/heartbeats"
            req = Request(url, headers={"Authorization": f"GenieKey {pcfg['apiKey']}", "Accept": "application/json"}, method="GET")
            resp = urlopen(req, timeout=10)
            ms = int((_t.time() - start) * 1000)
            return {"ok": True, "message": f"OpsGenie responded {resp.status}", "latency_ms": ms}

        else:
            return {"ok": False, "message": f"Unknown platform: {platform}", "latency_ms": 0}

    except HTTPError as e:
        ms = int((_t.time() - start) * 1000)
        return {"ok": False, "message": f"HTTP {e.code}: {e.reason}", "latency_ms": ms}
    except URLError as e:
        ms = int((_t.time() - start) * 1000)
        return {"ok": False, "message": f"Connection failed: {e.reason}", "latency_ms": ms}
    except Exception as e:
        ms = int((_t.time() - start) * 1000)
        return {"ok": False, "message": str(e)[:200], "latency_ms": ms}


def _test_single_provider(provider_name, endpoint, model, api_key) -> dict:
    """Test connectivity for a single provider+model. Returns {ok, message, latency_ms}."""
    import time as _t
    start = _t.time()
    try:
        if provider_name == "ollama":
            url = endpoint.rstrip("/") + "/api/tags"
            req = Request(url, headers={"Accept": "application/json"}, method="GET")
            resp = urlopen(req, timeout=10)
            data = json.loads(resp.read())
            models = [m.get("name", "?") for m in data.get("models", [])]
            ms = int((_t.time() - start) * 1000)
            found = model in " ".join(models) if model else True
            msg = f"Connected — {len(models)} model(s) available"
            if model and not found:
                msg += f" (warning: '{model}' not found)"
            return {"ok": True, "message": msg, "latency_ms": ms}

        elif provider_name == "vllm":
            url = endpoint.rstrip("/") + "/v1/models"
            req = Request(url, headers={"Accept": "application/json"}, method="GET")
            resp = urlopen(req, timeout=10)
            data = json.loads(resp.read())
            models = [m.get("id", "?") for m in data.get("data", [])]
            ms = int((_t.time() - start) * 1000)
            return {"ok": True, "message": f"Connected — models: {', '.join(models[:3])}", "latency_ms": ms}

        elif provider_name == "claude":
            import anthropic
            if not api_key:
                return {"ok": False, "message": "No API key configured", "latency_ms": 0}
            base_url = endpoint.rstrip("/") if endpoint != "https://api.anthropic.com" else None
            client = anthropic.Anthropic(api_key=api_key, base_url=base_url, timeout=10.0)
            msg = client.messages.create(
                model=model or "claude-3-5-haiku-latest",
                max_tokens=16,
                messages=[{"role": "user", "content": "Say OK"}],
            )
            ms = int((_t.time() - start) * 1000)
            text = msg.content[0].text if msg.content else ""
            return {"ok": True, "message": f"Connected — {model} responded: \"{text[:30]}\"", "latency_ms": ms}

        elif provider_name == "openai":
            import openai as _openai
            if not api_key:
                return {"ok": False, "message": "No API key configured", "latency_ms": 0}
            client = _openai.OpenAI(
                api_key=api_key,
                base_url=endpoint.rstrip("/") + "/v1" if endpoint else None,
                timeout=10.0,
            )
            resp = client.chat.completions.create(
                model=model or "gpt-4o-mini",
                max_tokens=16,
                messages=[{"role": "user", "content": "Say OK"}],
            )
            ms = int((_t.time() - start) * 1000)
            text = resp.choices[0].message.content or ""
            return {"ok": True, "message": f"Connected — {model} responded: \"{text[:30]}\"", "latency_ms": ms}

        else:
            return {"ok": False, "message": f"Unknown provider: {provider_name}", "latency_ms": 0}

    except HTTPError as e:
        ms = int((_t.time() - start) * 1000)
        if e.code in (401, 403):
            return {"ok": True, "message": f"Endpoint reachable (auth required: {e.code})", "latency_ms": ms}
        return {"ok": False, "message": f"HTTP {e.code}: {e.reason}", "latency_ms": ms}
    except URLError as e:
        ms = int((_t.time() - start) * 1000)
        return {"ok": False, "message": f"Connection failed: {e.reason}", "latency_ms": ms}
    except Exception as e:
        ms = int((_t.time() - start) * 1000)
        return {"ok": False, "message": str(e)[:200], "latency_ms": ms}


def test_llm_connection(target_provider=None) -> dict:
    """Test LLM connectivity. If target_provider given, tests that one.
    Otherwise tests all providers in chain and returns summary."""
    cfg = get_config()
    llm = cfg["llm"]
    providers = llm.get("providers", [])

    if not providers:
        # Legacy single-provider mode
        provider = llm["provider"]
        if provider == "disabled":
            return {"ok": False, "message": "LLM provider is disabled", "latency_ms": 0}
        if not llm.get("endpoint"):
            return {"ok": False, "message": "No endpoint configured", "latency_ms": 0}
        api_key = _resolve_api_key(provider)
        return _test_single_provider(provider, llm["endpoint"], llm.get("model", ""), api_key)

    # Test specific provider in chain
    if target_provider:
        for p in providers:
            key = _cb_key(p["name"], p.get("model", ""))
            if key == target_provider or p["name"] == target_provider:
                api_key = _resolve_api_key(p["name"], p)
                result = _test_single_provider(p["name"], p["endpoint"], p.get("model", ""), api_key)
                result["provider"] = key
                return result
        return {"ok": False, "message": f"Provider '{target_provider}' not in chain", "latency_ms": 0}

    # Test all providers in chain
    results = []
    for p in providers:
        if not p.get("enabled", True) or not p.get("endpoint"):
            continue
        api_key = _resolve_api_key(p["name"], p)
        r = _test_single_provider(p["name"], p["endpoint"], p.get("model", ""), api_key)
        key = _cb_key(p["name"], p.get("model", ""))
        r["provider"] = key
        results.append(r)

    ok_count = sum(1 for r in results if r["ok"])
    total = len(results)
    avg_ms = int(sum(r["latency_ms"] for r in results) / max(total, 1))
    return {
        "ok": ok_count > 0,
        "message": f"{ok_count}/{total} providers healthy",
        "latency_ms": avg_ms,
        "providers": results,
    }


# ── API Schema / Discovery ─────────────────────────────────────────────
def api_schema():
    return {
        "name": "LogClaw Incident Management API",
        "version": ENGINE_VERSION,
        "api_version": API_VERSION,
        "description": "Industry-standard incident management engine with PagerDuty/FireHydrant/ITIL-aligned workflows",
        "base_url": f"/api/{API_VERSION}",
        "endpoints": [
            {"method": "GET",    "path": f"/api/{API_VERSION}/incidents",                  "description": "List incidents (paginated, filterable)"},
            {"method": "POST",   "path": f"/api/{API_VERSION}/incidents",                  "description": "Create incident manually"},
            {"method": "GET",    "path": f"/api/{API_VERSION}/incidents/:id",              "description": "Get single incident by ID"},
            {"method": "PATCH",  "path": f"/api/{API_VERSION}/incidents/:id",              "description": "Update incident (state, assignee, impact, etc.)"},
            {"method": "DELETE", "path": f"/api/{API_VERSION}/incidents/:id",              "description": "Delete incident"},
            {"method": "GET",    "path": f"/api/{API_VERSION}/incidents/:id/timeline",     "description": "Get incident timeline events"},
            {"method": "POST",   "path": f"/api/{API_VERSION}/incidents/:id/notes",        "description": "Add note to incident timeline"},
            {"method": "GET",    "path": f"/api/{API_VERSION}/stats",                      "description": "Aggregated incident statistics"},
            {"method": "GET",    "path": f"/api/{API_VERSION}/metrics/mttr",               "description": "MTTR/MTTA/MTTM metrics (FireHydrant-style)"},
            {"method": "GET",    "path": f"/api/{API_VERSION}/integrations",               "description": "Integration status and configuration"},
            {"method": "GET",    "path": f"/api/{API_VERSION}/config",                     "description": "Get full runtime configuration"},
            {"method": "PATCH",  "path": f"/api/{API_VERSION}/config/routing",             "description": "Update severity-based routing rules"},
            {"method": "PATCH",  "path": f"/api/{API_VERSION}/config/platforms",           "description": "Toggle platforms and update credentials"},
            {"method": "PATCH",  "path": f"/api/{API_VERSION}/config/anomaly",             "description": "Update anomaly detection thresholds"},
            {"method": "PATCH",  "path": f"/api/{API_VERSION}/config/llm",                 "description": "Switch LLM provider, model, endpoint"},
            {"method": "POST",   "path": f"/api/{API_VERSION}/test-connection",             "description": "Test platform connectivity (Slack, PagerDuty, etc.)"},
            {"method": "POST",   "path": f"/api/{API_VERSION}/test-llm",                    "description": "Test LLM provider connectivity"},
            {"method": "GET",    "path": f"/api/{API_VERSION}/schema",                     "description": "API schema and endpoint discovery"},
        ],
        "incident_states": VALID_STATES,
        "severity_levels": VALID_SEVERITIES,
        "urgency_levels": VALID_URGENCIES,
        "priority_matrix": "severity x urgency -> P1-P5 (ITIL)",
        "integrations": list(VALID_PLATFORMS),
    }


# ── HTTP API ───────────────────────────────────────────────────────────
class H(BaseHTTPRequestHandler):
    def _route(self, method):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        params = parse_qs(parsed.query)
        req_id = gen_request_id()

        body = None
        if method in ("POST", "PATCH", "PUT"):
            ln = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(ln)) if ln > 0 else {}

        # ── Health / Ready ──
        if path == "/health":
            return self._j(200, {"status": "ok", "ready": consumer_ready.is_set(), "version": ENGINE_VERSION}, req_id)
        if path == "/ready":
            code = 200 if consumer_ready.is_set() else 503
            return self._j(code, {"ready": consumer_ready.is_set()}, req_id)

        # ── Prometheus metrics ──
        if path == "/metrics":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            lines = []
            for k, v in stats.items():
                lines.append(f"# TYPE logclaw_ticketing_{k} counter")
                lines.append(f"logclaw_ticketing_{k} {v}")
            # Per-provider LLM metrics
            for pkey, pstats in llm_provider_stats.items():
                for outcome, count in pstats.items():
                    lines.append(f'logclaw_ticketing_llm_provider_{outcome}{{provider="{pkey}"}} {count}')
            self.wfile.write("\n".join(lines).encode())
            return

        # ── Versioned API routes ──
        api_path = path
        if path.startswith(f"/api/{API_VERSION}"):
            api_path = "/api" + path[len(f"/api/{API_VERSION}"):]
        elif not path.startswith("/api"):
            return self._j(404, {"error": {"code": "not_found", "message": f"Unknown endpoint: {path}"}}, req_id)

        # ── Schema / Discovery ──
        if api_path == "/api/schema" and method == "GET":
            return self._j(200, api_schema(), req_id)

        # ── Stats ──
        if api_path == "/api/stats" and method == "GET":
            return self._j(200, get_stats(), req_id)

        # ── MTTR Metrics ──
        if api_path == "/api/metrics/mttr" and method == "GET":
            return self._j(200, get_mttr(params), req_id)

        # ── Integrations (read-only, reads from config) ──
        if api_path == "/api/integrations" and method == "GET":
            cfg = get_config(mask_secrets=True)
            return self._j(200, cfg["platforms"], req_id)

        # ── Runtime Config: GET ──
        if api_path == "/api/config" and method == "GET":
            cfg = get_config(mask_secrets=True)
            cfg["runtime"] = True
            return self._j(200, cfg, req_id)

        # ── Runtime Config: PATCH routing ──
        if api_path == "/api/config/routing" and method == "PATCH":
            errors = []
            for sev, plist in body.items():
                if sev not in VALID_SEVERITIES:
                    errors.append(f"Invalid severity: {sev}")
                    continue
                if not isinstance(plist, list):
                    errors.append(f"routing.{sev} must be an array")
                    continue
                for p in plist:
                    if p not in VALID_PLATFORMS:
                        errors.append(f"Unknown platform in routing.{sev}: {p}")
            if errors:
                return self._j(400, {"error": {"code": "validation_error", "messages": errors}}, req_id)
            with _config_lock:
                for sev, plist in body.items():
                    _config["routing"][sev] = plist
            return self._j(200, {"routing": get_config()["routing"], "persisted": False}, req_id)

        # ── Runtime Config: PATCH platforms ──
        if api_path == "/api/config/platforms" and method == "PATCH":
            for name in body:
                if name not in VALID_PLATFORMS:
                    return self._j(400, {"error": {"code": "unknown_platform", "message": f"Unknown platform: {name}"}}, req_id)
                if not isinstance(body[name], dict):
                    return self._j(400, {"error": {"code": "validation_error", "message": f"Platform {name} must be an object"}}, req_id)
            with _config_lock:
                for name, settings in body.items():
                    if name in _config["platforms"]:
                        _config["platforms"][name].update(settings)
            return self._j(200, {"platforms": get_config(mask_secrets=True)["platforms"], "persisted": False}, req_id)

        # ── Runtime Config: PATCH anomaly ──
        if api_path == "/api/config/anomaly" and method == "PATCH":
            allowed = {"minimumScore", "deduplicationWindowMinutes", "contextWindowSeconds", "maxLogLinesInTicket"}
            for key in body:
                if key not in allowed:
                    return self._j(400, {"error": {"code": "unknown_field", "message": f"Unknown anomaly field: {key}"}}, req_id)
            with _config_lock:
                for key, val in body.items():
                    if key in allowed:
                        _config["anomaly"][key] = val
            return self._j(200, {"anomaly": get_config()["anomaly"], "persisted": False}, req_id)

        # ── Runtime Config: PATCH llm ──
        if api_path == "/api/config/llm" and method == "PATCH":
            allowed_new = {"providers", "provider", "model", "endpoint", "api_key"}
            for key in body:
                if key not in allowed_new:
                    return self._j(400, {"error": {"code": "unknown_field", "message": f"Unknown LLM field: {key}"}}, req_id)

            if "providers" in body:
                # New multi-provider update
                chain = body["providers"]
                if not isinstance(chain, list):
                    return self._j(400, {"error": {"code": "invalid_format", "message": "providers must be an array"}}, req_id)
                for entry in chain:
                    if not isinstance(entry, dict) or entry.get("name") not in VALID_LLM_PROVIDERS or entry.get("name") == "disabled":
                        return self._j(400, {"error": {"code": "invalid_provider", "message": f"Invalid provider in chain: {entry.get('name', '?')}"}}, req_id)
                    # Fill defaults for missing fields
                    if "endpoint" not in entry or not entry["endpoint"]:
                        entry["endpoint"] = _PROVIDER_ENDPOINTS.get(entry["name"], "")
                    if "model" not in entry or not entry["model"]:
                        entry["model"] = _PROVIDER_DEFAULT_MODELS.get(entry["name"], "")
                    entry.setdefault("enabled", True)
                    entry.setdefault("api_key", "")
                with _config_lock:
                    _config["llm"]["providers"] = chain
                    if chain:
                        _config["llm"]["provider"] = chain[0]["name"]
            else:
                # Legacy single-provider update
                if "provider" in body and body["provider"] not in VALID_LLM_PROVIDERS:
                    return self._j(400, {"error": {"code": "invalid_provider", "message": f"Must be one of: {sorted(VALID_LLM_PROVIDERS)}"}}, req_id)
                allowed_flat = {"provider", "model", "endpoint", "api_key"}
                with _config_lock:
                    for key, val in body.items():
                        if key in allowed_flat:
                            _config["llm"][key] = val
            return self._j(200, {"llm": get_config(mask_secrets=True)["llm"], "persisted": False}, req_id)

        # ── Test platform connection ──
        if api_path == "/api/test-connection" and method == "POST":
            platform = body.get("platform", "") if body else ""
            if platform not in VALID_PLATFORMS:
                return self._j(400, {"error": {"code": "invalid_platform", "message": f"Must be one of: {sorted(VALID_PLATFORMS)}"}}, req_id)
            result = test_platform_connection(platform)
            return self._j(200, result, req_id)

        # ── Test LLM connection ──
        if api_path == "/api/test-llm" and method == "POST":
            target = body.get("provider") if body else None
            result = test_llm_connection(target_provider=target)
            return self._j(200, result, req_id)

        # ── LLM status (for dashboard fallback warning) ──
        if api_path == "/api/llm-status" and method == "GET":
            cfg = get_config(mask_secrets=True)
            llm = cfg["llm"]
            providers = llm.get("providers", [])
            providers_status = []
            for p in providers:
                name = p["name"]
                model = p.get("model", "")
                key = _cb_key(name, model)
                pstats = llm_provider_stats.get(key, {})
                success = pstats.get("success", 0)
                failure = pstats.get("failure", 0)
                total = success + failure
                providers_status.append({
                    "name": name,
                    "model": model,
                    "enabled": p.get("enabled", True),
                    "has_api_key": bool(_resolve_api_key(name, p)),
                    "using_default_key": not bool(p.get("api_key")) or p.get("api_key") == "****",
                    "circuit_breaker_open": _cb_is_open(key),
                    "calls": total,
                    "failures": failure,
                    "failure_rate": round(failure / max(total, 1) * 100, 1),
                })
            return self._j(200, {
                "primary_provider": providers[0]["name"] if providers else llm["provider"],
                "provider_chain": [_cb_key(p["name"], p.get("model", "")) for p in providers],
                "providers": providers_status,
                "enabled": bool(providers) or llm["provider"] != "disabled",
                "llm_calls": stats.get("llm_calls", 0),
                "llm_failures": stats.get("llm_failures", 0),
                "failure_rate": round(stats["llm_failures"] / max(stats["llm_calls"], 1) * 100, 1),
            }, req_id)

        # ── Audit trail ──
        if api_path == "/api/audit" and method == "GET":
            incident_id = params.get("incident_id", [None])[0]
            limit_n = min(int(params.get("limit", [100])[0]), 500)
            with lock:
                entries = list(_audit_log)
            if incident_id:
                entries = [e for e in entries if e["incident_id"] == incident_id]
            entries = entries[-limit_n:]
            entries.reverse()
            return self._j(200, {"data": entries, "total": len(entries)}, req_id)

        # ── Batch transition ──
        if api_path == "/api/incidents/batch" and method == "POST":
            ids = body.get("ids", [])
            action = body.get("action", "")
            actor = body.get("actor", "operator")
            if not ids or not action:
                return self._j(400, {"error": {"code": "validation_error", "message": "ids and action required"}}, req_id)
            results = []
            for iid in ids[:50]:  # cap at 50
                inc = get_incident(iid)
                if not inc:
                    results.append({"id": iid, "ok": False, "message": "not found"})
                    continue
                now_t = now_iso()
                old_state = inc["state"]
                new_state = action
                if new_state == "acknowledge":
                    new_state = "acknowledged"
                if new_state not in VALID_STATES:
                    results.append({"id": iid, "ok": False, "message": f"invalid state: {new_state}"})
                    continue
                inc["state"] = new_state
                inc["updated_at"] = now_t
                if new_state == "acknowledged" and not inc.get("acknowledged_at"):
                    inc["acknowledged_at"] = now_t
                elif new_state == "mitigated" and not inc.get("mitigated_at"):
                    inc["mitigated_at"] = now_t
                elif new_state == "resolved":
                    inc["resolved_at"] = now_t
                inc["timeline"].append({"id": gen_request_id(), "timestamp": now_t, "type": "state_change", "state": new_state, "message": f"Bulk action: {old_state} -> {new_state}", "actor": actor})
                save_incident(inc)
                audit_record(iid, "state_change", actor=actor, details={"from": old_state, "to": new_state, "bulk": True})
                results.append({"id": iid, "ok": True, "state": new_state})
            return self._j(200, {"results": results}, req_id)

        # ── Incident list ──
        if api_path == "/api/incidents" and method == "GET":
            return self._j(200, search_incidents(params), req_id)

        # ── Create incident ──
        if api_path == "/api/incidents" and method == "POST":
            now = now_iso()
            sev = body.get("severity", "medium")
            urg = body.get("urgency", "medium")
            if sev not in VALID_SEVERITIES:
                return self._j(400, {"error": {"code": "invalid_severity", "message": f"Must be one of: {VALID_SEVERITIES}"}}, req_id)
            if urg not in VALID_URGENCIES:
                urg = "medium"
            prio = PRIORITY_MATRIX.get((sev, urg), "P3")
            num = next_incident_number()
            iid = f"TICK-{num:04d}"
            incident = {
                "id": iid, "number": num,
                "severity": sev, "urgency": urg, "priority": prio,
                "state": "identified",
                "title": body.get("title", "Manual incident"),
                "description": body.get("description", ""),
                "service": body.get("service", "manual"),
                "environment": body.get("environment", params.get("tenant_id", [TENANT_ID])[0]),
                "anomaly_type": "manual", "anomaly_score": 0,
                "correlation_id": body.get("correlation_id", str(uuid.uuid4())),
                "affected_endpoint": body.get("affected_endpoint", ""),
                "impact": body.get("impact"),
                "root_cause": None, "commander": body.get("commander"),
                "assigned_to": body.get("assigned_to"),
                "communication_channel": body.get("communication_channel"),
                "runbook_url": body.get("runbook_url"),
                "evidence_logs": [],
                "created_at": now, "updated_at": now, "detected_at": now,
                "acknowledged_at": None, "mitigated_at": None, "resolved_at": None,
                "tenant_id": params.get("tenant_id", [TENANT_ID])[0],
                "timeline": [{"id": gen_request_id(), "timestamp": now, "type": "state_change", "state": "identified", "message": body.get("message", "Manually created incident"), "actor": body.get("actor", "operator")}],
                "external_refs": [], "tags": body.get("tags", []),
                "custom_fields": body.get("custom_fields", {}),
            }
            save_incident(incident)
            with lock:
                stats["created"] += 1
            return self._j(201, incident, req_id)

        # ── Single incident routes ──
        parts = api_path.split("/")
        if len(parts) >= 4 and parts[1] == "api" and parts[2] == "incidents":
            iid = parts[3]
            sub = parts[4] if len(parts) > 4 else None

            if method == "GET" and not sub:
                inc = get_incident(iid)
                if inc:
                    return self._j(200, inc, req_id)
                return self._j(404, {"error": {"code": "not_found", "message": f"Incident {iid} not found"}}, req_id)

            if method == "DELETE" and not sub:
                if delete_incident(iid):
                    return self._j(200, {"deleted": True, "id": iid}, req_id)
                return self._j(404, {"error": {"code": "not_found", "message": f"Incident {iid} not found"}}, req_id)

            if method == "GET" and sub == "timeline":
                inc = get_incident(iid)
                if inc:
                    return self._j(200, {"data": inc.get("timeline", []), "incident_id": iid}, req_id)
                return self._j(404, {"error": {"code": "not_found", "message": f"Incident {iid} not found"}}, req_id)

            if method == "POST" and sub == "notes":
                inc = get_incident(iid)
                if not inc:
                    return self._j(404, {"error": {"code": "not_found", "message": f"Incident {iid} not found"}}, req_id)
                now = now_iso()
                note = {
                    "id": gen_request_id(),
                    "timestamp": now,
                    "type": "note",
                    "state": inc["state"],
                    "message": body.get("message", ""),
                    "actor": body.get("actor", "operator"),
                }
                inc["timeline"].append(note)
                inc["updated_at"] = now
                save_incident(inc)
                return self._j(201, note, req_id)

            if method == "POST" and sub == "forward":
                inc = get_incident(iid)
                if not inc:
                    return self._j(404, {"error": {"code": "not_found", "message": f"Incident {iid} not found"}}, req_id)
                platform = body.get("platform", "") if body else ""
                if platform not in VALID_PLATFORMS:
                    return self._j(400, {"error": {"code": "invalid_platform", "message": f"Must be one of: {sorted(VALID_PLATFORMS)}"}}, req_id)
                result = forward_to_platform(inc, platform)
                if result.get("ok"):
                    now = now_iso()
                    platform_label = {"pagerduty": "PagerDuty", "jira": "Jira", "servicenow": "ServiceNow", "opsgenie": "OpsGenie", "slack": "Slack"}.get(platform, platform)
                    inc.setdefault("external_refs", []).append(result["external_ref"])
                    inc["timeline"].append({"id": gen_request_id(), "timestamp": now, "type": "integration", "state": inc["state"], "message": f"Manually forwarded to {platform_label}", "actor": body.get("actor", "operator")})
                    inc["updated_at"] = now
                    save_incident(inc)
                    return self._j(200, {"data": inc, "forwarded": result["external_ref"]}, req_id)
                else:
                    return self._j(502, {"error": {"code": "forward_failed", "message": result.get("error", "Unknown error"), "platform": platform}}, req_id)

            # State transitions via POST /api/incidents/{id}/{action}
            transition_map = {"acknowledge": "acknowledged", "investigate": "investigating", "mitigate": "mitigated", "resolve": "resolved"}
            if method == "POST" and sub in transition_map:
                inc = get_incident(iid)
                if not inc:
                    return self._j(404, {"error": {"code": "not_found", "message": f"Incident {iid} not found"}}, req_id)
                now = now_iso()
                old_state = inc["state"]
                new_state = transition_map[sub]
                inc["state"] = new_state
                inc["updated_at"] = now
                if new_state == "acknowledged" and not inc.get("acknowledged_at"):
                    inc["acknowledged_at"] = now
                elif new_state == "mitigated" and not inc.get("mitigated_at"):
                    inc["mitigated_at"] = now
                elif new_state == "resolved":
                    inc["resolved_at"] = now
                    if inc.get("created_at"):
                        try:
                            created = datetime.fromisoformat(inc["created_at"].replace("Z", "+00:00"))
                            resolved = datetime.fromisoformat(now.replace("Z", "+00:00"))
                            inc["mttr_seconds"] = int((resolved - created).total_seconds())
                        except Exception:
                            pass
                msg = body.get("message", f"State changed: {old_state} → {new_state}") if body else f"State changed: {old_state} → {new_state}"
                inc["timeline"].append({"id": gen_request_id(), "timestamp": now, "type": "state_change", "state": new_state, "message": msg, "actor": body.get("actor", "operator") if body else "operator"})
                save_incident(inc)
                return self._j(200, {"data": inc}, req_id)

            if method == "PATCH" and not sub:
                inc = get_incident(iid)
                if not inc:
                    return self._j(404, {"error": {"code": "not_found", "message": f"Incident {iid} not found"}}, req_id)
                now = now_iso()
                changed = False
                if "state" in body:
                    new_state = body["state"]
                    if new_state not in VALID_STATES:
                        return self._j(400, {"error": {"code": "invalid_state", "message": f"Must be one of: {VALID_STATES}"}}, req_id)
                    old_state = inc["state"]
                    inc["state"] = new_state
                    inc["updated_at"] = now
                    if new_state == "acknowledged" and not inc.get("acknowledged_at"):
                        inc["acknowledged_at"] = now
                    elif new_state == "mitigated" and not inc.get("mitigated_at"):
                        inc["mitigated_at"] = now
                    elif new_state == "resolved":
                        inc["resolved_at"] = now
                    msg = body.get("message", f"State changed: {old_state} -> {new_state}")
                    inc["timeline"].append({"id": gen_request_id(), "timestamp": now, "type": "state_change", "state": new_state, "message": msg, "actor": body.get("actor", "operator")})
                    audit_record(iid, "state_change", actor=body.get("actor", "operator"), details={"from": old_state, "to": new_state})
                    changed = True
                for field in ["assigned_to", "commander", "urgency", "impact", "root_cause", "communication_channel", "runbook_url"]:
                    if field in body:
                        old_val = inc.get(field)
                        inc[field] = body[field]
                        inc["updated_at"] = now
                        if field == "urgency" and body[field] in VALID_URGENCIES:
                            inc["priority"] = PRIORITY_MATRIX.get((inc["severity"], body[field]), inc.get("priority", "P3"))
                        inc["timeline"].append({"id": gen_request_id(), "timestamp": now, "type": "field_change", "state": inc["state"], "message": f"{field}: {old_val} -> {body[field]}", "actor": body.get("actor", "operator")})
                        audit_record(iid, "field_change", actor=body.get("actor", "operator"), details={"field": field, "from": str(old_val), "to": str(body[field])})
                        changed = True
                if "tags" in body:
                    inc["tags"] = list(set(inc.get("tags", []) + body["tags"]))
                    inc["updated_at"] = now
                    changed = True
                if "custom_fields" in body:
                    inc.setdefault("custom_fields", {}).update(body["custom_fields"])
                    inc["updated_at"] = now
                    changed = True
                if "message" in body and "state" not in body and not any(f in body for f in ["assigned_to", "commander", "urgency", "impact", "root_cause"]):
                    inc["updated_at"] = now
                    inc["timeline"].append({"id": gen_request_id(), "timestamp": now, "type": "note", "state": inc["state"], "message": body["message"], "actor": body.get("actor", "operator")})
                    changed = True
                if changed:
                    save_incident(inc)
                return self._j(200, inc, req_id)

        # ── Fallback: API root ──
        if api_path == "/api" or api_path == f"/api/{API_VERSION}":
            return self._j(200, api_schema(), req_id)

        return self._j(404, {"error": {"code": "not_found", "message": f"Unknown endpoint: {path}"}}, req_id)

    def do_GET(self):     self._route("GET")
    def do_POST(self):    self._route("POST")
    def do_PATCH(self):   self._route("PATCH")
    def do_PUT(self):     self._route("PUT")
    def do_DELETE(self):  self._route("DELETE")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Request-Id")
        self.end_headers()

    def _j(self, code, data, req_id=""):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        if req_id:
            self.send_header("X-Request-Id", req_id)
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, *a):
        pass


# ── Main ───────────────────────────────────────────────────────────────
cfg = get_config()
log(f"LogClaw Ticket Engine {ENGINE_VERSION} starting")
log(f"  API: /api/{API_VERSION}/  |  Tenant: {TENANT_ID}")
log(f"  Integrations: jira={cfg['platforms']['jira']['enabled']} snow={cfg['platforms']['servicenow']['enabled']} pd={cfg['platforms']['pagerduty']['enabled']} og={cfg['platforms']['opsgenie']['enabled']} slack={cfg['platforms']['slack']['enabled']}")
log(f"  LLM: provider={cfg['llm']['provider']} model={cfg['llm']['model']}")
log(f"  Routing: critical={cfg['routing']['critical']} high={cfg['routing']['high']} medium={cfg['routing']['medium']} low={cfg['routing']['low']}")
ensure_index()
_init_sequence()
threading.Thread(target=kafka_loop, daemon=True).start()
log(f"  HTTP API on :8080")
HTTPServer(("0.0.0.0", 8080), H).serve_forever()
