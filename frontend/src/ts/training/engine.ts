export const PROFILE_VERSION = 1 as const;

const MIN_KEY_ATTEMPTS = 5;
const MIN_PAIR_ATTEMPTS = 3;
const MIN_LATENCY_MS = 30;
const MAX_LATENCY_MS = 2000;
const MERGE_DECAY = 0.9;
const MAX_STAT_VALUE = 10_000;
const MAX_TARGETS = 2_048;
const MAX_SESSIONS = 50;
const MAX_SUMMARY_TARGETS = 128;
const TRAINING_LETTER = /^[a-z]$/;

export type Stat = {
  attempts: number;
  errors: number;
  totalLatency: number;
  latencySamples: number;
};

export type SessionKind = "diagnostic" | "adaptive" | "manual";

export type SessionSummary = {
  date: number;
  wpm: number;
  accuracy: number;
  targets: string[];
  kind: SessionKind;
  characters: number;
  durationMs: number;
};

export type TrainingProfile = {
  version: typeof PROFILE_VERSION;
  keys: Record<string, Stat>;
  pairs: Record<string, Stat>;
  sessions: SessionSummary[];
};

export type Attempt = {
  expected: string;
  actual: string;
  previous?: string;
  latencyMs?: number;
};

export type RankedTarget = {
  target: string;
  kind: "key" | "pair";
  accuracy: number;
  latencyMs: number;
  attempts: number;
  score: number;
};

const EMPTY_STAT = (): Stat => ({
  attempts: 0,
  errors: 0,
  totalLatency: 0,
  latencySamples: 0,
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boundedStat(value: unknown): Stat | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<Stat>;
  const attempts = clamp(finiteOr(candidate.attempts, 0), 0, MAX_STAT_VALUE);
  const errors = clamp(
    finiteOr(candidate.errors, 0),
    0,
    Math.min(attempts, MAX_STAT_VALUE),
  );
  const latencySamples = clamp(
    finiteOr(candidate.latencySamples, 0),
    0,
    Math.min(attempts, MAX_STAT_VALUE),
  );
  const totalLatency = clamp(
    finiteOr(candidate.totalLatency, 0),
    latencySamples === 0 ? 0 : latencySamples * MIN_LATENCY_MS,
    latencySamples * MAX_LATENCY_MS,
  );

  return { attempts, errors, totalLatency, latencySamples };
}

function hasOwn(record: Record<string, unknown>, target: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, target);
}

