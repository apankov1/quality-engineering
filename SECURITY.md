# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| main    | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue**
2. Use [GitHub's private vulnerability reporting](https://github.com/apankov1/quality-engineering/security/advisories/new)
3. Include steps to reproduce and impact assessment

You can expect an initial response within 48 hours.

## Scope

This repository contains testing utilities and skills — no production services, no user data, no secrets. Security concerns are primarily:

- Supply chain (dependency integrity)
- CI/CD pipeline safety (workflow injection)
- Code execution in test fixtures
