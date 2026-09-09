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
      sessions: Array<{
        kind: string;
        accuracy: number;
        characters: number;
      }>;
    };
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

  it("rejects unknown manual targets and accepts a known pair", () => {
    renderTraining();
    fireEvent.click(screen.getByRole("button", { name: "choose targets" }));

    const targetInput = screen.getByRole("textbox", { name: "key or pair" });
    const start = screen.getByRole("button", { name: "start training" });
    expect(start).toBeDisabled();

    fireEvent.input(targetInput, { target: { value: "qx" } });
    fireEvent.click(screen.getByRole("button", { name: "add target" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Choose one letter or a two-letter pair found in an English word.",
    );
    expect(start).toBeDisabled();

    fireEvent.input(targetInput, { target: { value: "TH" } });
    fireEvent.click(screen.getByRole("button", { name: "add target" }));
    expect(screen.getByRole("button", { name: "th ×" })).toBeInTheDocument();
    expect(start).not.toBeDisabled();
  });
});
