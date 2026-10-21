# Eunoia

Eunoia is a mobile-first, open-source AI companion workspace for long-running, personal conversations across multiple model providers. It explores what an AI relationship feels like when memory, continuity, proactive care, tools, and interface state are treated as one coherent system instead of isolated chat requests.

The project is actively maintained on the `main` branch and is used as a real production application.

## Highlights

- **Multi-model conversations** with streaming responses and per-companion model routing
- **Durable chat continuity** across refreshes, reconnects, retries, rewinds, and long sessions
- **Long-term memory** with layered summaries, recovery state, and user-visible memory management
- **One-to-one and group conversations** with distinct companion identities and turn coordination
- **Proactive companion behaviors** including scheduled messages, activities, diary entries, and contextual follow-ups
- **Extensible tools and integrations** for media, location, health data bridges, music, mini-games, and other companion actions
- **Mobile-first interface** with custom themes, chat bubbles, animations, voice-oriented interactions, and installable web-app behavior
- **Production-focused safety** around deployment provenance, authentication, secrets, user data, and message recovery

## Architecture

| Layer | Main responsibilities |
| --- | --- |
| Web client | React, Vite, Zustand, IndexedDB, message rendering, local state, and companion UI |
| Edge services | Cloudflare Workers and KV for authenticated APIs, synchronization, scheduled work, and provider-facing integrations |
| Companion runtime | TypeScript services for persistent Claude Code and OpenAI Codex sessions, memory, tools, media, and proactive events |
| Reliability | Stable message identities, reconnect recovery, deletion outboxes, timeline reduction, tests, and guarded release workflows |

The rendered chat timeline is a projection of durable messages plus ephemeral activity state. Transport events, persisted history, reconnect snapshots, streaming patches, and deletion tombstones are reconciled through stable identities rather than text or timestamps. See [the timeline architecture](docs/chat-timeline-architecture.md) for details.

## Repository layout

- `src/` — React client, state, hooks, services, components, themes, and interaction features
- `worker/` and `functions/` — edge APIs and Cloudflare integration
- `vps/ai-companion/` — version-controlled companion backend source
- `docs/` — architecture notes and feature progress records
- `test/` and colocated test files — regression coverage
- `.github/workflows/` — CI and deployment automation

Runtime secrets, credentials, transcripts, uploads, logs, and private state are intentionally excluded from version control.

## Local development

Requirements:

- Node.js 20 or newer
- npm

```bash
npm ci
npm run dev
```

Quality checks:

```bash
npm test
npm run build
```

Self-hosting requires your own model-provider credentials and service configuration. Never expose server credentials through frontend variables or commit runtime state.

## Maintenance and releases

`main` is the canonical production baseline. Every release should be built from a clean worktree based on the latest `origin/main`, reviewed as a complete diff, tested, and verified after deployment. Backend updates should preserve active companion sessions whenever a safe hot reload is possible.

The detailed release rules used by repository agents and maintainers are documented in [AGENTS.md](AGENTS.md).

## AI-assisted engineering

Eunoia is maintained through a **human-directed, AI-assisted engineering workflow**. Claude Code and OpenAI Codex are used for implementation, review, testing, debugging, documentation, and release preparation.

AI-generated changes are not treated as autonomous maintenance: the repository owner defines product behavior, reviews and accepts changes, controls merges and deployments, and remains responsible for security and production outcomes.

## Contributing

Focused issues and pull requests are welcome. Please:

1. describe the user-visible behavior or failure mode;
2. keep changes scoped to the relevant feature;
3. include regression coverage when practical;
4. run `npm test` and `npm run build` before submitting;
5. avoid committing credentials, personal data, generated transcripts, or runtime state.

This project is evolving quickly. Architecture and interfaces may change while the companion runtime is being hardened for broader use.

## Project policies

- Contributions: [CONTRIBUTING.md](CONTRIBUTING.md)
- Vulnerability reporting: [SECURITY.md](SECURITY.md)
- License: [MIT](LICENSE)
