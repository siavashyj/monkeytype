# English sequence frequency data

Generated from `wordfreq` 3.1.1 (`top_n_list("en", 50000,
wordlist="large")` and `word_frequency(word, "en", wordlist="large")`).
The generated values are derived data: each ASCII lowercase corpus word's
frequency is multiplied by the count of each overlapping 1–4 character
substring, then expressed as occurrences per million words.  The source
project and pinned package metadata are available at
<https://github.com/rspeer/wordfreq/> and
<https://pypi.org/project/wordfreq/3.1.1/>.

`wordfreq` was authored by Robyn Speer.  Its code is Apache License 2.0; see
[wordfreq-LICENSE-3.1.1.txt](../frontend/src/ts/training/data/wordfreq-LICENSE.txt).  Its included data
files may be redistributed under the [Creative Commons Attribution-ShareAlike
4.0 International license](https://creativecommons.org/licenses/by-sa/4.0/);
the full text is preserved in [CC-BY-SA-4.0.txt](../frontend/src/ts/training/data/CC-BY-SA-4.0.txt).

The following source credits and links are retained from the pinned upstream
README/NOTICE:

- **Exquisite Corpus**, a Luminoso project that combines the source data into
  `wordfreq`: <https://github.com/LuminosoInsight/exquisite-corpus>.
- **Google Books Ngrams** and **Google Books Syntactic Ngrams**:
  <https://books.google.com/ngrams> and
  <https://commondatastorage.googleapis.com/books/syntactic-ngrams/index.html>.
- **Leeds Internet Corpus**, University of Leeds Centre for Translation
  Studies: <http://corpus.leeds.ac.uk/list.html>.
- **Wikipedia**, the free encyclopedia: <https://www.wikipedia.org>.
- **ParaCrawl**, the multilingual web crawl: <https://paracrawl.eu>.
- **OPUS OpenSubtitles 2018**, whose data originates from OpenSubtitles:
  <http://opus.nlpl.eu/OpenSubtitles.php> and
  <https://www.opensubtitles.org/>.  OpenSubtitles attribution is required.
- **SUBTLEX-US, SUBTLEX-UK, SUBTLEX-CH, SUBTLEX-DE, and SUBTLEX-NL**,
  created by Marc Brysbaert et al. and freely available from the Ghent
  University subtitle-frequency data page:
  <http://crr.ugent.be/programs-data/subtitle-frequencies>.  The upstream
  permission requires crediting the SUBTLEX authors and keeping clear that
  SUBTLEX is freely available data.
- Additional aggregate statistics were collected by a custom application using
  the Twitter streaming API under Twitter's Developer Agreement and Policy;
  no Twitter content is republished in this dataset.

The exact upstream notice used for these credits is preserved in
[wordfreq-NOTICE-3.1.1.md](../frontend/src/ts/training/data/wordfreq-NOTICE.md).  The package source
archive (`wordfreq-3.1.1.tar.gz`) was downloaded from PyPI and its bundled
`README.md` and `LICENSE.txt` were checked against the upstream project.

## Generated table and reproduction

The derived sequence table is distributed under CC BY-SA 4.0. It contains
3,170 sequences supported by the English 1k vocabulary, top-200 vocabulary, and diagnostic, with
exposure and length-specific maxima computed from all 47,973 ASCII alphabetic
words among the source's top 50,000 entries. This filtering and aggregation are
modifications to the original word-frequency data. Unknown sequences use the
neutral 1× priority multiplier.

The generator is a maintenance tool; Python and wordfreq are not application
runtime dependencies. From the repository root, using an isolated Python environment:

```sh
python -m pip install wordfreq==3.1.1
python scripts/generate-training-frequency.py frontend/static/languages/english_1k.json frontend/src/ts/training/data/english-sequence-frequency.json
```

The script verifies the installed wordfreq version. Update its explicit diagnostic
word list if the diagnostic changes, and regenerate when the training vocabulary
changes. The table uses six decimal places and deterministic ordering.

## Top-200 practice vocabulary

`frontend/src/ts/training/data/english-top-200.json` retains the first 200 lowercase ASCII alphabetic entries in the same pinned wordfreq English `large` ranking. Filtering excludes digits, punctuation, and contractions before taking 200 entries; ties preserve source order. This derived vocabulary is distributed under CC BY-SA 4.0 with the same source attribution and license files listed above.

Regenerate with:

```sh
python scripts/generate-training-top-200.py frontend/src/ts/training/data/english-top-200.json
```

Both maintenance generators require `wordfreq==3.1.1`. No corpus access occurs in the browser.
