"""Crossref REST API provider."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import quote

from ..http import CachedHttpClient, InvalidMetadataResponse, MetadataError
from ..models import Author, Reference, Work
from ..normalization import is_collective_name, normalize_doi, normalize_orcid


class CrossrefProvider:
    """Resolve references against openly available Crossref metadata."""

    name = "crossref"
    base_url = "https://api.crossref.org"

    def __init__(self, http: CachedHttpClient, *, mailto: str | None = None) -> None:
        self.http = http
        self.mailto = mailto

    def _params(self, values: Mapping[str, str | int]) -> dict[str, str | int | None]:
        return {**values, "mailto": self.mailto}

    @staticmethod
    def _date_year(item: Mapping[str, Any]) -> int | None:
        for key in ("published-print", "published-online", "published", "issued", "created"):
            value = item.get(key)
            if not isinstance(value, Mapping):
                continue
            parts = value.get("date-parts")
            if (
                isinstance(parts, Sequence)
                and parts
                and isinstance(parts[0], Sequence)
                and parts[0]
                and isinstance(parts[0][0], int)
            ):
                return int(parts[0][0])
        return None

    @staticmethod
    def _first_string(value: object) -> str | None:
        if isinstance(value, str):
            return value.strip() or None
        if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
            for item in value:
                if isinstance(item, str) and item.strip():
                    return item.strip()
        return None

    @staticmethod
    def _parse_author(item: Mapping[str, Any]) -> Author | None:
        given = item.get("given") if isinstance(item.get("given"), str) else None
        family = item.get("family") if isinstance(item.get("family"), str) else None
        collective = item.get("name") if isinstance(item.get("name"), str) else None
        if collective:
            display_name = collective.strip()
        else:
            display_name = " ".join(
                part.strip() for part in (given, family) if part and part.strip()
            )
        if not display_name:
            return None
        return Author(
            display_name=display_name,
            given=given.strip() if given else None,
            family=family.strip() if family else None,
            orcid=normalize_orcid(
                item.get("ORCID") if isinstance(item.get("ORCID"), str) else None
            ),
            is_collective=bool(collective) or is_collective_name(display_name),
        )

    @classmethod
    def _parse_work(cls, item: Mapping[str, Any]) -> Work:
        title = cls._first_string(item.get("title")) or "Untitled work"
        doi = normalize_doi(item.get("DOI") if isinstance(item.get("DOI"), str) else None)
        authors_raw = item.get("author")
        authors: list[Author] = []
        if isinstance(authors_raw, Sequence) and not isinstance(authors_raw, (str, bytes)):
            for raw_author in authors_raw:
                if isinstance(raw_author, Mapping):
                    author = cls._parse_author(raw_author)
                    if author is not None:
                        authors.append(author)
        venue = cls._first_string(item.get("container-title"))
        source_url = f"https://doi.org/{doi}" if doi else cls._first_string(item.get("URL"))
        if doi:
            work_id = f"doi:{doi}"
        else:
            stable = f"{title}|{cls._date_year(item)}|{venue or ''}"
            work_id = f"crossref:{hashlib.sha256(stable.encode()).hexdigest()[:20]}"
        return Work(
            id=work_id,
            title=title,
            authors=tuple(authors),
            provider=cls.name,
            year=cls._date_year(item),
            doi=doi,
            venue=venue,
            source_url=source_url,
        )

    def lookup_doi(self, doi: str) -> Work | None:
        """Retrieve an exact Crossref work by DOI."""
        normalized = normalize_doi(doi)
        if normalized is None:
            return None
        try:
            payload = self.http.get_json(
                f"{self.base_url}/works/{quote(normalized, safe='')}",
                params=self._params({}),
            )
        except MetadataError as error:
            cause = error.__cause__
            if getattr(getattr(cause, "response", None), "status_code", None) == 404:
                return None
            raise
        message = payload.get("message")
        if not isinstance(message, Mapping):
            raise InvalidMetadataResponse("Crossref DOI response did not contain a work object")
        return self._parse_work(message)

    def search(self, reference: Reference, *, limit: int) -> list[Work]:
        """Search Crossref's bibliographic index using the complete raw citation."""
        payload = self.http.get_json(
            f"{self.base_url}/works",
            params=self._params(
                {
                    "query.bibliographic": reference.raw,
                    "rows": max(1, min(limit, 20)),
                    "select": (
                        "DOI,title,author,published,published-print,published-online,"
                        "issued,created,container-title,URL,type"
                    ),
                }
            ),
        )
        message = payload.get("message")
        if not isinstance(message, Mapping):
            raise InvalidMetadataResponse(
                "Crossref search response did not contain a message object"
            )
        items = message.get("items")
        if not isinstance(items, Sequence) or isinstance(items, (str, bytes)):
            raise InvalidMetadataResponse("Crossref search response did not contain an items list")
        return [self._parse_work(item) for item in items if isinstance(item, Mapping)]
