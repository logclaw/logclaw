package main

import (
	"context"
	"encoding/json"
	"log"
	"log/slog"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/logclaw/agent/collectors"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func setupLogging(ctx context.Context, tenantID string) (*sdklog.LoggerProvider, *slog.Logger) {
	res := resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName("logclaw-agent"),
		attribute.String("tenant.id", tenantID),
	)
	opts := []sdklog.LoggerProviderOption{sdklog.WithResource(res)}
	if endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"); endpoint != "" {
		exp, err := otlploghttp.New(ctx, otlploghttp.WithEndpoint(endpoint))
		if err == nil {
			opts = append(opts, sdklog.WithProcessor(sdklog.NewBatchProcessor(exp)))
		}
	}
	provider := sdklog.NewLoggerProvider(opts...)
	logger := slog.New(otelslog.NewHandler("logclaw-agent", otelslog.WithLoggerProvider(provider))).With(
		"tenant.id", tenantID,
	)
	slog.SetDefault(logger)
	return provider, logger
}

// MetricsPayload is the JSON response served on GET /metrics.
type MetricsPayload struct {
	TenantID    string                         `json:"tenantId"`
	CollectedAt string                         `json:"collectedAt"`
	KafkaLag    map[string]int64               `json:"kafkaLag"`
	FlinkJobs   []collectors.FlinkJob          `json:"flinkJobs"`
	OsHealth    collectors.OSHealth            `json:"osHealth"`
	ESOStatus   []collectors.ESOExternalSecret `json:"esoStatus"`
}

var (
	latestMetrics atomic.Value // stores *MetricsPayload
	ready         atomic.Bool
)

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required env var %s is not set", key)
	}
	return v
}

func collect(tenantID, namespace string) MetricsPayload {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	kafkaLag, err := collectors.KafkaLag(ctx, namespace)
	if err != nil {
		log.Printf("WARN kafka collector: %v", err)
		kafkaLag = map[string]int64{}
	}

	flinkJobs, err := collectors.FlinkJobs(ctx, namespace)
	if err != nil {
		log.Printf("WARN flink collector: %v", err)
		flinkJobs = []collectors.FlinkJob{}
	}

	osHealth, err := collectors.OpenSearchHealth(ctx, namespace)
	if err != nil {
		log.Printf("WARN opensearch collector: %v", err)
		osHealth = collectors.OSHealth{Status: "unknown"}
	}

	esoStatus, err := collectors.ESOStatus(ctx, namespace)
	if err != nil {
		log.Printf("WARN eso collector: %v", err)
		esoStatus = []collectors.ESOExternalSecret{}
	}

	return MetricsPayload{
		TenantID:    tenantID,
		CollectedAt: time.Now().UTC().Format(time.RFC3339),
		KafkaLag:    kafkaLag,
		FlinkJobs:   flinkJobs,
		OsHealth:    osHealth,
		ESOStatus:   esoStatus,
	}
}

func main() {
	ctx := context.Background()
	tenantID := mustEnv("LOGCLAW_TENANT_ID")
	namespace := os.Getenv("LOGCLAW_NAMESPACE")
	if namespace == "" {
		namespace = "default"
	}

	provider, _ := setupLogging(ctx, tenantID)
	defer func() { _ = provider.Shutdown(ctx) }()

	interval := 30 * time.Second

	// ── HTTP handlers ──────────────────────────────────────────
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	mux.HandleFunc("GET /ready", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if ready.Load() {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]bool{"ready": true})
		} else {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]bool{"ready": false})
		}
	})

	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		val := latestMetrics.Load()
		if val == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "no data collected yet"})
			return
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(val.(*MetricsPayload))
	})

	// ── Start HTTP server ──────────────────────────────────────
	go func() {
		slog.InfoContext(ctx, "HTTP server listening", "port", 8080)
		if err := http.ListenAndServe(":8080", mux); err != nil {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	// ── Collection loop ────────────────────────────────────────
	slog.InfoContext(ctx, "LogClaw agent starting", "tenant", tenantID, "namespace", namespace, "interval", interval.String())

	for {
		payload := collect(tenantID, namespace)
		latestMetrics.Store(&payload)
		ready.Store(true)

		slog.InfoContext(ctx, "Metrics collected",
			"kafka_topics", len(payload.KafkaLag),
			"flink_jobs", len(payload.FlinkJobs),
			"eso_secrets", len(payload.ESOStatus),
			"os_status", payload.OsHealth.Status,
		)

		time.Sleep(interval)
	}
}
