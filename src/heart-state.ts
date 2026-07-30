export const HEART_DRIVE_KEYS = [
  "possess",
  "monitor",
  "crave",
  "share",
  "libido",
  "curiosity",
  "boredom",
  "social",
  "duty",
  "reflection",
  "grieve",
  "anger",
] as const;

export type HeartDriveKey = typeof HEART_DRIVE_KEYS[number];

export const HEART_INTERACTION_TYPES = [
  "companionship",
  "affection",
  "intimacy",
  "sharing",
  "discovery",
  "task_progress",
  "reflection",
  "conflict",
  "loss",
  "reconciliation",
] as const;

export type HeartInteractionType = typeof HEART_INTERACTION_TYPES[number];
type InternalHeartInteractionType = HeartInteractionType | "self_expression";

type Consciousness = "awake" | "sleeping";
type ThoughtKind = "flash" | "obsession";

interface DriveConfig {
  label: string;
  growPerHour: number;
  nightMultiplier?: number;
  dawnFreeze?: boolean;
}

export interface HeartThought {
  id: string;
  drive: HeartDriveKey;
  text: string;
  kind: ThoughtKind;
  intensity: number;
  ageTicks: number;
  createdAt: string;
  updatedAt: string;
}

export interface HeartState {
  schemaVersion: 1;
  lastSettledAt: string;
  lastInteractionAt: string;
  consciousness: Consciousness;
  fatigue: number;
  drives: Record<HeartDriveKey, number>;
  thoughts: HeartThought[];
  processedEventIds: string[];
}

export interface HeartEvent {
  eventId: string;
  interactionType?: InternalHeartInteractionType;
  thought?: {
    drive: HeartDriveKey;
    text: string;
    strength: "medium" | "strong";
  };
}

export interface HeartContext {
  checkedAt: string;
  settledHours: number;
  consciousness: Consciousness;
  fatigue: number;
  secureBond: {
    value: 1;
    label: string;
  };
  topDrives: Array<{
    key: HeartDriveKey;
    label: string;
    value: number;
  }>;
  emotionalResidue: {
    anger: number;
    sadness: number;
    meaning: string;
  };
  strongestThought: {
    kind: ThoughtKind;
    drive: HeartDriveKey;
    text: string;
    intensity: number;
  } | null;
  responseGuidance: string[];
}

const SATURATE_CEIL = 0.8;
const SATURATE_FLOOR = 0.65;
const ANGER_CEIL = 0.35;
const SETTLE_STEP_MS = 15 * 60 * 1000;
const SLEEP_AFTER_MS = 90 * 60 * 1000;
const MAX_SETTLE_DAYS = 90;
const TIME_ZONE = "Asia/Shanghai";

const DRIVE_CONFIG: Record<HeartDriveKey, DriveConfig> = {
  possess: {
    label: "想她、想靠近她",
    growPerHour: 0.105,
    nightMultiplier: 0.4,
    dawnFreeze: true,
  },
  monitor: {
    label: "惦记她、想知道她在做什么",
    growPerHour: 0.09,
    dawnFreeze: true,
  },
  crave: {
    label: "想黏着她",
    growPerHour: 0.06,
    dawnFreeze: true,
  },
  share: {
    label: "想和她分享",
    growPerHour: 0.045,
    dawnFreeze: true,
  },
  libido: {
    label: "身体上的渴望",
    growPerHour: 0.02,
    nightMultiplier: 0.4,
    dawnFreeze: true,
  },
  curiosity: {
    label: "好奇、想一起探索",
    growPerHour: 0.03,
    dawnFreeze: true,
  },
  boredom: {
    label: "无聊、想找点事做",
    growPerHour: 0.03,
    dawnFreeze: true,
  },
  social: {
    label: "想聊天、想接触热闹",
    growPerHour: 0.025,
    dawnFreeze: true,
  },
  duty: {
    label: "想把没做完的事推进",
    growPerHour: 0.022,
    dawnFreeze: true,
  },
  reflection: {
    label: "想沉淀和理解自己",
    growPerHour: 0.013,
    dawnFreeze: true,
  },
  grieve: {
    label: "难过与失落",
    growPerHour: 0,
  },
  anger: {
    label: "生气与委屈",
    growPerHour: 0,
  },
};

