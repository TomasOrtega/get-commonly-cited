"""OpenAlex API provider for full authorships and canonical author identities."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import quote

from ..http import CachedHttpClient, InvalidMetadataResponse, MetadataError
from ..models import Author, Reference, Work
from ..normalization import normalize_doi, normalize_orcid, short_openalex_id


class OpenAlexProvider:
    """Resolve works against OpenAlex using a user-supplied free API key."""

    name = "openalex"
    base_url = "https://api.openalex.org"

    def __init__(self, http: CachedHttpClient, *, api_key: str) -> None:
        if not api_key.strip():
            raise ValueError("OpenAlex requires a non-empty API key")
        self.http = http
        self.api_key = api_key.strip()

    @staticmethod
    def _parse_work(item: Mapping[str, Any]) -> Work:
        title_value = item.get("display_name") or item.get("title")
        title = (
            title_value.strip()
            if isinstance(title_value, str) and title_value.strip()
            else "Untitled work"
        )
        doi = normalize_doi(item.get("doi") if isinstance(item.get("doi"), str) else None)
        openalex_work_id = short_openalex_id(
            item.get("id") if isinstance(item.get("id"), str) else None
        )

        authors: list[Author] = []
        authorships = item.get("authorships")
        if isinstance(authorships, Sequence) and not isinstance(authorships, (str, bytes)):
            for authorship in authorships:
                if not isinstance(authorship, Mapping):
                    continue
                raw_author = authorship.get("author")
                if not isinstance(raw_author, Mapping):
                    continue
                display_name = raw_author.get("display_name")
                if not isinstance(display_name, str) or not display_name.strip():
                    continue
                name = display_name.strip()
                family = name.rsplit(" ", maxsplit=1)[-1] if " " in name else name
                given = name[: -len(family)].strip() or None
                authors.append(
                    Author(
                        display_name=name,
                        given=given,
                        family=family,
                        orcid=normalize_orcid(
                            raw_author.get("orcid")
                            if isinstance(raw_author.get("orcid"), str)
                            else None
                        ),
                        openalex_id=short_openalex_id(
                            raw_author.get("id") if isinstance(raw_author.get("id"), str) else None
                        ),
                    )
                )

        venue: str | None = None
        primary_location = item.get("primary_location")
        if isinstance(primary_location, Mapping):
            source = primary_location.get("source")
            if isinstance(source, Mapping) and isinstance(source.get("display_name"), str):
                venue = source["display_name"].strip() or None

        year_value = item.get("publication_year")
        year = int(year_value) if isinstance(year_value, int) else None
        if openalex_work_id:
            work_id = f"openalex:{openalex_work_id}"
            source_url = f"https://openalex.org/{openalex_work_id}"
        elif doi:
            work_id = f"doi:{doi}"
            source_url = f"https://doi.org/{doi}"
        else:
            stable = f"{title}|{year}|{venue or ''}"
            work_id = f"openalex:{hashlib.sha256(stable.encode()).hexdigest()[:20]}"
            source_url = None
        return Work(
            id=work_id,
            title=title,
            authors=tuple(authors),
            provider=OpenAlexProvider.name,
            year=year,
            doi=doi,
            venue=venue,
            source_url=source_url,
        )

    def lookup_doi(self, doi: str) -> Work | None:
        """Retrieve an exact OpenAlex work by DOI."""
        normalized = normalize_doi(doi)
        if normalized is None:
            return None
        identifier = f"https://doi.org/{quote(normalized, safe='/')}"
        try:
            payload = self.http.get_json(
                f"{self.base_url}/works/{identifier}",
                params={"api_key": self.api_key},
            )
        except MetadataError as error:
            cause = error.__cause__
            if getattr(getattr(cause, "response", None), "status_code", None) == 404:
                return None
            raise
        return self._parse_work(payload)

    def search(self, reference: Reference, *, limit: int) -> list[Work]:
        """Search OpenAlex using the complete raw citation."""
        payload = self.http.get_json(
            f"{self.base_url}/works",
            params={
                "search": reference.raw,
                "per_page": max(1, min(limit, 20)),
                "select": "id,doi,display_name,publication_year,authorships,primary_location",
                "api_key": self.api_key,
            },
        )
        results = payload.get("results")
        if not isinstance(results, Sequence) or isinstance(results, (str, bytes)):
            raise InvalidMetadataResponse("OpenAlex search response did not contain a results list")
        return [self._parse_work(item) for item in results if isinstance(item, Mapping)]
