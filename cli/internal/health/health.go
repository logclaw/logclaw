package health

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const (
	pollInterval = 3 * time.Second
	maxWait      = 5 * time.Minute
)

type containerInfo struct {
	Name   string `json:"Name"`
	State  string `json:"State"`
	Health string `json:"Health"`
}

// WaitForServices polls docker compose ps until all containers are healthy/running
// or the timeout is exceeded.
func WaitForServices(composeFile string) error {
	deadline := time.Now().Add(maxWait)

	fmt.Println("Waiting for services to be healthy...")

	for time.Now().Before(deadline) {
		healthy, status, err := checkHealth(composeFile)
		if err != nil {
			// Docker might not be ready yet, keep trying
			time.Sleep(pollInterval)
			continue
		}

		fmt.Printf("\r  %s", status)

		if healthy {
			fmt.Println()
			return nil
		}

		time.Sleep(pollInterval)
	}

	fmt.Println()
	return fmt.Errorf("timed out waiting for services to become healthy (waited %s)", maxWait)
}

func checkHealth(composeFile string) (bool, string, error) {
	cmd := exec.Command("docker", "compose", "-f", composeFile, "ps", "--format", "json")
	out, err := cmd.Output()
	if err != nil {
		return false, "", err
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) == 0 || (len(lines) == 1 && lines[0] == "") {
		return false, "No containers found", nil
	}

	totalContainers := 0
	healthyContainers := 0
	var statuses []string

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var info containerInfo
		if err := json.Unmarshal([]byte(line), &info); err != nil {
			continue
		}

		totalContainers++
		state := strings.ToLower(info.State)
		health := strings.ToLower(info.Health)

		isHealthy := state == "running" && (health == "healthy" || health == "")
		if isHealthy {
			healthyContainers++
		}

		shortName := info.Name
		if idx := strings.LastIndex(shortName, "-"); idx > 0 {
			shortName = shortName[idx+1:]
		}

		mark := "\033[33m...\033[0m"
		if isHealthy {
			mark = "\033[32mok\033[0m"
		}
		statuses = append(statuses, fmt.Sprintf("%s: %s", shortName, mark))
	}

	status := fmt.Sprintf("[%d/%d] %s", healthyContainers, totalContainers, strings.Join(statuses, "  "))
	return healthyContainers == totalContainers && totalContainers > 0, status, nil
}
