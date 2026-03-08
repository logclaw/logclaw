package main

import (
	"os"
	"path/filepath"

	"github.com/logclaw/cli/cmd"
	"github.com/logclaw/cli/internal/compose"
)

func main() {
	// Try to discover the logclaw repo's docker-compose.yml relative to the binary.
	// If the binary lives at <repo>/cli/logclaw, the compose file is at <repo>/docker-compose.yml.
	if exe, err := os.Executable(); err == nil {
		repoRoot := filepath.Dir(filepath.Dir(exe))
		candidate := filepath.Join(repoRoot, "docker-compose.yml")
		if _, err := os.Stat(candidate); err == nil {
			compose.DefaultRepoComposePath = candidate
		}
	}

	cmd.Execute()
}
