"""Reference resolution pipeline combining Crossref and OpenAlex."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from .http import MetadataError
from .matching import choose_candidate
from .models import Author, Reference, Resolution, Work
from .normalization import normalize_name, normalize_surname

if TYPE_CHECKING:
    from collections.abc import Iterable

    from .models import ResolutionStatus
    from .providers import MetadataProvider

ProgressCallback = Callable[[int, int, Reference], None]


def _author_signature(author: Author) -> tuple[str, str]:
    """Return a conservative surname/first-initial signature for alignment."""
    family = author.family or author.display_name.rsplit(" ", maxsplit=1)[-1]
    given = author.given or author.display_name.removesuffix(family).strip()
    initial = normalize_name(given)[:1] if given else ""
    return normalize_surname(family), initial


def _merge_authors(primary: tuple[Author, ...], enriched: tuple[Author, ...]) -> tuple[Author, ...]:
    """Attach canonical IDs without discarding authors absent from enrichment.

    OpenAlex work objects currently expose at most the first 100 authors. Crossref
    deposits can be longer, so the Crossref list remains the structural base.
    """
    if not primary:
        return enriched
    if not enriched:
        return primary

    exact: dict[str, list[int]] = {}
    signatures: dict[tuple[str, str], list[int]] = {}
    for index, author in enumerate(enriched):
        exact.setdefault(normalize_name(author.display_name), []).append(index)
        signatures.setdefault(_author_signature(author), []).append(index)

    used: set[int] = set()
    merged: list[Author] = []
    for author in primary:
        match_index: int | None = None
        exact_matches = exact.get(normalize_name(author.display_name), [])
        available_exact = [index for index in exact_matches if index not in used]
        if len(available_exact) == 1:
            match_index = available_exact[0]
        else:
            signature_matches = signatures.get(_author_signature(author), [])
            available_signature = [index for index in signature_matches if index not in used]
            if len(available_signature) == 1:
                match_index = available_signature[0]

        if match_index is None:
            merged.append(author)
            continue
        used.add(match_index)
        canonical = enriched[match_index]
        merged.append(
            Author(
                display_name=canonical.display_name or author.display_name,
                given=author.given or canonical.given,
                family=author.family or canonical.family,
                orcid=canonical.orcid or author.orcid,
                openalex_id=canonical.openalex_id or author.openalex_id,
                provider_id=canonical.provider_id or author.provider_id,
                is_collective=author.is_collective or canonical.is_collective,
            )
        )

    merged.extend(author for index, author in enumerate(enriched) if index not in used)
    return tuple(merged)


def _merge_work_metadata(primary: Work, enriched: Work) -> Work:
    """Prefer canonical OpenAlex identity while retaining richer author coverage."""
    return Work(
        id=enriched.id,
        title=enriched.title or primary.title,
        authors=_merge_authors(primary.authors, enriched.authors),
        provider=enriched.provider,
        year=enriched.year or primary.year,
        doi=enriched.doi or primary.doi,
        venue=enriched.venue or primary.venue,
        source_url=enriched.source_url or primary.source_url,
    )


class ReferenceResolver:
    """Resolve noisy references and enrich full author lists when possible."""

    def __init__(
        self,
        *,
        crossref: MetadataProvider | None,
        openalex: MetadataProvider | None,
        candidate_limit: int = 5,
        min_confidence: float = 0.74,
        min_margin: float = 0.04,
    ) -> None:
        if crossref is None and openalex is None:
            raise ValueError("At least one metadata provider is required")
        self.crossref = crossref
        self.openalex = openalex
        self.candidate_limit = candidate_limit
        self.min_confidence = min_confidence
        self.min_margin = min_margin

    @staticmethod
    def _provider_error(provider: str, error: Exception) -> str:
        return f"{provider}: {error}"

    def _exact_doi(self, reference: Reference) -> tuple[Work | None, str | None, list[str]]:
        if reference.doi is None:
            return None, None, []
        errors: list[str] = []
        crossref_work: Work | None = None
        openalex_work: Work | None = None

        if self.crossref is not None:
            try:
                crossref_work = self.crossref.lookup_doi(reference.doi)
            except MetadataError as error:
                errors.append(self._provider_error("Crossref", error))

        if self.openalex is not None:
            try:
                openalex_work = self.openalex.lookup_doi(reference.doi)
            except MetadataError as error:
                errors.append(self._provider_error("OpenAlex", error))

        if crossref_work is not None and openalex_work is not None:
            return (
                _merge_work_metadata(crossref_work, openalex_work),
                "crossref_openalex_doi",
                errors,
            )
        if openalex_work is not None:
            return openalex_work, "openalex_doi", errors
        if crossref_work is not None:
            return crossref_work, "crossref_doi", errors
        return None, None, errors

    def _enrich_crossref_work(self, work: Work, errors: list[str]) -> Work:
        if self.openalex is None or work.doi is None:
            return work
        try:
            enriched = self.openalex.lookup_doi(work.doi)
        except MetadataError as error:
            errors.append(self._provider_error("OpenAlex enrichment", error))
            return work
        return _merge_work_metadata(work, enriched) if enriched is not None else work

    def resolve(self, reference: Reference) -> Resolution:
        """Resolve one reference without ever silently accepting ambiguity."""
        exact, method, errors = self._exact_doi(reference)
        if exact is not None:
            return Resolution(
                reference=reference,
                status="matched",
                work=exact,
                confidence=1.0,
                method=method,
                reason="Exact DOI lookup",
                provider_errors=tuple(errors),
            )

        candidate_works: list[Work] = []
        search_method = ""
        if self.crossref is not None:
            try:
                candidate_works.extend(self.crossref.search(reference, limit=self.candidate_limit))
                search_method = "crossref_search"
            except MetadataError as error:
                errors.append(self._provider_error("Crossref search", error))

        decision = choose_candidate(
            reference,
            candidate_works,
            min_confidence=self.min_confidence,
            min_margin=self.min_margin,
        )

        # OpenAlex search is a fallback because each search consumes API credits.
        if not decision.accepted and self.openalex is not None:
            try:
                openalex_candidates = self.openalex.search(reference, limit=self.candidate_limit)
                candidate_works.extend(openalex_candidates)
                search_method = (
                    "crossref_and_openalex_search" if search_method else "openalex_search"
                )
                decision = choose_candidate(
                    reference,
                    candidate_works,
                    min_confidence=self.min_confidence,
                    min_margin=self.min_margin,
                )
            except MetadataError as error:
                errors.append(self._provider_error("OpenAlex search", error))

        if decision.accepted and decision.candidate is not None:
            work = decision.candidate.work
            if work.provider == "crossref":
                work = self._enrich_crossref_work(work, errors)
            return Resolution(
                reference=reference,
                status="matched",
                work=work,
                confidence=decision.candidate.score,
                method=search_method or f"{work.provider}_search",
                reason=decision.reason,
                alternatives=decision.alternatives,
                provider_errors=tuple(errors),
            )

        status: ResolutionStatus = "ambiguous" if decision.ambiguous else "unmatched"
        if not candidate_works and errors:
            status = "error"
        return Resolution(
            reference=reference,
            status=status,
            confidence=decision.candidate.score if decision.candidate else 0.0,
            method=search_method or None,
            reason=decision.reason,
            alternatives=decision.alternatives,
            provider_errors=tuple(errors),
        )

    def resolve_all(
        self,
        references: Iterable[Reference],
        *,
        progress: ProgressCallback | None = None,
    ) -> list[Resolution]:
        """Resolve references sequentially to respect public API etiquette."""
        reference_list = list(references)
        resolutions: list[Resolution] = []
        total = len(reference_list)
        for position, reference in enumerate(reference_list, start=1):
            if progress is not None:
                progress(position, total, reference)
            resolutions.append(self.resolve(reference))
        return resolutions
