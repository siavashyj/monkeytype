import { describe, expect, it } from "vitest";

import {
  createProfile,
  parseProfile,
  rankTargets,
  type Stat,
} from "../../src/ts/training/engine";
import { englishFrequencyMultiplier } from "../../src/ts/training/frequency";
import frequencies from "../../src/ts/training/data/english-sequence-frequency.json";

const stat = (errors = 2): Stat => ({
  attempts: 10,
  errors,
  totalLatency: (10 - errors) * 100,
  latencySamples: 10 - errors,
});

describe("English frequency priority", () => {
  it("uses bounded logarithmic boosts from English frequencies at each length", () => {
    for (const target of Object.keys(frequencies.perMillion)) {
      const boost = englishFrequencyMultiplier(target);
      expect(boost).toBeGreaterThanOrEqual(1);
      expect(boost).toBeLessThanOrEqual(2);
    }
    expect(englishFrequencyMultiplier("th")).toBeGreaterThan(
      englishFrequencyMultiplier("qz"),
    );
    expect(englishFrequencyMultiplier("the")).toBeGreaterThan(
      englishFrequencyMultiplier("qzx"),
    );
    expect(englishFrequencyMultiplier("tion")).toBeGreaterThan(
      englishFrequencyMultiplier("qzxq"),
    );
    for (const target of ["", "A", "a b", "__proto__", "abcde"]) {
      expect(englishFrequencyMultiplier(target)).toBe(1);
    }
  });

  it("prioritizes common combinations with equal weaknesses without changing measurements or saved data", () => {
    const profile = createProfile();
    profile.pairs = { th: stat(), qz: stat() };
    profile.triples = { the: stat(), qzx: stat() };
    profile.quads = { tion: stat(), qzxq: stat() };
    const saved = JSON.stringify(profile);
    const ranked = rankTargets(profile);
    const baseline = rankTargets(profile, () => 1);
    for (const target of ranked) {
      const original = baseline.find((item) => item.target === target.target);
      expect(target.score).toBeCloseTo(
        (original?.score ?? 0) * target.frequencyMultiplier,
      );
      expect(target.accuracy).toBe(original?.accuracy);
      expect(target.latencyMs).toBe(original?.latencyMs);
      expect(target.attempts).toBe(original?.attempts);
    }
    for (const [common, rare] of [
      ["th", "qz"],
      ["the", "qzx"],
      ["tion", "qzxq"],
    ]) {
      expect(ranked.findIndex((item) => item.target === common)).toBeLessThan(
        ranked.findIndex((item) => item.target === rare),
      );
    }
    expect(JSON.stringify(profile)).toBe(saved);
    expect(rankTargets(parseProfile(saved))).toEqual(ranked);
  });

  it("does not create weaknesses or bypass evidence thresholds just because a sequence is common", () => {
    const profile = createProfile();
    profile.pairs["th"] = stat(0);
    expect(rankTargets(profile)).toEqual([]);
    profile.pairs["th"] = {
      attempts: 2,
      errors: 2,
      totalLatency: 0,
      latencySamples: 0,
    };
    expect(rankTargets(profile)).toEqual([]);
  });

  it("keeps a severe rare weakness above a small common weakness and bounds supplied boosts", () => {
    const profile = createProfile();
    profile.pairs = { th: stat(1), qz: stat(9) };
    expect(
      rankTargets(profile, (target) => (target === "th" ? 2 : 1))[0]?.target,
    ).toBe("qz");
    for (const [supplied, expected] of [
      [100, 2],
      [0, 1],
      [Number.NaN, 1],
    ]) {
      expect(
        rankTargets(profile, () => supplied as number).every(
          (target) => target.frequencyMultiplier === expected,
        ),
      ).toBe(true);
    }
  });
});
