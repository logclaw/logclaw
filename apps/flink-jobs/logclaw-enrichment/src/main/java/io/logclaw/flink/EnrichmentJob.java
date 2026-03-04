package io.logclaw.flink;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.RichMapFunction;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.api.java.utils.ParameterTool;
import org.apache.flink.configuration.ConfigOptions;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.configuration.GlobalConfiguration;
import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.connector.kafka.sink.KafkaSink;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Serializable;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * LogClaw Enrichment Job.
 *
 * Consumes canonical log records from {@code enriched-logs}, enriches them with
 * ML features from the Feast feature store, and writes the result back to the
 * same topic (in-place enrichment via separate consumer group).
 *
 * <p>Enrichment adds:
 * <ul>
 *   <li>{@code ml_features.service_error_rate_1h}  – rolling error rate</li>
 *   <li>{@code ml_features.service_p99_latency_1h} – rolling P99 latency</li>
 *   <li>{@code ml_features.service_request_rate_1h} – rolling request rate</li>
 *   <li>{@code ml_features.service_anomaly_history} – past anomaly count</li>
 *   <li>{@code enriched_at} – enrichment timestamp</li>
 * </ul>
 *
 * If Feast is unreachable, records pass through with default features (graceful
 * degradation — never blocks the pipeline).
 */
public class EnrichmentJob {

    private static final Logger LOG = LoggerFactory.getLogger(EnrichmentJob.class);

    public static void main(String[] args) throws Exception {
        final ParameterTool params = resolveParams(args);

        final String brokers       = params.getRequired("kafka.brokers");
        final String inputTopic    = params.get("kafka.input.topic", "enriched-logs");
        final String outputTopic   = params.get("kafka.output.topic", "enriched-logs");
        final String dlqTopic      = params.get("kafka.dlq.topic", "dlq");
        final String tenantId      = params.get("tenant.id", "default");
        final String groupId       = params.get("kafka.group.id", "logclaw-enrichment-" + tenantId);
        final String feastEndpoint = params.get("feast.endpoint", "http://localhost:6566");

        LOG.info("Starting LogClaw Enrichment job: {} (tenant={}, feast={})",
                inputTopic, tenantId, feastEndpoint);

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

        // ── Kafka Sink ──
        KafkaSink<String> sink = KafkaSink.<String>builder()
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
                // Skip records that are already enriched (prevent infinite loop)
                .filter(record -> {
                    try {
                        return !new ObjectMapper().readTree(record).has("enriched_at");
                    } catch (Exception e) {
                        return true;
                    }
                })
                .uid("skip-already-enriched")
                .name("Filter: unenriched only")
                .map(new FeatureEnricher(feastEndpoint, tenantId))
                .uid("feast-enricher")
                .name("Feast Feature Enrichment")
                .sinkTo(sink)
                .uid("enriched-sink")
                .name("Kafka: " + outputTopic);

        env.execute("LogClaw Enrichment [" + tenantId + "]");
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
     * Enriches log records with ML features from Feast.
     * Falls back to default features if Feast is unavailable.
     */
    static class FeatureEnricher extends RichMapFunction<String, String> {
        private final String feastEndpoint;
        private final String tenantId;
        private transient ObjectMapper mapper;
        private transient HttpClient httpClient;
        private transient ConcurrentHashMap<String, CachedFeatures> featureCache;
        private transient long lastFeastError;
        private static final long FEAST_BACKOFF_MS = 30_000; // 30s backoff on Feast errors

        FeatureEnricher(String feastEndpoint, String tenantId) {
            this.feastEndpoint = feastEndpoint;
            this.tenantId = tenantId;
        }

        @Override
        public void open(Configuration parameters) {
            mapper = new ObjectMapper();
            httpClient = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(2))
                    .build();
            featureCache = new ConcurrentHashMap<>();
            lastFeastError = 0;
        }

        @Override
        public String map(String value) throws Exception {
            ObjectNode record;
            try {
                record = (ObjectNode) mapper.readTree(value);
            } catch (Exception e) {
                return value; // unparseable → pass through
            }

            String service = record.path("service").asText("unknown");

            // Get ML features (from cache or Feast)
            ObjectNode features = getFeatures(service);
            record.set("ml_features", features);
            record.put("enriched_at", Instant.now().toString());

            return mapper.writeValueAsString(record);
        }

        private ObjectNode getFeatures(String service) {
            // Check cache (TTL 60s)
            CachedFeatures cached = featureCache.get(service);
            if (cached != null && (System.currentTimeMillis() - cached.timestamp) < 60_000) {
                return cached.features.deepCopy();
            }

            // If Feast recently errored, use defaults (backoff)
            if (System.currentTimeMillis() - lastFeastError < FEAST_BACKOFF_MS) {
                return defaultFeatures();
            }

            // Try Feast
            try {
                ObjectNode requestBody = mapper.createObjectNode();
                requestBody.putArray("entities")
                        .addObject().put("service_name", service);
                requestBody.putArray("features")
                        .add("service_metrics:error_rate_1h")
                        .add("service_metrics:p99_latency_1h")
                        .add("service_metrics:request_rate_1h")
                        .add("service_metrics:anomaly_history_count");

                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(feastEndpoint + "/get-online-features"))
                        .header("Content-Type", "application/json")
                        .timeout(Duration.ofSeconds(2))
                        .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(requestBody)))
                        .build();

