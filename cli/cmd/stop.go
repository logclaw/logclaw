package cmd

import (
	"fmt"

	"github.com/logclaw/cli/internal/compose"
	"github.com/spf13/cobra"
)

var stopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop all LogClaw services",
	RunE: func(cmd *cobra.Command, args []string) error {
		composeFile, err := compose.FindComposeFile()
		if err != nil {
			return fmt.Errorf("cannot find docker-compose.yml: %w", err)
		}

		fmt.Println("Stopping LogClaw...")
		if err := compose.Run(composeFile, "down"); err != nil {
			return fmt.Errorf("docker compose down failed: %w", err)
		}

		fmt.Println("\n\033[32mLogClaw stopped.\033[0m")
		return nil
	},
}
