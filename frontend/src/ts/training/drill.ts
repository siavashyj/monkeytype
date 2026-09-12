const PHRASE_TARGET = /^[a-z]+ [a-z]+$/;

type DrillTargetPool = {
  target: string;
  words: string[];
  phrase: boolean;
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
      const size = pool.phrase ? 2 : 1;
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
    (sum, pool) => sum + (pool.phrase ? 2 : 1),
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
    if (event.phrase) {
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
 * Builds a drill from words and letter/phrase targets. Letter targets keep
 * the legacy substring behavior. A valid phrase is emitted as its two exact
 * words, never as one token containing a space.
 */
export function generateDrill(
  words: string[],
  targets: string[],
  count: number,
  random: () => number = Math.random,
): string[] {
  const allCandidates = uniqueWords(words);
  if (allCandidates.length === 0 || count <= 0) return [];

  const normalizedTargets = [
    ...new Set(targets.filter((target) => target.length > 0)),
  ];
  const { plain, phrases } = targetPoolsFor(
    allCandidates.filter((word) => !/\s/.test(word)),
    normalizedTargets,
  );

  // Keep the old algorithm and random-call sequence untouched when no
  // recognized phrase can participate. Unknown/invalid phrases are common
  // pool targets by design.
  if (phrases.length === 0) {
    return generateLegacyDrill(
      allCandidates,
      normalizedTargets.filter((target) => !/\s/.test(target)),
      count,
      random,
    );
  }

  // Keep malformed numeric counts from entering the phrase scheduler. The
  // legacy branch above intentionally retains its existing loop behavior.
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (safeCount === 0) return [];
  const phraseCandidates = allCandidates.filter((word) => !/\s/.test(word));
  return generatePhraseDrill(
    phraseCandidates,
    [...plain, ...phrases],
    safeCount,
    random,
  );
}
