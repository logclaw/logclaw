package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

const cliVersion = "0.1.0"

var rootCmd = &cobra.Command{
	Use:   "logclaw",
	Short: "LogClaw CLI -- self-hosted log management powered by OpenTelemetry",
	Long: `LogClaw CLI wraps Docker Compose to give you a polished self-hosted
log management experience. Start the full stack with a single command,
send logs via OTLP, and view everything in the dashboard.`,
}

// Execute runs the root command.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.AddCommand(initCmd)
	rootCmd.AddCommand(startCmd)
	rootCmd.AddCommand(stopCmd)
	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(logsCmd)
	rootCmd.AddCommand(ingestCmd)
	rootCmd.AddCommand(versionCmd)
}
