import {
  createEffect,
  createMemo,
  Index,
  JSXElement,
  on,
  onCleanup,
  onMount,
} from "solid-js";

export function TrainingPrompt(props: {
  text: string;
  typed: string;
  cursor: number;
  paused: boolean;
}): JSXElement {
  let prompt!: HTMLParagraphElement;
  let caret!: HTMLSpanElement;
  let end!: HTMLSpanElement;
  const letters: HTMLSpanElement[] = [];
  const extras: HTMLSpanElement[] = [];
  const characters = createMemo(() => props.text.split(""));
  const extraCharacters = createMemo(() =>
    props.typed.slice(props.text.length).split(""),
  );
  let frame: number | undefined;
  let disposed = false;
  let previousTop: number | undefined;
  let snap = true;

  // Read geometry only once per frame, after Solid has updated the text.
  const scheduleCaret = (reset = false): void => {
    snap ||= reset;
    if (disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const index = Math.max(
        0,
        Math.min(props.cursor, Math.max(props.text.length, props.typed.length)),
      );
      const target =
        index < props.text.length
          ? letters[index]
          : index < props.typed.length
            ? extras[index - props.text.length]
            : end;
      if (!target) return;
      const origin = prompt.getBoundingClientRect();
      const position = target.getBoundingClientRect();
      const top = position.top - origin.top;
      // Line changes and resizes snap; horizontal typing/deletion glides.
      caret.style.transitionProperty =
        snap || previousTop !== top ? "none" : "transform";
      caret.style.transform = `translate3d(${position.left - origin.left}px, ${top}px, 0)`;
      caret.style.height = `${position.height}px`;
      caret.style.visibility = props.paused ? "hidden" : "visible";
      previousTop = top;
      snap = false;
    });
  };

  createEffect(
    on(
      () => [props.cursor, props.text, props.typed, props.paused],
      () => scheduleCaret(),
    ),
  );
  onMount(() => {
    const resize = (): void => scheduleCaret(true);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(resize);
    observer?.observe(prompt);
    window.addEventListener("resize", resize);
    document.fonts?.addEventListener("loadingdone", resize);
    scheduleCaret(true);
    onCleanup(() => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      document.fonts?.removeEventListener("loadingdone", resize);
    });
  });

  return (
    <p
      ref={(element) => {
        prompt = element;
      }}
      id="training-prompt"
      class="relative text-2xl leading-relaxed break-words whitespace-pre-wrap sm:text-3xl"
      aria-label={props.text}
    >
      <Index each={characters()}>
        {(letter, index) => {
          // Only letters whose status changes need a class update.
          const status = createMemo(() =>
            props.typed[index] === undefined
              ? "text-sub"
              : props.typed[index] === letter()
                ? "text-text"
                : "text-error underline",
          );
          return (
            <span
              ref={(element) => {
                letters[index] = element;
              }}
              aria-hidden="true"
              class={status()}
            >
              {letter()}
            </span>
          );
        }}
      </Index>
      <Index each={extraCharacters()}>
        {(letter, index) => (
          <span
            ref={(element) => {
              extras[index] = element;
            }}
            aria-hidden="true"
            class="text-error underline"
          >
            {letter()}
          </span>
        )}
      </Index>
      <span
        ref={(element) => {
          end = element;
        }}
        aria-hidden="true"
      >
        {"\u200b"}
      </span>
      <span
        ref={(element) => {
          caret = element;
        }}
        data-training-caret
        aria-hidden="true"
        class="pointer-events-none invisible absolute top-0 left-0 w-0.5 rounded bg-caret duration-75 ease-linear motion-reduce:duration-0"
      ></span>
    </p>
  );
}
