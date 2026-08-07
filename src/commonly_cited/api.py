"""Public programmatic API."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .analysis import aggregate_resolutions
from .parsing import parse_references

if TYPE_CHECKING:
    from .models import AnalysisResult
    from .resolver import ProgressCallback, ReferenceResolver


def analyze_text(
    text: str,
    *,
    resolver: ReferenceResolver,
    deduplicate_works: bool = True,
    include_collective_authors: bool = False,
    progress: ProgressCallback | None = None,
) -> AnalysisResult:
    """Parse, resolve, and aggregate a pasted bibliography."""
    references = parse_references(text)
    resolutions = resolver.resolve_all(references, progress=progress)
    return aggregate_resolutions(
        resolutions,
        deduplicate_works=deduplicate_works,
        include_collective_authors=include_collective_authors,
    )
