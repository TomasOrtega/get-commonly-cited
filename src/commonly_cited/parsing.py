"""Reference-list segmentation and lightweight feature extraction."""

from __future__ import annotations

import re
import unicodedata
from typing import TYPE_CHECKING

from .models import Reference
from .normalization import normalize_doi, normalize_surname, unique_preserving_order

if TYPE_CHECKING:
    from collections.abc import Iterable

_DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)
_YEAR_RE = re.compile(r"(?<!\d)(?:18|19|20|21)\d{2}[a-z]?(?!\d)", re.IGNORECASE)
_ET_AL_RE = re.compile(r"\bet\s+al\.?\b", re.IGNORECASE)
_NUMBERED_START_RE = re.compile(
    r"^\s*(?:\[(?P<bracket>\d{1,3})\]|\((?P<paren>\d{1,3})\)|"
    r"(?P<plain>\d{1,3})[.)])\s*(?P<body>.+?)\s*$"
)
_INLINE_NUMBER_RE = re.compile(
    r"(?<!\w)(?:\[(?P<bracket>\d{1,3})\]|\((?P<paren>\d{1,3})\)|"
    r"(?P<plain>\d{1,3})[.)])\s+"
)
_DASH_CHARACTERS = "-\u2010\u2011\u2012\u2013\u2014\u2015"
_BIBTEX_START_RE = re.compile(
    r"^\s*@(?:article|book|inproceedings|misc|phdthesis|"
    r"mastersthesis|techreport|incollection|proceedings)\s*\{",
    re.IGNORECASE,
)
_RIS_START_RE = re.compile(r"^TY\s{0,2}-\s*", re.IGNORECASE)
_RIS_END_RE = re.compile(r"^ER\s{0,2}-\s*", re.IGNORECASE)
_HEADING_RE = re.compile(r"^\s*(?:references|bibliography|works\s+cited)\s*:?[\s]*$", re.IGNORECASE)
_BULLET_RE = re.compile(r"^\s*(?:[-*•‣▪◦])\s+")

_SURNAME_COMMA_RE = re.compile(
    r"(?<![\w'-])([A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'\u2019\-]{1,})\s*,\s*"
    r"(?:[A-ZÀ-ÖØ-Þ](?:\.|[a-zà-öø-ÿ]+))"
)
_INITIALS_SURNAME_RE = re.compile(
    r"(?:\b[A-ZÀ-ÖØ-Þ]\.?\s*){1,4}"
    r"([A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'\u2019\-]{1,})\b"
)
_SURNAME_INITIALS_RE = re.compile(
    r"\b([A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'\u2019\-]{1,})\s+"
    r"(?:[A-ZÀ-ÖØ-Þ]\.?\s*){1,4}(?=,|;|\s+(?:and|&)\b|$)"
)
_ET_AL_SURNAME_RE = re.compile(
    r"\b([A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'\u2019\-]{1,})\s+(?:,\s*)?et\s+al\.?",
    re.IGNORECASE,
)


def _clean_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\u00ad", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Repair words broken by a PDF line-wrap while leaving ordinary hyphens intact.
    return re.sub(r"(?<=[A-Za-z])-[ \t]*\n[ \t]*(?=[a-z])", "", text)


def _clean_reference(value: str) -> str:
    value = _BULLET_RE.sub("", value.strip())
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def extract_doi(value: str) -> str | None:
    """Extract the first DOI from noisy reference text."""
    match = _DOI_RE.search(value)
    return normalize_doi(match.group(0)) if match else None


def extract_years(value: str) -> tuple[int, ...]:
    """Extract plausible publication years from a reference."""
    years: list[int] = []
    for match in _YEAR_RE.finditer(value):
        year = int(match.group(0)[:4])
        if year not in years:
            years.append(year)
    return tuple(years)


def extract_visible_surnames(value: str) -> tuple[str, ...]:
    """Extract visible author surnames for candidate scoring.

    This is intentionally conservative. The metadata provider, rather than this
    heuristic, supplies the final author list.
    """
    year_match = _YEAR_RE.search(value)
    prefix = value[: year_match.start()] if year_match else value[:300]
    prefix = _NUMBERED_START_RE.sub(lambda match: match.group("body"), prefix)
    prefix = prefix.split(".", maxsplit=1)[0] if len(prefix) > 180 else prefix

    candidates: list[str] = []
    candidates.extend(match.group(1) for match in _SURNAME_COMMA_RE.finditer(prefix))
    candidates.extend(match.group(1) for match in _INITIALS_SURNAME_RE.finditer(prefix))
    candidates.extend(match.group(1) for match in _SURNAME_INITIALS_RE.finditer(prefix))
    candidates.extend(match.group(1) for match in _ET_AL_SURNAME_RE.finditer(prefix))

    normalized = (normalize_surname(candidate) for candidate in candidates)
    return unique_preserving_order(normalized)


def _split_bibtex(text: str) -> list[str]:
    entries: list[str] = []
    current: list[str] = []
    depth = 0
    in_entry = False
    for line in text.splitlines():
        if not in_entry and _BIBTEX_START_RE.match(line):
            in_entry = True
            current = []
            depth = 0
        if in_entry:
            current.append(line)
            depth += line.count("{") - line.count("}")
            if depth <= 0 and current:
                entries.append(_clean_reference("\n".join(current)))
                current = []
                in_entry = False
    if current:
        entries.append(_clean_reference("\n".join(current)))
    return entries


