# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`ac-mcp-controller` — a Cloudflare Worker that exposes a remote MCP server (over SSE, protected by OAuth 2.0) for controlling a physical air conditioner through the Tuya Cloud IR API. Claude apps connect to `https://ac.xiaoman.xyz/sse` as an MCP connector; after OAuth approval they get tools to read AC status and change power/temperature/mode/fan speed.

User-facing strings (tool descriptions, HTML pages, tool responses) are in Chinese; code, comments, and identifiers are in English. Keep that convention.

## Commands

```bash
npm run dev         # wrangler dev — local worker
npm run type-check  # tsc --noEmit (strict mode) — the only check; there are no tests or linters
npm run deploy      # wrangler deploy — deploys to production route ac.xiaoman.xyz/*
```

Run `npm run type-check` after any change. Do not run `npm run deploy` unless explicitly asked — it ships straight to the production domain.

## Architecture

Three source files under `src/`:

- **`src/index.ts`** — Worker entry point. The default export is a `@cloudflare/workers-oauth-provider` `OAuthProvider` that wraps everything:
  - `/sse` (API route) → `AcMcpAgent.mount("/sse")`, reachable only with a valid OAuth access token
  - `/authorize`, `/token`, `/register` → OAuth endpoints (dynamic client registration supported; tokens live 24 h, state stored in the `OAUTH_KV` KV namespace)
  - `/` → HTML landing page; `/authorize` GET renders a consent page, POST approve completes authorization as a single hard-coded `"local-user"` (there is no real login — anyone who clicks approve is authorized)
  - Also defines the shared `Env` interface (bindings + vars + secrets) and `Props` (data encrypted into the access token and passed to the agent)

- **`src/ac-agent.ts`** — `AcMcpAgent`, a Durable Object extending `McpAgent<Env, AcState, Props>` from the `agents` package. Registers all MCP tools in `init()` on an `McpServer`, with Zod schemas for parameters. Tools: `get_ac_status`, `turn_on_ac`, `turn_off_ac`, `set_temperature` (16–30 °C), `set_mode` (cool/heat/fan/auto/dry), `set_fan_speed` (low/medium/high/auto).
  - `AcState` (power, temperature, mode, fanSpeed) is persisted via the McpAgent `state`/`setState` mechanism.
  - The IR blaster is one-directional, so state can drift from reality: every command sends the *full* state (power+mode+temp+wind) via `command()`, and `get_ac_status` tries the Tuya status endpoint but falls back to the cached local state on error.
  - Numeric mappings between the string enums and Tuya values live at the top of this file (`MODE_TO_TUYA` etc. — 0=Auto, 1=Cool, 2=Heat, 3=Fan, 4=Dry); Chinese display names in `MODE_NAMES`/`SPEED_NAMES`.
  - Tuya access tokens are cached in instance fields with a 60 s early-refresh margin; the cache resets when the Durable Object hibernates.

- **`src/tuya.ts`** — Standalone Tuya Cloud API client (no imports from the other files; takes a `TuyaEnv` subset of `Env`). Implements Tuya's HMAC-SHA256 request signing using the Web Crypto API — the signing string format is documented in the file header and differs between token requests and normal requests (normal requests include the access token in the HMAC input). `sendAcCommand` posts to the IR scene-command endpoint; `getAcStatus` reads the remote status endpoint.

Adding a tool = register it in `AcMcpAgent.init()` with a Zod param schema and a Chinese description, and (if user-visible) add it to the landing-page tool list in `index.ts`.

## Configuration & secrets

`wrangler.toml` holds non-secret config: Durable Object binding (`AcMcpAgent`), KV namespace (`OAUTH_KV`), production route, and `[vars]` for the Tuya endpoint/client ID/device IDs (`TUYA_IR_ID` = IR blaster, `TUYA_AC_ID` = the AC remote it controls).

Secrets are wrangler secrets, never committed: `TUYA_CLIENT_SECRET` and `COOKIE_SECRET` (set with `wrangler secret put <NAME>`). When adding a new env var or secret, update **both** the `Env` interface in `src/index.ts` and `wrangler.toml` (or wrangler secrets).

Note `OAUTH_PROVIDER` in `Env` is injected at runtime by OAuthProvider, not a real wrangler binding — don't add it to `wrangler.toml`.

## Conventions

- TypeScript strict mode, ES2022 modules, `@cloudflare/workers-types` — Workers runtime only (use Web Crypto / `fetch`, no Node APIs despite the `nodejs_compat` flag).
- Aligned-colon formatting is used in object literals and type declarations (e.g. `power: 1` columns lined up); match it in edited files.
- Section banners like `// ─── Name ───…` divide files; keep them when adding code.
- Tool responses return `{ content: [{ type: "text" as const, text: ... }] }` with Chinese text and status emoji (✅ / ⚠️ / 🟢 / 🔴).
- Errors from Tuya are thrown as plain `Error` with HTTP status or Tuya error code in the message; tools either let them propagate or (for status reads) catch and fall back to cached state.
