# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in LogClaw, please report it responsibly.

**Email:** [security@logclaw.ai](mailto:security@logclaw.ai)

Please include:
- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Impact assessment (if known)

**Do not** open a public GitHub issue for security vulnerabilities.

## Response Timeline

| Action | Timeframe |
|--------|-----------|
| Acknowledge receipt | Within 48 hours |
| Initial assessment | Within 5 business days |
| Fix for critical issues | Within 30 days |
| Fix for non-critical issues | Within 90 days |

## Disclosure Policy

We follow coordinated disclosure:

1. You report the vulnerability privately to us
2. We acknowledge and begin working on a fix
3. We release a patch and publish an advisory
4. After the fix is available, you may publicly disclose the vulnerability

We request a 90-day disclosure window from the initial report to allow us to develop and release a fix.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Previous releases | Best effort |

## Scope

### In scope
- LogClaw core services (Bridge, Agent, Ticketing Agent, Auth Proxy, Dashboard)
- Helm chart configurations
- Authentication and authorization
- Data isolation between tenants
- Log ingestion pipeline

### Out of scope
- Self-hosted deployment misconfigurations
- Vulnerabilities in third-party dependencies (report to upstream maintainers)
- Social engineering attacks
- Denial of service attacks
- Issues in environments running unsupported versions

## Recognition

We appreciate security researchers who help keep LogClaw safe. With your permission, we will acknowledge your contribution in our security advisories.
