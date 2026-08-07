from __future__ import annotations

from commonly_cited.models import Author, Reference, Work
from commonly_cited.resolver import ReferenceResolver, _merge_work_metadata


def test_openalex_enrichment_does_not_drop_crossref_authors() -> None:
    crossref = Work(
        id="doi:10.1/example",
        title="A paper",
        provider="crossref",
        doi="10.1/example",
        authors=(
            Author("Jane Smith", given="Jane", family="Smith"),
            Author("Alex Doe", given="Alex", family="Doe"),
            Author("Pat Roe", given="Pat", family="Roe"),
        ),
    )
    openalex = Work(
        id="openalex:W1",
        title="A paper",
        provider="openalex",
        doi="10.1/example",
        authors=(
            Author("Jane Smith", family="Smith", openalex_id="A1"),
            Author("Alex Doe", family="Doe", openalex_id="A2"),
        ),
    )

    merged = _merge_work_metadata(crossref, openalex)

    assert [author.display_name for author in merged.authors] == [
        "Jane Smith",
        "Alex Doe",
        "Pat Roe",
    ]
    assert merged.authors[0].openalex_id == "A1"
    assert merged.authors[1].openalex_id == "A2"
    assert merged.authors[2].openalex_id is None


class _StaticProvider:
    name = "static"

    def __init__(self, work: Work | None) -> None:
        self.work = work

    def lookup_doi(self, doi: str) -> Work | None:
        del doi
        return self.work

    def search(self, reference: Reference, *, limit: int) -> list[Work]:
        del reference, limit
        return []


def test_exact_doi_merges_crossref_coverage_with_openalex_identity() -> None:
    crossref = Work(
        id="doi:10.1/example",
        title="A paper",
        provider="crossref",
        doi="10.1/example",
        authors=(
            Author("Jane Smith", given="Jane", family="Smith"),
            Author("Alex Doe", given="Alex", family="Doe"),
            Author("Pat Roe", given="Pat", family="Roe"),
        ),
    )
    openalex = Work(
        id="openalex:W1",
        title="A paper",
        provider="openalex",
        doi="10.1/example",
        authors=(
            Author("Jane Smith", family="Smith", openalex_id="A1"),
            Author("Alex Doe", family="Doe", openalex_id="A2"),
        ),
    )
    resolver = ReferenceResolver(
        crossref=_StaticProvider(crossref),
        openalex=_StaticProvider(openalex),
    )

    resolution = resolver.resolve(Reference(index=1, raw="doi:10.1/example", doi="10.1/example"))

    assert resolution.status == "matched"
    assert resolution.method == "crossref_openalex_doi"
    assert resolution.work is not None
    assert [author.display_name for author in resolution.work.authors] == [
        "Jane Smith",
        "Alex Doe",
        "Pat Roe",
    ]
    assert resolution.work.authors[0].openalex_id == "A1"
