import { describe, expect, it } from "vitest";
import {
  createProfile,
  generateDrill,
  mergeSession,
  parseProfile,
  rankTargets,
  recordAttempt,
  type Stat,
  type SessionSummary,
} from "../../src/ts/training/engine";

function repeatAttempt(
  profile: ReturnType<typeof createProfile>,
  expected: string,
  actual: string,
  count: number,
  options: {
    previous?: string;
    previousTwo?: string;
    previousThree?: string;
    latencyMs?: number;
  } = {},
): void {
  for (let index = 0; index < count; index++) {
    recordAttempt(profile, {
      expected,
      actual,
      previous: options.previous,
      previousTwo: options.previousTwo,
      previousThree: options.previousThree,
      latencyMs: options.latencyMs,
    });
  }
}

const summary: SessionSummary = {
  date: 1_700_000_000_000,
  wpm: 72,
  accuracy: 0.96,
  targets: ["a", "th"],
  kind: "adaptive",
  characters: 240,
  durationMs: 120_000,
};

describe("recordAttempt", () => {
  it("counts every expected input and treats wrong attempts as errors", () => {
    const profile = createProfile();

    recordAttempt(profile, {
      expected: "a",
      actual: "x",
      latencyMs: 10,
    });
    recordAttempt(profile, {
      expected: "a",
      actual: "a",
      latencyMs: 30,
    });

    expect(profile.keys["a"]).toEqual({
      attempts: 2,
      errors: 1,
      totalLatency: 30,
      latencySamples: 1,
    });
  });

  it("records a pair against the expected neighboring characters", () => {
    const profile = createProfile();

    recordAttempt(profile, {
      expected: "b",
      actual: "x",
      previous: "a",
      latencyMs: 100,
    });
    recordAttempt(profile, {
      expected: "b",
      actual: "b",
      previous: "a",
      latencyMs: 100,
    });
    recordAttempt(profile, {
      expected: "b",
      actual: "b",
      previous: "",
      latencyMs: 100,
    });

    expect(profile.pairs["ab"]).toEqual({
      attempts: 2,
      errors: 1,
      totalLatency: 100,
      latencySamples: 1,
    });
    expect(profile.pairs["a"]).toBeUndefined();
  });

  it("records terminal trigram errors and rejects invalid or whitespace context", () => {
    const profile = createProfile();

    recordAttempt(profile, {
      expected: "c",
      actual: "x",
      previous: "b",
      previousTwo: "ab",
      latencyMs: 100,
    });
    recordAttempt(profile, {
      expected: "c",
      actual: "c",
      previous: "b",
      previousTwo: "ab",
      latencyMs: 100,
    });
    recordAttempt(profile, {
      expected: "d",
      actual: "d",
      previousTwo: "bc",
      latencyMs: 80,
    });
    recordAttempt(profile, {
      expected: "c",
      actual: "c",
      previous: "b",
      previousTwo: "a ",
      latencyMs: 100,
    });
    recordAttempt(profile, {
      expected: "c",
      actual: "c",
      previous: "a",
      previousTwo: "bc",
      latencyMs: 100,
    });

    expect(profile.triples["abc"]).toEqual({
      attempts: 2,
      errors: 1,
      totalLatency: 100,
      latencySamples: 1,
    });
    expect(profile.triples["bcd"]).toEqual({
      attempts: 1,
      errors: 0,
      totalLatency: 80,
      latencySamples: 1,
    });
    expect(profile.triples["bcc"]).toBeUndefined();
  });

  it("records terminal quad errors with final-transition latency and rejects invalid context", () => {
    const profile = createProfile();

    recordAttempt(profile, {
      expected: "d",
      actual: "x",
      previous: "c",
      previousTwo: "bc",
      previousThree: "abc",
      latencyMs: 2_000,
    });
    recordAttempt(profile, {
      expected: "d",
      actual: "d",
      previous: "c",
      previousTwo: "bc",
      previousThree: "abc",
      latencyMs: 100,
    });
    recordAttempt(profile, {
      expected: "d",
      actual: "d",
      previous: "c",
      previousTwo: "bc",
      previousThree: "ab ",
      latencyMs: 100,
    });
    recordAttempt(profile, {
      expected: "d",
      actual: "d",
      previous: "x",
      previousTwo: "bc",
      previousThree: "abc",
      latencyMs: 100,
    });
    recordAttempt(profile, {
      expected: "d",
      actual: "d",
      previous: "c",
      previousTwo: "ac",
      previousThree: "abc",
      latencyMs: 100,
    });
    recordAttempt(profile, {
      expected: "d",
      actual: "d",
      previous: "c",
      previousTwo: "bc",
      previousThree: "Abc",
      latencyMs: 100,
    });
    recordAttempt(profile, {
      expected: "d",
      actual: "d",
      previous: "c",
      previousTwo: "bc",
      previousThree: "ab",
      latencyMs: 100,
    });

    expect(profile.quads["abcd"]).toEqual({
      attempts: 2,
      errors: 1,
      totalLatency: 100,
      latencySamples: 1,
    });
  });

  it("accepts only bounded successful quad latency samples", () => {
    const profile = createProfile();

    for (const latencyMs of [29, 30, 2_000, 2_001, Number.NaN]) {
      recordAttempt(profile, {
        expected: "d",
        actual: "d",
        previous: "c",
        previousTwo: "bc",
        previousThree: "abc",
        latencyMs,
      });
    }

    expect(profile.quads["abcd"]).toEqual({
      attempts: 5,
      errors: 0,
      totalLatency: 2_030,
      latencySamples: 2,
    });
  });

  it("accepts only bounded latency samples", () => {
    const profile = createProfile();

    for (const latencyMs of [29, 30, 2_000, 2_001, Number.NaN]) {
      recordAttempt(profile, {
        expected: "a",
        actual: "a",
        latencyMs,
      });
    }

    expect(profile.keys["a"]).toEqual({
      attempts: 5,
      errors: 0,
      totalLatency: 2_030,
      latencySamples: 2,
    });
  });

  it("does not create a pair when no previous expected character is supplied", () => {
    const profile = createProfile();

    repeatAttempt(profile, "a", "a", 5);

    expect(profile.pairs).toEqual({});
  });

  it("limits training targets to lowercase letters", () => {
    const profile = createProfile();

    recordAttempt(profile, { expected: " ", actual: "x", previous: "a" });
    recordAttempt(profile, { expected: "A", actual: "x", previous: "a" });
    recordAttempt(profile, { expected: ".", actual: "x", previous: "a" });
    recordAttempt(profile, { expected: "b", actual: "x", previous: " " });

    expect(profile.keys["b"]).toEqual({
      attempts: 1,
      errors: 1,
      totalLatency: 0,
      latencySamples: 0,
    });
    expect(profile.pairs).toEqual({});
  });

  it("does not use error latency when measuring rhythm", () => {
    const profile = createProfile();

    recordAttempt(profile, { expected: "a", actual: "x", latencyMs: 2_000 });
    recordAttempt(profile, { expected: "a", actual: "a", latencyMs: 100 });

    expect(profile.keys["a"]).toEqual({
      attempts: 2,
      errors: 1,
      totalLatency: 100,
      latencySamples: 1,
    });
  });
});

