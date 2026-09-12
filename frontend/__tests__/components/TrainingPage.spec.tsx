import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrainingSession } from "../../src/ts/components/pages/training/TrainingPage";

const storageKey = "monkeytype.smartTraining.v1";

function renderTraining(): void {
  render(() => <TrainingSession />);
}

function startDiagnostic(): HTMLTextAreaElement {
  fireEvent.click(screen.getByRole("button", { name: "start diagnostic" }));
  return screen.getByRole("textbox", { name: "Typing practice" });
}

function promptText(): string {
  return (
    document.getElementById("training-prompt")?.getAttribute("aria-label") ?? ""
  );
}

function progress(): number {
  return Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
}

function keyDown(input: HTMLTextAreaElement, key: string): void {
  const allowed = fireEvent.keyDown(input, { key, repeat: false });
  if (!allowed || input.disabled) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  // JSDOM has no native editing default action; emulate the browser's edit,
  // then dispatch its input event. The component must not cancel those keys.
  if (key === "Backspace") {
    input.setRangeText(
      "",
      start === end ? Math.max(0, start - 1) : start,
      end,
      "end",
    );
    fireEvent.input(input, { inputType: "deleteContentBackward", data: null });
  } else if (key.length === 1) {
    input.setRangeText(key, start, end, "end");
    fireEvent.input(input, { inputType: "insertText", data: key });
  }
}

function typeText(input: HTMLTextAreaElement, text: string): void {
  for (const character of text) keyDown(input, character);
}

function statValue(label: string): string {
  const labelElement = Array.from(
    document.querySelectorAll('[aria-label="Session statistics"] .text-sm'),
  ).find((element) => element.textContent === label);
  if (!labelElement) return "";
  return (
    labelElement.parentElement?.querySelector(".text-3xl")?.textContent ?? ""
  );
}

