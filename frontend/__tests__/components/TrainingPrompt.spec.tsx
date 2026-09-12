import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrainingPrompt } from "../../src/ts/components/pages/training/TrainingPrompt";

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
function flushFrame(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(): {
  prompt: HTMLElement;
  caret: HTMLElement;
  setTyped: (text: string) => void;
  setCursor: (position: number) => void;
  setPaused: (paused: boolean) => void;
} {
  const [typed, setTyped] = createSignal("");
  const [cursor, setCursor] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  render(() => (
    <TrainingPrompt
      text="the"
      typed={typed()}
      cursor={cursor()}
      paused={paused()}
    />
  ));
  const prompt = document.getElementById("training-prompt") as HTMLElement;
  const caret = prompt.querySelector("[data-training-caret]") as HTMLElement;
  vi.spyOn(prompt, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 200,
  } as DOMRect);
  const spans = Array.from(prompt.querySelectorAll("span")).filter(
    (span) => span !== caret,
  );
  spans.forEach((span, index) => {
    vi.spyOn(span, "getBoundingClientRect").mockReturnValue({
      left: 100 + index * 18,
      top: 200,
      height: 30,
    } as DOMRect);
  });
  return { prompt, caret, setTyped, setCursor, setPaused };
}

describe("TrainingPrompt", () => {
  it("moves one separate caret without changing letter geometry or replacing nodes", () => {
    const { prompt, caret, setTyped, setCursor } = setup();
    const first = prompt.firstElementChild;
    flushFrame();
    expect(caret.style.transform).toBe("translate3d(0px, 0px, 0)");
    expect(caret).toHaveClass("absolute");
    setTyped("t");
    setCursor(1);
    setTyped("tx");
    setCursor(2);
    expect(frames.size).toBe(1);
    flushFrame();
    expect(caret.style.transform).toBe("translate3d(36px, 0px, 0)");
    expect(caret.style.transitionProperty).toBe("transform");
    expect(prompt.firstElementChild).toBe(first);
    expect(prompt.querySelector(".border-l-2")).toBeNull();
    expect(prompt.children[1]).toHaveClass("text-error");
    setTyped("t");
    setCursor(1);
    flushFrame();
    expect(caret.style.transform).toBe("translate3d(18px, 0px, 0)");
    expect(prompt.children[1]).toHaveClass("text-sub");
    setTyped("the");
    setCursor(3);
    flushFrame();
    expect(caret.style.transform).toBe("translate3d(54px, 0px, 0)");
  });

  it("snaps across lines and on resize, hides when paused, and cancels pending work on teardown", () => {
    const { prompt, caret, setCursor, setPaused } = setup();
    flushFrame();
    const letter = prompt.children[2] as HTMLElement;
    vi.mocked(letter.getBoundingClientRect).mockReturnValue({
      left: 100,
      top: 245,
      height: 30,
    } as DOMRect);
    setCursor(2);
    flushFrame();
    expect(caret.style.transform).toBe("translate3d(0px, 45px, 0)");
    expect(caret.style.transitionProperty).toBe("none");
    window.dispatchEvent(new Event("resize"));
    flushFrame();
    expect(caret.style.transitionProperty).toBe("none");
    setPaused(true);
    flushFrame();
    expect(caret.style.visibility).toBe("hidden");
    setPaused(false);
    flushFrame();
    expect(caret.style.visibility).toBe("visible");
    expect(caret).toHaveClass("motion-reduce:duration-0");
    setCursor(1);
    expect(frames.size).toBe(1);
    cleanup();
    expect(frames.size).toBe(0);
  });
});
