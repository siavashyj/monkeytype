import { englishFrequencyMultiplier } from "./frequency";

export { generateDrill } from "./drill";

export const PROFILE_VERSION = 1 as const;

const MIN_KEY_ATTEMPTS = 5;
const MIN_PAIR_ATTEMPTS = 3;
const MIN_TRIPLE_ATTEMPTS = 3;
const MIN_QUAD_ATTEMPTS = 3;
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

export type WordPairStat = Stat & { occurrences: number };

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
  triples: Record<string, Stat>;
  quads: Record<string, Stat>;
  wordPairs: Record<string, WordPairStat>;
  sessions: SessionSummary[];
};

export type Attempt = {
  expected: string;
  actual: string;
  previous?: string;
  previousTwo?: string;
  previousThree?: string;
  latencyMs?: number;
};

export type RankedTarget = {
  target: string;
  kind: "key" | "pair" | "triple" | "quad" | "wordPair";
  accuracy: number;
  latencyMs: number;
  attempts: number;
  score: number;
  frequencyMultiplier: number;
  occurrences?: number;
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
  return typeof value === "string" && TRAINING_LETTER.test(value);
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

function tripleTarget(
  previousTwo: string | undefined,
  previous: string | undefined,
  expected: string,
): string | null {
  if (
    previousTwo === undefined ||
    !/^[a-z]{2}$/.test(previousTwo) ||
    !isTrainingLetter(expected)
  ) {
    return null;
  }
  if (
    previous !== undefined &&
    (!isTrainingLetter(previous) || !previousTwo.endsWith(previous))
  ) {
    return null;
  }
  return `${previousTwo}${expected}`;
}

function quadTarget(attempt: Attempt): string | null {
  const { previousThree, previousTwo, previous, expected } = attempt;
  if (
    previousThree === undefined ||
    !/^[a-z]{3}$/.test(previousThree) ||
    !isTrainingLetter(expected) ||
    (previousTwo !== undefined && previousTwo !== previousThree.slice(-2)) ||
    (previous !== undefined && previous !== previousThree.slice(-1))
  ) {
    return null;
  }
  return `${previousThree}${expected}`;
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
    triples: {},
    quads: {},
    wordPairs: {},
    sessions: [],
  };
}

