const PHRASE_TARGET = /^[a-z]+ [a-z]+$/;
const SEQUENCE_TARGET = /^[a-z ]{2,4}$/;

export type DrillTargetKind = "key" | "pair" | "triple" | "quad" | "wordPair";

export type DrillTarget = Readonly<{
  target: string;
  kind: DrillTargetKind;
}>;

type DrillTargetInput = string | DrillTarget;

type SequencePattern = {
  parts: string[];
  candidates: string[][];
};

type DrillTargetPool = {
  target: string;
  words: string[];
  phrase: boolean;
  sequence?: SequencePattern;
};

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

function sequenceLengthFor(kind: DrillTargetKind): number | undefined {
  switch (kind) {
    case "key":
      return 1;
    case "pair":
      return 2;
    case "triple":
      return 3;
    case "quad":
      return 4;
    default:
      return undefined;
  }
}

function isSequenceTarget(target: string, kind: DrillTargetKind): boolean {
  const length = sequenceLengthFor(kind);
  if (length === undefined || target.length !== length) return false;
  if (kind === "key") return /^[a-z]$/.test(target);
  return (
    SEQUENCE_TARGET.test(target) &&
    /[a-z]/.test(target) &&
    !target.includes("  ")
  );
}

function isTypedTarget(value: DrillTargetInput): value is DrillTarget {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof value.target === "string" &&
    (value.kind === "key" ||
      value.kind === "pair" ||
      value.kind === "triple" ||
      value.kind === "quad" ||
      value.kind === "wordPair")
  );
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

function pickCommonWord(
  candidates: string[],
  previous: string | undefined,
  random: () => number,
  forbidden: string | undefined,
): string | undefined {
  if (forbidden === undefined) {
    return pickWord(candidates, candidates, previous, random);
  }

  const options = candidates.filter(
    (candidate) => candidate !== previous && candidate !== forbidden,
  );
  if (options.length > 0) {
    return options[randomIndex(random, options.length)];
  }
  return pickWord(candidates, candidates, previous, random);
}

function pickSequenceWords(
  pool: DrillTargetPool,
  previous: string | undefined,
  random: () => number,
  history: Map<DrillTargetPool, Set<string>[]>,
): string[] | undefined {
  const sequence = pool.sequence;
  if (sequence === undefined) return undefined;

  const used = history.get(pool) ?? sequence.candidates.map(() => new Set());
  history.set(pool, used);
  const result: string[] = [];
  let prior = previous;

  for (const [index, candidates] of sequence.candidates.entries()) {
    const withoutPrevious = candidates.filter(
      (candidate) => candidate !== prior,
    );
    const options = withoutPrevious.length > 0 ? withoutPrevious : candidates;
    if (options.length === 0) return undefined;

    const seen = used[index] ?? new Set<string>();
    used[index] = seen;
    const unseen = options.filter((candidate) => !seen.has(candidate));
    const choices = unseen.length > 0 ? unseen : options;
    const selected = choices[randomIndex(random, choices.length)];
    if (selected === undefined) return undefined;
    result.push(selected);
    seen.add(selected);
    if (seen.size >= candidates.length) seen.clear();
    prior = selected;
  }

  return result;
}

