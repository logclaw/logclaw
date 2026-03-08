package cmd

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/logclaw/cli/internal/compose"
	"github.com/spf13/cobra"
)

type psEntry struct {
	Name    string `json:"Name"`
	Service string `json:"Service"`
	State   string `json:"State"`
	Health  string `json:"Health"`
	Ports   string `json:"Ports"`
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show the status of LogClaw services",
	RunE: func(cmd *cobra.Command, args []string) error {
		composeFile, err := compose.FindComposeFile()
		if err != nil {
			return fmt.Errorf("cannot find docker-compose.yml: %w", err)
		}

		output, err := compose.RunCapture(composeFile, "ps", "--format", "json")
		if err != nil {
			return fmt.Errorf("docker compose ps failed: %w", err)
		}

		lines := strings.Split(strings.TrimSpace(output), "\n")
		if len(lines) == 0 || (len(lines) == 1 && lines[0] == "") {
			fmt.Println("No LogClaw containers running.")
			fmt.Println("Run 'logclaw start' to start services.")
			return nil
		}

		var entries []psEntry
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var e psEntry
			if err := json.Unmarshal([]byte(line), &e); err != nil {
				continue
			}
			entries = append(entries, e)
		}

		if len(entries) == 0 {
			fmt.Println("No LogClaw containers running.")
			fmt.Println("Run 'logclaw start' to start services.")
			return nil
		}

		green := "\033[32m"
		yellow := "\033[33m"
		red := "\033[31m"
		bold := "\033[1m"
		reset := "\033[0m"

		fmt.Printf("\n%s%-25s %-12s %-10s %s%s\n", bold, "SERVICE", "STATE", "HEALTH", "PORTS", reset)
		fmt.Println(strings.Repeat("-", 75))

		for _, e := range entries {
			color := green
			state := e.State
			health := e.Health

			switch strings.ToLower(e.State) {
			case "running":
				if strings.ToLower(health) == "healthy" || health == "" {
					color = green
				} else {
					color = yellow
				}
			case "exited", "dead":
				color = red
			default:
				color = yellow
			}

			if health == "" {
				health = "-"
			}

			// Shorten port display
			ports := e.Ports
			if len(ports) > 40 {
				ports = ports[:37] + "..."
			}

			fmt.Printf("%s%-25s %-12s %-10s %s%s\n", color, e.Service, state, health, ports, reset)
		}
		fmt.Println()

		return nil
	},
}
