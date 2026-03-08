package compose

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// DefaultRepoComposePath is the path to the docker-compose.yml shipped with the logclaw repo.
// It is used as a fallback when no compose file is found in the current directory.
var DefaultRepoComposePath = ""

// FindComposeFile locates the docker-compose.yml to use.
// Priority:
//  1. docker-compose.yml in the current working directory
//  2. The repo-level docker-compose.yml (DefaultRepoComposePath)
func FindComposeFile() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get working directory: %w", err)
	}

	local := filepath.Join(cwd, "docker-compose.yml")
	if _, err := os.Stat(local); err == nil {
		return local, nil
	}

	if DefaultRepoComposePath != "" {
		if _, err := os.Stat(DefaultRepoComposePath); err == nil {
			return DefaultRepoComposePath, nil
		}
	}

	return "", fmt.Errorf("no docker-compose.yml found in %s or the logclaw repo path", cwd)
}

// Run executes a docker compose command with the given arguments.
// It streams stdout/stderr to the terminal.
func Run(composeFile string, args ...string) error {
	cmdArgs := []string{"compose", "-f", composeFile}
	cmdArgs = append(cmdArgs, args...)

	c := exec.Command("docker", cmdArgs...)
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	c.Stdin = os.Stdin

	return c.Run()
}

// RunPassthrough executes a docker compose command and fully replaces stdin/stdout/stderr,
// suitable for interactive commands like `logs -f`.
func RunPassthrough(composeFile string, args ...string) error {
	cmdArgs := []string{"compose", "-f", composeFile}
	cmdArgs = append(cmdArgs, args...)

	c := exec.Command("docker", cmdArgs...)
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	c.Stdin = os.Stdin

	return c.Run()
}

// RunCapture executes a docker compose command and returns combined output.
func RunCapture(composeFile string, args ...string) (string, error) {
	cmdArgs := []string{"compose", "-f", composeFile}
	cmdArgs = append(cmdArgs, args...)

	c := exec.Command("docker", cmdArgs...)
	out, err := c.CombinedOutput()
	return string(out), err
}
