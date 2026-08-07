from __future__ import annotations

import httpx

from commonly_cited.http import CachedHttpClient
from commonly_cited.models import Reference
from commonly_cited.providers import CrossrefProvider, OpenAlexProvider


def test_crossref_search_normalizes_work_and_authors() -> None:
    payload = {
        "message": {
            "items": [
                {
                    "DOI": "10.1000/Example",
                    "title": ["A useful paper"],
                    "author": [
                        {
                            "given": "Jane",
                            "family": "Smith",
                            "ORCID": "https://orcid.org/0000-0001-0000-0001",
                        },
                        {"name": "Example Study Group"},
                    ],
                    "published": {"date-parts": [[2020, 1, 1]]},
                    "container-title": ["Journal of Useful Results"],
                }
            ]
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload, request=request)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = CrossrefProvider(CachedHttpClient(cache=None, client=client))
    works = provider.search(Reference(1, "Smith 2020 useful paper"), limit=5)

    assert len(works) == 1
    assert works[0].doi == "10.1000/example"
    assert works[0].authors[0].display_name == "Jane Smith"
    assert works[0].authors[0].orcid == "0000-0001-0000-0001"
    assert works[0].authors[1].is_collective


def test_openalex_lookup_preserves_canonical_author_id() -> None:
    payload = {
        "id": "https://openalex.org/W1",
        "doi": "https://doi.org/10.1000/example",
        "display_name": "A useful paper",
        "publication_year": 2020,
        "authorships": [
            {
                "author": {
                    "id": "https://openalex.org/A1",
                    "display_name": "Jane Smith",
                    "orcid": "https://orcid.org/0000-0001-0000-0001",
                }
            }
        ],
        "primary_location": {"source": {"display_name": "Journal of Useful Results"}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["api_key"] == "secret"
        assert request.url.path == "/works/https://doi.org/10.1000/example"
        return httpx.Response(200, json=payload, request=request)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = OpenAlexProvider(CachedHttpClient(cache=None, client=client), api_key="secret")
    work = provider.lookup_doi("10.1000/example")

    assert work is not None
    assert work.id == "openalex:W1"
    assert work.authors[0].openalex_id == "A1"
    assert work.authors[0].orcid == "0000-0001-0000-0001"
