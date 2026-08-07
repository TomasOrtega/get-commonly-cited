# How matching works

## 1. Reference segmentation

The parser normalizes Unicode and line endings, removes common bibliography
headings, repairs words split by PDF line wrapping, and applies format-specific
segmentation in this order:

1. BibTeX brace-balanced entries
2. RIS `TY` through `ER` records
3. inline numbering such as `[1] ... [2] ...`
4. numbered lines with wrapped continuations
5. blank-line-separated blocks
6. one complete reference per line
7. conservative start-of-reference and semicolon heuristics

Each reference stores its raw normalized text, DOI, plausible years, visible
surnames, and whether it contains “et al.”.

## 2. Exact DOI lookup

A DOI match is accepted with confidence 1.0. When both providers are enabled,
the tool queries Crossref and OpenAlex, retains Crossref's potentially longer
author list, and attaches OpenAlex identities where the names align. A result
from either provider is still accepted when the other is unavailable.

## 3. Bibliographic search

Without a DOI, the complete raw reference is sent to Crossref's
`query.bibliographic` search. OpenAlex search is used only when Crossref does
not produce an accepted match. This ordering reduces OpenAlex API-credit use.

## 4. Candidate score

The weighted score uses evidence that can survive poor formatting:

| Component | Base weight | Definition |
| --- | ---: | --- |
| Title | 0.64 | RapidFuzz token-set similarity between candidate title and raw reference |
| Visible authors | 0.21 | fraction of conservatively extracted surnames found among candidate authors |
| Year | 0.11 | exact match, with smaller credit for a one- or two-year difference |
| Venue | 0.04 | partial similarity between candidate venue and raw reference |

Unavailable components are omitted and the remaining weights are normalized.
A candidate with title similarity below 0.45 receives an additional penalty.
A non-DOI match must have title similarity of at least 0.55.

## 5. Confidence and ambiguity gates

The best candidate must satisfy both conditions:

- score at least `--min-confidence`, 0.74 by default
- lead over the second distinct work of at least `--min-margin`, 0.04 by default

Near ties are marked ambiguous. Low scores are marked unmatched. Provider
failures with no candidates are marked errors. None of these references enter
the author ranking.

## 6. Author enrichment

An accepted Crossref work with a DOI is looked up in OpenAlex when enabled.
Names are aligned first by exact normalized full name, then by a unique
surname-and-first-initial signature. OpenAlex IDs and ORCIDs are attached to
aligned Crossref authors.

OpenAlex exposes at most the first 100 authors on a work. The merge therefore
retains the Crossref author list and appends any unmatched OpenAlex authors,
preventing enrichment from shortening a long deposited list.

## 7. Identity and aggregation

Work deduplication prefers DOI. Person identity prefers ORCID, then OpenAlex ID,
then another provider ID, then exact normalized full name. Identifier links are
joined transitively when the same metadata record carries more than one ID.
Name-only records are attached to identified records only when the normalized
name points to one unique identified person in the current bibliography.

For each distinct work:

- full count adds 1 to every counted person
- fractional count adds `1 / number of counted people`

The audit JSON preserves the evidence needed to inspect every decision.
