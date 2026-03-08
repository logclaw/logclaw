package cmd

import (
	"fmt"
	"os"

	"github.com/logclaw/cli/internal/compose"
	"github.com/logclaw/cli/internal/config"
	"github.com/logclaw/cli/internal/health"
	"github.com/spf13/cobra"
)

var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Start all LogClaw services via Docker Compose",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load("")
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: %v, using defaults\n", err)
			cfg = config.DefaultConfig()
		}

		composeFile, err := compose.FindComposeFile()
		if err != nil {
			return fmt.Errorf("cannot find docker-compose.yml: %w\nRun 'logclaw init' or ensure docker-compose.yml is in the current directory", err)
		}

		fmt.Println("Starting LogClaw...")
		fmt.Printf("  Compose file: %s\n\n", composeFile)

		if err := compose.Run(composeFile, "up", "-d"); err != nil {
			return fmt.Errorf("docker compose up failed: %w", err)
		}

		fmt.Println()
		if err := health.WaitForServices(composeFile); err != nil {
			fmt.Fprintf(os.Stderr, "\n\033[33mWarning: %v\033[0m\n", err)
			fmt.Fprintln(os.Stderr, "Some services may still be starting. Run 'logclaw status' to check.")
		}

		printSuccessMessage(cfg)
		return nil
	},
}

func printSuccessMessage(cfg config.Config) {
	green := "\033[32m"
	yellow := "\033[33m"
	bold := "\033[1m"
	reset := "\033[0m"

	fmt.Printf(`
%s%s LogClaw is running!%s

   %sDashboard:%s      http://localhost:%d
   %sOTel (gRPC):%s    http://localhost:%d
   %sOTel (HTTP):%s    http://localhost:%d
   %sOpenSearch:%s     http://localhost:%d

 %sSend your first log:%s
   %scurl -X POST http://localhost:%d/v1/logs \
     -H "Content-Type: application/json" \
     -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"my-app"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"1741003200000000000","severityText":"ERROR","body":{"stringValue":"connection timeout"},"traceId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","spanId":"1a2b3c4d5e6f7a8b"}]}]}]}'%s

`,
		bold, green, reset,
		green, reset, cfg.Ports.Dashboard,
		green, reset, cfg.Ports.OtelGRPC,
		green, reset, cfg.Ports.OtelHTTP,
		green, reset, cfg.Ports.OpenSearch,
		bold, reset,
		yellow, cfg.Ports.OtelHTTP, reset,
	)
}
