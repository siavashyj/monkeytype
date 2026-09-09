import { describe, expect, it } from "vitest";
import {
  createProfile,
  generateDrill,
  mergeSession,
  parseProfile,
  rankTargets,
  recordAttempt,
  type SessionSummary,
} from "../../src/ts/training/engine";

function repeatAttempt(
  profile: ReturnType<typeof createProfile>,
  expected: string,
  actual: string,
  count: number,
  options: { previous?: string; latencyMs?: number } = {},
): void {
  for (let index = 0; index < count; index++) {
    recordAttempt(profile, {
      expected,
      actual,
      previous: options.previous,
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
        sessions,
      }),
    );

    expect(parsed.keys["a"]?.attempts).toBe(10_000);
    expect(parsed.keys["a"]?.errors).toBe(10_000);
    expect(parsed.keys["a"]?.latencySamples).toBe(10_000);
    expect(parsed.keys["a"]?.totalLatency).toBe(20_000_000);
    expect(parsed.sessions).toHaveLength(50);
    expect(parsed.sessions[0]?.date).toBe(5);
    expect(parsed.sessions.at(-1)?.date).toBe(54);
  });

  it("round-trips a profile without sharing mutable arrays", () => {
    const profile = createProfile();
    repeatAttempt(profile, "a", "a", 5, { latencyMs: 100 });
    profile.sessions.push(summary);

    const parsed = parseProfile(JSON.stringify(profile));
    parsed.sessions[0]?.targets.push("new");

    expect(parsed.keys["a"]).toEqual(profile.keys["a"]);
    expect(profile.sessions[0]?.targets).toEqual(["a", "th"]);
  });
});
