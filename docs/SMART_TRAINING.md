# Smart training

Open **train** in the header or `/training`. The standalone `pnpm dev:training` entry uses the same Solid component without requiring Monkeytype's backend or Firebase. `pnpm build:training` emits that standalone app to `dist/` for static hosting. The existing `pnpm build-fe` remains the full frontend build.

## Practice loop

1. Start with the repeatable diagnostic, which includes all English letters.
2. Type freely in the text field. The prompt highlights mismatches in red while the text field shows exactly what you typed. Incorrect characters move the caret forward. Backspace deletes what you actually typed; selection, word deletion, and undo use normal browser editing. Corrections never erase historical errors.
3. After typing the full prompt length, press Enter or choose **finish drill** to save key/pair/triple/quad statistics and a session summary. You can still correct the final character before finishing, or finish with uncorrected mistakes. WPM counts currently correct characters, excluding deleted, extra, and incorrect characters. Interrupted or restarted drills do not change the profile.
4. Use adaptive practice for suggested targets, or choose up to three keys or 2–4-letter sequences. Drills include roughly 70% targeted words and 30% general vocabulary from Monkeytype's English 1k list.

Escape, tabbing away, or hiding the tab pauses. Resume excludes paused time from WPM and resets transition timing. Clipboard paste remains disabled for practice. Native input events support keyboard and touch editing. Deletions and undo/redo update the text without counting as new typing attempts; only continuous single-character input contributes transition timing.

The prompt uses a separate, absolutely positioned caret so movement never changes letter widths or line breaks. Caret positioning runs once per animation frame, glides horizontally, and snaps on line changes or resize. Reduced-motion preferences disable the glide. Letter feedback updates immediately, and live statistics reserve their width to keep the layout stable.

## Recommendation model

The deterministic engine uses error rate and mean valid transition latency relative to the user's own profile. Errors contribute 70% of the score and slower transitions 30%. Only correct transitions between adjacent letters contribute timing, and intervals outside 30–2000 ms are excluded. Keys require five weighted attempts; two- to four-letter sequences require three, each scored against their own sequence-length baseline. Sequence accuracy measures the final-character attempt given a matching prefix; sequence latency measures the final transition, not the duration of the whole sequence. Targets with no measured weakness are omitted.

Each completed session retains 90% of earlier evidence before adding new observations. Counts shown as weighted samples reflect this recency weighting. The most recent 50 summaries remain available; the repeatable diagnostic enables comparison on the same text, while WPM across different adaptive drills is not directly comparable.

Progress lives in `localStorage` under `monkeytype.smartTraining.v1`. Accuracy values are ratios internally and percentages in the UI. Existing version-1 profiles without triple or quad statistics load with empty maps for those sequence lengths while retaining all existing statistics and history. Malformed or incompatible stored profiles fall back safely. Storage failures produce a visible notice and allow in-memory practice. Reset requires an explicit in-app confirmation and affects only this training data.

Training never writes regular results, account data, or leaderboard scores. Existing typing history is not imported. This feature currently supports English only. The training profile belongs to the browser’s site storage, not a signed-in user account. Completed drills survive refreshes and browser restarts, but clearing site data removes them; no account backup or cross-device synchronization is implemented.

## Validation

```sh
pnpm vitest run frontend/__tests__/training/engine.spec.ts frontend/__tests__/components/TrainingPage.spec.tsx
pnpm oxlint --format agent --type-aware --type-check frontend/src/ts/training frontend/src/ts/components/pages/training
pnpm build:training
```

The engine tests cover evidence thresholds, error/latency scoring, targeted word generation, corrupted data, decay, and bounded history. The component tests exercise the real practice loop, corrections, pauses, restarting, manual targets, and persistence.
