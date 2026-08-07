"""Normalization helpers for identifiers, titles, and personal names."""

from __future__ import annotations

import re
import unicodedata
from typing import TYPE_CHECKING

_DOI_URL_PREFIX_RE = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", re.IGNORECASE)
_NON_WORD_RE = re.compile(r"[^\w]+", re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")
if TYPE_CHECKING:
    from collections.abc import Iterable

_COLLECTIVE_TERMS = {
    "collaboration",
    "consortium",
    "committee",
    "group",
    "initiative",
    "network",
    "team",
    "study",
    "investigators",
}


def strip_accents(value: str) -> str:
    """Return a case-preserving ASCII-like representation when possible."""
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def normalize_text(value: str) -> str:
    """Normalize arbitrary text for fuzzy matching."""
    value = strip_accents(unicodedata.normalize("NFKC", value)).casefold()
    value = _NON_WORD_RE.sub(" ", value)
    return _WHITESPACE_RE.sub(" ", value).strip()


def normalize_name(value: str) -> str:
    """Normalize a personal name while retaining all name tokens."""
    return normalize_text(value)


def normalize_surname(value: str) -> str:
    """Normalize a surname used in visible-author matching."""
    return normalize_text(value).replace(" ", "")


def normalize_doi(value: str | None) -> str | None:
    """Normalize a DOI or DOI URL into its bare lowercase identifier."""
    if value is None:
        return None
    cleaned = _DOI_URL_PREFIX_RE.sub("", value.strip()).strip()
    cleaned = cleaned.rstrip(".,;:)]}>\"'")
    cleaned = cleaned.lstrip("([{<\"'")
    return cleaned.casefold() or None


def normalize_orcid(value: str | None) -> str | None:
    """Normalize an ORCID URL or bare ORCID."""
    if not value:
        return None
    cleaned = value.strip().casefold()
    cleaned = cleaned.removeprefix("https://orcid.org/")
    cleaned = cleaned.removeprefix("http://orcid.org/")
    return cleaned or None


def short_openalex_id(value: str | None) -> str | None:
    """Normalize an OpenAlex entity URL into its compact identifier."""
    if not value:
        return None
    cleaned = value.strip().rstrip("/")
    return cleaned.rsplit("/", maxsplit=1)[-1] or None


def is_collective_name(value: str) -> bool:
    """Heuristically identify group or consortium authors."""
    tokens = set(normalize_text(value).split())
    return bool(tokens & _COLLECTIVE_TERMS)


def stable_work_key(work_id: str, doi: str | None) -> str:
    """Return a provider-independent work key when a DOI is available."""
    normalized_doi = normalize_doi(doi)
    return f"doi:{normalized_doi}" if normalized_doi else work_id


def author_identity_key(
    *,
    display_name: str,
    orcid: str | None,
    openalex_id: str | None,
    provider_id: str | None = None,
) -> str:
    """Return the strongest stable identity key available for an author."""
    normalized_orcid = normalize_orcid(orcid)
    if normalized_orcid:
        return f"orcid:{normalized_orcid}"
    normalized_openalex = short_openalex_id(openalex_id)
    if normalized_openalex:
        return f"openalex:{normalized_openalex}"
    if provider_id:
        return f"provider:{provider_id}"
    return f"name:{normalize_name(display_name)}"


def unique_preserving_order(values: Iterable[str]) -> tuple[str, ...]:
    """Deduplicate strings without changing their first-seen order."""
    return tuple(dict.fromkeys(value for value in values if value))
