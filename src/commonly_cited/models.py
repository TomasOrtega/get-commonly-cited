"""Core data models for citation resolution and aggregation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ResolutionStatus = Literal["matched", "ambiguous", "unmatched", "error"]


@dataclass(frozen=True, slots=True)
class Reference:
    """A single reference extracted from the user's input."""

    index: int
    raw: str
    doi: str | None = None
    years: tuple[int, ...] = ()
    visible_surnames: tuple[str, ...] = ()
    has_et_al: bool = False


@dataclass(frozen=True, slots=True)
class Author:
    """An author as represented by a metadata provider."""

    display_name: str
    given: str | None = None
    family: str | None = None
    orcid: str | None = None
    openalex_id: str | None = None
    provider_id: str | None = None
    is_collective: bool = False


@dataclass(frozen=True, slots=True)
class Work:
    """A normalized scholarly work returned by a metadata provider."""

    id: str
    title: str
    authors: tuple[Author, ...]
    provider: str
    year: int | None = None
    doi: str | None = None
    venue: str | None = None
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class CandidateScore:
    """A candidate work and the components of its reference-match score."""

    work: Work
    score: float
    title_score: float
    author_score: float | None
    year_score: float | None
    venue_score: float | None


@dataclass(slots=True)
class Resolution:
    """The outcome of resolving one parsed reference."""

    reference: Reference
    status: ResolutionStatus
    work: Work | None = None
    confidence: float = 0.0
    method: str | None = None
    reason: str | None = None
    alternatives: tuple[CandidateScore, ...] = ()
    provider_errors: tuple[str, ...] = ()
    duplicate_of: int | None = None

    @property
    def hidden_authors_expanded(self) -> int:
        """Estimate how many authors were recovered beyond the visible citation text."""
        if self.work is None or not self.reference.has_et_al:
            return 0
        visible = max(1, len(self.reference.visible_surnames))
        return max(0, len(self.work.authors) - visible)


@dataclass(slots=True)
class PersonCount:
    """Aggregated counts for one canonical person identity."""

    key: str
    display_name: str
    aliases: set[str] = field(default_factory=set)
    work_ids: set[str] = field(default_factory=set)
    full_count: int = 0
    fractional_count: float = 0.0
    orcid: str | None = None
    openalex_id: str | None = None

    def as_dict(self, matched_work_count: int) -> dict[str, Any]:
        """Serialize a person count into stable JSON-compatible data."""
        share = self.full_count / matched_work_count if matched_work_count else 0.0
        return {
            "key": self.key,
            "name": self.display_name,
            "aliases": sorted(self.aliases - {self.display_name}),
            "cited_works": self.full_count,
            "fractional_count": round(self.fractional_count, 6),
            "share_of_matched_works": round(share, 6),
            "orcid": self.orcid,
            "openalex_id": self.openalex_id,
        }


@dataclass(frozen=True, slots=True)
class AnalysisSummary:
    """Summary statistics for a bibliography analysis."""

    input_references: int
    matched_references: int
    ambiguous_references: int
    unmatched_references: int
    errored_references: int
    duplicate_references: int
    distinct_matched_works: int
    ranked_people: int
    et_al_references: int
    hidden_authors_expanded: int

    def as_dict(self) -> dict[str, int]:
        """Serialize summary statistics."""
        return {
            "input_references": self.input_references,
            "matched_references": self.matched_references,
            "ambiguous_references": self.ambiguous_references,
            "unmatched_references": self.unmatched_references,
            "errored_references": self.errored_references,
            "duplicate_references": self.duplicate_references,
            "distinct_matched_works": self.distinct_matched_works,
            "ranked_people": self.ranked_people,
            "et_al_references": self.et_al_references,
            "hidden_authors_expanded": self.hidden_authors_expanded,
        }


@dataclass(slots=True)
class AnalysisResult:
    """Complete output of resolving and aggregating a bibliography."""

    resolutions: list[Resolution]
    people: list[PersonCount]
    summary: AnalysisSummary
    warnings: list[str] = field(default_factory=list)
