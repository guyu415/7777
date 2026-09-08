# Eunoia VPS companion backend

Production path: `/opt/ai-companion`. The files in this directory are the
version-controlled source mirror for the VPS-resident CC/Codex companion
backend. Secrets, logs, state, transcripts, uploads, generated compression
artifacts, and MCP credentials are intentionally excluded.

## Chat current location

The fixed Claude Code chat toolbar opens a preview of a fresh browser GPS fix.
The preview shows an OpenStreetMap embed with the original WGS84 marker, the
resolved address, accuracy, capture time and great-circle distance to the user's
fixed reference point: 500 Howard Street, San Francisco, CA 94105, USA
(37.7876, -122.3968). Distance is a spherical estimate, not a driving route.
OpenStreetMap receives the preview coordinates; the AMap key is not used for
map display. See https://wiki.openstreetmap.org/wiki/Export for map sharing.

Only the explicit send button sends the displayed fix and distance as a normal
chat text message. Refresh obtains a new fix; fixes older than two minutes must
be refreshed before sending. Closing the preview or switching conversations
cancels unfinished requests without sending. Existing drafts remain intact.

Deploy `location.ts` alongside `channel-server.ts` and configure the server-only
`AMAP_WEB_SERVICE_KEY` in the companion process environment. This is the same
Web Service key type used by the check-in worker on branch
`claude/worker-oauth-auth-6wxiq4`; that worker's secret is not automatically
available to the VPS. Never put the key in frontend code or a `VITE_` variable.
Preserve the existing CC session and runtime state when deploying.

`POST /location/resolve` uses the existing Origin and HttpOnly cookie gate. It
converts GPS coordinates through AMap before reverse geocoding, with a shared
seven-second upstream deadline and no location logging or response caching.
API reference: https://lbs.amap.com/api/webservice/guide/api/georegeo
If the endpoint/key/address service is unavailable, the chat explicitly says
the address could not be resolved and still sends the fresh GPS fix. It never
substitutes a previous check-in location.

Before production use, verify on the actual phone: first-time permission,
denial/retry, timeout, a successful readable address, switching conversations
mid-request, and the received message in the existing CC conversation. Local
tests mock GPS and AMap; they do not verify production credentials or location.

## CC tidal-memory configuration

Only the fixed Claude Code companion window reads these variables:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `AI_COMPANION_TIDAL_TOKEN_THRESHOLD` | `110000` | Real input context tokens required to trigger |
| `AI_COMPANION_TIDAL_VISIBLE_THRESHOLD` | `150` | Visible user/assistant messages fallback |
| `AI_COMPANION_TIDAL_RECENT_MAX` | `16` | Maximum raw messages in recovery layer |
| `AI_COMPANION_TIDAL_RECOVERY_TOKEN_BUDGET` | `4000` | Total three-layer recovery budget |
| `AI_COMPANION_TIDAL_RETRY_MS` | `300000` | Retry delay after a failed stage |
| `AI_COMPANION_TIDAL_SUMMARY_TIMEOUT_MS` | `250000` | Luna/Gemini summary task timeout |
| `AI_COMPANION_TIDAL_COMPACT_TIMEOUT_MS` | `180000` | Native `/compact` confirmation timeout |
| `AI_COMPANION_TIDAL_GEMINI_KEY_FILE` | `config/gemini.secret` | Gemini fallback API key file |
| `AI_COMPANION_TIDAL_GEMINI_MODEL` | `gemini-3.5-flash-lite` | Free Gemini fallback model |

Luna runs through the root-owned fixed-path script
`scripts/tidal-luna-summary.sh`. The narrow sudoers entry allows no
arguments. It invokes `codex exec --ephemeral --ignore-user-config
--ignore-rules --sandbox read-only --model gpt-5.6-luna` with medium
reasoning and a strict JSON output schema. It never resumes a CC or Codex
thread. The root Codex CLI is authenticated with ChatGPT login, so this uses
the ChatGPT plan's included Codex allowance rather than an OpenAI API key.

Persistent tidal state is `/opt/ai-companion/state/cc-tidal-memory.json`.
The file contains the CC session id, rolling summary, processed boundary,
summary revision/model/update metadata, latest run status, two-phase pending
record, retry timestamp, and FIFO messages that arrived during maintenance.
It is private runtime state and must never be committed. The authenticated
`GET /tidal-memory/status` and version-checked `PUT /tidal-memory/summary`
routes are the only settings-page access to that authoritative summary; the
retired `/compression/*` review pipeline is not consulted.

The production CC service remains `ai-companion-brain.service`. Codex's
app-server is owned by the separate `ai-companion-codex-daemon.service` cgroup;
the CC channel server talks to its companion-only Unix socket through
`codex-fd-bridge client`. The brain unit only `Wants=` the daemon, so stopping
or restarting either unit never propagates a stop to the other. Existing Codex
thread ids remain persisted and are resumed after a daemon cold start.

`ai-companion-codex-runtime.service` and the bridge's `adopt` mode are retained
only as one-time migration tools for transferring an already-running stdio
process. Normal boot uses bridge `serve` mode and requires a fixed executable
at `/usr/local/bin/codex`.