function setOwn<T>(record: Record<string, T>, target: string, value: T): void {
  // defineProperty also makes the target `__proto__` safe if a non-keyboard
  // caller supplies it.
  Object.defineProperty(record, target, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function statFor(record: Record<string, Stat>, target: string): Stat {
  if (!hasOwn(record, target)) {
    setOwn(record, target, EMPTY_STAT());
  }
  return record[target] as Stat;
}

function validLatency(latencyMs: unknown): latencyMs is number {
  return (
    typeof latencyMs === "number" &&
    Number.isFinite(latencyMs) &&
    latencyMs >= MIN_LATENCY_MS &&
    latencyMs <= MAX_LATENCY_MS
  );
}

function isTrainingLetter(value: string): boolean {
  return TRAINING_LETTER.test(value);
}

function pairTarget(
  previous: string | undefined,
  expected: string,
): string | null {
  if (
    previous === undefined ||
    !isTrainingLetter(previous) ||
    !isTrainingLetter(expected)
  ) {
    return null;
  }
  return `${previous}${expected}`;
}

function recordInto(
  stat: Stat,
  isError: boolean,
  latencyMs: number | undefined,
): void {
  stat.attempts = Math.min(MAX_STAT_VALUE, stat.attempts + 1);
  if (isError) {
    stat.errors = Math.min(stat.attempts, stat.errors + 1);
  }
  if (
    !isError &&
    validLatency(latencyMs) &&
    stat.latencySamples < MAX_STAT_VALUE
  ) {
    stat.totalLatency = Math.min(
      MAX_STAT_VALUE * MAX_LATENCY_MS,
      stat.totalLatency + latencyMs,
    );
    stat.latencySamples++;
  }
}

function copyStat(stat: Stat): Stat {
  return { ...stat };
}

function cloneStats(input: Record<string, Stat>): Record<string, Stat> {
  const output: Record<string, Stat> = {};
  for (const target of Object.keys(input)) {
    const stat = boundedStat(input[target]);
    if (stat !== null) setOwn(output, target, stat);
  }
  return output;
}

function validKind(value: unknown): value is SessionKind {
  return value === "diagnostic" || value === "adaptive" || value === "manual";
}

function boundedSummary(value: unknown): SessionSummary | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<SessionSummary>;
  if (!validKind(candidate.kind)) return null;

  const targets = Array.isArray(candidate.targets)
    ? candidate.targets
        .filter((target): target is string => typeof target === "string")
        .filter((target) => target.length > 0)
        .slice(0, MAX_SUMMARY_TARGETS)
    : [];

  return {
    date: Math.max(0, finiteOr(candidate.date, 0)),
    wpm: Math.max(0, finiteOr(candidate.wpm, 0)),
    accuracy: clamp(finiteOr(candidate.accuracy, 0), 0, 1),
    targets,
    kind: candidate.kind,
    characters: Math.max(0, Math.floor(finiteOr(candidate.characters, 0))),
    durationMs: Math.max(0, finiteOr(candidate.durationMs, 0)),
  };
}

function cloneSummary(summary: SessionSummary): SessionSummary {
  return { ...summary, targets: [...summary.targets] };
}

export function createProfile(): TrainingProfile {
  return {
    version: PROFILE_VERSION,
    keys: {},
    pairs: {},
    sessions: [],
  };
}

/**
 * Records one expected target. `errors` is intentionally based on the raw
 * expected/actual comparison, so corrections still count as errors. The UI
 * decides whether `previous` is a valid neighboring character before calling
 * this function.
 */
export function recordAttempt(
  profile: TrainingProfile,
  attempt: Attempt,
): void {
  if (!isTrainingLetter(attempt.expected)) return;

  const isError = attempt.actual !== attempt.expected;
  recordInto(
    statFor(profile.keys, attempt.expected),
    isError,
    attempt.latencyMs,
  );

  const pair = pairTarget(attempt.previous, attempt.expected);
  if (pair !== null) {
    recordInto(statFor(profile.pairs, pair), isError, attempt.latencyMs);
  }
}

type Baseline = {
  errorRate: number;
  latencyMs: number;
};

function baselineFor(
  entries: [string, Stat][],
  minimumAttempts: number,
): Baseline {
  const eligible = entries.filter(
    ([, stat]) => stat.attempts >= minimumAttempts,
  );
  const attempts = eligible.reduce((sum, [, stat]) => sum + stat.attempts, 0);
  const errors = eligible.reduce((sum, [, stat]) => sum + stat.errors, 0);
  const latencySamples = eligible.reduce(
    (sum, [, stat]) => sum + stat.latencySamples,
    0,
  );
  const totalLatency = eligible.reduce(
    (sum, [, stat]) => sum + stat.totalLatency,
    0,
  );

  return {
    errorRate: attempts === 0 ? 0 : errors / attempts,
    latencyMs: latencySamples === 0 ? 0 : totalLatency / latencySamples,
  };
}

function relativeErrorSignal(errorRate: number, baseline: number): number {
  const excess = Math.max(0, errorRate - baseline);
  const relative = excess / Math.max(0.05, baseline);
  // Keep a small absolute component so a profile with one uniformly weak
  // target still produces a useful diagnostic instead of a flat zero list.
  return clamp(relative, 0, 1) * 0.75 + errorRate * 0.25;
}

function relativeLatencySignal(latencyMs: number, baseline: number): number {
  if (latencyMs <= 0 || baseline <= 0) return 0;
  return clamp((latencyMs - baseline) / Math.max(100, baseline), 0, 1);
}

export function rankTargets(profile: TrainingProfile): RankedTarget[] {
  const ranked: RankedTarget[] = [];
  const keyEntries = Object.entries(profile.keys);
  const pairEntries = Object.entries(profile.pairs);
  const keyBaseline = baselineFor(keyEntries, MIN_KEY_ATTEMPTS);
  const pairBaseline = baselineFor(pairEntries, MIN_PAIR_ATTEMPTS);

  for (const [target, stat] of keyEntries) {
    if (stat.attempts < MIN_KEY_ATTEMPTS) continue;
    const errorRate = stat.errors / stat.attempts;
    const latencyMs =
      stat.latencySamples === 0 ? 0 : stat.totalLatency / stat.latencySamples;
    const errorSignal = relativeErrorSignal(errorRate, keyBaseline.errorRate);
    const latencySignal = relativeLatencySignal(
      latencyMs,
      keyBaseline.latencyMs,
    );
    ranked.push({
      target,
      kind: "key",
      accuracy: 1 - errorRate,
      latencyMs,
      attempts: stat.attempts,
      score: 0.7 * errorSignal + 0.3 * latencySignal,
    });
  }

  for (const [target, stat] of pairEntries) {
    if (stat.attempts < MIN_PAIR_ATTEMPTS) continue;
    const errorRate = stat.errors / stat.attempts;
    const latencyMs =
      stat.latencySamples === 0 ? 0 : stat.totalLatency / stat.latencySamples;
    const errorSignal = relativeErrorSignal(errorRate, pairBaseline.errorRate);
    const latencySignal = relativeLatencySignal(
      latencyMs,
      pairBaseline.latencyMs,
    );
    ranked.push({
      target,
      kind: "pair",
      accuracy: 1 - errorRate,
      latencyMs,
      attempts: stat.attempts,
      score: 0.7 * errorSignal + 0.3 * latencySignal,
    });
  }

  return ranked
    .filter((target) => target.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.accuracy !== left.accuracy) {
        return left.accuracy - right.accuracy;
      }
      if (right.attempts !== left.attempts) {
        return right.attempts - left.attempts;
      }
      if (left.kind !== right.kind) return left.kind === "pair" ? -1 : 1;
      return left.target.localeCompare(right.target);
    });
}

