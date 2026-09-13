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

describe("generateDrill space sequences", () => {
  const words = [
    "bake",
    "cake",
    "make",
    "alpha",
    "ape",
    "off",
    "often",
    "offer",
    "a",
    "be",
    "bike",
    "cat",
    "dog",
  ];

  it.each([25, 50])(
    "keeps e-space-of transitions together at count %i",
    (count) => {
      const drill = generateDrill(
        words,
        [{ target: "e of", kind: "quad" }],
        count,
        () => 0,
      );

      expect(drill).toHaveLength(count);
      expect(
        drill.filter(
          (word, index) =>
            word.endsWith("e") && (drill[index + 1]?.startsWith("of") ?? false),
        ),
      ).toHaveLength(Math.floor(Math.round(count * 0.7) / 2));
    },
  );

  it("matches leading and trailing boundary spaces", () => {
    const trailing = generateDrill(
      words,
      [{ target: "e ", kind: "pair" }],
      25,
      () => 0,
    );
    const leading = generateDrill(
      words,
      [{ target: " of", kind: "triple" }],
      25,
      () => 0,
    );

    expect(
      trailing.filter(
        (word, index) =>
          word.endsWith("e") && trailing[index + 1] !== undefined,
      ).length,
    ).toBeGreaterThanOrEqual(9);
    expect(
      leading.filter(
        (word, index) =>
          leading[index - 1] !== undefined && word.startsWith("of"),
      ).length,
    ).toBeGreaterThanOrEqual(9);
  });

  it("matches two spaces as three adjacent word parts", () => {
    const drill = generateDrill(
      words,
      [{ target: " a b", kind: "quad" }],
      25,
      () => 0,
    );

    let groups = 0;
    for (let index = 0; index + 2 < drill.length; index++) {
      if (drill[index + 1] === "a" && drill[index + 2]?.startsWith("b")) {
        groups++;
      }
    }
    expect(groups).toBeGreaterThanOrEqual(6);
  });

  it("keeps typed sequences distinct from exact typed word pairs", () => {
    const drill = generateDrill(
      ["alpha", "beta", "a", "b", "cat", "dog", "coda"],
      [
        { target: "a b", kind: "triple" },
        { target: "a b", kind: "wordPair" },
      ],
      50,
      () => 0,
    );

    expect(drill).toHaveLength(50);
    expect(phraseCount(drill, "a", "b")).toBeGreaterThan(0);
    expect(phraseCount(drill, "alpha", "beta")).toBeGreaterThan(0);
  });

  it("includes typed plain targets alongside space targets", () => {
    const drill = generateDrill(
      ["cat", "coat", "bake", "cake", "off", "often", "a", "b", "be", "dog"],
      [
        { target: "at", kind: "pair" },
        { target: "e of", kind: "quad" },
        { target: "a b", kind: "wordPair" },
      ],
      50,
      () => 0,
    );

    expect(drill).toHaveLength(50);
    expect(drill.filter((word) => word.includes("at")).length).toBeGreaterThan(
      0,
    );
    expect(phraseCount(drill, "a", "b")).toBeGreaterThan(0);
    expect(
      drill.some(
        (word, index) =>
          word.endsWith("e") && drill[index + 1]?.startsWith("of"),
      ),
    ).toBe(true);
  });

  it("falls back cleanly for unsupported or too-short space targets", () => {
    const words = ["cat", "dog", "bake", "off"];
    const unsupported = generateDrill(
      words,
      [{ target: "a  b", kind: "quad" }],
      25,
      () => 0,
    );
    const tooShort = generateDrill(
      words,
      [{ target: "e of", kind: "quad" }],
      1,
      () => 0,
    );

    expect(unsupported).toHaveLength(25);
    expect(tooShort).toHaveLength(1);
    expect(unsupported.every((word) => words.includes(word))).toBe(true);
    expect(tooShort.every((word) => words.includes(word))).toBe(true);
  });
});
