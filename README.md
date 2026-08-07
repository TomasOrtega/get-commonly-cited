# commonly-cited

[![CI](https://github.com/TomasOrtega/get-commonly-cited/actions/workflows/ci.yml/badge.svg)](https://github.com/TomasOrtega/get-commonly-cited/actions/workflows/ci.yml)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![BSD-3-Clause](https://img.shields.io/badge/license-BSD--3--Clause-green.svg)](LICENSE)

**[Use the web app](https://tomasortega.github.io/get-commonly-cited/)** — no
installation or API key required.

`commonly-cited` finds the people who occur most often in a bibliography. It is
built for the messy reference lists people actually paste from papers, PDFs, web
pages, and word processors. It also resolves citations containing “et al.”
against scholarly metadata so the hidden coauthors are counted.

```text
$ commonly-cited references.txt --audit audit.json
                  Most commonly cited people
┏━━━━━━┳━━━━━━━━━━━━━━┳━━━━━━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━┳━━━━━━━━━━━━━━┓
┃ Rank ┃ Person       ┃ Cited works ┃ Fractional ┃ Share ┃ Identifier   ┃
┡━━━━━━╇━━━━━━━━━━━━━━╇━━━━━━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━╇━━━━━━━━━━━━━━┩
│    1 │ Jane Smith   │           7 │      2.417 │ 35.0% │ OpenAlex A…  │
│    2 │ Alex Doe     │           5 │      1.583 │ 25.0% │ ORCID 0000…  │
└──────┴──────────────┴─────────────┴────────────┴───────┴──────────────┘
Parsed 22 references; matched 20, ambiguous 1, unmatched 1, errors 0;
20 distinct works, 64 authors expanded from et al.
```

The tool is conservative by design. It leaves low-confidence or near-tied
matches unresolved instead of quietly assigning the wrong paper. The optional
audit file records every match, score, alternative candidate, recovered author,
and provider error.

The static web app is Crossref-only and runs the analysis in your browser.
Crossref responses and their citation queries are cached in that browser, and
reference text goes directly to Crossref rather than through a commonly-cited
server. Public API rate limits make large bibliographies slower than local
DOI-heavy runs. The browser matcher uses the same evidence weights and
confidence gates as the Python package, but borderline fuzzy scores can differ
slightly from RapidFuzz-backed CLI results.

## What it does

1. Splits poorly formatted input into references. Numbered lists, wrapped lines,
   blank-line-separated citations, one-citation-per-line text, BibTeX, and RIS
   are supported.
2. Extracts exact DOIs when present.
3. Searches Crossref using the complete citation when a DOI is absent.
4. Scores candidates using title, visible authors, year, and venue evidence.
5. Optionally enriches accepted works with OpenAlex author IDs and ORCIDs.
6. Recovers deposited coauthors hidden behind “et al.”.
7. Deduplicates repeated references and counts each person once per cited work.
8. Produces a terminal table, CSV, Markdown, or a complete JSON audit trail.

Crossref works without an account or API key. OpenAlex enrichment is optional,
but it gives substantially better identity resolution for name variants and
same-name authors. OpenAlex requires a free API key as of February 13, 2026.

## Installation

For a keyless browser version, open the
[hosted web app](https://tomasortega.github.io/get-commonly-cited/). See the
[web app documentation](https://tomasortega.github.io/get-commonly-cited/docs/web/)
for its privacy, caching, and rate-limit behavior.

Install the command-line tool from PyPI:

```bash
uv tool install commonly-cited
```

Or install it into an existing Python environment:

```bash
python -m pip install commonly-cited
```

For development from a source checkout:

```bash
git clone https://github.com/TomasOrtega/get-commonly-cited.git
cd get-commonly-cited
uv tool install .
```

## Basic use

Read a file:

```bash
commonly-cited references.txt
```

Paste through standard input:

```bash
pbpaste | commonly-cited -
# On Linux, for example: xclip -selection clipboard -o | commonly-cited -
```

Save both the ranking and a detailed audit:

```bash
commonly-cited references.txt \
  --format csv \
  --output commonly-cited.csv \
  --audit audit.json
```

Use JSON for downstream analysis:

```bash
commonly-cited references.txt --format json --top 0 > result.json
```

Rank large-team papers fractionally, assigning each author
`1 / number of counted authors` for a work:

```bash
commonly-cited references.txt --ranking fractional
```

## Metadata configuration

Crossref recommends identifying automated clients with a contact email:

```bash
export CROSSREF_MAILTO="you@example.org"
```

To add OpenAlex author disambiguation:

```bash
export OPENALEX_API_KEY="your-free-key"
commonly-cited references.txt
```

The default `--provider auto` mode always uses Crossref and uses OpenAlex when
`OPENALEX_API_KEY` is present. Other choices are `crossref`, `openalex`, and
`both`.

Metadata responses are cached for 30 days in the platform-standard user cache
directory. Change the location with `COMMONLY_CITED_CACHE_DIR`, change the
lifetime with `--cache-ttl-days`, disable caching with `--no-cache`, or replay
only cached requests with `--offline`.

## Input examples

The parser accepts mixed formatting such as:

```text
References

[1] Smith, J., Doe, A., et al. (2020). A useful result.
    Journal of Useful Results 4, 10–20.

[2] J. Smith and B. Roe. 2021. Another result.
    https://doi.org/10.1234/example
```

It also handles references pasted one per line, inline-numbered lists, and
common export formats. Segmentation is heuristic, so the audit file should be
checked when the source text has lost all boundaries between citations.

## Counting and identity rules

The primary count is the number of distinct matched works authored by a person.
A duplicate bibliography entry does not count twice unless `--keep-duplicates`
is supplied. Fractional counts are also reported.

Identity keys are chosen in this order:

1. ORCID
2. OpenAlex author ID
3. another provider ID
4. an exact normalized full name

Identifiers are joined transitively when metadata records link an ORCID, an
OpenAlex ID, or another provider ID for the same author. A name-only record is
attached to an identified person only when the same normalized name maps to one
unique identified person in the bibliography. The tool intentionally avoids
aggressive initial-only clustering because it can merge different people.

Collaborations, consortia, committees, and similar collective authors are
excluded by default because the requested output is people. Use
`--include-collective-authors` to keep them.

## Accuracy and limitations

The result is only as complete as the metadata deposited by publishers and
indexed by the providers. A citation may remain unmatched when it is too
incomplete, refers to a work outside the provider, or has several equally
plausible candidates.

OpenAlex work responses expose at most the first 100 authors. When both
providers are enabled, `commonly-cited` uses the longer Crossref author list as
the structural base and attaches OpenAlex identities to aligned authors rather
than dropping later names. This still cannot recover authors missing from both
sources.

Raw references are sent to the selected public metadata APIs. Exact API
responses are cached locally. Use `--offline` after warming the cache when the
references should not be transmitted again.

See [the algorithm documentation](docs/algorithm.md) for the scoring and
acceptance rules.

## Development

The repository follows the Scientific Python development-guide conventions:
`pyproject.toml`, a `src/` layout, typed public APIs, Ruff, mypy, pytest,
coverage, pre-commit/prek, Nox, uv-based CI, documentation checks, package-build
checks, Dependabot, and release automation.

```bash
uv sync --group dev
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run mkdocs build --strict
npm --prefix web ci
npm --prefix web run lint
npm --prefix web test
npm --prefix web run build
```

Or run the grouped sessions:

```bash
uvx nox -s lint tests docs build
```

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

`commonly-cited` is distributed under the BSD 3-Clause License. See
[LICENSE](LICENSE).
