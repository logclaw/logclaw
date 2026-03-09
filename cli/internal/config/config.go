package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

const DefaultConfigFile = "logclaw.toml"

// Config represents the full logclaw.toml configuration.
type Config struct {
	Project  ProjectConfig  `toml:"project"`
	Services ServicesConfig `toml:"services"`
	AI       AIConfig       `toml:"ai"`
	Ports    PortsConfig    `toml:"ports"`
}

type ProjectConfig struct {
	Name     string `toml:"name"`
	TenantID string `toml:"tenant_id"`
}

type ServicesConfig struct {
	OpenSearch     bool `toml:"opensearch"`
	Kafka          bool `toml:"kafka"`
	OtelCollector  bool `toml:"otel_collector"`
	Bridge         bool `toml:"bridge"`
	TicketingAgent bool `toml:"ticketing_agent"`
	Dashboard      bool `toml:"dashboard"`
}

type AIConfig struct {
	Provider string `toml:"provider"`
	Model    string `toml:"model"`
}

type PortsConfig struct {
	Dashboard  int `toml:"dashboard"`
	OpenSearch int `toml:"opensearch"`
	Kafka      int `toml:"kafka"`
	OtelGRPC   int `toml:"otel_grpc"`
	OtelHTTP   int `toml:"otel_http"`
	Bridge     int `toml:"bridge"`
	Ticketing  int `toml:"ticketing"`
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		Project: ProjectConfig{
			Name:     "my-project",
			TenantID: "dev-local",
		},
		Services: ServicesConfig{
			OpenSearch:     true,
			Kafka:          true,
			OtelCollector:  true,
			Bridge:         true,
			TicketingAgent: true,
			Dashboard:      true,
		},
		AI: AIConfig{
			Provider: "disabled",
			Model:    "llama3.2:8b",
		},
		Ports: PortsConfig{
			Dashboard:  3000,
			OpenSearch: 9200,
			Kafka:      9092,
			OtelGRPC:   4317,
			OtelHTTP:   4318,
			Bridge:     8080,
			Ticketing:  18081,
		},
	}
}

// Load reads logclaw.toml from the given directory (or cwd).
// If the file does not exist, it returns the default config.
func Load(dir string) (Config, error) {
	cfg := DefaultConfig()

	if dir == "" {
		var err error
		dir, err = os.Getwd()
		if err != nil {
			return cfg, fmt.Errorf("failed to get working directory: %w", err)
		}
	}

	path := filepath.Join(dir, DefaultConfigFile)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return cfg, nil
	}

	if _, err := toml.DecodeFile(path, &cfg); err != nil {
		return cfg, fmt.Errorf("failed to parse %s: %w", path, err)
	}

	return cfg, nil
}

// DefaultTOML returns the default configuration as a TOML string.
func DefaultTOML() string {
	return `[project]
name = "my-project"
tenant_id = "dev-local"

[services]
opensearch = true
kafka = true
otel_collector = true
bridge = true
ticketing_agent = true
dashboard = true

[ai]
provider = "disabled"
model = "llama3.2:8b"

[ports]
dashboard = 3000
opensearch = 9200
kafka = 9092
otel_grpc = 4317
otel_http = 4318
bridge = 8080
ticketing = 18081
`
}
