"""Scholarly metadata providers."""

from .base import MetadataProvider
from .crossref import CrossrefProvider
from .openalex import OpenAlexProvider

__all__ = ["CrossrefProvider", "MetadataProvider", "OpenAlexProvider"]