function uniqueWords(words: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const word of words) {
    if (word.length === 0 || seen.has(word)) continue;
    seen.add(word);
    result.push(word);
  }
  return result;
}

function randomIndex(random: () => number, length: number): number {
  if (length <= 1) return 0;
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}

function pickWord(
  pool: string[],
  fallback: string[],
  previous: string | undefined,
  random: () => number,
): string | undefined {
  const options = pool.length > 0 ? pool : fallback;
  if (options.length === 0) return undefined;

  const start = randomIndex(random, options.length);
  for (let offset = 0; offset < options.length; offset++) {
    const candidate = options[(start + offset) % options.length];
    if (candidate !== previous) return candidate;
  }

  // A one-word target pool can still avoid a repeat by borrowing a common
  // word. If the entire dictionary has one word, repeating is unavoidable.
  const fallbackOptions = fallback.filter(
    (candidate) => candidate !== previous,
  );
  if (fallbackOptions.length > 0) {
    return fallbackOptions[randomIndex(random, fallbackOptions.length)];
  }
  return options[start] ?? options[0];
}

/**
 * Builds a short drill from existing language words. Target slots are about
 * 70% of the result; the remaining slots sample the whole word list for
 * coverage. If no word contains a requested target, all slots gracefully use
 * the common pool.
 */
export function generateDrill(
  words: string[],
  targets: string[],
  count: number,
  random: () => number = Math.random,
): string[] {
  const candidates = uniqueWords(words);
  if (candidates.length === 0 || count <= 0) return [];

  const normalizedTargets = [
    ...new Set(targets.filter((target) => target.length > 0)),
  ];
  const targetPools = normalizedTargets
    .map((target) => ({
      target,
      words: candidates.filter((word) => word.includes(target)),
    }))
    .filter((pool) => pool.words.length > 0);
  const targetSlots =
    targetPools.length === 0
      ? 0
      : Math.min(count, Math.max(Math.round(count * 0.7), targetPools.length));
  const result: string[] = [];
  let targetSlotNumber = 0;

  for (let index = 0; index < count; index++) {
    const isTargetSlot =
      targetSlots > 0 &&
      Math.round(((index + 1) * targetSlots) / count) >
        Math.round((index * targetSlots) / count);
    const targetPool =
      targetPools.length === 0
        ? undefined
        : targetPools[targetSlotNumber % targetPools.length];
    const primary =
      isTargetSlot && targetPool !== undefined ? targetPool.words : candidates;
    if (isTargetSlot) targetSlotNumber++;
    const selected = pickWord(primary, candidates, result.at(-1), random);
    if (selected !== undefined) result.push(selected);
  }

  return result;
}

