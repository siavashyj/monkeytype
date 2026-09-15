#!/usr/bin/env python3
"""Generate the filtered top-200 English words from wordfreq 3.1.1.

Usage:
    python scripts/generate-training-top-200.py frontend/src/ts/training/data/english-top-200.json
"""

from __future__ import annotations

import argparse
import json
from importlib.metadata import version as installed_version
from pathlib import Path

from wordfreq import top_n_list


PACKAGE = "wordfreq"
VERSION = "3.1.1"
LANGUAGE = "en"
WORDLIST = "large"
REQUESTED_WORDS = 50_000
TARGET_COUNT = 200


def is_lower_ascii_alpha(word: str) -> bool:
    """Return whether *word* contains only lowercase ASCII letters."""

    return bool(word) and all("a" <= character <= "z" for character in word)


def build_dataset() -> dict[str, object]:
    actual_version = installed_version(PACKAGE)
    if actual_version != VERSION:
        raise RuntimeError(
            f"{PACKAGE}=={VERSION} is required; installed {actual_version!r}"
        )

    ranked_words = top_n_list(LANGUAGE, REQUESTED_WORDS, wordlist=WORDLIST)
    filtered_words = [word for word in ranked_words if is_lower_ascii_alpha(word)]
    words = filtered_words[:TARGET_COUNT]
    if len(words) != TARGET_COUNT or len(set(words)) != TARGET_COUNT:
        raise RuntimeError(
            f"source yielded {len(words)} unique filtered words; expected {TARGET_COUNT}"
        )

    return {
        "source": {
            "package": PACKAGE,
            "version": VERSION,
            "language": LANGUAGE,
            "wordlist": WORDLIST,
            "api": "top_n_list",
            "requestedWords": REQUESTED_WORDS,
            "ranking": "source frequency order",
        },
        "filter": {
            "description": "lowercase ASCII alphabetic only",
            "predicate": "non-empty and every character is in a-z",
            "filteredCandidateCount": len(filtered_words),
        },
        "count": TARGET_COUNT,
        "words": words,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_path", type=Path)
    args = parser.parse_args()
    dataset = build_dataset()
    args.output_path.parent.mkdir(parents=True, exist_ok=True)
    with args.output_path.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(dataset, output, ensure_ascii=False, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
