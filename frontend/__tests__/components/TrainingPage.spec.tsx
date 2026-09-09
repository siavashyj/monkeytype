import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrainingSession } from "../../src/ts/components/pages/training/TrainingPage";

const storageKey = "monkeytype.smartTraining.v1";

function renderTraining(): void {
  render(() => <TrainingSession />);
}

function startDiagnostic(): HTMLInputElement {
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

function keyDown(input: HTMLInputElement, key: string): void {
  fireEvent.keyDown(input, {
    key,
    code: key === " " ? "Space" : `Key${key.toUpperCase()}`,
    repeat: false,
  });
}

function typeText(input: HTMLInputElement, text: string): void {
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
    expect(progress()).toBe(0);
    keyDown(input, expected);

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
