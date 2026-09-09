import { describe, expect, it } from "vitest";
import { getTextInsertion } from "../../src/ts/training/input";

describe("native text edits", () => {
  it("identifies a replacement in the middle without replaying the suffix", () => {
    expect(getTextInsertion("the quick", "txe quick", 2, "x")).toEqual({
      start: 1,
      text: "x",
    });
  });

  it("identifies insertion before repeated letters using the native caret", () => {
    expect(getTextInsertion("aa", "aaa", 1, "a")).toEqual({
      start: 0,
      text: "a",
    });
  });

  it("counts retyping an identical selection as a new attempt", () => {
    expect(getTextInsertion("the", "the", 2, "h")).toEqual({
      start: 1,
      text: "h",
    });
  });

  it("finds touch-keyboard replacements when event data is unavailable", () => {
    expect(getTextInsertion("teh quick", "the quick", 3, null)).toEqual({
      start: 1,
      text: "he",
    });
  });

  it("does not invent inserted text for selection and word deletion", () => {
    expect(getTextInsertion("the quick", "the ", 4, null).text).toBe("");
    expect(getTextInsertion("txe", "te", 1, null).text).toBe("");
  });
});