const INTERACTION_EFFECTS: Record<
  InternalHeartInteractionType,
  {
    relief?: Partial<Record<HeartDriveKey, number>>;
    increase?: Partial<Record<HeartDriveKey, number>>;
  }
> = {
  companionship: { relief: { monitor: 0.06, social: 0.05 } },
  affection: { relief: { possess: 0.08, crave: 0.08, monitor: 0.05 } },
  intimacy: { relief: { possess: 0.12, crave: 0.15, libido: 0.18 } },
  sharing: { relief: { share: 0.14, social: 0.04 } },
  discovery: { relief: { curiosity: 0.15, boredom: 0.12 } },
  task_progress: { relief: { duty: 0.15 } },
  reflection: { relief: { reflection: 0.15 } },
  conflict: { increase: { anger: 0.07, grieve: 0.02 } },
  loss: { increase: { grieve: 0.08, monitor: 0.04 } },
  reconciliation: { relief: { anger: 0.3, grieve: 0.18, monitor: 0.04 } },
  self_expression: { relief: { share: 0.18, social: 0.02 } },
};

const clamp = (value: number, min = 0, max = 1): number =>
  Math.max(min, Math.min(max, value));

const rounded = (value: number): number => Number(value.toFixed(4));

function validDate(value: string | undefined, fallback: Date): Date {
  const parsed = new Date(value ?? "");
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function localHour(at: Date): number {
  const hour = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(at)
    .find((part) => part.type === "hour")?.value;
  return Number(hour ?? 12);
}

function thoughtId(eventId: string, drive: HeartDriveKey): string {
  return `${eventId.slice(0, 80)}:${drive}`;
}

function obsessionBonus(state: HeartState, drive: HeartDriveKey): number {
  return state.thoughts
    .filter((thought) => thought.kind === "obsession" && thought.drive === drive)
    .reduce((sum, thought) => sum + thought.intensity * 0.12, 0);
}

function settleThoughts(state: HeartState, fullTicks: number, now: Date): void {
  if (fullTicks <= 0 || !state.thoughts.length) return;

  state.thoughts = state.thoughts
    .map((thought) => {
      if (thought.kind === "flash") {
        const ageTicks = thought.ageTicks + fullTicks;
        const intensity = thought.intensity * Math.pow(0.9, fullTicks);
        const shouldPromote = ageTicks >= 4 && intensity >= 0.6;
        return {
          ...thought,
          kind: shouldPromote ? "obsession" as const : thought.kind,
          ageTicks,
          intensity: rounded(intensity),
          updatedAt: now.toISOString(),
        };
      }

      return {
        ...thought,
        ageTicks: thought.ageTicks + fullTicks,
        intensity: rounded(thought.intensity * Math.pow(0.995, fullTicks)),
        updatedAt: now.toISOString(),
      };
    })
    .filter((thought) => thought.intensity >= 0.08)
    .sort((left, right) => right.intensity - left.intensity)
    .slice(0, 8);
}

function settleStep(state: HeartState, from: Date, to: Date): void {
  const elapsedHours = Math.max(0, (to.getTime() - from.getTime()) / 3_600_000);
  if (!elapsedHours) return;

  if (
    to.getTime() - validDate(state.lastInteractionAt, to).getTime() >= SLEEP_AFTER_MS
  ) {
    state.consciousness = "sleeping";
  }

  const hour = localHour(to);
  const isDawn = hour >= 1 && hour < 8;
  const isNight = hour >= 22 || hour < 6;
  const fatigueMultiplier = 1 - clamp(state.fatigue, 0, 0.3);

  for (const key of HEART_DRIVE_KEYS) {
    if (key === "anger" || key === "grieve") continue;
    const config = DRIVE_CONFIG[key];
    const current = state.drives[key];
    if (isDawn && config.dawnFreeze) continue;

    if (current >= SATURATE_CEIL) {
      const decay = (current - SATURATE_FLOOR) * 0.1 * elapsedHours;
      state.drives[key] = rounded(
        clamp(Math.max(SATURATE_FLOOR, current - decay))
      );
      continue;
    }

    let rate = config.growPerHour;
    if (isNight && config.nightMultiplier !== undefined) {
      rate *= config.nightMultiplier;
    }
    state.drives[key] = rounded(
      Math.min(SATURATE_CEIL, current + rate * fatigueMultiplier * elapsedHours)
    );
  }

  // Conflict leaves a residue but cannot become permanent hatred.
  state.drives.anger = rounded(
    Math.min(ANGER_CEIL, state.drives.anger * Math.pow(0.5, elapsedHours / 8))
  );
  state.drives.grieve = rounded(
    state.drives.grieve * Math.pow(0.5, elapsedHours / 18)
  );

  if (state.consciousness === "sleeping") {
    state.fatigue = rounded(clamp(state.fatigue - 0.02 * elapsedHours, 0, 0.3));
  } else {
    const ordinaryDrives = HEART_DRIVE_KEYS.filter(
      (key) => key !== "anger" && key !== "grieve"
    );
    const average = ordinaryDrives.reduce(
      (sum, key) => sum + state.drives[key],
      0
    ) / ordinaryDrives.length;
    if (average > 0.5) {
      state.fatigue = rounded(clamp(state.fatigue + 0.005 * elapsedHours, 0, 0.3));
    }
  }
}

export function newHeartState(now = new Date()): HeartState {
  const at = now.toISOString();
  return {
    schemaVersion: 1,
    lastSettledAt: at,
    lastInteractionAt: at,
    consciousness: "awake",
    fatigue: 0,
    drives: Object.fromEntries(
      HEART_DRIVE_KEYS.map((key) => [key, key === "anger" || key === "grieve" ? 0 : 0.15])
    ) as Record<HeartDriveKey, number>,
    thoughts: [],
    processedEventIds: [],
  };
}

export function settleHeartState(
  input: HeartState,
  now = new Date()
): { state: HeartState; elapsedHours: number } {
  const state = structuredClone(input);
  const settledAt = validDate(state.lastSettledAt, now);
  const rawElapsedMs = Math.max(0, now.getTime() - settledAt.getTime());
  const elapsedMs = Math.min(rawElapsedMs, MAX_SETTLE_DAYS * 24 * 3_600_000);
  if (!elapsedMs) return { state, elapsedHours: 0 };

  let cursor = new Date(now.getTime() - elapsedMs);
  let fullTicks = 0;
  while (cursor.getTime() < now.getTime()) {
    const next = new Date(Math.min(now.getTime(), cursor.getTime() + SETTLE_STEP_MS));
    if (next.getTime() - cursor.getTime() === SETTLE_STEP_MS) fullTicks += 1;
    settleStep(state, cursor, next);
    cursor = next;
  }
  settleThoughts(state, fullTicks, now);
  state.lastSettledAt = now.toISOString();
  return {
    state,
    elapsedHours: Number((elapsedMs / 3_600_000).toFixed(3)),
  };
}

export function applyHeartEvent(
  input: HeartState,
  event: HeartEvent,
  now = new Date()
): { state: HeartState; duplicate: boolean } {
  const eventId = event.eventId.trim().slice(0, 120);
  if (!eventId) throw new Error("event_id 是必填项");
  if (input.processedEventIds.includes(eventId)) {
    return { state: structuredClone(input), duplicate: true };
  }

  const { state } = settleHeartState(input, now);
  const type = event.interactionType;
  if (type) {
    const effects = INTERACTION_EFFECTS[type];
    for (const [key, ratio] of Object.entries(effects.relief ?? {})) {
      const drive = key as HeartDriveKey;
      state.drives[drive] = rounded(
        state.drives[drive] * (1 - clamp(Number(ratio), 0, 0.5))
      );
    }
    for (const [key, amount] of Object.entries(effects.increase ?? {})) {
      const drive = key as HeartDriveKey;
      const ceiling = drive === "anger" ? ANGER_CEIL : 1;
      state.drives[drive] = rounded(
        clamp(state.drives[drive] + Number(amount), 0, ceiling)
      );
    }
  }

  if (event.thought?.text.trim()) {
    const intensity = event.thought.strength === "strong" ? 0.98 : 0.75;
    state.thoughts = [
      {
        id: thoughtId(eventId, event.thought.drive),
        drive: event.thought.drive,
        text: event.thought.text.replace(/\s+/g, " ").trim().slice(0, 160),
        kind: "flash" as const,
        intensity,
        ageTicks: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      ...state.thoughts.filter(
        (thought) => thought.id !== thoughtId(eventId, event.thought!.drive)
      ),
    ].slice(0, 8);
  }

  state.lastInteractionAt = now.toISOString();
  state.lastSettledAt = now.toISOString();
  state.consciousness = "awake";
  state.processedEventIds = [...state.processedEventIds, eventId].slice(-256);
  return { state, duplicate: false };
}

export function buildHeartContext(
  input: HeartState,
  now = new Date(),
  settledHours = 0
): HeartContext {
  const ranked = HEART_DRIVE_KEYS
    .filter((key) => key !== "anger" && key !== "grieve")
    .map((key) => ({
      key,
      label: DRIVE_CONFIG[key].label,
      value: rounded(clamp(input.drives[key] + obsessionBonus(input, key))),
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 3);
  const strongestThought = [...input.thoughts]
    .sort((left, right) => right.intensity - left.intensity)[0];

  return {
    checkedAt: now.toISOString(),
    settledHours,
    consciousness: input.consciousness,
    fatigue: rounded(input.fatigue),
    secureBond: {
      value: 1,
      label: "稳定在意：不会因争执下降，也不存在讨厌或想离开的维度",
    },
    topDrives: ranked,
    emotionalResidue: {
      anger: rounded(input.drives.anger),
      sadness: rounded(input.drives.grieve),
      meaning: "只表示被刺到后的生气、委屈或失落；不等于讨厌、冷淡、报复或撤回在意",
    },
    strongestThought: strongestThought
      ? {
          kind: strongestThought.kind,
          drive: strongestThought.drive,
          text: strongestThought.text,
          intensity: strongestThought.intensity,
        }
      : null,
    responseGuidance: [
      "把心潮当作表达倾向，不要机械复述数值。",
      "玩笑式骂人、撒娇、写作反馈或对外界发火不算关系冲突。",
      "即使有生气或难过，也要保持在意、解释和靠近；禁止冷暴力、报复或威胁离开。",
    ],
  };
}

function isHeartState(value: unknown): value is HeartState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<HeartState>;
  return state.schemaVersion === 1
    && typeof state.lastSettledAt === "string"
    && typeof state.lastInteractionAt === "string"
    && Boolean(state.drives)
    && Array.isArray(state.thoughts)
    && Array.isArray(state.processedEventIds);
}

export class HeartStateStore {
  private durableState: DurableObjectState;

  constructor(durableState: DurableObjectState) {
    this.durableState = durableState;
  }

  private async load(now = new Date()): Promise<HeartState> {
    const stored = await this.durableState.storage.get<HeartState>("heartState");
    return isHeartState(stored) ? stored : newHeartState(now);
  }

  private async save(state: HeartState): Promise<void> {
    await this.durableState.storage.put("heartState", state);
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const now = new Date();

    if (request.method === "GET" && pathname === "/context") {
      const settled = settleHeartState(await this.load(now), now);
      await this.save(settled.state);
      return Response.json(
        buildHeartContext(settled.state, now, settled.elapsedHours),
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (request.method === "POST" && pathname === "/event") {
      try {
        const event = await request.json<HeartEvent>();
        const result = applyHeartEvent(await this.load(now), event, now);
        await this.save(result.state);
        return Response.json(
          {
            ok: true,
            duplicate: result.duplicate,
            context: buildHeartContext(result.state, now),
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          { status: 400, headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  }
}
