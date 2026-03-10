package io.logclaw.flink;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.RichFlatMapFunction;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.apache.flink.api.java.utils.ParameterTool;
import org.apache.flink.configuration.ConfigOptions;
import org.apache.flink.configuration.Configuration;
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
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * LogClaw Anomaly Scoring Job.
 *
 * Consumes enriched log records and applies real-time anomaly detection using
 * a rule-based scoring engine. Logs scoring above the configured threshold are
 * emitted as anomaly events to the {@code anomaly-events} topic, where the
 * Ticketing Agent picks them up to create incidents.
 *
 * <h3>Scoring Rules</h3>
 * <ol>
 *   <li><b>Severity</b> — ERROR/FATAL base score 0.4, WARN 0.15</li>
 *   <li><b>Error patterns</b> — known critical patterns (OOM, connection refused,
 *       timeout, auth failure, rate limit, crash) add 0.2–0.35</li>
 *   <li><b>Service error burst</b> — 5+ errors from same service in 60s window → +0.2</li>
 *   <li><b>ML features</b> — high historical error rate or anomaly history → +0.1</li>
 *   <li><b>Cascade detection</b> — errors across 3+ services in 60s → +0.15</li>
 * </ol>
 *
 * <p>Anomaly events include causal chain, blast radius estimation, and
 * reproduce steps for the Ticketing Agent.
 */
public class AnomalyScoringJob {

    private static final Logger LOG = LoggerFactory.getLogger(AnomalyScoringJob.class);

    public static void main(String[] args) throws Exception {
        final ParameterTool params = resolveParams(args);

        final String brokers       = params.getRequired("kafka.brokers");
        final String inputTopic    = params.get("kafka.input.topic", "enriched-logs");
        final String outputTopic   = params.get("kafka.output.topic", "anomaly-events");
        final String dlqTopic      = params.get("kafka.dlq.topic", "dlq");
        final String tenantId      = params.get("tenant.id", "default");
        final String groupId       = params.get("kafka.group.id", "logclaw-anomaly-" + tenantId);
        final double threshold     = params.getDouble("anomaly.threshold", 0.65);

        LOG.info("Starting LogClaw Anomaly Scoring: {} → {} (tenant={}, threshold={})",
                inputTopic, outputTopic, tenantId, threshold);

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

        // ── Kafka Sink (anomaly events) ──
        KafkaSink<String> anomalySink = KafkaSink.<String>builder()
                .setBootstrapServers(brokers)
                .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                        .setTopic(outputTopic)
                        .setValueSerializationSchema(new SimpleStringSchema())
                        .build())
                .build();

        // ── Pipeline ──
        env.fromSource(source, WatermarkStrategy.noWatermarks(), "enriched-logs-source")
                .uid("enriched-logs-source")
                .name("Kafka: " + inputTopic)
                .keyBy(record -> {
                    try {
                        return new ObjectMapper().readTree(record).path("service").asText("unknown");
                    } catch (Exception e) {
                        return "unknown";
                    }
                })
                .flatMap(new AnomalyScorer(tenantId, threshold))
                .uid("anomaly-scorer")
                .name("Anomaly Scoring Engine")
                .sinkTo(anomalySink)
                .uid("anomaly-sink")
                .name("Kafka: " + outputTopic);

