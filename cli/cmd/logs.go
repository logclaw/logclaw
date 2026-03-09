package cmd

import (
	"fmt"

	"github.com/logclaw/cli/internal/compose"
	"github.com/spf13/cobra"
)

var logsCmd = &cobra.Command{
	Use:   "logs [service]",
	Short: "Stream logs from LogClaw services",
	Long:  `Stream logs from all services, or specify a service name to follow only that service.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		composeFile, err := compose.FindComposeFile()
		if err != nil {
			return fmt.Errorf("cannot find docker-compose.yml: %w", err)
		}

		composeArgs := []string{"logs", "-f"}
		if len(args) > 0 {
			composeArgs = append(composeArgs, args[0])
		}

		return compose.RunPassthrough(composeFile, composeArgs...)
	},
}
