package cmd

import (
	"bytes"
	"fmt"
	"net/http"
	"time"

	"github.com/logclaw/cli/internal/config"
	"github.com/spf13/cobra"
)

var ingestCmd = &cobra.Command{
	Use:   "ingest",
	Short: "Send a sample OTLP log to the local OTel collector",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load("")
		if err != nil {
			cfg = config.DefaultConfig()
		}

		url := fmt.Sprintf("http://localhost:%d/v1/logs", cfg.Ports.OtelHTTP)

		now := time.Now().UnixNano()
		payload := fmt.Sprintf(`{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "logclaw-cli-test"}},
          {"key": "service.version", "value": {"stringValue": "1.0.0"}},
          {"key": "deployment.environment", "value": {"stringValue": "development"}}
        ]
      },
      "scopeLogs": [
        {
          "scope": {
            "name": "logclaw.cli.ingest"
          },
          "logRecords": [
            {
              "timeUnixNano": "%d",
              "severityNumber": 17,
              "severityText": "ERROR",
              "body": {"stringValue": "Failed to connect to database: connection refused on port 5432"},
              "traceId": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
              "spanId": "1a2b3c4d5e6f7a8b",
              "attributes": [
                {"key": "db.system", "value": {"stringValue": "postgresql"}},
                {"key": "db.statement", "value": {"stringValue": "SELECT * FROM users WHERE id = $1"}},
                {"key": "error.type", "value": {"stringValue": "ConnectionRefusedError"}}
              ]
            }
          ]
        }
      ]
    }
  ]
}`, now)

		fmt.Printf("Sending sample log to %s ...\n", url)

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Post(url, "application/json", bytes.NewBufferString(payload))
		if err != nil {
			return fmt.Errorf("\033[31mfailed to send log: %w\033[0m\nIs LogClaw running? Try: logclaw start", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			fmt.Printf("\033[32mSample log sent successfully! (HTTP %d)\033[0m\n", resp.StatusCode)
			fmt.Println("Check the dashboard at http://localhost:3000 to see it.")
		} else {
			fmt.Printf("\033[31mUnexpected response: HTTP %d\033[0m\n", resp.StatusCode)
		}

		return nil
	},
}
