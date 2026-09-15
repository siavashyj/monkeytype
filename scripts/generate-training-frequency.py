#!/usr/bin/env python3
"""Generate English substring exposure data from wordfreq 3.1.1.

Usage:
    python scripts/generate-training-frequency.py VOCABULARY_JSON OUTPUT_JSON

The vocabulary file is the frontend language JSON.  The diagnostic words are
kept here explicitly so this generator does not depend on parsing a source
component to discover its target set.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from importlib.metadata import version as installed_version
from pathlib import Path
from typing import Iterable, Sequence

from wordfreq import top_n_list, word_frequency


PACKAGE = "wordfreq"
VERSION = "3.1.1"
LANGUAGE = "en"
WORDLIST = "large"
REQUESTED_WORDS = 50_000
MAX_SUBSTRING_LENGTH = 4
PER_MILLION = 1_000_000
TOP200_WORD_COUNT = 200

# Keep this in sync with the diagnostic drill in TrainingPage.tsx.  Explicit
# words make the target vocabulary reproducible without parsing TypeScript.
DIAGNOSTIC_WORDS: tuple[str, ...] = (
    "the",
    "quick",
    "brown",
    "fox",
    "jumps",
    "over",
    "the",
    "lazy",
    "dog",
    "then",
    "we",
    "write",
    "each",
    "word",
    "with",
    "care",
    "and",
    "keep",
    "a",
    "steady",
    "rhythm",
    "when",
    "learning",
    "something",
    "new",
)


def _is_ascii_lowercase_word(value: str) -> bool:
    """Return whether *value* consists only of ASCII lowercase letters."""

    return bool(value) and all("a" <= character <= "z" for character in value)


def _substrings(word: str, max_length: int = MAX_SUBSTRING_LENGTH) -> Iterable[str]:
    """Yield every overlapping substring of *word* up to *max_length*."""

    for length in range(1, min(max_length, len(word)) + 1):
        for start in range(len(word) - length + 1):
            yield word[start : start + length]


def aggregate_substring_exposures(
    word_frequencies: Iterable[tuple[str, float]],
    max_length: int = MAX_SUBSTRING_LENGTH,
) -> dict[int, dict[str, float]]:
    """Sum frequency exposure for all overlapping substrings.

    This is deliberately pure: callers provide `(word, frequency)` pairs and
    receive an independent map keyed by substring length.  For example,
    ``aggregate_substring_exposures([("banana", 1.0)])[3]["ana"]`` is ``2.0``.
    """

    exposures: dict[int, defaultdict[str, float]] = {
        length: defaultdict(float) for length in range(1, max_length + 1)
    }
    for word, frequency in word_frequencies:
        for length in range(1, min(max_length, len(word)) + 1):
            for start in range(len(word) - length + 1):
                exposures[length][word[start : start + length]] += frequency
    return {length: dict(values) for length, values in exposures.items()}


def _load_vocabulary(path: Path) -> list[str]:
    with path.open(encoding="utf-8") as vocabulary_file:
        payload = json.load(vocabulary_file)
    words = payload.get("words")
    if not isinstance(words, list) or not all(isinstance(word, str) for word in words):
        raise ValueError(f"{path} must contain a string array at `words`")
    return words


def _target_substrings(vocabulary_words: Sequence[str]) -> dict[int, set[str]]:
    target_words = {
        word.lower()
        for word in (*vocabulary_words, *DIAGNOSTIC_WORDS)
        if _is_ascii_lowercase_word(word.lower())
    }
    targets = {length: set() for length in range(1, MAX_SUBSTRING_LENGTH + 1)}
    for word in target_words:
        for substring in _substrings(word):
            targets[len(substring)].add(substring)
    return targets


def build_dataset(vocabulary_path: Path) -> dict[str, object]:
    """Build the deterministic JSON-compatible dataset for *vocabulary_path*."""

    if installed_version(PACKAGE) != VERSION:
        raise RuntimeError(
            f"{PACKAGE}=={VERSION} is required; installed {installed_version(PACKAGE)!r}"
        )

    corpus_words = top_n_list(LANGUAGE, REQUESTED_WORDS, wordlist=WORDLIST)
    alphabetic_words = [word for word in corpus_words if _is_ascii_lowercase_word(word)]
    vocabulary_words = _load_vocabulary(vocabulary_path)
    targets = _target_substrings(
        (*vocabulary_words, *alphabetic_words[:TOP200_WORD_COUNT])
    )
    word_frequencies = (
        (word, word_frequency(word, LANGUAGE, wordlist=WORDLIST))
        for word in alphabetic_words
    )
    exposures = aggregate_substring_exposures(word_frequencies)

    max_per_million = {
        str(length): round(max(exposures[length].values(), default=0.0) * PER_MILLION, 6)
        for length in range(1, MAX_SUBSTRING_LENGTH + 1)
    }
    retained: dict[str, float] = {}
    all_targets = sorted(
        (target for targets_for_length in targets.values() for target in targets_for_length),
        key=lambda target: (len(target), target),
    )
    for target in all_targets:
        retained[target] = round(
            exposures[len(target)].get(target, 0.0) * PER_MILLION,
            6,
        )

    return {
        "source": {
            "package": PACKAGE,
            "version": VERSION,
            "language": LANGUAGE,
            "wordlist": WORDLIST,
            "requestedWords": REQUESTED_WORDS,
            "alphabeticWords": len(alphabetic_words),
            "frequencyUnit": "occurrences per million words",
            "exposure": "sum(word_frequency(word, 'en', wordlist='large') * overlapping occurrence count)",
        },
        "maxPerMillion": max_per_million,
        "perMillion": retained,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vocabulary_path", type=Path)
    parser.add_argument("output_path", type=Path)
    args = parser.parse_args()

    dataset = build_dataset(args.vocabulary_path)
    args.output_path.parent.mkdir(parents=True, exist_ok=True)
    with args.output_path.open("w", encoding="utf-8", newline="\n") as output_file:
        json.dump(dataset, output_file, ensure_ascii=False, sort_keys=False, indent=2)
        output_file.write("\n")


if __name__ == "__main__":
    main()