describe("TrainingSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("completes the diagnostic and persists a completed session", () => {
    renderTraining();
    const input = startDiagnostic();
    const text = promptText();

    expect(text.length).toBeGreaterThan(20);
    typeText(input, text);
    keyDown(input, "Enter");

    expect(
      screen.getByRole("heading", { name: "session complete" }),
    ).toBeInTheDocument();
    expect(statValue("accuracy")).toBe("100.0%");

    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      triples: Record<string, { attempts: number; errors: number }>;
      quads: Record<string, { attempts: number; errors: number }>;
      sessions: Array<{
        kind: string;
        accuracy: number;
        characters: number;
      }>;
    };
    expect(stored.triples["the"]).toMatchObject({
      attempts: text.match(/the/g)?.length ?? 0,
      errors: 0,
    });
    expect(
      Object.keys(stored.triples).every((target) => /^[a-z]{3}$/.test(target)),
    ).toBe(true);
    expect(stored.quads["quic"]).toMatchObject({ attempts: 1, errors: 0 });
    expect(
      Object.keys(stored.quads).every((target) => /^[a-z]{4}$/.test(target)),
    ).toBe(true);
    expect(stored.sessions).toHaveLength(1);
    expect(stored.sessions[0]).toMatchObject({
      kind: "diagnostic",
      accuracy: 1,
      characters: text.length,
    });
  });

  it("counts a mistake even after the character is corrected", () => {
    renderTraining();
    const input = startDiagnostic();
    const expected = promptText()[0] as string;
    const wrong = expected === "a" ? "b" : "a";

    keyDown(input, wrong);
    expect(input.value).toBe(wrong);
    expect(progress()).toBe(1);
    keyDown(input, "Backspace");
    expect(input.value).toBe("");
    keyDown(input, expected);

    expect(progress()).toBe(1);
    expect(statValue("accuracy")).toBe("50.0%");
  });

  it("deletes the actual typo without deleting the preceding correct character", () => {
    renderTraining();
    const input = startDiagnostic();
    typeText(input, "tx");
    expect(input.value).toBe("tx");
    expect(progress()).toBe(2);
    expect(
      document.getElementById("training-prompt")?.querySelector(".text-error")
        ?.textContent,
    ).toBe("h");
    keyDown(input, "Backspace");
    expect(input.value).toBe("t");
    typeText(input, "he");
    expect(input.value).toBe("the");
    expect(progress()).toBe(3);
    expect(statValue("accuracy")).toBe("75.0%");
    const text = promptText();
    typeText(input, text.slice(3));
    keyDown(input, "Enter");
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      pairs: Record<string, { attempts: number; errors: number }>;
    };
    expect(stored.pairs["th"]).toMatchObject({
      attempts: (text.match(/th/g)?.length ?? 0) + 1,
      errors: 1,
    });
  });

  it("allows selection replacement and native word deletion", () => {
    renderTraining();
    const input = startDiagnostic();
    typeText(input, "the quick");
    input.setSelectionRange(1, 2);
    typeText(input, "x");
    expect(input.value).toBe("txe quick");
    keyDown(input, "Backspace");
    typeText(input, "h");
    expect(input.value).toBe("the quick");
    input.setRangeText("", 4, 9, "end");
    fireEvent.input(input, { inputType: "deleteWordBackward", data: null });
    expect(input.value).toBe("the ");
    expect(progress()).toBe(4);
    expect(statValue("accuracy")).toBe("90.9%");
  });

  it("lets the final typo be corrected before finishing and retains its error", () => {
    renderTraining();
    const input = startDiagnostic();
    const text = promptText();
    typeText(input, `${text.slice(0, -1)}~`);
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(input.value).toBe(`${text.slice(0, -1)}~`);
    keyDown(input, "Backspace");
    expect(input.value).toBe(text.slice(0, -1));
    typeText(input, text.at(-1) as string);
    expect(localStorage.getItem(storageKey)).toBeNull();
    keyDown(input, "Enter");
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      sessions: { accuracy: number }[];
    };
    expect(stored.sessions[0]?.accuracy).toBeCloseTo(
      text.length / (text.length + 1),
    );
  });

  it("can submit uncorrected errors without crediting them as WPM", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    renderTraining();
    const input = startDiagnostic();
    const text = promptText();
    typeText(input, "~".repeat(text.length + 2));
    expect(input.value.length).toBe(text.length + 2);
    expect(progress()).toBe(text.length);
    now = 2000;
    keyDown(input, "Enter");
    expect(statValue("wpm")).toBe("0");
    expect(statValue("accuracy")).toBe("0.0%");
  });

  it("does not cancel native editing shortcuts or count undo as new typing", () => {
    renderTraining();
    const input = startDiagnostic();
    typeText(input, "tx");
    expect(fireEvent.keyDown(input, { key: "Backspace" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "Delete" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "ArrowLeft" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "Backspace", ctrlKey: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(input, { key: "z", metaKey: true })).toBe(true);
    input.value = "t";
    fireEvent.input(input, { inputType: "historyUndo", data: null });
    expect(progress()).toBe(1);
    expect(statValue("accuracy")).toBe("50.0%");
  });

  it("moves back one character for backspace without double progress", () => {
    renderTraining();
    const input = startDiagnostic();
    const expected = promptText()[0] as string;

    keyDown(input, expected);
    expect(progress()).toBe(1);

    keyDown(input, "Backspace");
    expect(progress()).toBe(0);

    keyDown(input, expected);
    expect(progress()).toBe(1);
  });

  it("excludes idle time between pause and resume", () => {
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    renderTraining();
    const input = startDiagnostic();
    const text = promptText();

    keyDown(input, text[0] as string);
    now = 2_000;
    keyDown(input, "Escape");
    expect(input).toBeDisabled();

    now = 12_000;
    fireEvent.click(screen.getByRole("button", { name: "resume" }));
    now = 13_000;
    keyDown(input, text[1] as string);

    // Two active seconds for two characters: 12 WPM. Charging ten idle seconds gives 2 WPM.
    expect(statValue("wpm")).toBe("12");
  });

  it("does not persist an incomplete drill when restarted or abandoned", () => {
    renderTraining();
    const input = startDiagnostic();
    keyDown(input, promptText()[0] as string);

    expect(localStorage.getItem(storageKey)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "restart drill" }));
    expect(progress()).toBe(0);
    expect(localStorage.getItem(storageKey)).toBeNull();

    keyDown(input, promptText()[0] as string);
    cleanup();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("ends an in-progress drill without persisting it", () => {
    renderTraining();
    const input = startDiagnostic();
    keyDown(input, promptText()[0] as string);

    fireEvent.click(screen.getByRole("button", { name: "end drill" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Incomplete drills do not change your training profile.",
    );
    expect(
      screen.getByRole("button", { name: "start diagnostic" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("starts cleanly when saved data is corrupted", () => {
    localStorage.setItem(storageKey, "{not valid json");
    renderTraining();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "start diagnostic" }),
    ).toBeInTheDocument();
  });

  it("shows a recoverable notice when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    renderTraining();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Storage is unavailable. Progress lasts until you leave this page.",
    );
  });

  it("preserves legacy saved results while adding triple statistics", () => {
    const legacy = {
      version: 1,
      keys: {
        z: { attempts: 10, errors: 2, totalLatency: 800, latencySamples: 8 },
      },
      pairs: {
        zz: { attempts: 10, errors: 2, totalLatency: 800, latencySamples: 8 },
      },
      sessions: [
        {
          date: 1700000000000,
          kind: "diagnostic",
          accuracy: 0.9,
          wpm: 40,
          targets: [],
          characters: 100,
          durationMs: 30000,
        },
      ],
    };
    localStorage.setItem(storageKey, JSON.stringify(legacy));
    renderTraining();
    fireEvent.click(screen.getByRole("button", { name: "diagnostic" }));
    const input = startDiagnostic();
    typeText(input, promptText());
    keyDown(input, "Enter");
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      keys: Record<string, { errors: number }>;
      pairs: Record<string, { attempts: number }>;
      triples: Record<string, { attempts: number }>;
      sessions: unknown[];
    };
    expect(stored.sessions).toHaveLength(2);
    expect(stored.sessions[0]).toEqual(legacy.sessions[0]);
    expect(stored.keys["z"]?.errors).toBeCloseTo(1.8);
    expect(stored.pairs["zz"]?.attempts).toBe(9);
    expect(stored.triples["the"]?.attempts).toBeGreaterThan(0);
    cleanup();
    renderTraining();
    expect(screen.getByText(/2 sessions retained/)).toBeInTheDocument();
  });

  it("retains the original triple error when its final character is corrected", () => {
    renderTraining();
    const input = startDiagnostic();
    const text = promptText();
    typeText(input, "thx");
    keyDown(input, "Backspace");
    typeText(input, text.slice(2));
    keyDown(input, "Enter");
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      triples: Record<string, { attempts: number; errors: number }>;
      pairs: Record<string, { attempts: number; errors: number }>;
    };
    expect(stored.triples["the"]).toMatchObject({
      attempts: (text.match(/the/g)?.length ?? 0) + 1,
      errors: 1,
    });
    expect(stored.pairs["he"]).toMatchObject({
      attempts: (text.match(/he/g)?.length ?? 0) + 1,
      errors: 1,
    });
  });

  it("rejects unknown manual targets and accepts two- to four-letter sequences", () => {
    renderTraining();
    fireEvent.click(screen.getByRole("button", { name: "choose targets" }));

    const targetInput = screen.getByRole("textbox", {
      name: "key, sequence, or word pair",
    });
    const start = screen.getByRole("button", { name: "start training" });
    expect(start).toBeDisabled();

    fireEvent.input(targetInput, { target: { value: "qx" } });
    fireEvent.click(screen.getByRole("button", { name: "add target" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Choose a key, a 2–4-letter sequence, or two words from the practice vocabulary.",
    );
    expect(start).toBeDisabled();

    fireEvent.input(targetInput, { target: { value: "TH" } });
    fireEvent.click(screen.getByRole("button", { name: "add target" }));
    expect(screen.getByRole("button", { name: "th ×" })).toBeInTheDocument();
    expect(start).not.toBeDisabled();

    expect(targetInput).toHaveAttribute("maxlength", "61");
    fireEvent.input(targetInput, { target: { value: "THE" } });
    fireEvent.click(screen.getByRole("button", { name: "add target" }));
    expect(screen.getByRole("button", { name: "the ×" })).toBeInTheDocument();
    fireEvent.input(targetInput, { target: { value: "WORD" } });
    fireEvent.click(screen.getByRole("button", { name: "add target" }));
    expect(screen.getByRole("button", { name: "word ×" })).toBeInTheDocument();
    fireEvent.input(targetInput, { target: { value: "words" } });
    fireEvent.click(screen.getByRole("button", { name: "add target" }));
    expect(
      screen.queryByRole("button", { name: "words ×" }),
    ).not.toBeInTheDocument();
    fireEvent.click(start);
    expect(promptText()).toContain("the");
    expect(promptText()).toContain("word");
  });

  it("recommends a weak three-letter sequence for adaptive practice", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        keys: {},
        pairs: {},
        triples: {
          the: { attempts: 6, errors: 3, totalLatency: 300, latencySamples: 3 },
        },
        sessions: [],
      }),
    );
    renderTraining();
    expect(
      screen.getByText(/3-letter · 6 weighted samples/),
    ).toBeInTheDocument();
    expect(screen.getByText(/× frequency boost/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "adaptive" }));
    fireEvent.click(screen.getByRole("button", { name: "start training" }));
    expect(promptText()).toContain("the");
  });
  it("retains a four-letter error after correcting its final character", () => {
    renderTraining();
    const input = startDiagnostic();
    const text = promptText();
    typeText(input, `${text.slice(0, 7)}x`);
    keyDown(input, "Backspace");
    typeText(input, text.slice(7));
    keyDown(input, "Enter");
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      quads: Record<string, { attempts: number; errors: number }>;
    };
    expect(stored.quads["quic"]).toMatchObject({ attempts: 2, errors: 1 });
    expect(stored.quads["uick"]).toMatchObject({ attempts: 1, errors: 0 });
  });

  it("adds four-letter stats to a saved triple profile and recommends them after reload", () => {
    const summary = {
      date: 1700000000000,
      kind: "diagnostic",
      accuracy: 0.9,
      wpm: 40,
      targets: ["the"],
      characters: 100,
      durationMs: 30000,
    };
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        keys: {},
        pairs: {},
        triples: {
          zzz: { attempts: 6, errors: 3, totalLatency: 300, latencySamples: 3 },
        },
        sessions: [summary],
      }),
    );
    renderTraining();
    fireEvent.click(screen.getByRole("button", { name: "diagnostic" }));
    const input = startDiagnostic();
    const text = promptText();
    typeText(input, `${text.slice(0, 7)}x`);
    keyDown(input, "Backspace");
    typeText(input, "x");
    keyDown(input, "Backspace");
    typeText(input, text.slice(7));
    keyDown(input, "Enter");
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      triples: Record<string, { attempts: number }>;
      quads: Record<string, { attempts: number; errors: number }>;
      sessions: unknown[];
    };
    expect(stored.sessions[0]).toEqual(summary);
    expect(stored.triples["zzz"]?.attempts).toBe(5.4);
    expect(stored.quads["quic"]).toMatchObject({ attempts: 3, errors: 2 });
    cleanup();
    renderTraining();
    expect(
      screen.getByText(/4-letter · 3 weighted samples/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "start training" }));
    expect(promptText()).toContain("quic");
  });
  it("keeps phrase errors after native corrections and saves only one encounter", () => {
    renderTraining();
    const input = startDiagnostic();
    const text = promptText();
    typeText(input, "thex");
    keyDown(input, "Backspace");
    typeText(input, text.slice(3));
    keyDown(input, "Enter");
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      wordPairs: Record<
        string,
        { attempts: number; errors: number; occurrences: number }
      >;
    };
    expect(stored.wordPairs["the quick"]).toMatchObject({
      attempts: 10,
      errors: 1,
      occurrences: 1,
    });
    cleanup();
    renderTraining();
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "null")).toEqual(
      stored,
    );
  });

  it("accepts exact word pairs as manual targets and preserves their adjacency in drills", () => {
    renderTraining();
    fireEvent.click(screen.getByRole("button", { name: "choose targets" }));
    const targetInput = screen.getByRole("textbox", {
      name: "key, sequence, or word pair",
    });
    fireEvent.input(targetInput, { target: { value: "  OF   THE  " } });
    fireEvent.click(screen.getByRole("button", { name: "add target" }));
    expect(
      screen.getByRole("button", { name: "of the ×" }),
    ).toBeInTheDocument();
    fireEvent.input(targetInput, { target: { value: "zzzzzz the" } });
    fireEvent.click(screen.getByRole("button", { name: "add target" }));
    expect(
      screen.queryByRole("button", { name: "zzzzzz the ×" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "start training" }));
    const text = promptText();
    expect(text).toContain("of the");
    expect(text.split(" ")).toHaveLength(25);
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Typing practice",
    });
    typeText(input, text.replaceAll("of the", "of thx"));
    keyDown(input, "Enter");
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      wordPairs: Record<string, { occurrences: number; errors: number }>;
      sessions: { targets: string[] }[];
    };
    expect(stored.wordPairs["of the"]?.occurrences).toBeGreaterThanOrEqual(3);
    expect(stored.wordPairs["of the"]?.errors).toBe(
      stored.wordPairs["of the"]?.occurrences,
    );
    expect(stored.sessions[0]?.targets).toEqual(["of the"]);
    expect(
      screen.getAllByText(/word pair · .* weighted encounters/).length,
    ).toBeGreaterThan(0);
  });
  it("includes an observed weak word pair alongside higher-scoring letter targets", () => {
    const stat = {
      attempts: 10,
      errors: 8,
      latencySamples: 2,
      totalLatency: 200,
    };
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        keys: { a: stat, b: stat, c: stat },
        pairs: {},
        triples: {},
        quads: {},
        wordPairs: {
          "of the": {
            attempts: 18,
            errors: 1,
            latencySamples: 17,
            totalLatency: 1700,
            occurrences: 3,
          },
        },
        sessions: [],
      }),
    );
    renderTraining();
    expect(
      screen.getByText(/word pair · 3.0 weighted encounters/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "adaptive" }));
    fireEvent.click(screen.getByRole("button", { name: "start training" }));
    expect(promptText()).toContain("of the");
  });
  it("remembers disabled word combinations and preserves their saved evidence through a drill", () => {
    const pair = {
      attempts: 18,
      errors: 3,
      latencySamples: 15,
      totalLatency: 1500,
      occurrences: 3,
    };
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        keys: {},
        pairs: {},
        triples: {},
        quads: {},
        wordPairs: { "of the": pair },
        sessions: [],
      }),
    );
    renderTraining();
    expect(
      screen.getByText(/word pair · 3.0 weighted encounters/),
    ).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Word combinations" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText(/word pair ·/)).not.toBeInTheDocument();
    cleanup();
    renderTraining();
    expect(
      screen.getByRole("switch", { name: "Word combinations" }),
    ).not.toBeChecked();
    const input = startDiagnostic();
    expect(
      screen.getByRole("switch", { name: "Word combinations" }),
    ).toBeDisabled();
    typeText(input, promptText());
    keyDown(input, "Enter");
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      wordPairs: unknown;
      keys: Record<string, unknown>;
    };
    expect(stored.wordPairs).toEqual({ "of the": pair });
    expect(stored.keys["t"]).toBeDefined();
    fireEvent.click(screen.getByRole("switch", { name: "Word combinations" }));
    expect(
      screen.getByText(/word pair · 3.0 weighted encounters/),
    ).toBeInTheDocument();
  });

  it("removes selected word pairs when disabled while keeping letter targets usable", () => {
    renderTraining();
    fireEvent.click(screen.getByRole("button", { name: "choose targets" }));
    let targetInput = screen.getByRole("textbox", {
      name: "key, sequence, or word pair",
    });
    for (const value of ["of the", "th"]) {
      fireEvent.input(targetInput, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "add target" }));
    }
    fireEvent.click(screen.getByRole("switch", { name: "Word combinations" }));
    expect(
      screen.queryByRole("button", { name: "of the ×" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "th ×" })).toBeInTheDocument();
    targetInput = screen.getByRole("textbox", { name: "key or sequence" });
    expect(targetInput).toHaveAttribute("maxlength", "4");
    fireEvent.input(targetInput, { target: { value: "of the" } });
    fireEvent.click(screen.getByRole("button", { name: "add target" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Turn on word combinations to add a word pair.",
    );
    fireEvent.click(screen.getByRole("button", { name: "start training" }));
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Typing practice",
    });
    typeText(input, promptText());
    keyDown(input, "Enter");
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      wordPairs: unknown;
      sessions: { targets: string[] }[];
    };
    expect(stored.wordPairs).toEqual({});
    expect(stored.sessions[0]?.targets).toEqual(["th"]);
  });
});
