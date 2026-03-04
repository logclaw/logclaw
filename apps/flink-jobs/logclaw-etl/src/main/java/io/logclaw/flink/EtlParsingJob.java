package io.logclaw.flink;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.FlatMapFunction;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.api.java.utils.ParameterTool;
import org.apache.flink.configuration.ConfigOptions;
import org.apache.flink.configuration.GlobalConfiguration;
import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.connector.kafka.sink.KafkaSink;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;

/**
 * LogClaw ETL Parsing Job.
 *
 * Consumes raw OpenTelemetry log records from the {@code raw-logs} Kafka topic,
 * normalises them into the LogClaw canonical schema, and writes the result to
 * the {@code enriched-logs} topic for downstream enrichment and anomaly scoring.
 *
 * <p>Canonical schema fields:
 * <ul>
 *   <li>{@code log_id}        – deterministic UUID for dedup</li>
 *   <li>{@code timestamp}     – ISO-8601 from OTel timeUnixNano / observedTimestamp</li>
 *   <li>{@code severity}      – normalised: TRACE, DEBUG, INFO, WARN, ERROR, FATAL</li>
 *   <li>{@code service}       – extracted from resource attributes</li>
 *   <li>{@code environment}   – tenant environment label</li>
 *   <li>{@code message}       – log body text</li>
 *   <li>{@code trace_id}      – OTel trace correlation</li>
 *   <li>{@code span_id}       – OTel span correlation</li>
 *   <li>{@code attributes}    – merged resource + log attributes</li>
 *   <li>{@code tenant_id}     – multi-tenant isolation key</li>
 * </ul>
 */
public class EtlParsingJob {

    private static final Logger LOG = LoggerFactory.getLogger(EtlParsingJob.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        final ParameterTool params = resolveParams(args);

        final String brokers     = params.getRequired("kafka.brokers");
        final String inputTopic  = params.get("kafka.input.topic", "raw-logs");
        final String outputTopic = params.get("kafka.output.topic", "enriched-logs");
        final String dlqTopic    = params.get("kafka.dlq.topic", "dlq");
        final String tenantId    = params.get("tenant.id", "default");
        final String groupId     = params.get("kafka.group.id", "logclaw-etl-" + tenantId);

        LOG.info("Starting LogClaw ETL job: {} → {} (tenant={})", inputTopic, outputTopic, tenantId);

        final StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        env.getConfig().setGlobalJobParameters(params);

        // ── Kafka Source ──
        KafkaSource<String> source = KafkaSource.<String>builder()
                .setBootstrapServers(brokers)
                .setTopics(inputTopic)
                .setGroupId(groupId)
                .setStartingOffsets(OffsetsInitializer.latest())
                .setValueOnlyDeserializer(new SimpleStringSchema())
                .build();

        // ── Kafka Sink (enriched) ──
        KafkaSink<String> sink = KafkaSink.<String>builder()
                .setBootstrapServers(brokers)
                .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                        .setTopic(outputTopic)
                        .setValueSerializationSchema(new SimpleStringSchema())
                        .build())
                .build();

