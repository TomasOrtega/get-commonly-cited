# Usage

## Input

Pass a UTF-8 text file or use `-` for standard input:

```bash
commonly-cited references.txt
cat references.txt | commonly-cited -
```

Accepted layouts include numbered and bulleted lists, wrapped references,
blank-line-separated records, one reference per line, inline-numbered lists,
BibTeX, and RIS.

## Provider selection

```bash
commonly-cited references.txt --provider crossref
commonly-cited references.txt --provider openalex
commonly-cited references.txt --provider both
```

`auto` is the default. It uses Crossref and enables OpenAlex enrichment when
`OPENALEX_API_KEY` exists.

Configure polite API access through environment variables:

```bash
export CROSSREF_MAILTO="you@example.org"
export OPENALEX_API_KEY="..."
```

API keys are intentionally read from the environment instead of a command-line
option so they do not appear in shell history or process listings.

## Output formats

Terminal table:

```bash
commonly-cited references.txt --format table
```

CSV or Markdown:

```bash
commonly-cited references.txt --format csv --output ranking.csv
commonly-cited references.txt --format markdown --output ranking.md
```

Complete JSON, including the reference-level audit:

```bash
commonly-cited references.txt --format json --top 0 > result.json
```

A separate audit can accompany any main format:

```bash
commonly-cited references.txt --audit audit.json
```

## Matching controls

`--min-confidence` sets the minimum weighted score. `--min-margin` requires the
best candidate to beat the second candidate by a minimum amount. The defaults
favor precision over recall.

```bash
commonly-cited references.txt \
  --min-confidence 0.80 \
  --min-margin 0.06
```

Use `--fail-on-unmatched` in a reproducible pipeline to return exit status 2
when any reference is ambiguous, unmatched, or errored.

## Counting controls

By default, duplicate references are collapsed and collective authors are
excluded.

```bash
commonly-cited references.txt --keep-duplicates
commonly-cited references.txt --include-collective-authors
```

The primary ranking gives one count to each author of each cited work. A
fractional ranking distributes one unit across all counted authors of a work:

```bash
commonly-cited references.txt --ranking fractional
```

## Cache and offline mode

Responses are cached for 30 days. This reduces load on public services and
makes reruns faster.

```bash
commonly-cited references.txt --cache-ttl-days 90
commonly-cited references.txt --no-cache
commonly-cited references.txt --offline
```

`--offline` never makes a network request. A cache miss is recorded as a
provider error for that reference.
