package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the LogClaw CLI version",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("logclaw version %s\n", cliVersion)
	},
}
