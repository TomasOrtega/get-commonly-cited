"""Find the people cited most often in a noisy bibliography."""

from __future__ import annotations

from .api import analyze_text
from .models import AnalysisResult, Author, Reference, Resolution, Work
from .parsing import parse_references, split_references

__version__ = "0.1.0"

__all__ = [
    "AnalysisResult",
    "Author",
    "Reference",
    "Resolution",
    "Work",
    "analyze_text",
    "parse_references",
    "split_references",
]