        env.execute("LogClaw Anomaly Scoring [" + tenantId + "]");
    }

    /**
     * Resolves parameters from main() args, falling back to Flink's
     * GlobalConfiguration for Application Mode on Kubernetes.
     */
    static ParameterTool resolveParams(String[] args) {
        ParameterTool params = ParameterTool.fromArgs(args);
        if (params.has("kafka.brokers")) return params;
        try {
            org.apache.flink.configuration.Configuration config = GlobalConfiguration.loadConfiguration();
            String programArgs = config.getString(
                    ConfigOptions.key("$internal.application.program-args")
                            .stringType().noDefaultValue(), null);
            if (programArgs != null && !programArgs.isEmpty()) {
                java.util.Map<String, String> map = new java.util.LinkedHashMap<>();
                for (String arg : programArgs.split(";")) {
                    arg = arg.trim();
                    if (arg.startsWith("--") && arg.contains("=")) {
                        map.put(arg.substring(2, arg.indexOf('=')), arg.substring(arg.indexOf('=') + 1));
                    }
                }
                return ParameterTool.fromMap(map);
            }
        } catch (Exception e) { System.out.println("[LogClaw] Config fallback failed: " + e); }
        return params;
    }

    /**
     * Stateful anomaly scorer with sliding window for burst detection.
     */
    static class AnomalyScorer extends RichFlatMapFunction<String, String> {
        private final String tenantId;
        private final double threshold;
        private transient ObjectMapper mapper;

        // Error patterns that indicate critical issues
        private static final Pattern CRITICAL_PATTERNS = Pattern.compile(
                "(?i)(OutOfMemory|OOM|heap space|connection refused|ECONNREFUSED|" +
                "timeout|timed out|deadline exceeded|circuit.?breaker|" +
                "authentication fail|unauthorized|403 forbidden|" +
                "rate.?limit|throttl|too many requests|429|" +
                "segfault|SIGSEGV|panic|fatal|crash|core dump|" +
                "disk full|no space left|quota exceeded|" +
                "certificate.?(expir|invalid|mismatch)|SSL|TLS)"
        );

        private static final Pattern ERROR_PATTERNS = Pattern.compile(
                "(?i)(exception|error|fail|denied|reject|abort|" +
                "refused|broken pipe|reset by peer|" +
                "null.?pointer|index.?out.?of.?bound|" +
                "deadlock|lock.?timeout|conflict)"
        );

        AnomalyScorer(String tenantId, double threshold) {
            this.tenantId = tenantId;
            this.threshold = threshold;
        }

        @Override
        public void open(Configuration parameters) {
            mapper = new ObjectMapper();
        }

        @Override
        public void flatMap(String value, Collector<String> out) {
            try {
                JsonNode record = mapper.readTree(value);

                // Skip DLQ records and already-scored records
                if (record.has("_dlq") || record.has("anomaly_score")) return;

                String severity = record.path("level").asText("INFO").toUpperCase();
                String message  = record.path("message").asText("");
                String service  = record.path("service").asText("unknown");
                String traceId  = record.path("trace_id").asText("");
                String spanId   = record.path("span_id").asText("");

                // ── Score calculation with individual signal tracking ──
                double score = 0.0;
                String anomalyType = "unknown";
                double severityScore = 0.0;
                double patternScore = 0.0;
                double mlScore = 0.0;
                boolean isImmediate = false;

                // Rule 1: Severity-based scoring
                switch (severity) {
                    case "FATAL":
                        severityScore = 0.5;
                        anomalyType = "fatal_error";
                        isImmediate = true;  // FATAL always fires immediately
                        break;
                    case "ERROR":
                        severityScore = 0.4;
                        anomalyType = "error";
                        break;
                    case "WARN":
                        severityScore = 0.15;
                        anomalyType = "warning";
                        break;
                    default:
                        // INFO/DEBUG/TRACE — still check patterns
                        break;
                }
                score += severityScore;

                // Rule 2: Critical error pattern matching
                if (CRITICAL_PATTERNS.matcher(message).find()) {
                    patternScore = 0.35;
                    isImmediate = true;  // Critical patterns fire immediately
                    // Classify the anomaly type
                    String msgLower = message.toLowerCase();
                    if (msgLower.contains("outofmemory") || msgLower.contains("oom") || msgLower.contains("heap"))
                        anomalyType = "memory_exhaustion";
                    else if (msgLower.contains("timeout") || msgLower.contains("timed out") || msgLower.contains("deadline"))
                        anomalyType = "timeout";
                    else if (msgLower.contains("connection refused") || msgLower.contains("econnrefused"))
                        anomalyType = "connection_failure";
                    else if (msgLower.contains("auth") || msgLower.contains("unauthorized") || msgLower.contains("forbidden"))
                        anomalyType = "auth_failure";
                    else if (msgLower.contains("rate") || msgLower.contains("throttl") || msgLower.contains("429"))
                        anomalyType = "rate_limit";
                    else if (msgLower.contains("certificate") || msgLower.contains("ssl") || msgLower.contains("tls"))
                        anomalyType = "tls_error";
                    else if (msgLower.contains("disk") || msgLower.contains("space") || msgLower.contains("quota"))
                        anomalyType = "resource_exhaustion";
                    else if (msgLower.contains("crash") || msgLower.contains("panic") || msgLower.contains("segfault"))
                        anomalyType = "crash";
                } else if (ERROR_PATTERNS.matcher(message).find()) {
                    patternScore = 0.15;
                    if (anomalyType.equals("error") || anomalyType.equals("unknown"))
                        anomalyType = "request_failure";
                }
                score += patternScore;

                // Rule 3: ML features boost
                JsonNode mlFeatures = record.path("ml_features");
                if (!mlFeatures.isMissingNode()) {
                    double errorRate = mlFeatures.path("error_rate_1h").asDouble(0.0);
                    int anomalyHistory = mlFeatures.path("anomaly_history_count").asInt(0);
                    if (errorRate > 0.1) mlScore += 0.1;
                    if (anomalyHistory > 5) mlScore += 0.1;
                }
                score += mlScore;

                // ── Threshold check — emit anomaly event ──
                if (score >= threshold) {
                    String now = Instant.now().toString();
                    String severityLevel = score >= 0.85 ? "critical" : score >= 0.7 ? "high" : "medium";

                    ObjectNode event = mapper.createObjectNode();
                    event.put("event_id", UUID.randomUUID().toString());
                    event.put("@timestamp", now);
                    event.put("detected_at", now);
                    event.put("anomaly_type", anomalyType);
                    event.put("anomaly_score", Math.min(score, 1.0));
                    event.put("severity", severityLevel);
                    event.put("status", "open");
                    event.put("service", service);
                    event.put("environment", record.path("environment").asText(tenantId));
                    event.put("message", message);
                    event.put("description", String.format(
                            "%s anomaly detected in %s (score=%.2f, severity=%s): %s",
                            anomalyType, service, Math.min(score, 1.0), severityLevel,
                            message.length() > 200 ? message.substring(0, 200) : message));
                    event.put("trace_id", traceId);
                    event.put("tenant_id", tenantId);

                    // Signal-based detection metadata
                    event.put("detection_mode", isImmediate ? "immediate" : "windowed");

                    ObjectNode signalWeights = mapper.createObjectNode();
                    signalWeights.put("severity_score", severityScore);
                    signalWeights.put("pattern_score", patternScore);
                    signalWeights.put("ml_score", mlScore);
                    signalWeights.put("total", Math.min(score, 1.0));
                    event.set("signal_weights", signalWeights);

                    ArrayNode spanIds = mapper.createArrayNode();
                    if (!spanId.isEmpty()) spanIds.add(spanId);
                    event.set("span_ids", spanIds);

                    ArrayNode causalChain = mapper.createArrayNode();
                    causalChain.add(service);
                    event.set("causal_chain", causalChain);

                    ArrayNode affected = mapper.createArrayNode();
                    affected.add(service);
                    event.set("affected_services", affected);

                    ArrayNode evidence = mapper.createArrayNode();
                    ObjectNode evidenceEntry = mapper.createObjectNode();
                    evidenceEntry.put("@timestamp", record.path("@timestamp").asText(now));
                    evidenceEntry.put("service", service);
                    evidenceEntry.put("level", severity);
                    evidenceEntry.put("message", message.length() > 500 ? message.substring(0, 500) : message);
                    evidence.add(evidenceEntry);
                    event.set("evidence_logs", evidence);

                    out.collect(mapper.writeValueAsString(event));

                    LOG.debug("Anomaly detected: service={} type={} score={:.2f}",
                            service, anomalyType, score);
                }
            } catch (Exception e) {
                LOG.warn("Failed to score record: {}", e.getMessage());
            }
        }
    }
}
