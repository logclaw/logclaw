package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/logclaw/agent/collectors"
)

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
	tenantID := mustEnv("LOGCLAW_TENANT_ID")
	namespace := os.Getenv("LOGCLAW_NAMESPACE")
	if namespace == "" {
		namespace = "default"
	}

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
		log.Printf("HTTP server listening on :8080")
		if err := http.ListenAndServe(":8080", mux); err != nil {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	// ── Collection loop ────────────────────────────────────────
	log.Printf("LogClaw agent starting: tenant=%s namespace=%s interval=%s", tenantID, namespace, interval)

	for {
		payload := collect(tenantID, namespace)
		latestMetrics.Store(&payload)
		ready.Store(true)

		log.Printf("Metrics collected: kafka_topics=%d flink_jobs=%d eso_secrets=%d os_status=%s",
			len(payload.KafkaLag), len(payload.FlinkJobs), len(payload.ESOStatus), payload.OsHealth.Status)

		time.Sleep(interval)
	}
}
