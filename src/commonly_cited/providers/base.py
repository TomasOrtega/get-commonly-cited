"""Provider protocol and shared parsing helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from ..models import Reference, Work


class MetadataProvider(Protocol):
    """Interface implemented by scholarly metadata providers."""

    name: str

    def lookup_doi(self, doi: str) -> Work | None:
        """Look up one exact DOI."""

    def search(self, reference: Reference, *, limit: int) -> list[Work]:
        """Return candidate works for a noisy reference."""