function mergeStat(
  existing: Stat | undefined,
  incoming: Stat | undefined,
): Stat {
  const oldStat =
    existing === undefined
      ? EMPTY_STAT()
      : (boundedStat(existing) ?? EMPTY_STAT());
  const newStat =
    incoming === undefined
      ? EMPTY_STAT()
      : (boundedStat(incoming) ?? EMPTY_STAT());
  const attempts = Math.min(
    MAX_STAT_VALUE,
    oldStat.attempts * MERGE_DECAY + newStat.attempts,
  );
  const errors = Math.min(
    attempts,
    oldStat.errors * MERGE_DECAY + newStat.errors,
  );
  const latencySamples = Math.min(
    attempts,
    MAX_STAT_VALUE,
    oldStat.latencySamples * MERGE_DECAY + newStat.latencySamples,
  );
  const totalLatency = Math.min(
    latencySamples * MAX_LATENCY_MS,
    oldStat.totalLatency * MERGE_DECAY + newStat.totalLatency,
  );

  return { attempts, errors, totalLatency, latencySamples };
}

function cloneProfile(profile: TrainingProfile): TrainingProfile {
  const normalized = createProfile();
  normalized.keys = cloneStats(profile.keys);
  normalized.pairs = cloneStats(profile.pairs);
  normalized.sessions = profile.sessions
    .map((summary) => boundedSummary(summary))
    .filter((summary): summary is SessionSummary => summary !== null)
    .slice(-MAX_SESSIONS)
    .map(cloneSummary);
  return normalized;
}

function mergeStats(
  destination: Record<string, Stat>,
  incoming: Record<string, Stat>,
): void {
  const targets = new Set([
    ...Object.keys(destination),
    ...Object.keys(incoming),
  ]);
  for (const target of targets) {
    setOwn(
      destination,
      target,
      mergeStat(destination[target], incoming[target]),
    );
  }
}

export function mergeSession(
  profile: TrainingProfile,
  sessionProfile: TrainingProfile,
  summary: SessionSummary,
): TrainingProfile {
  const merged = cloneProfile(profile);
  const session = cloneProfile(sessionProfile);
  mergeStats(merged.keys, session.keys);
  mergeStats(merged.pairs, session.pairs);

  const bounded = boundedSummary(summary);
  if (bounded !== null) {
    merged.sessions.push(bounded);
    merged.sessions = merged.sessions.slice(-MAX_SESSIONS).map(cloneSummary);
  }
  return merged;
}

export function parseProfile(raw: string | null): TrainingProfile {
  if (raw === null || raw.length === 0 || raw.length > 1_000_000) {
    return createProfile();
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return createProfile();
    }
    const candidate = parsed as Partial<TrainingProfile>;
    if (candidate.version !== PROFILE_VERSION) return createProfile();

    const profile = createProfile();
    if (typeof candidate.keys === "object" && candidate.keys !== null) {
      profile.keys = cloneStats(candidate.keys);
    }
    if (typeof candidate.pairs === "object" && candidate.pairs !== null) {
      profile.pairs = cloneStats(candidate.pairs);
    }
    if (Array.isArray(candidate.sessions)) {
      profile.sessions = candidate.sessions
        .map((summary) => boundedSummary(summary))
        .filter((summary): summary is SessionSummary => summary !== null)
        .slice(-MAX_SESSIONS)
        .map(cloneSummary);
    }

    // Bound map size after validation. Keep the most observed targets, which
    // preserves the useful part of a malformed or oversized local payload.
    profile.keys = capStats(profile.keys);
    profile.pairs = capStats(profile.pairs);
    return profile;
  } catch {
    return createProfile();
  }
}

function capStats(stats: Record<string, Stat>): Record<string, Stat> {
  const entries = Object.entries(stats)
    .sort(([, left], [, right]) => {
      const leftEvidence = left.attempts + left.latencySamples;
      const rightEvidence = right.attempts + right.latencySamples;
      return rightEvidence - leftEvidence;
    })
    .slice(0, MAX_TARGETS);
  const capped: Record<string, Stat> = {};
  for (const [target, stat] of entries) setOwn(capped, target, copyStat(stat));
  return capped;
}
