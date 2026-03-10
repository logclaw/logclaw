# LogClaw Schema Contracts

Source-of-truth schemas for all service-to-service data contracts. Every producer and consumer must conform to these schemas.

## Schemas

| File | Kafka Topic / Index | Producers | Consumers |
|------|---------------------|-----------|-----------|
| `enriched-log.v1.schema.json` | `enriched-logs` | Flink ETL, Bridge | Flink Enrichment, Flink Anomaly Scorer, Bridge, OpenSearch |
| `anomaly-event.v1.schema.json` | `anomaly-events` | Flink Anomaly Scorer, Bridge | Ticketing Agent, OpenSearch |
| `incident.v1.schema.json` | `logclaw-incidents` (index) | Ticketing Agent | Dashboard |

## Field Conventions

- **Naming**: `snake_case` everywhere. Exception: `@timestamp` (OpenSearch/ECS standard).
- **Log severity** (`level`): Uppercase enum — `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. OTLP `CRITICAL` is normalized to `FATAL`.
- **Anomaly/incident severity** (`severity`): Lowercase enum — `critical`, `high`, `medium`, `low`. Different concept from log level.
- **Primary timestamp**: Always `@timestamp` (ISO-8601). Conforms to the OpenSearch index template.
- **OTLP attribute flattening**:
  - Log attributes → top-level fields, dots replaced with underscores (e.g., `http.method` → `http_method`).
  - Resource attributes → `resource_` prefix + dots replaced with underscores (e.g., `service.name` → `resource_service_name`).
- **Additional properties**: Enriched logs allow extra fields (`additionalProperties: true`) for flattened OTLP attributes. Anomaly events and incidents are strict (`additionalProperties: false`).

## OpenSearch Alignment

OpenSearch is the critical downstream dependency. All field names match the index templates in `charts/logclaw-opensearch/templates/index-template-configmap.yaml`:

- `logclaw-logs-*` — maps enriched log fields with `dynamic: false`
- `logclaw-anomalies-*` — maps anomaly event fields with `dynamic: false`
- `logclaw-incidents` — managed by the ticketing agent's own index template

## Versioning

Schema files are versioned in their filename (e.g., `v1`). Breaking changes require a new version. Non-breaking additions (new optional fields) can be added to the current version.