describe("rankTargets", () => {
  it("requires minimum evidence before ranking keys or pairs", () => {
    const profile = createProfile();
    repeatAttempt(profile, "a", "x", 4, { latencyMs: 100 });
    repeatAttempt(profile, "b", "x", 5, { latencyMs: 100 });
    repeatAttempt(profile, "c", "c", 1, { previous: "a", latencyMs: 100 });

    expect(rankTargets(profile)).toEqual([
      expect.objectContaining({
        target: "b",
        kind: "key",
        attempts: 5,
        accuracy: 0,
      }),
    ]);
  });

  it("ranks error rate ahead of latency when both are present", () => {
    const profile = createProfile();
    repeatAttempt(profile, "a", "x", 2, { latencyMs: 100 });
    repeatAttempt(profile, "a", "a", 3, { latencyMs: 100 });
    repeatAttempt(profile, "b", "b", 5, { latencyMs: 100 });
    repeatAttempt(profile, "c", "c", 5, { latencyMs: 1_000 });

    const ranked = rankTargets(profile);
    expect(ranked[0]).toMatchObject({ target: "a", kind: "key" });
    expect(ranked.some((target) => target.target === "c")).toBe(true);
  });

  it("uses a user-specific latency baseline to expose a slow target", () => {
    const profile = createProfile();
    repeatAttempt(profile, "a", "a", 5, { latencyMs: 100 });
    repeatAttempt(profile, "b", "b", 5, { latencyMs: 500 });

    const ranked = rankTargets(profile);
    expect(ranked[0]).toMatchObject({ target: "b", latencyMs: 500 });
    expect((ranked[0]?.score ?? 0) > 0).toBe(true);
  });

  it("does not suggest a uniformly accurate, even profile", () => {
    const profile = createProfile();
    repeatAttempt(profile, "a", "a", 5, { latencyMs: 100 });
    repeatAttempt(profile, "b", "b", 5, { latencyMs: 100 });

    expect(rankTargets(profile)).toEqual([]);
  });

  it("ranks a pair after three observations and reports accuracy/latency", () => {
    const profile = createProfile();
    repeatAttempt(profile, "b", "x", 2, { previous: "a", latencyMs: 120 });
    repeatAttempt(profile, "b", "b", 1, { previous: "a", latencyMs: 120 });
    repeatAttempt(profile, "a", "a", 5, { latencyMs: 120 });
    repeatAttempt(profile, "c", "c", 5, { latencyMs: 120 });

    const pair = rankTargets(profile).find(
      (target) => target.kind === "pair" && target.target === "ab",
    );
    expect(pair).toMatchObject({
      target: "ab",
      kind: "pair",
      latencyMs: 120,
      attempts: 3,
    });
    expect(pair?.accuracy).toBeCloseTo(1 / 3);
  });

  it("requires three trigram observations and uses a separate trigram baseline", () => {
    const profile = createProfile();
    repeatAttempt(profile, "c", "x", 2, {
      previous: "b",
      previousTwo: "ab",
      latencyMs: 120,
    });

    expect(
      rankTargets(profile).some(
        (target) => target.kind === "triple" && target.target === "abc",
      ),
    ).toBe(false);

    repeatAttempt(profile, "c", "c", 1, {
      previous: "b",
      previousTwo: "ab",
      latencyMs: 120,
    });
    repeatAttempt(profile, "d", "d", 3, {
      previous: "b",
      previousTwo: "ab",
      latencyMs: 120,
    });
    profile.keys = {};
    profile.pairs = {};

    const triple = rankTargets(profile).find(
      (target) => target.kind === "triple" && target.target === "abc",
    );
    expect(triple).toMatchObject({
      target: "abc",
      kind: "triple",
      attempts: 3,
      latencyMs: 120,
    });
    expect(triple?.accuracy).toBeCloseTo(1 / 3);
  });

  it("requires three quad observations and uses a separate quad baseline", () => {
    const profile = createProfile();
    repeatAttempt(profile, "d", "x", 2, {
      previous: "c",
      previousTwo: "bc",
      previousThree: "abc",
      latencyMs: 120,
    });

    expect(
      rankTargets(profile).some(
        (target) => target.kind === "quad" && target.target === "abcd",
      ),
    ).toBe(false);

    repeatAttempt(profile, "d", "d", 1, {
      previous: "c",
      previousTwo: "bc",
      previousThree: "abc",
      latencyMs: 120,
    });
    repeatAttempt(profile, "e", "e", 3, {
      previous: "c",
      previousTwo: "bc",
      previousThree: "abc",
      latencyMs: 120,
    });
    profile.keys = {};
    profile.pairs = {};
    profile.triples = {};

    const quad = rankTargets(profile).find(
      (target) => target.kind === "quad" && target.target === "abcd",
    );
    expect(quad).toMatchObject({
      target: "abcd",
      kind: "quad",
      attempts: 3,
      latencyMs: 120,
    });
    expect(quad?.accuracy).toBeCloseTo(1 / 3);
  });

  it("orders equal-score target kinds deterministically", () => {
    const stat = (attempts: number, latencyMs: number): Stat => ({
      attempts,
      errors: 0,
      totalLatency: attempts * latencyMs,
      latencySamples: attempts,
    });
    const profile = createProfile();
    profile.keys = { a: stat(5, 100), b: stat(5, 200) };
    profile.pairs = { ab: stat(5, 100), cd: stat(5, 200) };
    profile.triples = { abc: stat(5, 100), def: stat(5, 200) };
    profile.quads = { abcd: stat(5, 100), efgh: stat(5, 200) };

    expect(rankTargets(profile).map((target) => target.kind)).toEqual([
      "quad",
      "triple",
      "pair",
      "key",
    ]);
  });
});

