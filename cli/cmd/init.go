package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/logclaw/cli/internal/config"
	"github.com/spf13/cobra"
)

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Create a logclaw.toml configuration file with defaults",
	RunE: func(cmd *cobra.Command, args []string) error {
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("failed to get working directory: %w", err)
		}

		path := filepath.Join(cwd, config.DefaultConfigFile)

		if _, err := os.Stat(path); err == nil {
			return fmt.Errorf("%s already exists in this directory", config.DefaultConfigFile)
		}

		if err := os.WriteFile(path, []byte(config.DefaultTOML()), 0644); err != nil {
			return fmt.Errorf("failed to write %s: %w", config.DefaultConfigFile, err)
		}

		fmt.Printf("\033[32mCreated %s\033[0m\n", path)
		fmt.Println("Edit this file to customize your LogClaw setup, then run: logclaw start")
		return nil
	},
}
