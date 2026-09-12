import { describe, expect, it } from "vitest";
import { generateDrill } from "../../src/ts/training/drill";

function phraseCount(drill: string[], first: string, second: string): number {
  let count = 0;
  for (let index = 1; index < drill.length; index++) {
    if (drill[index - 1] === first && drill[index] === second) count++;
  }
  return count;
}

describe("generateDrill word pairs", () => {
  it("keeps an exact phrase adjacent and returns the requested word count", () => {
    const drill = generateDrill(
      ["the", "quick", "brown", "fox", "jumps"],
      ["quick brown"],
      25,
      () => 0,
    );

    expect(drill).toHaveLength(25);
    expect(phraseCount(drill, "quick", "brown")).toBeGreaterThan(0);
    expect(drill.every((word) => !/\s/.test(word))).toBe(true);
  });

  it("rotates phrase and letter target pools in a mixed drill", () => {
    const drill = generateDrill(
      ["aa", "quick", "brown", "the", "other", "fox", "dog"],
      ["aa", "quick brown"],
      50,
      () => 0.25,
    );

    expect(drill).toHaveLength(50);
    expect(drill).toContain("aa");
    expect(phraseCount(drill, "quick", "brown")).toBeGreaterThan(0);
  });

  it("uses the common pool for an invalid or unknown phrase", () => {
    const words = ["cat", "dog"];
    const drill = generateDrill(
      words,
      ["cat dog!", "missing words"],
      6,
      () => 0,
    );

    expect(drill).toHaveLength(6);
    expect(drill.every((word) => words.includes(word))).toBe(true);
    expect(drill.every((word) => !/\s/.test(word))).toBe(true);
  });

  it("does not split a phrase when only one word slot remains", () => {
    const drill = generateDrill(
      ["had", "word", "else"],
      ["had word"],
      1,
      () => 0,
    );

    expect(drill).toHaveLength(1);
    expect(phraseCount(drill, "had", "word")).toBe(0);
    expect(drill.every((word) => !/\s/.test(word))).toBe(true);
  });

  it("retains an explicit repeated-word pair", () => {
    const drill = generateDrill(
      ["had", "word", "else"],
      ["had had"],
      5,
      () => 0,
    );

    expect(drill).toHaveLength(5);
    expect(phraseCount(drill, "had", "had")).toBeGreaterThan(0);
  });

  it("terminates safely for non-finite counts", () => {
    const words = ["had", "word", "else"];

    expect(generateDrill(words, ["had word"], Number.NaN, () => 0)).toEqual([]);
    expect(
      generateDrill(words, ["had word"], Number.POSITIVE_INFINITY, () => 0),
    ).toEqual([]);
  });
});
