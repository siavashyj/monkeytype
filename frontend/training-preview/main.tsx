import { render } from "solid-js/web";

import { TrainingSession } from "../src/ts/components/pages/training/TrainingPage";
import "@fortawesome/fontawesome-free/css/all.min.css";

import "./style.css";

render(
  () => (
    <div class="mx-auto max-w-6xl px-4 sm:px-8">
      <header class="flex flex-wrap items-center justify-between gap-4 border-b border-sub-alt py-8">
        <a href="/" class="flex items-center gap-3 text-2xl text-text">
          <span class="text-main" aria-hidden="true">
            ⌨
          </span>
          monkeytype<span class="text-sm text-sub">/ training fork</span>
        </a>
        <a
          href="https://github.com/siavashyj/monkeytype/tree/feat/smart-training"
          target="_blank"
          rel="noreferrer"
          class="text-sm text-sub hover:text-main"
        >
          source code ↗
        </a>
      </header>
      <main>
        <TrainingSession />
      </main>
      <footer class="border-t border-sub-alt py-6 text-sm text-sub">
        An independent fork of Monkeytype · GPL-3.0 · Training stays in this
        browser.
      </footer>
    </div>
  ),
  document.getElementById("training-app") as HTMLElement,
);
