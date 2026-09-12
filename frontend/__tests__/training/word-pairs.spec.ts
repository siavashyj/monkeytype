import { describe, expect, it } from "vitest";
import {
  createProfile,
  mergeSession,
  parseProfile,
  rankTargets,
  type SessionSummary,
} from "../../src/ts/training/engine";
import { createWordPairTracker } from "../../src/ts/training/word-pairs";

const summary: SessionSummary = {
  date: 1000,
  wpm: 50,
  accuracy: 0.9,
  targets: ["of the"],
  kind: "manual",
  characters: 20,
  durationMs: 5000,
};

describe("word pair tracking", () => {
  it("tracks overlapping pairs, mistakes in either word, and corrections without inventing encounters", () => {
    const profile = createProfile();
    const text = "the quick brown";
    const track = createWordPairTracker(text);
    for (let index = 0; index < text.length; index++) {
      track(
        profile,
        index,
        [1, 5].includes(index) ? "x" : (text[index] as string),
        100,
      );
    }
    track(profile, 1, "h");
    track(profile, 5, "u");
    track(profile, 8, "k");
    expect(profile.wordPairs["the quick"]).toMatchObject({
      attempts: 12,
      errors: 2,
      occurrences: 1,
    });
    expect(profile.wordPairs["quick brown"]).toMatchObject({
      attempts: 13,
      errors: 1,
      occurrences: 1,
    });
    expect(Object.keys(profile.wordPairs)).toEqual([
      "the quick",
      "quick brown",
    ]);
  });

  it("counts boundary-space errors and separate occurrences of the same pair", () => {
    const profile = createProfile();
    const text = "of the of the";
    const track = createWordPairTracker(text);
    for (let index = 0; index < text.length; index++) {
      track(profile, index, index === 2 ? "x" : (text[index] as string), 100);
    }
    track(profile, 2, " ");
    expect(profile.wordPairs["of the"]).toMatchObject({
      attempts: 13,
      errors: 1,
      occurrences: 2,
    });
    expect(profile.wordPairs["the of"]).toMatchObject({
      attempts: 6,
      errors: 0,
      occurrences: 1,
    });
  });

  it("does not join across punctuation or multiple spaces or mark an unfinished pair completed", () => {
    const profile = createProfile();
    const text = "of, the  word";
    const track = createWordPairTracker(text);
    for (let index = 0; index < text.length; index++) {
      track(profile, index, text[index] as string);
    }
    expect(profile.wordPairs).toEqual({});
    createWordPairTracker("of the")(profile, 0, "o");
    expect(profile.wordPairs["of the"]?.occurrences).toBe(0);
    expect(rankTargets(profile)).toEqual([]);
  });

  it("requires repeated encounters, uses its own baseline, and never invents phrase frequency", () => {
    const profile = createProfile();
    profile.wordPairs = {
      "of the": {
        attempts: 18,
        errors: 3,
        latencySamples: 15,
        totalLatency: 1500,
        occurrences: 2,
      },
      "in the": {
        attempts: 18,
        errors: 0,
        latencySamples: 18,
        totalLatency: 1800,
        occurrences: 3,
      },
    };
    expect(rankTargets(profile)).toEqual([]);
    const pair = profile.wordPairs["of the"];
    if (pair) pair.occurrences = 3;
    const ranked = rankTargets(profile, () => 2);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({
      target: "of the",
      kind: "wordPair",
      occurrences: 3,
      attempts: 18,
      frequencyMultiplier: 1,
      latencyMs: 100,
    });
    expect(ranked[0]?.accuracy).toBeCloseTo(15 / 18);
  });

  it("preserves legacy stats and merges, decays, and round-trips phrase evidence", () => {
    const old = parseProfile(
      JSON.stringify({
        version: 1,
        keys: { a: { attempts: 5, errors: 1 } },
        sessions: [summary],
      }),
    );
    expect(old.wordPairs).toEqual({});
    const incoming = createProfile();
    incoming.wordPairs["of the"] = {
      attempts: 18,
      errors: 3,
      totalLatency: 1500,
      latencySamples: 15,
      occurrences: 3,
    };
    const first = mergeSession(old, incoming, summary);
    const merged = mergeSession(first, incoming, summary);
    expect(merged.wordPairs["of the"]?.occurrences).toBeCloseTo(5.7);
    expect(merged.wordPairs["of the"]?.errors).toBeCloseTo(5.7);
    expect(incoming.wordPairs["of the"]?.occurrences).toBe(3);
    expect(first.wordPairs["of the"]?.occurrences).toBe(3);
    expect(merged.keys["a"]?.errors).toBeCloseTo(0.81);
    expect(merged.sessions).toHaveLength(3);
    expect(parseProfile(JSON.stringify(merged))).toEqual(merged);
    expect(
      parseProfile(JSON.stringify({ version: 1, wordPairs: [] })).wordPairs,
    ).toEqual({});
    expect(
      parseProfile(
        JSON.stringify({
          version: 1,
          wordPairs: {
            bad: {},
            "of the": { attempts: 2, errors: 10, occurrences: 100 },
          },
        }),
      ).wordPairs,
    ).toEqual({
      "of the": {
        attempts: 2,
        errors: 2,
        totalLatency: 0,
        latencySamples: 0,
        occurrences: 2,
      },
    });
  });
});