                HttpResponse<String> response = httpClient.send(request,
                        HttpResponse.BodyHandlers.ofString());

                if (response.statusCode() == 200) {
                    JsonNode body = mapper.readTree(response.body());
                    ObjectNode features = parseFeastResponse(body);
                    featureCache.put(service, new CachedFeatures(features, System.currentTimeMillis()));
                    return features.deepCopy();
                }
            } catch (Exception e) {
                LOG.debug("Feast unavailable for service={}: {}", service, e.getMessage());
                lastFeastError = System.currentTimeMillis();
            }

            // Default features — graceful degradation
            ObjectNode defaults = defaultFeatures();
            featureCache.put(service, new CachedFeatures(defaults, System.currentTimeMillis()));
            return defaults.deepCopy();
        }

        private ObjectNode parseFeastResponse(JsonNode body) {
            ObjectNode features = mapper.createObjectNode();
            try {
                JsonNode results = body.path("results");
                if (results.isArray() && results.size() > 0) {
                    for (JsonNode result : results) {
                        JsonNode values = result.path("values");
                        String name = result.path("feature_names").path(0).asText("");
                        if (!name.isEmpty() && values.isArray() && values.size() > 0) {
                            String shortName = name.contains(":") ? name.split(":")[1] : name;
                            features.put(shortName, values.get(0).asDouble(0.0));
                        }
                    }
                }
            } catch (Exception e) {
                LOG.debug("Failed to parse Feast response", e);
            }
            // Fill in any missing with defaults
            if (!features.has("error_rate_1h")) features.put("error_rate_1h", 0.0);
            if (!features.has("p99_latency_1h")) features.put("p99_latency_1h", 0.0);
            if (!features.has("request_rate_1h")) features.put("request_rate_1h", 0.0);
            if (!features.has("anomaly_history_count")) features.put("anomaly_history_count", 0);
            return features;
        }

        private ObjectNode defaultFeatures() {
            ObjectNode features = mapper.createObjectNode();
            features.put("error_rate_1h", 0.0);
            features.put("p99_latency_1h", 0.0);
            features.put("request_rate_1h", 0.0);
            features.put("anomaly_history_count", 0);
            features.put("_source", "default");
            return features;
        }

        static class CachedFeatures implements Serializable {
            final ObjectNode features;
            final long timestamp;
            CachedFeatures(ObjectNode features, long timestamp) {
                this.features = features;
                this.timestamp = timestamp;
            }
        }
    }
}
