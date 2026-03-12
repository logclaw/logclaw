# Contributing to LogClaw

Thank you for your interest in contributing to LogClaw! This guide will help you get started.

## Quick Links

- [Documentation](https://docs.logclaw.ai)
- [Issue Tracker](https://github.com/logclaw/logclaw/issues)
- [Security Policy](SECURITY.md)

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Kubernetes cluster (for Helm deployments)
- Node.js 20+ (for dashboard and auth-proxy)
- Python 3.11+ (for bridge and ticketing agent)
- Go 1.22+ (for agent)

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/logclaw/logclaw.git
   cd logclaw
   ```

2. **Start the stack with Docker Compose**
   ```bash
   docker compose up -d
   ```

3. **Send test logs**
   ```bash
   curl -X POST http://localhost:4318/v1/logs \
     -H "Content-Type: application/json" \
     -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"test"}}]},"scopeLogs":[{"logRecords":[{"body":{"stringValue":"hello from curl"},"severityText":"INFO"}]}]}]}'
   ```

See the [README](README.md) for full architecture details and component documentation.

## How to Contribute

### Reporting Bugs

1. Check existing [issues](https://github.com/logclaw/logclaw/issues) to avoid duplicates
2. Use the **Bug Report** issue template
3. Include: steps to reproduce, expected behavior, actual behavior, environment details

### Suggesting Features

1. Open a **Feature Request** issue
2. Describe the problem you're trying to solve
3. Propose a solution if you have one

### Submitting Code Changes

1. **Fork** the repository
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
3. **Make your changes** following the code style guidelines below
4. **Test your changes** locally
5. **Commit** with a clear message:
   ```bash
   git commit -m "feat: add support for PagerDuty ticketing"
   ```
6. **Push** and open a Pull Request against `main`

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation changes
- `refactor:` — Code refactoring (no behavior change)
- `test:` — Adding or updating tests
- `chore:` — Build, CI, or tooling changes

### Code Style

- **Python**: Follow PEP 8. Use type hints where possible.
- **TypeScript/JavaScript**: Use the existing ESLint/Prettier config.
- **Go**: Run `gofmt` and `go vet` before committing.
- **Helm Charts**: Validate with `helm lint` before committing.

### Pull Request Guidelines

- Keep PRs focused on a single change
- Update documentation if your change affects user-facing behavior
- If changing Python code in `apps/`, also update the corresponding Helm chart configmap
- Add tests for new functionality where applicable
- PRs require at least one maintainer review before merging

## Project Structure

```
logclaw/
├── apps/                    # Application source code
│   ├── logclaw-bridge/      # Python — anomaly detection engine
│   ├── logclaw-agent/       # Go — AI analysis agent
│   ├── logclaw-ticketing-agent/  # Python — ticket creation
│   ├── logclaw-auth-proxy/  # Node.js — API key validation
│   └── dashboard/           # Next.js — web dashboard
├── charts/                  # Helm charts for Kubernetes
├── docs/                    # Mintlify documentation site
├── docker-compose.yml       # Local development stack
└── .github/                 # CI/CD workflows
```

## Need Help?

- Open a [Discussion](https://github.com/logclaw/logclaw/discussions) for questions
- Email [support@logclaw.ai](mailto:support@logclaw.ai) for private inquiries
- See [SECURITY.md](SECURITY.md) for vulnerability reports

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
