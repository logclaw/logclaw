import os, sys, json, time, threading, hashlib, uuid, traceback
from datetime import datetime, timezone, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse, parse_qs

# ── Infrastructure (immutable — require restart) ─────────────────────
KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC_ANOMALIES", "anomaly-events")
KAFKA_GROUP = os.environ.get("KAFKA_CONSUMER_GROUP", "logclaw-ticketing-agent")
OS_ENDPOINT = os.environ.get("OPENSEARCH_ENDPOINT", "http://localhost:9200")
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
    },
    "llm": {
        "provider": os.environ.get("LLM_PROVIDER", "disabled"),
        "model": os.environ.get("LLM_MODEL", ""),
        "endpoint": os.environ.get("LLM_ENDPOINT", ""),
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
stats = {"consumed": 0, "created": 0, "skipped": 0, "webhooks_sent": 0, "webhooks_failed": 0}


def log(m):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {m}", flush=True)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def gen_request_id():
    return str(uuid.uuid4())[:8]


# ── OpenSearch helpers ─────────────────────────────────────────────────
def os_req(method, path, body=None):
    url = f"{OS_ENDPOINT}/{path}"
    data = json.dumps(body).encode() if body else None
    req = Request(url, data, {"Content-Type": "application/json"}, method=method)
    resp = urlopen(req, timeout=10).read()
    if not resp:
        return {}
    return json.loads(resp)


def ensure_index():
    try:
        os_req("HEAD", INCIDENT_INDEX)
    except HTTPError as e:
        if e.code == 404:
            mapping = {
                "settings": {"number_of_shards": 1, "number_of_replicas": 0},
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
    sort_by = params.get("sort", ["created_at"])[0]
    sort_dir = params.get("order", ["desc"])[0]
    musts = []
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
    if q:
        musts.append({"multi_match": {"query": q, "fields": ["title", "description", "service", "tags"]}})
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
def os_context(service):
    cfg = get_config()
    max_lines = cfg["anomaly"]["maxLogLinesInTicket"]
    q = {
        "size": max_lines,
        "query": {"bool": {"must": [{"term": {"service": service}}, {"terms": {"level": ["ERROR", "FATAL", "WARN"]}}]}},
        "sort": [{"_doc": "desc"}],
    }
    try:
        r = os_req("POST", "logclaw-logs-*/_search", q)
        return [h["_source"] for h in r.get("hits", {}).get("hits", [])]
    except Exception:
        return []


# ── Deduplication & grouping ──────────────────────────────────────────
dedup_registry = {}

def find_groupable_ticket(dedup_key):
    now = time.time()
    entry = dedup_registry.get(dedup_key)
    if entry and now < entry["expires"] and entry["trace_count"] < 3:
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
        ticket["request_traces"] = traces[:3]
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
        error_pattern = event.get("root_cause", "")[:50]
        dedup_key = f"{svc}:{atype}:{hashlib.md5(error_pattern.encode()).hexdigest()[:8]}"
    else:
        dedup_key = f"{svc}:{atype}"

    existing = find_groupable_ticket(dedup_key)
    if existing:
        append_trace_to_ticket(existing, event)
        return

    if is_dup_key(dedup_key):
        stats["skipped"] += 1
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

    if atype == "request_failure":
        title = event.get("title", f"{svc} request failure")
    else:
        raw_desc = event.get("description", "anomaly")[:120]
        title = f"[{sev.upper()}] {svc} - {raw_desc}"

    request_traces = []
    if event.get("request_trace"):
        request_traces.append({
            "trace_id": event.get("trace_id", str(uuid.uuid4())[:8]),
            "span_ids": event.get("span_ids", []),
            "logs": event["request_trace"],
            "error_message": event.get("error_message", ""),
            "timestamp": event.get("timestamp", now),
        })

    reproduce_steps = []
    if event.get("request_trace"):
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

    incident = {
        "id": iid, "number": num,
        "severity": sev, "urgency": urgency, "priority": priority,
        "state": "identified",
        "title": title,
        "description": event.get("description", ""),
        "service": svc,
        "environment": TENANT_ID,
        "anomaly_type": atype,
        "anomaly_score": event.get("anomaly_score", 0),
        "correlation_id": event.get("event_id", str(uuid.uuid4())),
        "trace_id": event.get("trace_id"),
        "span_ids": event.get("span_ids", []),
        "request_flow": event.get("request_flow", []),
        "affected_services": event.get("affected_services", [svc]),
        "request_traces": request_traces,
        "root_cause": event.get("root_cause"),
        "reproduce_steps": reproduce_steps,
        "similar_count": 1,
        "affected_endpoint": event.get("endpoint", event.get("affected_endpoint", "")),
        "error_type": event.get("error_type"),
        "status_code": event.get("status_code"),
        "impact": None, "commander": None, "assigned_to": None,
        "communication_channel": None, "runbook_url": None,
        "evidence_logs": [],
        "created_at": now, "updated_at": now, "detected_at": now,
        "acknowledged_at": None, "mitigated_at": None, "resolved_at": None,
        "tenant_id": TENANT_ID,
        "timeline": [
            {"id": gen_request_id(), "timestamp": now, "type": "state_change", "state": "identified", "message": f"Anomaly detected: {event.get('description', 'unknown anomaly')[:100]}", "actor": "system"}
        ],
        "external_refs": [], "tags": [svc, atype, sev],
        "custom_fields": {},
    }

    if atype == "error_rate_spike":
        evidence = os_context(svc)
        incident["evidence_logs"] = evidence[:max_lines]

    ext_refs = send_webhooks(incident)
    if ext_refs:
        incident["external_refs"] = ext_refs

    save_incident(incident)

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
        while True:
            for tp, msgs in c.poll(timeout_ms=2000).items():
                for msg in msgs:
                    stats["consumed"] += 1
                    try:
                        process(msg.value)
                    except Exception as e:
                        log(f"Process error: {e}")
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


def test_llm_connection() -> dict:
    """Perform a lightweight connectivity test for the configured LLM provider."""
    cfg = get_config()
    llm = cfg["llm"]
    provider = llm["provider"]
    endpoint = llm.get("endpoint", "")
    model = llm.get("model", "")

    if provider == "disabled":
        return {"ok": False, "message": "LLM provider is disabled", "latency_ms": 0}
    if not endpoint:
        return {"ok": False, "message": "No endpoint configured", "latency_ms": 0}

    import time as _t
    start = _t.time()
    try:
        if provider == "ollama":
            # Ollama: GET /api/tags to list available models
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

        elif provider == "vllm":
            # vLLM: GET /v1/models (OpenAI-compatible)
            url = endpoint.rstrip("/") + "/v1/models"
            req = Request(url, headers={"Accept": "application/json"}, method="GET")
            resp = urlopen(req, timeout=10)
            data = json.loads(resp.read())
            models = [m.get("id", "?") for m in data.get("data", [])]
            ms = int((_t.time() - start) * 1000)
            return {"ok": True, "message": f"Connected — models: {', '.join(models[:3])}", "latency_ms": ms}

        elif provider in ("claude", "openai"):
            # Cloud providers: just check the endpoint is reachable
            url = endpoint.rstrip("/") + ("/v1/models" if provider == "openai" else "/v1/messages")
            req = Request(url, headers={"Accept": "application/json"}, method="GET")
            resp = urlopen(req, timeout=10)
            ms = int((_t.time() - start) * 1000)
            return {"ok": True, "message": f"Endpoint reachable ({resp.status})", "latency_ms": ms}

        else:
            return {"ok": False, "message": f"Unknown provider: {provider}", "latency_ms": 0}

    except HTTPError as e:
        ms = int((_t.time() - start) * 1000)
        # 401/403 means the endpoint IS reachable but needs auth — that's actually a partial success
        if e.code in (401, 403):
            return {"ok": True, "message": f"Endpoint reachable (auth required: {e.code})", "latency_ms": ms}
        return {"ok": False, "message": f"HTTP {e.code}: {e.reason}", "latency_ms": ms}
    except URLError as e:
        ms = int((_t.time() - start) * 1000)
        return {"ok": False, "message": f"Connection failed: {e.reason}", "latency_ms": ms}
    except Exception as e:
        ms = int((_t.time() - start) * 1000)
        return {"ok": False, "message": str(e)[:200], "latency_ms": ms}


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
            allowed = {"provider", "model", "endpoint"}
            for key in body:
                if key not in allowed:
                    return self._j(400, {"error": {"code": "unknown_field", "message": f"Unknown LLM field: {key}"}}, req_id)
            if "provider" in body and body["provider"] not in VALID_LLM_PROVIDERS:
                return self._j(400, {"error": {"code": "invalid_provider", "message": f"Must be one of: {sorted(VALID_LLM_PROVIDERS)}"}}, req_id)
            with _config_lock:
                for key, val in body.items():
                    if key in allowed:
                        _config["llm"][key] = val
            return self._j(200, {"llm": get_config()["llm"], "persisted": False}, req_id)

        # ── Test platform connection ──
        if api_path == "/api/test-connection" and method == "POST":
            platform = body.get("platform", "") if body else ""
            if platform not in VALID_PLATFORMS:
                return self._j(400, {"error": {"code": "invalid_platform", "message": f"Must be one of: {sorted(VALID_PLATFORMS)}"}}, req_id)
            result = test_platform_connection(platform)
            return self._j(200, result, req_id)

        # ── Test LLM connection ──
        if api_path == "/api/test-llm" and method == "POST":
            result = test_llm_connection()
            return self._j(200, result, req_id)

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
                "environment": body.get("environment", TENANT_ID),
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
                "tenant_id": TENANT_ID,
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
                    changed = True
                for field in ["assigned_to", "commander", "urgency", "impact", "root_cause", "communication_channel", "runbook_url"]:
                    if field in body:
                        old_val = inc.get(field)
                        inc[field] = body[field]
                        inc["updated_at"] = now
                        if field == "urgency" and body[field] in VALID_URGENCIES:
                            inc["priority"] = PRIORITY_MATRIX.get((inc["severity"], body[field]), inc.get("priority", "P3"))
                        inc["timeline"].append({"id": gen_request_id(), "timestamp": now, "type": "field_change", "state": inc["state"], "message": f"{field}: {old_val} -> {body[field]}", "actor": body.get("actor", "operator")})
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
