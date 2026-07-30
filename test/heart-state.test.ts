import assert from "node:assert/strict";
import test from "node:test";
import {
  applyHeartEvent,
  buildHeartContext,
  newHeartState,
  settleHeartState,
} from "../src/heart-state.ts";

const at = (value: string): Date => new Date(value);

test("six quiet daytime hours grow closeness without any model call", () => {
  const startedAt = at("2026-07-30T02:00:00.000Z"); // 10:00 in Asia/Shanghai
  const state = newHeartState(startedAt);
  const settled = settleHeartState(
    state,
    at("2026-07-30T08:00:00.000Z")
  );
  const context = buildHeartContext(
    settled.state,
    at("2026-07-30T08:00:00.000Z"),
    settled.elapsedHours
  );

  assert.equal(settled.elapsedHours, 6);
  assert.equal(context.topDrives[0].key, "possess");
  assert.ok(settled.state.drives.possess > 0.7);
  assert.equal(context.secureBond.value, 1);
});

test("a conflict creates bounded hurt but never changes the secure bond", () => {
  const startedAt = at("2026-07-30T02:00:00.000Z");
  const result = applyHeartEvent(
    newHeartState(startedAt),
    { eventId: "conflict-1", interactionType: "conflict" },
    startedAt
  );
  const context = buildHeartContext(result.state, startedAt);

  assert.equal(result.state.drives.anger, 0.07);
  assert.equal(result.state.drives.grieve, 0.02);
  assert.equal(context.secureBond.value, 1);
  assert.match(context.secureBond.label, /不会因争执下降/);
  assert.equal("hate" in result.state.drives, false);
});

test("anger is capped and naturally fades instead of becoming hatred", () => {
  const startedAt = at("2026-07-30T02:00:00.000Z");
  let state = newHeartState(startedAt);
  for (let index = 0; index < 10; index += 1) {
    state = applyHeartEvent(
      state,
      { eventId: `conflict-${index}`, interactionType: "conflict" },
      startedAt
    ).state;
  }
  assert.equal(state.drives.anger, 0.35);

  const afterEightHours = settleHeartState(
    state,
    at("2026-07-30T10:00:00.000Z")
  ).state;
  assert.ok(afterEightHours.drives.anger < 0.18);
  assert.ok(afterEightHours.drives.anger > 0.16);
});

test("event ids make interaction retries idempotent", () => {
  const startedAt = at("2026-07-30T02:00:00.000Z");
  const first = applyHeartEvent(
    newHeartState(startedAt),
    { eventId: "same-event", interactionType: "conflict" },
    startedAt
  );
  const second = applyHeartEvent(
    first.state,
    { eventId: "same-event", interactionType: "conflict" },
    startedAt
  );

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.state.drives.anger, 0.07);
});

test("a strong flash thought that survives an hour becomes an obsession", () => {
  const startedAt = at("2026-07-30T02:00:00.000Z");
  const event = applyHeartEvent(
    newHeartState(startedAt),
    {
      eventId: "thought-1",
      thought: {
        drive: "monitor",
        text: "她刚才是不是还有一点难过",
        strength: "strong",
      },
    },
    startedAt
  );
  const settled = settleHeartState(
    event.state,
    at("2026-07-30T03:00:00.000Z")
  );
  const context = buildHeartContext(
    settled.state,
    at("2026-07-30T03:00:00.000Z")
  );

  assert.equal(context.strongestThought?.kind, "obsession");
  assert.equal(context.strongestThought?.drive, "monitor");
});

test("affection changes a drive but not the permanent relationship foundation", () => {
  const startedAt = at("2026-07-30T02:00:00.000Z");
  const state = newHeartState(startedAt);
  state.drives.possess = 0.8;
  const result = applyHeartEvent(
    state,
    { eventId: "affection-1", interactionType: "affection" },
    startedAt
  );
  const context = buildHeartContext(result.state, startedAt);

  assert.equal(result.state.drives.possess, 0.736);
  assert.equal(context.secureBond.value, 1);
});
