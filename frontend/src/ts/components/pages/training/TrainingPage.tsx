import {
  createMemo,
  createSignal,
  For,
  JSXElement,
  onCleanup,
  Show,
  untrack,
} from "solid-js";

import english from "../../../../../static/languages/english_1k.json";
import {
  createProfile,
  generateDrill,
  mergeSession,
  parseProfile,
  rankTargets,
  recordAttempt,
  type SessionSummary,
} from "../../../training/engine";
import { getTextInsertion } from "../../../training/input";
import { cn } from "../../../utils/cn";
import { Button } from "../../common/Button";
import { Fa } from "../../common/Fa";

const vocabulary = english.words.map((word) => word.toLowerCase());
const storageKey = "monkeytype.smartTraining.v1";
const diagnostic =
  "the quick brown fox jumps over the lazy dog then we write each word with care and keep a steady rhythm when learning something new";

export function TrainingSession(): JSXElement {
  const [storageNotice, setStorageNotice] = createSignal("");
  const [profile, setProfile] = createSignal(
    (() => {
      try {
        return parseProfile(localStorage.getItem(storageKey));
      } catch {
        setStorageNotice(
          "Storage is unavailable. Progress lasts until you leave this page.",
        );
        return createProfile();
      }
    })(),
  );
  const [mode, setMode] = createSignal<SessionSummary["kind"]>(
    untrack(profile).sessions.length ? "adaptive" : "diagnostic",
  );
  const [selected, setSelected] = createSignal<string[]>([]);
  const [manual, setManual] = createSignal("");
  const [count, setCount] = createSignal(25);
  const [text, setText] = createSignal("");
  const [typed, setTyped] = createSignal("");
  const [cursor, setCursor] = createSignal(0);
  const position = () => Math.min(typed().length, text().length);
  const correctCharacters = createMemo(
    () =>
      typed()
        .split("")
        .filter((character, index) => character === text()[index]).length,
  );
  const [attempts, setAttempts] = createSignal(0);
  const [errors, setErrors] = createSignal(0);
  const [elapsed, setElapsed] = createSignal(0);
  const [running, setRunning] = createSignal(false);
  const [paused, setPaused] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [result, setResult] = createSignal<SessionSummary>();
  const [confirmReset, setConfirmReset] = createSignal(false);
  const [drillTargets, setDrillTargets] = createSignal<string[]>([]);
  let input: HTMLTextAreaElement | undefined;
  let session = createProfile();
  let activeSince: number | null = null;
  let activeTime = 0;
  let lastKey: number | null = null;
  let lastCorrect = false;
  let lastPosition = -1;
  const ranked = createMemo(() => rankTargets(profile()));
  const targets = createMemo(() =>
    mode() === "manual"
      ? selected()
      : ranked()
          .slice(0, 3)
          .map((item) => item.target),
  );
  const accuracy = () =>
    attempts() ? (100 * (attempts() - errors())) / attempts() : 100;
  const wpm = () =>
    elapsed() > 0
      ? Math.round(correctCharacters() / 5 / (elapsed() / 60000))
      : 0;
  const currentTime = (): number =>
    activeTime + (activeSince !== null ? performance.now() - activeSince : 0);
  const timer = window.setInterval(() => {
    if (untrack(running) && !untrack(paused)) setElapsed(currentTime());
  }, 200);
  const pause = (): void => {
    if (!running() || paused()) return;
    activeTime = currentTime();
    activeSince = null;
    lastKey = null;
    lastCorrect = false;
    setElapsed(activeTime);
    setPaused(true);
  };
  const visibility = (): void => {
    if (document.hidden) pause();
  };
  document.addEventListener("visibilitychange", visibility);
  onCleanup(() => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", visibility);
  });

  const persist = (next: ReturnType<typeof createProfile>): void => {
    setProfile(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageNotice("");
    } catch {
      setStorageNotice(
        "Could not save progress. This session is available until you leave the page.",
      );
    }
  };

  const start = (): void => {
    const chosen = mode() === "diagnostic" ? [] : targets();
    const words =
      mode() === "diagnostic"
        ? diagnostic.split(" ")
        : generateDrill(vocabulary, chosen, count());
    setText(words.join(" "));
    setDrillTargets(chosen);
    setTyped("");
    setCursor(0);
    setAttempts(0);
    setErrors(0);
    setElapsed(0);
    setNotice("");
    setResult(undefined);
    session = createProfile();
    activeTime = 0;
    activeSince = null;
    lastKey = null;
    lastCorrect = false;
    setPaused(false);
    setRunning(true);
    if (input !== undefined) {
      // Reset only for a new drill. Keep native edits/undo untouched while typing.
      input.value = "";
      input.setSelectionRange(0, 0);
      input.focus();
    }
  };

  const finish = (): void => {
    if (!running() || typed().length < text().length) return;
    const durationMs = Math.max(currentTime(), 1);
    const summary: SessionSummary = {
      date: Date.now(),
      wpm: Math.round(correctCharacters() / 5 / (durationMs / 60000)),
      accuracy: accuracy() / 100,
      targets: drillTargets(),
      kind: mode(),
      characters: text().length,
      durationMs,
    };
    setElapsed(durationMs);
    activeSince = null;
    setRunning(false);
    setResult(summary);
    persist(mergeSession(profile(), session, summary));
  };

  const handleInput = (
    event: InputEvent & { currentTarget: HTMLTextAreaElement },
  ): void => {
    if (!running() || paused()) return;
    const element = event.currentTarget;
    const next = element.value;
    const before = typed();
    const insertion = getTextInsertion(
      before,
      next,
      element.selectionEnd,
      event.data,
    );
    const isHistory =
      event.inputType === "historyUndo" || event.inputType === "historyRedo";
    const isDeletion = event.inputType.startsWith("delete");
    const now = performance.now();
    if (next !== before || insertion.text.length) activeSince ??= now;
    if (!isHistory && !isDeletion) {
      for (let offset = 0; offset < insertion.text.length; offset++) {
        const index = insertion.start + offset;
        const character = insertion.text[offset] as string;
        const expected = text()[index];
        const correct = character === expected;
        const continuous =
          insertion.text.length === 1 &&
          insertion.start === before.length &&
          lastCorrect &&
          lastPosition === index - 1 &&
          before[index - 1] === text()[index - 1];
        if (expected !== undefined) {
          recordAttempt(session, {
            expected,
            actual: character,
            previous: continuous ? text()[index - 1] : undefined,
            latencyMs:
              continuous && lastKey !== null ? now - lastKey : undefined,
          });
        }
        setAttempts((value) => value + 1);
        if (!correct) setErrors((value) => value + 1);
        lastKey = now;
        lastPosition = index;
        lastCorrect = correct;
      }
    }
    if (isHistory || isDeletion || insertion.text.length !== 1) {
      lastCorrect = false;
      lastKey = null;
    }
    setTyped(next);
    setCursor(element.selectionStart);
    setElapsed(currentTime());
  };

  const keydown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      pause();
    } else if (event.key === "Enter") {
      event.preventDefault();
      finish();
    }
    // Character input, Backspace, Delete, selection, and shortcuts stay native.
  };

  const resume = (): void => {
    setPaused(false);
    lastKey = null;
    lastCorrect = false;
    if (position() || attempts()) activeSince = performance.now();
    input?.focus();
  };

  const choose = (target: string): void => {
    if (running()) return;
    setMode("manual");
    setResult(undefined);
    setSelected((values) =>
      values.includes(target)
        ? values.filter((value) => value !== target)
        : [...values.slice(-2), target],
    );
  };

  const addTarget = (event: SubmitEvent): void => {
    event.preventDefault();
    const target = manual().trim().toLowerCase();
    if (
      !/^[a-z]{1,2}$/.test(target) ||
      !vocabulary.some((word) => word.includes(target))
    ) {
      setNotice(
        "Choose one letter or a two-letter pair found in an English word.",
      );
      return;
    }
    if (!selected().includes(target)) choose(target);
    setManual("");
    setNotice("");
  };

  return (
    <div class="grid gap-8 py-8 text-base" data-testid="smart-training">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div class="mb-2 flex items-center gap-2 text-sm text-main">
            <Fa icon="fa-bullseye" /> focused practice
          </div>
          <h1 class="text-3xl text-text">smart training</h1>
        </div>
        <p class="text-sm text-sub">
          English · saved on this device · {profile().sessions.length} sessions
          retained
        </p>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-4 rounded bg-sub-alt p-3">
        <div class="flex flex-wrap gap-2" aria-label="Training mode">
          <For each={["diagnostic", "adaptive", "manual"] as const}>
            {(item) => (
              <Button
                text={item === "manual" ? "choose targets" : item}
                active={mode() === item}
                disabled={running()}
                onClick={() => {
                  setMode(item);
                  setResult(undefined);
                }}
              />
            )}
          </For>
        </div>
        <Show when={mode() !== "diagnostic"}>
          <div class="flex items-center gap-2 text-sm">
            <span class="text-sub">words</span>
            <For each={[25, 50]}>
              {(size) => (
                <Button
                  text={String(size)}
                  active={count() === size}
                  disabled={running()}
                  onClick={() => setCount(size)}
                />
              )}
            </For>
          </div>
        </Show>
      </div>

      <section class="grid gap-5" aria-label="Typing drill">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="max-w-2xl">
            <h2 class="text-lg text-main">
              {running()
                ? paused()
                  ? "paused"
                  : "find your rhythm"
                : result()
                  ? "session complete"
                  : mode() === "diagnostic"
                    ? "find your starting point"
                    : mode() === "manual"
                      ? "make it your practice"
                      : targets().length
                        ? "your next focus"
                        : "build your typing profile"}
            </h2>
            <p class="mt-2 text-text">
              {mode() === "diagnostic"
                ? "A short, repeatable check across the alphabet. Type accurately at a comfortable pace."
                : mode() === "manual"
                  ? "Choose up to three keys or letter pairs below. Your drill mixes focused words with everyday words."
                  : targets().length
                    ? `Practice ${targets().join(", ")} with a drill based on your recent accuracy and rhythm.`
                    : "Complete a diagnostic or a mixed drill so we can find useful practice targets."}
            </p>
          </div>
          <Show when={running() || result()}>
            <div class="flex gap-6 text-main" aria-label="Session statistics">
              <div>
                <div class="text-sm text-sub">wpm</div>
                <div class="text-3xl">{result()?.wpm ?? wpm()}</div>
              </div>
              <div>
                <div class="text-sm text-sub">accuracy</div>
                <div class="text-3xl">
                  {result()
                    ? ((result()?.accuracy ?? 0) * 100).toFixed(1)
                    : accuracy().toFixed(1)}
                  %
                </div>
              </div>
            </div>
          </Show>
        </div>

        <Show
          when={running()}
          fallback={
            <div class="flex flex-wrap items-center gap-4 py-4">
              <Button
                text={
                  result()
                    ? "next drill"
                    : mode() === "diagnostic"
                      ? "start diagnostic"
                      : "start training"
                }
                fa={{ icon: "fa-play" }}
                active
                disabled={mode() === "manual" && !selected().length}
                onClick={() => {
                  if (result()) setMode("adaptive");
                  start();
                }}
                class="px-6 py-3"
              />
              <Show when={result()}>
                <span role="status" class="text-text">
                  {(result()?.accuracy ?? 0) >= 0.97
                    ? "Steady and accurate. Keep the same rhythm in your next drill."
                    : "Ease off the speed and aim for 97% accuracy in your next drill."}
                </span>
              </Show>
            </div>
          }
        >
          <div class="rounded border border-sub-alt p-4 sm:p-6">
            <div class="mb-4 flex justify-between text-sm text-sub">
              <span>
                {drillTargets().length
                  ? `focus: ${drillTargets().join(" · ")}`
                  : "balanced practice"}
              </span>
              <span>
                {position()} / {text().length} characters
              </span>
            </div>
            <div
              class="mb-6 h-1 overflow-hidden rounded bg-sub-alt"
              role="progressbar"
              aria-label="Drill progress"
              aria-valuemin={0}
              aria-valuemax={text().length}
              aria-valuenow={position()}
            >
              <div
                class="h-full bg-main"
                style={{ width: `${(position() / text().length) * 100}%` }}
              ></div>
            </div>
            <p
              id="training-prompt"
              class="text-2xl leading-relaxed break-words whitespace-pre-wrap sm:text-3xl"
              aria-label={text()}
            >
              <For each={text().split("")}>
                {(letter, index) => (
                  <span
                    aria-hidden="true"
                    class={cn(
                      "transition-colors",
                      typed()[index()] === undefined
                        ? "text-sub"
                        : typed()[index()] === letter
                          ? "text-text"
                          : "text-error underline",
                      index() === cursor() && "border-l-2 border-caret",
                    )}
                  >
                    {letter}
                  </span>
                )}
              </For>
              <span class="text-error underline">
                {typed().slice(text().length)}
              </span>
            </p>
            <label
              for="training-input"
              class="mt-6 mb-2 block text-sm text-text"
            >
              {paused()
                ? "Resume when you are ready."
                : "Type the text above. Edit mistakes normally, then press Enter to finish."}
            </label>
            <textarea
              ref={(element) => {
                input = element;
              }}
              id="training-input"
              aria-describedby="training-prompt training-help"
              aria-label="Typing practice"
              rows={3}
              inputMode="text"
              autocomplete="off"
              autoCapitalize="off"
              // Solid uses the lowercase spellcheck attribute.
              // oxlint-disable-next-line react/no-unknown-property
              spellcheck={false}
              disabled={paused()}
              placeholder={paused() ? "Paused" : "Type here…"}
              class="w-full rounded bg-sub-alt p-3 text-text focus:outline-2 focus:outline-main"
              onKeyDown={keydown}
              onBlur={pause}
              onInput={handleInput}
              onSelect={(event) =>
                setCursor(event.currentTarget.selectionStart)
              }
              onPaste={(event) => {
                event.preventDefault();
                setNotice(
                  "Type each character yourself so the drill can measure your progress.",
                );
              }}
            ></textarea>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p id="training-help" class="text-sm text-sub">
                Mistakes still count after correction. Esc or leaving the input
                pauses.
              </p>
              <div class="flex flex-wrap gap-2">
                <Button
                  text="finish drill"
                  active
                  disabled={typed().length < text().length}
                  onClick={finish}
                />
                <Show when={paused()}>
                  <Button
                    text="resume"
                    fa={{ icon: "fa-play" }}
                    active
                    onClick={resume}
                  />
                </Show>
                <Button
                  text="restart drill"
                  fa={{ icon: "fa-redo" }}
                  onClick={start}
                />
                <Button
                  text="end drill"
                  variant="text"
                  onClick={() => {
                    activeSince = null;
                    setRunning(false);
                    setResult(undefined);
                    setNotice(
                      "Drill ended. Incomplete drills do not change your training profile.",
                    );
                  }}
                />
              </div>
            </div>
          </div>
        </Show>
        <Show when={notice()}>
          <p role="status" class="text-sm text-main">
            {notice()}
          </p>
        </Show>
      </section>

      <div class="grid gap-8 lg:grid-cols-2">
        <section aria-label="Keyboard focus" class="grid content-start gap-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg">your keyboard</h2>
            <span class="text-sm text-sub">select keys to focus</span>
          </div>
          <div class="grid gap-2 rounded bg-sub-alt p-3 sm:p-5">
            <For each={["qwertyuiop", "asdfghjkl", "zxcvbnm"]}>
              {(row) => (
                <div class="flex justify-center gap-1 sm:gap-2">
                  <For each={row.split("")}>
                    {(key) => {
                      const stat = () => profile().keys[key];
                      const weak = () =>
                        ranked()
                          .slice(0, 5)
                          .some(
                            (item) =>
                              item.kind === "key" && item.target === key,
                          );
                      return (
                        <button
                          type="button"
                          disabled={running()}
                          aria-pressed={
                            selected().includes(key) && mode() === "manual"
                          }
                          aria-label={`${key}${stat() ? `, ${Math.round(100 * (1 - (stat()?.errors ?? 0) / (stat()?.attempts ?? 1)))} percent accuracy, ${stat()?.attempts} attempts` : ", no samples"}`}
                          onClick={() => choose(key)}
                          class={cn(
                            "h-10 w-8 rounded border border-bg bg-bg text-sm text-sub transition-colors hover:border-main focus-visible:outline-2 focus-visible:outline-main disabled:cursor-default sm:h-12 sm:w-12 sm:text-base",
                            stat() && "text-text",
                            weak() && "border-main text-main",
                            mode() === "manual" &&
                              selected().includes(key) &&
                              "bg-main text-bg",
                          )}
                        >
                          {key}
                        </button>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
          </div>
          <p class="text-sm text-sub">
            Highlighted outlines mark suggested keys. Unsampled keys stay dim.
          </p>
          <Show when={mode() === "manual"}>
            <form
              class="flex flex-wrap items-center gap-2"
              onSubmit={addTarget}
            >
              <label for="training-target" class="text-sm">
                key or pair
              </label>
              <input
                id="training-target"
                value={manual()}
                maxLength={2}
                disabled={running()}
                onInput={(event) => setManual(event.currentTarget.value)}
                placeholder="th"
                class="w-20 rounded bg-sub-alt p-2 text-text"
              />
              <Button text="add target" type="submit" disabled={running()} />
              <For each={selected()}>
                {(target) => (
                  <Button
                    text={`${target} ×`}
                    active
                    disabled={running()}
                    onClick={() => choose(target)}
                  />
                )}
              </For>
            </form>
          </Show>
        </section>

        <section
          aria-label="Recommended targets"
          class="grid content-start gap-4"
        >
          <h2 class="text-lg">where to focus</h2>
          <Show
            when={ranked().length}
            fallback={
              <div class="rounded bg-sub-alt p-6">
                <Fa icon="fa-seedling" class="mb-3 text-2xl text-main" />
                <p>
                  {profile().sessions.length
                    ? "No clear weak spots yet."
                    : "Start with a diagnostic."}
                </p>
                <p class="mt-2 text-sm text-sub">
                  Recommendations appear after at least five attempts for a key
                  or three for a pair. We look for errors first, then slower
                  transitions.
                </p>
              </div>
            }
          >
            <div class="grid gap-2">
              <For each={ranked().slice(0, 5)}>
                {(item) => (
                  <button
                    type="button"
                    disabled={running()}
                    onClick={() => choose(item.target)}
                    class="flex items-center justify-between gap-3 rounded bg-sub-alt p-3 text-left text-text hover:text-main focus-visible:outline-2 focus-visible:outline-main"
                  >
                    <span class="flex items-center gap-3">
                      <span class="min-w-10 text-xl text-main">
                        {item.target}
                      </span>
                      <span class="text-sm text-sub">
                        {item.kind} · {Math.round(item.attempts)} weighted
                        samples
                      </span>
                    </span>
                    <span class="text-right text-sm">
                      {(item.accuracy * 100).toFixed(1)}% accuracy
                      <span class="block text-sub">
                        {item.latencyMs
                          ? `${Math.round(item.latencyMs)} ms`
                          : "collecting rhythm"}
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <p class="text-sm text-sub">
            Based on completed drills here. Targets adapt as you practice; they
            are suggestions, not a skill rating.
          </p>
        </section>
      </div>

      <section class="grid gap-4" aria-label="Training history">
        <div class="flex flex-wrap justify-between gap-3">
          <h2 class="text-lg">recent sessions</h2>
          <span class="text-sm text-sub">
            Repeat the diagnostic to compare the same text.
          </span>
        </div>
        <Show
          when={profile().sessions.length}
          fallback={
            <p class="rounded bg-sub-alt p-5 text-sub">
              Your first completed drill will appear here.
            </p>
          }
        >
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="text-sub">
                <tr>
                  <th class="p-3">session</th>
                  <th class="p-3">focus</th>
                  <th class="p-3">wpm</th>
                  <th class="p-3">accuracy</th>
                </tr>
              </thead>
              <tbody>
                <For
                  each={[...profile().sessions]
                    .sort((a, b) => b.date - a.date)
                    .slice(0, 5)}
                >
                  {(item) => (
                    <tr class="border-t border-sub-alt">
                      <td class="p-3">
                        {item.kind}
                        <span class="block text-sub">
                          {new Date(item.date).toLocaleString()}
                        </span>
                      </td>
                      <td class="p-3 text-main">
                        {item.targets.join(", ") || "balanced"}
                      </td>
                      <td class="p-3">{item.wpm}</td>
                      <td class="p-3">{(item.accuracy * 100).toFixed(1)}%</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
        <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-sub">
          <p>
            No account needed. Training results are separate from test scores
            and leaderboards.
          </p>
          <Button
            text="reset training data"
            variant="text"
            disabled={running()}
            onClick={() => setConfirmReset(true)}
          />
        </div>
        <Show when={confirmReset()}>
          <div
            class="flex flex-wrap items-center gap-3 rounded border border-error p-4"
            role="alert"
          >
            <p>Delete this browser’s training history and key statistics?</p>
            <Button
              text="delete training data"
              danger
              onClick={() => {
                persist(createProfile());
                setResult(undefined);
                setSelected([]);
                setMode("diagnostic");
                setConfirmReset(false);
              }}
            />
            <Button text="cancel" onClick={() => setConfirmReset(false)} />
          </div>
        </Show>
        <Show when={storageNotice()}>
          <p role="status" class="text-main">
            {storageNotice()}
          </p>
        </Show>
      </section>
    </div>
  );
}