def _split_ris(text: str) -> list[str]:
    entries: list[str] = []
    current: list[str] = []
    for line in text.splitlines():
        if _RIS_START_RE.match(line):
            if current:
                entries.append(_clean_reference("\n".join(current)))
            current = [line]
        elif current:
            current.append(line)
            if _RIS_END_RE.match(line):
                entries.append(_clean_reference("\n".join(current)))
                current = []
    if current:
        entries.append(_clean_reference("\n".join(current)))
    return entries


def _split_inline_numbered(text: str) -> list[str]:
    matches = [
        match
        for match in _INLINE_NUMBER_RE.finditer(text)
        if not (
            match.group("plain")
            and text[: match.start()].rstrip().endswith(tuple(_DASH_CHARACTERS))
        )
    ]
    if len(matches) < 2:
        return []
    # Inline markers are only credible when the first one starts the list. This
    # avoids mistaking journal volumes or page numbers such as ``1.`` and ``2.``
    # at line endings for bibliography numbering.
    prefix = text[: matches[0].start()].strip()
    if prefix and not _HEADING_RE.match(prefix):
        return []

    first = matches[0]
    style = next(name for name in ("bracket", "paren", "plain") if first.group(name))
    expected_number = int(first.group(style)) + 1
    sequence = [first]
    for match in matches[1:]:
        value = match.group(style)
        if value is not None and int(value) == expected_number:
            sequence.append(match)
            expected_number += 1
    matches = sequence
    if len(matches) < 2:
        return []

    entries: list[str] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        entry = _clean_reference(text[start:end])
        if entry:
            entries.append(entry)
    return entries


def _split_numbered_lines(lines: list[str]) -> list[str]:
    entries: list[str] = []
    current: list[str] = []
    found_marker = False
    for line in lines:
        match = _NUMBERED_START_RE.match(line)
        if match:
            found_marker = True
            if current:
                entries.append(_clean_reference(" ".join(current)))
            current = [match.group("body")]
        elif current and line.strip():
            current.append(line.strip())
    if current:
        entries.append(_clean_reference(" ".join(current)))
    return entries if found_marker else []


def _looks_like_reference(value: str) -> bool:
    cleaned = _clean_reference(value)
    return len(cleaned) >= 25 and (extract_doi(cleaned) is not None or bool(extract_years(cleaned)))


def _looks_like_reference_start(value: str) -> bool:
    cleaned = _clean_reference(value)
    if len(cleaned) < 12:
        return False
    first_year = _YEAR_RE.search(cleaned[:180])
    if first_year is None:
        return False
    prefix = cleaned[: first_year.start()]
    return bool("," in prefix or _ET_AL_RE.search(prefix) or _INITIALS_SURNAME_RE.search(prefix))


def _split_blank_blocks(lines: list[str]) -> list[str]:
    blocks: list[str] = []
    current: list[str] = []
    for line in lines:
        if line.strip():
            current.append(line.strip())
        elif current:
            blocks.append(_clean_reference(" ".join(current)))
            current = []
    if current:
        blocks.append(_clean_reference(" ".join(current)))
    plausible = sum(_looks_like_reference(block) for block in blocks)
    if len(blocks) >= 2 and plausible >= len(blocks) / 2:
        return blocks
    return []


def _split_semicolon_candidates(text: str) -> list[str]:
    parts = [_clean_reference(part) for part in re.split(r"\s*;\s*(?=[A-Z\[])", text)]
    parts = [part for part in parts if part]
    if len(parts) >= 2 and all(_looks_like_reference(part) for part in parts):
        return parts
    return []


def split_references(text: str) -> list[str]:
    """Split a poorly formatted bibliography into individual references."""
    text = _clean_text(text)
    lines = [line for line in text.splitlines() if not _HEADING_RE.match(line)]
    text_without_heading = "\n".join(lines).strip()
    if not text_without_heading:
        return []

    if _BIBTEX_START_RE.search(text_without_heading):
        entries = _split_bibtex(text_without_heading)
        if entries:
            return entries

    if any(_RIS_START_RE.match(line) for line in lines):
        entries = _split_ris(text_without_heading)
        if entries:
            return entries

    entries = _split_inline_numbered(text_without_heading)
    if entries:
        return entries

    entries = _split_numbered_lines(lines)
    if entries:
        return entries

    entries = _split_blank_blocks(lines)
    if entries:
        return entries

    nonempty = [_clean_reference(line) for line in lines if line.strip()]
    plausible_lines = sum(_looks_like_reference(line) for line in nonempty)
    if len(nonempty) >= 2 and plausible_lines >= 0.7 * len(nonempty):
        return nonempty

    entries = []
    current: list[str] = []
    for line in nonempty:
        current_is_reference = _looks_like_reference(" ".join(current))
        if current and _looks_like_reference_start(line) and current_is_reference:
            entries.append(_clean_reference(" ".join(current)))
            current = [line]
        else:
            current.append(line)
    if current:
        entries.append(_clean_reference(" ".join(current)))
    if len(entries) >= 2:
        return entries

    semicolon_entries = _split_semicolon_candidates(text_without_heading)
    if semicolon_entries:
        return semicolon_entries

    return [_clean_reference(text_without_heading)]


def parse_references(text: str) -> list[Reference]:
    """Parse bibliography text into references with matching features."""
    references: list[Reference] = []
    for index, raw in enumerate(split_references(text), start=1):
        references.append(
            Reference(
                index=index,
                raw=raw,
                doi=extract_doi(raw),
                years=extract_years(raw),
                visible_surnames=extract_visible_surnames(raw),
                has_et_al=bool(_ET_AL_RE.search(raw)),
            )
        )
    return references


def join_reference_lines(lines: Iterable[str]) -> str:
    """Public helper for normalizing a stream of reference lines."""
    return _clean_reference(" ".join(line.strip() for line in lines if line.strip()))
