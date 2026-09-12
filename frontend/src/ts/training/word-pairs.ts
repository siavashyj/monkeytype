import { recordWordPairAttempt, type TrainingProfile } from "./engine";

type PairRange = { target: string; start: number; end: number };

/** Precompute overlapping adjacent word pairs once per drill, not on each key. */
export function createWordPairTracker(
  text: string,
): (
  profile: TrainingProfile,
  index: number,
  actual: string,
  latencyMs?: number,
) => void {
  const words = [...text.matchAll(/[a-z]+/g)];
  const positions: PairRange[][] = Array.from(
    { length: text.length },
    () => [],
  );
  const completed = new Set<number>();
  for (let i = 1; i < words.length; i++) {
    const first = words[i - 1];
    const second = words[i];
    if (!first || !second) continue;
    if (text.slice(first.index + first[0].length, second.index) !== " ") {
      continue;
    }
    const range = {
      target: `${first[0]} ${second[0]}`,
      start: first.index,
      end: second.index + second[0].length,
    };
    for (let index = range.start; index < range.end; index++) {
      positions[index]?.push(range);
    }
  }
  return (profile, index, actual, latencyMs): void => {
    for (const pair of positions[index] ?? []) {
      const newlyCompleted =
        index === pair.end - 1 && !completed.has(pair.start);
      if (newlyCompleted) completed.add(pair.start);
      recordWordPairAttempt(profile, {
        target: pair.target,
        expected: text[index] as string,
        actual,
        latencyMs: index > pair.start ? latencyMs : undefined,
        completed: newlyCompleted,
      });
    }
  };
}
