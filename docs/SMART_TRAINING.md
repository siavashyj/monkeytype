# Smart training

Open **train** in the header or `/training`. The standalone `pnpm dev:training` entry uses the same Solid component without requiring Monkeytype's backend or Firebase. `pnpm build:training` emits that standalone app to `dist/` for static hosting. The existing `pnpm build-fe` remains the full frontend build.

## Practice loop

1. Start with the repeatable diagnostic, which includes all English letters.
2. Type each highlighted character. A wrong character leaves the caret in place and still counts as an error after correction. Backspace revisits the preceding character without awarding duplicate progress.
3. Complete the drill to save key/pair statistics and a session summary. Interrupted or restarted drills do not change the profile.
4. Use adaptive practice for suggested targets, or choose up to three letters/pairs. Drills include roughly 70% targeted words and 30% general vocabulary from Monkeytype's English 1k list.

Escape, tabbing away, or hiding the tab pauses. Resume excludes paused time from WPM and resets transition timing. English direct input is supported; paste, composition, and held-key repeats do not contribute synthetic typing results.

## Recommendation model

The deterministic engine uses error rate and mean valid transition latency relative to the user's own profile. Errors contribute 70% of the score and slower transitions 30%. Only correct transitions between adjacent letters contribute timing, and intervals outside 30–2000 ms are excluded. Keys require five weighted attempts, pairs three. Targets with no measured weakness are omitted.

Each completed session retains 90% of earlier evidence before adding new observations. Counts shown as weighted samples reflect this recency weighting. The most recent 50 summaries remain available; the repeatable diagnostic enables comparison on the same text, while WPM across different adaptive drills is not directly comparable.

Progress lives in `localStorage` under `monkeytype.smartTraining.v1`. Accuracy values are ratios internally and percentages in the UI. Malformed or incompatible stored profiles fall back safely. Storage failures produce a visible notice and allow in-memory practice. Reset requires an explicit in-app confirmation and affects only this training data.

Training never writes regular results, account data, or leaderboard scores. Existing typing history is not imported. This feature currently supports English only and does not synchronize between tabs or devices.

## Validation

```sh
pnpm vitest run frontend/__tests__/training/engine.spec.ts frontend/__tests__/components/TrainingPage.spec.tsx
pnpm oxlint --format agent --type-aware --type-check frontend/src/ts/training frontend/src/ts/components/pages/training
pnpm build:training
```

The engine tests cover evidence thresholds, error/latency scoring, targeted word generation, corrupted data, decay, and bounded history. The component tests exercise the real practice loop, corrections, pauses, restarting, manual targets, and persistence.
