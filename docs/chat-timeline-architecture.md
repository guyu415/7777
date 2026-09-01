# One-to-one chat timeline architecture

The rendered timeline is not a transport log. It is a projection of durable
messages plus ephemeral activity state.

## Sources and authority

| Source | Meaning | Timeline event |
| --- | --- | --- |
| IndexedDB / cloud KV | Durable display-history snapshot | `snapshot` |
| Current API or CC turn | New accepted message / complete stream update | `upsert` / `patch` |
| CC live wire not claimed by the current turn | Remote user or proactive assistant message | `upsert` through `ccMessageInbox` |
| CC reconnect history | Recovery snapshot, not live messages | one anchored `merge` through `ccMessageInbox` |
| Codex history / live wire | Server-authoritative snapshot or stable-id update | `snapshot` / `upsert` |
| Transport status | Thinking/working/stopped | never a message |

All timeline mutations reduce through `reduceMessageTimeline`. Stable
`id`/`wireIds` are display deduplication keys; `serverWireIds` are transport
recovery/deletion keys. Equal text is not identity.

## Ordering rules

1. A durable snapshot is canonicalized and timestamp-sorted once during
   hydration.
2. A live message is appended in receive order. Its clock is display metadata,
   not permission to move older rendered rows.
3. A stable-id update replaces the existing row in place.
4. A reconnect snapshot finds the newest server wire represented in local
   `id`/`wireIds` and recovers only the tail after it. Missing rows before that
   anchor are old gaps and are not inserted into an open conversation.
5. A genuinely empty device may hydrate the complete server snapshot, but it
   enters the store in one batch.
6. A reply carrying `replyToTurnId` is causally attached immediately after the
   matching user message. This parent relation outranks client/server clock
   values; semantic quote targets such as `replyTo` never control placement.

## CC message boundaries

The CC wire protocol is authoritative: one `reply()` call is one durable
server message. Its `serverWireIds` identity controls reconnect recovery and
deletion, while stable paragraph-level `wireIds` control rendered-bubble
deduplication. Blank-line paragraphs therefore remain separate chat bubbles
without pretending they are separate server messages or swallowing siblings
during hydration. Multiple `reply()` calls still retain distinct server ids.

## Ephemeral state

`isLoading`, typing dots, reasoning activity and stop controls are UI/runtime
state. The pending reply indicator is rendered by `PendingReplyIndicator`; it
has no message id, timestamp, long-press menu or delete operation.

Persisted rows that still contain `streaming`/`voiceLoading` after a process
death are finalized during durable hydration: empty placeholders are dropped
and an unfinished voice placeholder degrades to readable text. A stale loading
row must never be resurrected as a real message.

## Persistence and deletion

`ccMessageInbox` is the only writer for CC messages outside the currently
awaited `useChat` turn. It serializes live and reconnect events, performs one
batched visible merge, writes IndexedDB, then debounces cloud synchronization.

Deletion tombstones and the reliable server-delete outbox remain in
`messageTimelineGuard`. A reconnect snapshot can therefore neither display nor
retain a row that is waiting for its idempotent server deletion acknowledgement.

## Change checklist

- Do not append WebSocket history items one by one.
- Do not deduplicate by text or timestamp.
- Do not put loading indicators into a message array.
- Do not sort the whole timeline in response to a live event.
- Add reducer tests for every new message lifecycle state.
