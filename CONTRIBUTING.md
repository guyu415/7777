# Contributing to Eunoia

Thank you for helping improve Eunoia.

## Before you start

Eunoia is a production-used, mobile-first AI companion project. Changes should preserve conversation continuity, user control, privacy boundaries, and the existing release baseline.

For non-trivial work, open an issue first and describe:

- the user-visible problem or proposed behavior;
- the affected client, edge, or companion-runtime component;
- privacy, migration, or compatibility concerns;
- how the change can be tested.

## Development

Use Node.js 20 or newer.

```bash
npm ci
npm run dev
```

Before submitting a pull request:

```bash
npm test
npm run build
```

Add focused regression coverage when changing message ordering, persistence, reconnect behavior, deletion, memory, authentication, or tool permissions.

## Pull requests

- Branch from the latest `main`.
- Keep the diff scoped; do not replace newer files with copies from older branches.
- Explain the behavior before and after the change.
- List the checks you ran.
- Call out any deployment, environment, migration, or rollback requirement.
- Never commit credentials, cookies, tokens, personal data, transcripts, uploads, logs, or runtime state.

AI-assisted contributions are welcome. Contributors remain responsible for reviewing generated changes, verifying behavior, and accurately describing tests and limitations.

## Security

Do not report vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md) and use GitHub's private vulnerability reporting flow when available.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