        // ── Kafka Sink (DLQ) ──
        KafkaSink<String> dlqSink = KafkaSink.<String>builder()
                .setBootstrapServers(brokers)
                .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                        .setTopic(dlqTopic)
                        .setValueSerializationSchema(new SimpleStringSchema())
                        .build())
                .build();

        // ── Pipeline: parse raw OTel → canonical schema ──
        var parsed = env
                .fromSource(source, WatermarkStrategy.noWatermarks(), "raw-logs-source")
                .uid("raw-logs-source")
                .name("Kafka: " + inputTopic)
                .flatMap(new OTelParser(tenantId))
                .uid("otel-parser")
                .name("OTel → Canonical");

        // Main output
        parsed.filter(r -> !r.startsWith("{\"_dlq\""))
                .uid("filter-good")
                .sinkTo(sink)
                .uid("enriched-sink")
                .name("Kafka: " + outputTopic);

        // Dead-letter queue for unparseable records
        parsed.filter(r -> r.startsWith("{\"_dlq\""))
                .uid("filter-dlq")
                .sinkTo(dlqSink)
                .uid("dlq-sink")
                .name("Kafka: " + dlqTopic);

        env.execute("LogClaw ETL [" + tenantId + "]");
    }

    /**
     * Resolves parameters from main() args, falling back to Flink's
     * GlobalConfiguration for Application Mode on Kubernetes where the
     * operator passes args via $internal.application.program-args.
     */
    /**
     * Resolves parameters from main() args, falling back to reading Flink's
     * GlobalConfiguration for Application Mode on Kubernetes where the
     * operator passes args via $internal.application.program-args.
     */
    static ParameterTool resolveParams(String[] args) {
        // Try standard main() args first
        ParameterTool params = ParameterTool.fromArgs(args);
        if (params.has("kafka.brokers")) return params;

        // In Flink Application Mode on K8s, args come via GlobalConfiguration
        try {
            org.apache.flink.configuration.Configuration config = GlobalConfiguration.loadConfiguration();
            String programArgs = config.getString(
                    ConfigOptions.key("$internal.application.program-args")
                            .stringType().noDefaultValue(), null);
            if (programArgs != null && !programArgs.isEmpty()) {
                // Parse --key=value pairs manually (ParameterTool.fromArgs may not
                // handle --key=value format in all Flink versions)
                java.util.Map<String, String> map = new java.util.LinkedHashMap<>();
                for (String arg : programArgs.split(";")) {
                    arg = arg.trim();
                    if (arg.startsWith("--") && arg.contains("=")) {
                        String key = arg.substring(2, arg.indexOf('='));
                        String val = arg.substring(arg.indexOf('=') + 1);
                        map.put(key, val);
                    }
                }
                System.out.println("[LogClaw] Resolved " + map.size() + " params from GlobalConfiguration");
                return ParameterTool.fromMap(map);
            }
        } catch (Exception e) {
            System.out.println("[LogClaw] GlobalConfiguration fallback failed: " + e);
        }
        return params;
    }

    /**
     * Parses raw OTel JSON into LogClaw canonical schema.
     * Handles both single log records and batched resourceLogs format.
     */
    static class OTelParser implements FlatMapFunction<String, String> {
        private final String tenantId;
        private transient ObjectMapper mapper;

        OTelParser(String tenantId) {
            this.tenantId = tenantId;
        }

        @Override
        public void flatMap(String value, Collector<String> out) {
            if (mapper == null) mapper = new ObjectMapper();
            try {
                JsonNode root = mapper.readTree(value);

                // Handle OTel batched format: { resourceLogs: [ ... ] }
                if (root.has("resourceLogs")) {
                    for (JsonNode rl : root.get("resourceLogs")) {
                        JsonNode resource = rl.path("resource");
                        for (JsonNode sl : rl.path("scopeLogs")) {
                            for (JsonNode lr : sl.path("logRecords")) {
                                String canonical = toCanonical(lr, resource);
                                out.collect(canonical);
                            }
                        }
                    }
                }
                // Handle single log record
                else if (root.has("body") || root.has("severityText")) {
                    out.collect(toCanonical(root, mapper.createObjectNode()));
                }
                // Pass through already-canonical records
                else if (root.has("log_id") && root.has("service")) {
                    // Already in canonical form — enrich tenant_id if missing
                    if (!root.has("tenant_id")) {
                        ((ObjectNode) root).put("tenant_id", tenantId);
                    }
                    out.collect(mapper.writeValueAsString(root));
                }
                // Unknown format → DLQ
                else {
                    ObjectNode dlq = mapper.createObjectNode();
                    dlq.put("_dlq", true);
                    dlq.put("reason", "unknown_format");
                    dlq.put("tenant_id", tenantId);
                    dlq.put("timestamp", Instant.now().toString());
                    dlq.set("original", root);
                    out.collect(mapper.writeValueAsString(dlq));
                }
            } catch (Exception e) {
                try {
                    ObjectNode dlq = mapper.createObjectNode();
                    dlq.put("_dlq", true);
                    dlq.put("reason", "parse_error");
                    dlq.put("error", e.getMessage());
                    dlq.put("tenant_id", tenantId);
                    dlq.put("timestamp", Instant.now().toString());
                    dlq.put("original", value.length() > 4096 ? value.substring(0, 4096) : value);
                    out.collect(mapper.writeValueAsString(dlq));
                } catch (Exception inner) {
                    LOG.error("Failed to serialize DLQ record", inner);
                }
            }
        }

        private String toCanonical(JsonNode logRecord, JsonNode resource) throws Exception {
            ObjectNode out = mapper.createObjectNode();

            // log_id — deterministic from trace+span+timestamp for dedup
            String traceId = logRecord.path("traceId").asText("");
            String spanId  = logRecord.path("spanId").asText("");
            String tsNano  = logRecord.path("timeUnixNano").asText(
                    logRecord.path("observedTimeUnixNano").asText(""));

            if (!traceId.isEmpty() && !tsNano.isEmpty()) {
                out.put("log_id", UUID.nameUUIDFromBytes(
                        (traceId + spanId + tsNano).getBytes()).toString());
            } else {
                out.put("log_id", UUID.randomUUID().toString());
            }

            // timestamp
            if (!tsNano.isEmpty()) {
                try {
                    long nanos = Long.parseLong(tsNano);
                    out.put("timestamp", Instant.ofEpochSecond(
                            nanos / 1_000_000_000L, nanos % 1_000_000_000L).toString());
                } catch (NumberFormatException e) {
                    out.put("timestamp", tsNano);
                }
            } else if (logRecord.has("timestamp")) {
                out.put("timestamp", logRecord.get("timestamp").asText());
            } else {
                out.put("timestamp", Instant.now().toString());
            }

            // severity — normalise
            String severity = logRecord.path("severityText").asText("INFO").toUpperCase();
            if (severity.startsWith("WARN")) severity = "WARN";
            if (severity.equals("CRITICAL") || severity.equals("ALERT") || severity.equals("EMERGENCY"))
                severity = "FATAL";
            out.put("severity", severity);

            // service — from resource attributes
            String service = extractAttribute(resource.path("attributes"), "service.name");
            if (service.isEmpty()) service = extractAttribute(logRecord.path("attributes"), "service.name");
            if (service.isEmpty()) service = logRecord.path("service").asText("unknown");
            out.put("service", service);

            // environment
            String env = extractAttribute(resource.path("attributes"), "deployment.environment");
            if (env.isEmpty()) env = tenantId;
            out.put("environment", env);

            // message — from body
            JsonNode body = logRecord.path("body");
            if (body.has("stringValue")) {
                out.put("message", body.get("stringValue").asText());
            } else if (body.isTextual()) {
                out.put("message", body.asText());
            } else if (logRecord.has("message")) {
                out.put("message", logRecord.get("message").asText());
            } else {
                out.put("message", body.toString());
            }

            // trace correlation
            out.put("trace_id", traceId);
            out.put("span_id", spanId);

            // merge attributes
            ObjectNode attrs = mapper.createObjectNode();
            mergeAttributes(attrs, resource.path("attributes"));
            mergeAttributes(attrs, logRecord.path("attributes"));
            out.set("attributes", attrs);

            // tenant
            out.put("tenant_id", tenantId);

            return mapper.writeValueAsString(out);
        }

        private String extractAttribute(JsonNode attributes, String key) {
            if (attributes == null || attributes.isMissingNode()) return "";
            for (JsonNode attr : attributes) {
                if (key.equals(attr.path("key").asText())) {
                    JsonNode val = attr.path("value");
                    if (val.has("stringValue")) return val.get("stringValue").asText();
                    if (val.has("intValue")) return val.get("intValue").asText();
                    return val.toString();
                }
            }
            return "";
        }

        private void mergeAttributes(ObjectNode target, JsonNode attributes) {
            if (attributes == null || attributes.isMissingNode()) return;
            if (attributes.isArray()) {
                for (JsonNode attr : attributes) {
                    String key = attr.path("key").asText();
                    JsonNode val = attr.path("value");
                    if (val.has("stringValue")) target.put(key, val.get("stringValue").asText());
                    else if (val.has("intValue")) target.put(key, val.get("intValue").asLong());
                    else if (val.has("doubleValue")) target.put(key, val.get("doubleValue").asDouble());
                    else if (val.has("boolValue")) target.put(key, val.get("boolValue").asBoolean());
                }
            } else if (attributes.isObject()) {
                Iterator<Map.Entry<String, JsonNode>> fields = attributes.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> f = fields.next();
                    target.set(f.getKey(), f.getValue());
                }
            }
        }
    }
}