/**
 * Records one expected target. `errors` is intentionally based on the raw
 * expected/actual comparison, so corrections still count as errors. The UI
 * decides whether `previous`, `previousTwo`, and `previousThree` match the
 * neighboring characters. Each sequence uses the same
 * final transition latency recorded for its terminal character, rather than
 * the duration of the whole sequence.
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

  const triple = tripleTarget(
    attempt.previousTwo,
    attempt.previous,
    attempt.expected,
  );
  if (triple !== null) {
    recordInto(statFor(profile.triples, triple), isError, attempt.latencyMs);
  }

  const quad = quadTarget(attempt);
  if (quad !== null) {
    recordInto(statFor(profile.quads, quad), isError, attempt.latencyMs);
  }
}

export function isWordPairTarget(target: string): boolean {
  return /^[a-z]{1,30} [a-z]{1,30}$/.test(target);
}

export function recordWordPairAttempt(
  profile: TrainingProfile,
  attempt: {
    target: string;
    expected: string;
    actual: string;
    latencyMs?: number;
    completed: boolean;
  },
): void {
  if (!isWordPairTarget(attempt.target) || !/^[a-z ]$/.test(attempt.expected)) {
    return;
  }
  const stat = profile.wordPairs[attempt.target] ?? {
    ...EMPTY_STAT(),
    occurrences: 0,
  };
  recordInto(stat, attempt.expected !== attempt.actual, attempt.latencyMs);
  if (attempt.completed) {
    stat.occurrences = Math.min(MAX_STAT_VALUE, stat.occurrences + 1);
  }
  profile.wordPairs[attempt.target] = stat;
}

function cloneWordPairs(input: unknown): Record<string, WordPairStat> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }
  const result: Record<string, WordPairStat> = {};
  const entries: [string, WordPairStat][] = [];
  for (const [target, value] of Object.entries(input)) {
    if (!isWordPairTarget(target)) continue;
    const stat = boundedStat(value);
    if (!stat) continue;
    const occurrences = clamp(
      finiteOr((value as Partial<WordPairStat>).occurrences, 0),
      0,
      stat.attempts,
    );
    entries.push([target, { ...stat, occurrences }]);
  }
  entries.sort(
    ([, left], [, right]) =>
      right.occurrences - left.occurrences || right.attempts - left.attempts,
  );
  for (const [target, stat] of entries.slice(0, MAX_TARGETS)) {
    result[target] = stat;
  }
  return result;
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

export function rankTargets(
  profile: TrainingProfile,
  frequencyMultiplierFor: (
    target: string,
  ) => number = englishFrequencyMultiplier,
): RankedTarget[] {
  const ranked: Omit<RankedTarget, "frequencyMultiplier">[] = [];
  const keyEntries = Object.entries(profile.keys);
  const pairEntries = Object.entries(profile.pairs);
  const tripleEntries = Object.entries(profile.triples ?? {});
  const quadEntries = Object.entries(profile.quads ?? {});
  const keyBaseline = baselineFor(keyEntries, MIN_KEY_ATTEMPTS);
  const pairBaseline = baselineFor(pairEntries, MIN_PAIR_ATTEMPTS);
  const tripleBaseline = baselineFor(tripleEntries, MIN_TRIPLE_ATTEMPTS);
  const quadBaseline = baselineFor(quadEntries, MIN_QUAD_ATTEMPTS);

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

  for (const [target, stat] of tripleEntries) {
    if (stat.attempts < MIN_TRIPLE_ATTEMPTS) continue;
    const errorRate = stat.errors / stat.attempts;
    const latencyMs =
      stat.latencySamples === 0 ? 0 : stat.totalLatency / stat.latencySamples;
    const errorSignal = relativeErrorSignal(
      errorRate,
      tripleBaseline.errorRate,
    );
    const latencySignal = relativeLatencySignal(
      latencyMs,
      tripleBaseline.latencyMs,
    );
    ranked.push({
      target,
      kind: "triple",
      accuracy: 1 - errorRate,
      latencyMs,
      attempts: stat.attempts,
      score: 0.7 * errorSignal + 0.3 * latencySignal,
    });
  }

  for (const [target, stat] of quadEntries) {
    if (stat.attempts < MIN_QUAD_ATTEMPTS) continue;
    const errorRate = stat.errors / stat.attempts;
    const latencyMs =
      stat.latencySamples === 0 ? 0 : stat.totalLatency / stat.latencySamples;
    const errorSignal = relativeErrorSignal(errorRate, quadBaseline.errorRate);
    const latencySignal = relativeLatencySignal(
      latencyMs,
      quadBaseline.latencyMs,
    );
    ranked.push({
      target,
      kind: "quad",
      accuracy: 1 - errorRate,
      latencyMs,
      attempts: stat.attempts,
      score: 0.7 * errorSignal + 0.3 * latencySignal,
    });
  }

  const wordPairEntries = Object.entries(profile.wordPairs ?? {}).filter(
    ([, stat]) => stat.occurrences >= 3,
  );
  const wordPairBaseline = baselineFor(wordPairEntries, 1);
  for (const [target, stat] of wordPairEntries) {
    if (stat.attempts <= 0) continue;
    const errorRate = stat.errors / stat.attempts;
    const latencyMs =
      stat.latencySamples === 0 ? 0 : stat.totalLatency / stat.latencySamples;
    ranked.push({
      target,
      kind: "wordPair",
      accuracy: 1 - errorRate,
      latencyMs,
      attempts: stat.attempts,
      occurrences: stat.occurrences,
      score:
        0.7 * relativeErrorSignal(errorRate, wordPairBaseline.errorRate) +
        0.3 * relativeLatencySignal(latencyMs, wordPairBaseline.latencyMs),
    });
  }

  return ranked
    .filter((target) => target.score > 0)
    .map((target) => {
      const frequencyMultiplier = clamp(
        target.kind === "wordPair"
          ? 1
          : finiteOr(frequencyMultiplierFor(target.target), 1),
        1,
        2,
      );
      return {
        ...target,
        frequencyMultiplier,
        score: target.score * frequencyMultiplier,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.accuracy !== left.accuracy) {
        return left.accuracy - right.accuracy;
      }
      if (right.attempts !== left.attempts) {
        return right.attempts - left.attempts;
      }
      if (left.kind !== right.kind) {
        const kindOrder: Record<RankedTarget["kind"], number> = {
          wordPair: -1,
          quad: 0,
          triple: 1,
          pair: 2,
          key: 3,
        };
        return kindOrder[left.kind] - kindOrder[right.kind];
      }
      return left.target.localeCompare(right.target);
    });
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
  normalized.triples = cloneStats(profile.triples ?? {});
  normalized.quads = cloneStats(profile.quads ?? {});
  normalized.wordPairs = cloneWordPairs(profile.wordPairs);
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
  mergeStats(merged.triples, session.triples);
  mergeStats(merged.quads, session.quads);
  for (const target of new Set([
    ...Object.keys(merged.wordPairs),
    ...Object.keys(session.wordPairs),
  ])) {
    const previous = merged.wordPairs[target];
    const incoming = session.wordPairs[target];
    merged.wordPairs[target] = {
      ...mergeStat(previous, incoming),
      occurrences: Math.min(
        MAX_STAT_VALUE,
        (previous?.occurrences ?? 0) * MERGE_DECAY +
          (incoming?.occurrences ?? 0),
      ),
    };
  }
  merged.wordPairs = cloneWordPairs(merged.wordPairs);

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
    profile.wordPairs = cloneWordPairs(candidate.wordPairs);
    if (typeof candidate.keys === "object" && candidate.keys !== null) {
      profile.keys = cloneStats(candidate.keys);
    }
    if (typeof candidate.pairs === "object" && candidate.pairs !== null) {
      profile.pairs = cloneStats(candidate.pairs);
    }
    if (
      typeof candidate.triples === "object" &&
      candidate.triples !== null &&
      !Array.isArray(candidate.triples)
    ) {
      profile.triples = cloneStats(candidate.triples);
    }
    if (
      typeof candidate.quads === "object" &&
      candidate.quads !== null &&
      !Array.isArray(candidate.quads)
    ) {
      profile.quads = cloneStats(candidate.quads);
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
    profile.triples = capStats(profile.triples);
    profile.quads = capStats(profile.quads);
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