describe("generateDrill", () => {
  it("allocates about 70% of slots to target-containing words", () => {
    const words = ["cat", "dog", "the", "cog", "bat"];
    const drill = generateDrill(words, ["at"], 10, () => 0);
    const targetCount = drill.filter((word) => word.includes("at")).length;

    expect(drill).toHaveLength(10);
    expect(targetCount).toBeGreaterThanOrEqual(7);
    for (let index = 1; index < drill.length; index++) {
      expect(drill[index]).not.toBe(drill[index - 1]);
    }
  });

  it("falls back to the common pool for impossible targets", () => {
    const drill = generateDrill(["cat", "dog"], ["zz"], 6, () => 0);

    expect(drill).toHaveLength(6);
    expect(drill.every((word) => word === "cat" || word === "dog")).toBe(true);
    for (let index = 1; index < drill.length; index++) {
      expect(drill[index]).not.toBe(drill[index - 1]);
    }
  });

  it("rotates target pools and interleaves target slots with common coverage", () => {
    const drill = generateDrill(
      ["aa", "zz", "elm", "oak"],
      ["aa", "zz"],
      6,
      () => 0.99,
    );
    const isTarget = (word: string): boolean => word === "aa" || word === "zz";

    expect(drill).toHaveLength(6);
    expect(drill.filter(isTarget)).toHaveLength(4);
    expect(drill).toContain("aa");
    expect(drill).toContain("zz");
    expect(drill.slice(0, 4).some((word) => !isTarget(word))).toBe(true);
  });

  it("handles empty input and an unavoidable one-word repeat", () => {
    expect(generateDrill([], ["a"], 4)).toEqual([]);
    expect(generateDrill(["cat"], ["zz"], 3, () => 0)).toEqual([
      "cat",
      "cat",
      "cat",
    ]);
  });

  it("uses three-letter targets to enrich focused word selection", () => {
    const drill = generateDrill(
      ["the", "other", "cat", "dog"],
      ["the"],
      10,
      () => 0,
    );

    expect(drill).toHaveLength(10);
    expect(
      drill.filter((word) => word.includes("the")).length,
    ).toBeGreaterThanOrEqual(7);
  });

  it("uses four-letter targets to enrich focused word selection", () => {
    const drill = generateDrill(
      ["abcd", "xabcd", "cat", "dog"],
      ["abcd"],
      10,
      () => 0,
    );

    expect(drill).toHaveLength(10);
    expect(
      drill.filter((word) => word.includes("abcd")).length,
    ).toBeGreaterThanOrEqual(7);
  });
});