function generateLegacyDrill(
  candidates: string[],
  targets: string[],
  count: number,
  random: () => number,
): string[] {
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

function targetPoolsFor(
  candidates: string[],
  targets: string[],
): { plain: DrillTargetPool[]; phrases: DrillTargetPool[] } {
  const vocabulary = new Set(candidates);
  const plain: DrillTargetPool[] = [];
  const phrases: DrillTargetPool[] = [];

  for (const target of targets) {
    if (target.length === 0) continue;
    if (PHRASE_TARGET.test(target)) {
      const [first, second] = target.split(" ");
      // Phrase targets are exact pairs of vocabulary entries. A missing word
      // deliberately leaves the target out of the focused pools.
      if (
        first !== undefined &&
        second !== undefined &&
        vocabulary.has(first) &&
        vocabulary.has(second)
      ) {
        phrases.push({ target, words: [first, second], phrase: true });
      }
      continue;
    }

    // Targets containing whitespace are malformed phrase targets. They fall
    // back to the common pool instead of becoming substring targets.
    if (/\s/.test(target)) continue;
    const targetWords = candidates.filter((word) => word.includes(target));
    if (targetWords.length > 0) {
      plain.push({ target, words: targetWords, phrase: false });
    }
  }

  return { plain, phrases };
}

function sequencePartCandidates(
  candidates: string[],
  parts: string[],
): string[][] | undefined {
  const result = parts.map((part, index) => {
    if (parts.length === 1) {
      return candidates.filter((word) => word.includes(part));
    }
    if (index === 0) return candidates.filter((word) => word.endsWith(part));
    if (index === parts.length - 1) {
      return candidates.filter((word) => word.startsWith(part));
    }
    return candidates.filter((word) => word === part);
  });
  return result.every((part) => part.length > 0) ? result : undefined;
}

function sequencePoolFor(
  candidates: string[],
  target: DrillTarget,
): DrillTargetPool | undefined {
  if (!isSequenceTarget(target.target, target.kind)) return undefined;
  const parts = target.target.split(" ");
  const candidateParts = sequencePartCandidates(candidates, parts);
  if (candidateParts === undefined) return undefined;
  return {
    target: target.target,
    words: [],
    phrase: false,
    sequence: { parts, candidates: candidateParts },
  };
}

function wordPairPoolFor(
  candidates: string[],
  target: DrillTarget,
): DrillTargetPool | undefined {
  if (target.kind !== "wordPair" || !PHRASE_TARGET.test(target.target)) {
    return undefined;
  }
  const [first, second] = target.target.split(" ");
  if (
    first === undefined ||
    second === undefined ||
    !candidates.includes(first) ||
    !candidates.includes(second)
  ) {
    return undefined;
  }
  return { target: target.target, words: [first, second], phrase: true };
}

function poolWordCount(pool: DrillTargetPool): number {
  if (pool.sequence !== undefined) return pool.sequence.parts.length;
  return pool.phrase ? 2 : 1;
}

function targetEvents(
  pools: DrillTargetPool[],
  targetBudget: number,
  count: number,
): DrillTargetPool[] {
  const events: DrillTargetPool[] = [];
  if (pools.length === 0 || targetBudget <= 0) return events;

  let poolIndex = 0;
  let targetWords = 0;
  while (true) {
    let selected = false;
    for (let offset = 0; offset < pools.length; offset++) {
      const pool = pools[(poolIndex + offset) % pools.length];
      if (pool === undefined) continue;
      const size = poolWordCount(pool);
      if (targetWords + size > targetBudget || targetWords + size > count) {
        continue;
      }
      events.push(pool);
      targetWords += size;
      poolIndex = (poolIndex + offset + 1) % pools.length;
      selected = true;
      break;
    }
    if (!selected) break;
  }
  return events;
}

function generatePhraseDrill(
  candidates: string[],
  pools: DrillTargetPool[],
  count: number,
  random: () => number,
): string[] {
  if (candidates.length === 0 || count <= 0) return [];

  const targetBudget = Math.min(
    count,
    Math.max(Math.round(count * 0.7), pools.length),
  );
  const events = targetEvents(pools, targetBudget, count);
  if (events.length === 0) {
    const result: string[] = [];
    while (result.length < count) {
      const selected = pickWord(candidates, candidates, result.at(-1), random);
      if (selected === undefined) break;
      result.push(selected);
    }
    return result;
  }

  const targetWordCount = events.reduce(
    (sum, pool) => sum + poolWordCount(pool),
    0,
  );
  const commonWordCount = count - targetWordCount;
  // There is one common-word gap before, between, and after target events.
  // Rounding the cumulative shares keeps the gaps balanced for odd counts.
  const gaps = Array.from(
    { length: events.length + 1 },
    (_, index) =>
      Math.round(((index + 1) * commonWordCount) / (events.length + 1)) -
      Math.round((index * commonWordCount) / (events.length + 1)),
  );
  const result: string[] = [];
  const sequenceHistory = new Map<DrillTargetPool, Set<string>[]>();

  for (let eventIndex = 0; eventIndex <= events.length; eventIndex++) {
    const event = events[eventIndex];
    let gap = gaps[eventIndex] ?? 0;
    // A phrase may share its first word with the previous unit (for example
    // `foo bar` followed by `bar baz`). If a common slot is available later,
    // move it here to avoid an accidental boundary duplicate. An explicit
    // repeated pair such as `had had` is left intact.
    if (
      event?.phrase &&
      event.words[0] !== undefined &&
      event.words[0] !== event.words[1] &&
      result.at(-1) === event.words[0] &&
      gap === 0
    ) {
      const donor = gaps.findIndex(
        (available, index) => index > eventIndex && available > 0,
      );
      if (donor >= 0) {
        gaps[donor] = (gaps[donor] ?? 0) - 1;
        gap++;
      }
    }
    for (let gapIndex = 0; gapIndex < gap; gapIndex++) {
      const forbidden =
        gapIndex === gap - 1 && event?.phrase ? event.words[0] : undefined;
      const selected = pickCommonWord(
        candidates,
        result.at(-1),
        random,
        forbidden,
      );
      if (selected !== undefined) result.push(selected);
    }

    if (event === undefined) continue;
    if (event.sequence !== undefined) {
      const selected = pickSequenceWords(
        event,
        result.at(-1),
        random,
        sequenceHistory,
      );
      if (selected !== undefined) result.push(...selected);
    } else if (event.phrase) {
      // Keep the pair together, including an intentional `had had` pair.
      const first = event.words[0];
      const second = event.words[1];
      if (first === undefined || second === undefined) continue;
      result.push(first, second);
    } else {
      const selected = pickWord(event.words, candidates, result.at(-1), random);
      if (selected !== undefined) result.push(selected);
    }
  }

  return result;
}

/**
 * Builds a drill from words and letter/sequence/phrase targets. String
 * targets retain their legacy substring and exact-phrase behavior. Typed
 * sequence targets may contain spaces and are emitted as adjacent words.
 */
export function generateDrill(
  words: string[],
  targets: readonly DrillTargetInput[],
  count: number,
  random: () => number = Math.random,
): string[] {
  const allCandidates = uniqueWords(words);
  if (allCandidates.length === 0 || count <= 0 || !Number.isFinite(count)) {
    return [];
  }

  const stringTargets = [
    ...new Set(
      targets.filter(
        (target): target is string =>
          typeof target === "string" && target.length > 0,
      ),
    ),
  ];
  const typedTargets = [
    ...new Map(
      targets
        .filter(isTypedTarget)
        .filter((target) => target.target.length > 0)
        .map((target) => [`${target.kind}\u0000${target.target}`, target]),
    ).values(),
  ];
  const phraseCandidates = allCandidates.filter((word) => !/\s/.test(word));
  const { plain: stringPlain, phrases } = targetPoolsFor(
    phraseCandidates,
    stringTargets,
  );
  const typedPlainTargets = typedTargets
    .filter(
      (target) =>
        target.kind !== "wordPair" &&
        !target.target.includes(" ") &&
        isSequenceTarget(target.target, target.kind),
    )
    .map((target) => target.target);
  const { plain: typedPlainPools } = targetPoolsFor(
    phraseCandidates,
    typedPlainTargets,
  );
  const plain = [
    ...stringPlain,
    ...typedPlainPools.filter(
      (pool) =>
        !stringPlain.some((existing) => existing.target === pool.target),
    ),
  ];
  const typedSequencePools = typedTargets
    .filter(
      (target) => target.kind !== "wordPair" && target.target.includes(" "),
    )
    .map((target) => sequencePoolFor(phraseCandidates, target))
    .filter((pool): pool is DrillTargetPool => pool !== undefined);
  const typedPhrasePools = typedTargets
    .filter((target) => target.kind === "wordPair")
    .map((target) => wordPairPoolFor(phraseCandidates, target))
    .filter((pool): pool is DrillTargetPool => pool !== undefined)
    .filter((pool) => !phrases.some((phrase) => phrase.target === pool.target));

  const spacePools = [...typedPhrasePools, ...typedSequencePools];
  const legacyTargets = [
    ...stringTargets.filter((target) => !/\s/.test(target)),
    ...typedPlainTargets,
  ];

  // Keep the old algorithm and random-call sequence untouched when no
  // recognized space target can participate. Unknown/invalid phrases and
  // unsupported typed targets are common-pool inputs by design.
  if (phrases.length === 0 && spacePools.length === 0) {
    return generateLegacyDrill(allCandidates, legacyTargets, count, random);
  }

  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) return [];
  return generatePhraseDrill(
    phraseCandidates,
    [...plain, ...phrases, ...spacePools],
    safeCount,
    random,
  );
}
