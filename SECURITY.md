# Security Policy

Security reports are welcome and should be handled privately.

## Supported code

The latest commit on `main` is the supported development baseline. Older branches, experimental snapshots, and self-hosted forks may not receive fixes.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** / private security advisory flow for this repository when available.

If private reporting is unavailable, open a minimal public issue asking the maintainer to establish a private contact channel. Do **not** include exploit details, credentials, personal data, production URLs containing secrets, or proof-of-concept payloads in a public issue.

A useful report includes:

- the affected component and commit;
- the security impact;
- reproducible steps using redacted or synthetic data;
- any relevant logs with tokens, cookies, identifiers, and personal content removed;
- a suggested mitigation, if known.

## Areas of particular interest

- authentication and session boundaries;
- accidental secret or personal-data exposure;
- prompt injection that crosses tool or privilege boundaries;
- unsafe webhook, media, location, or health-data handling;
- dependency and supply-chain risks;
- cross-user data access;
- message-history, memory, or deletion inconsistencies;
- deployment provenance and rollback safety.

## Handling

The maintainer will validate the report, assess affected versions, prepare a scoped fix, and coordinate disclosure when appropriate. Automated and AI-assisted security review may support triage and remediation, but release decisions and disclosure remain the maintainer's responsibility.