describe("mergeSession", () => {
  it("decays old evidence, adds session evidence, and preserves inputs", () => {
    const profile = createProfile();
    repeatAttempt(profile, "a", "x", 10, { latencyMs: 100 });
    const session = createProfile();
    repeatAttempt(session, "a", "a", 2, { latencyMs: 200 });

    const merged = mergeSession(profile, session, summary);

    expect(merged.keys["a"]).toEqual({
      attempts: 11,
      errors: 9,
      totalLatency: 400,
      latencySamples: 2,
    });
    expect(profile.keys["a"]?.attempts).toBe(10);
    expect(session.keys["a"]?.attempts).toBe(2);
    expect(merged.sessions).toEqual([summary]);
    expect(merged.sessions[0]).not.toBe(summary);
  });

  it("decays and merges trigram evidence independently", () => {
    const profile = createProfile();
    repeatAttempt(profile, "c", "x", 10, {
      previous: "b",
      previousTwo: "ab",
      latencyMs: 100,
    });
    const session = createProfile();
    repeatAttempt(session, "c", "c", 2, {
      previous: "b",
      previousTwo: "ab",
      latencyMs: 200,
    });

    const merged = mergeSession(profile, session, summary);

    expect(merged.triples["abc"]).toEqual({
      attempts: 11,
      errors: 9,
      totalLatency: 400,
      latencySamples: 2,
    });
    expect(profile.triples["abc"]?.attempts).toBe(10);
    expect(session.triples["abc"]?.attempts).toBe(2);
  });

  it("decays and merges quad evidence independently", () => {
    const profile = createProfile();
    repeatAttempt(profile, "d", "x", 10, {
      previous: "c",
      previousTwo: "bc",
      previousThree: "abc",
      latencyMs: 100,
    });
    const session = createProfile();
    repeatAttempt(session, "d", "d", 2, {
      previous: "c",
      previousTwo: "bc",
      previousThree: "abc",
      latencyMs: 200,
    });

    const merged = mergeSession(profile, session, summary);

    expect(merged.quads["abcd"]).toEqual({
      attempts: 11,
      errors: 9,
      totalLatency: 400,
      latencySamples: 2,
    });
    expect(profile.quads["abcd"]?.attempts).toBe(10);
    expect(session.quads["abcd"]?.attempts).toBe(2);
  });

  it("keeps only the latest 50 session summaries", () => {
    const profile = createProfile();
    for (let index = 0; index < 55; index++) {
      profile.sessions.push({ ...summary, date: index });
    }

    const merged = mergeSession(profile, createProfile(), summary);

    expect(merged.sessions).toHaveLength(50);
    expect(merged.sessions[0]?.date).toBe(6);
    expect(merged.sessions.at(-1)?.date).toBe(summary.date);
  });
});

describe("parseProfile", () => {
  it("returns an empty profile for malformed or incompatible data", () => {
    expect(parseProfile("not json")).toEqual(createProfile());
    expect(parseProfile(JSON.stringify({ version: 2 }))).toEqual(
      createProfile(),
    );
    expect(parseProfile(null)).toEqual(createProfile());
  });

  it("bounds stats, filters invalid sessions, and caps session history", () => {
    const sessions = Array.from({ length: 55 }, (_, index) => ({
      ...summary,
      date: index,
    }));
    sessions.push({ ...summary, kind: "bad" as SessionSummary["kind"] });

    const parsed = parseProfile(
      JSON.stringify({
        version: 1,
        keys: {
          a: {
            attempts: 99_999,
            errors: 99_999,
            totalLatency: 99_999_999,
            latencySamples: 99_999,
          },
        },
        triples: {
          abc: {
            attempts: 99_999,
            errors: 99_999,
            totalLatency: 99_999_999,
            latencySamples: 99_999,
          },
        },
        sessions,
      }),
    );

    expect(parsed.keys["a"]?.attempts).toBe(10_000);
    expect(parsed.keys["a"]?.errors).toBe(10_000);
    expect(parsed.keys["a"]?.latencySamples).toBe(10_000);
    expect(parsed.keys["a"]?.totalLatency).toBe(20_000_000);
    expect(parsed.triples["abc"]?.attempts).toBe(10_000);
    expect(parsed.triples["abc"]?.totalLatency).toBe(20_000_000);
    expect(parsed.sessions).toHaveLength(50);
    expect(parsed.sessions[0]?.date).toBe(5);
    expect(parsed.sessions.at(-1)?.date).toBe(54);
  });

  it("migrates v1 profiles with missing or malformed triple maps", () => {
    const oldProfile = parseProfile(
      JSON.stringify({
        version: 1,
        keys: {},
        pairs: {},
        sessions: [],
      }),
    );
    const malformed = parseProfile(
      JSON.stringify({
        version: 1,
        triples: [{ attempts: 5 }],
        quads: [{ attempts: 5 }],
      }),
    );

    expect(oldProfile.triples).toEqual({});
    expect(oldProfile.quads).toEqual({});
    expect(malformed.triples).toEqual({});
    expect(malformed.quads).toEqual({});
  });

  it("loads v1 profiles without quads while preserving existing maps and sessions", () => {
    const stat: Stat = {
      attempts: 3,
      errors: 1,
      totalLatency: 120,
      latencySamples: 1,
    };
    const parsed = parseProfile(
      JSON.stringify({
        version: 1,
        keys: { a: stat },
        pairs: { ab: stat },
        triples: { abc: stat },
        sessions: [summary],
      }),
    );

    expect(parsed.keys["a"]).toEqual(stat);
    expect(parsed.pairs["ab"]).toEqual(stat);
    expect(parsed.triples["abc"]).toEqual(stat);
    expect(parsed.quads).toEqual({});
    expect(parsed.sessions).toEqual([summary]);
  });

  it("caps quad stats at 2048 entries", () => {
    const quads = Object.fromEntries(
      Array.from({ length: 2_050 }, (_, index) => [
        `q${String(index).padStart(4, "0")}`,
        {
          attempts: index + 1,
          errors: 0,
          totalLatency: (index + 1) * 100,
          latencySamples: index + 1,
        },
      ]),
    );

    const parsed = parseProfile(JSON.stringify({ version: 1, quads }));

    expect(Object.keys(parsed.quads)).toHaveLength(2_048);
    expect(parsed.quads["q2049"]).toBeDefined();
    expect(parsed.quads["q0000"]).toBeUndefined();
    expect(parsed.quads["q0001"]).toBeUndefined();
  });

  it("round-trips a profile without sharing mutable arrays", () => {
    const profile = createProfile();
    repeatAttempt(profile, "a", "a", 5, { latencyMs: 100 });
    repeatAttempt(profile, "c", "c", 3, {
      previous: "b",
      previousTwo: "ab",
      latencyMs: 100,
    });
    repeatAttempt(profile, "d", "d", 3, {
      previous: "c",
      previousTwo: "bc",
      previousThree: "abc",
      latencyMs: 100,
    });
    profile.sessions.push(summary);

    const parsed = parseProfile(JSON.stringify(profile));
    parsed.sessions[0]?.targets.push("new");

    expect(parsed.keys["a"]).toEqual(profile.keys["a"]);
    expect(parsed.triples["abc"]).toEqual(profile.triples["abc"]);
    expect(parsed.quads["abcd"]).toEqual(profile.quads["abcd"]);
    expect(profile.sessions[0]?.targets).toEqual(["a", "th"]);
  });
});
