"""Small, transparent filesystem cache for scholarly metadata responses."""

from __future__ import annotations

import hashlib
import json
import os
import time
from contextlib import suppress
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from platformdirs import user_cache_path

if TYPE_CHECKING:
    from pathlib import Path


@dataclass(frozen=True, slots=True)
class CacheEntry:
    """A decoded cache entry."""

    value: dict[str, Any]
    created_at: float


class JsonCache:
    """Store JSON API responses as one atomic file per request key."""

    def __init__(self, directory: Path | None = None, *, ttl_seconds: float | None = None) -> None:
        self.directory = directory or user_cache_path("commonly-cited", ensure_exists=True)
        self.ttl_seconds = ttl_seconds
        self.directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def digest(key: str) -> str:
        """Return a stable cache filename digest for a request key."""
        return hashlib.sha256(key.encode("utf-8")).hexdigest()

    def path_for(self, key: str) -> Path:
        """Return the on-disk path used for a key."""
        return self.directory / f"{self.digest(key)}.json"

    def get(self, key: str) -> CacheEntry | None:
        """Read a non-expired entry, returning ``None`` on a miss or corruption."""
        path = self.path_for(key)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            created_at = float(payload["created_at"])
            value = payload["value"]
            if not isinstance(value, dict):
                return None
        except (FileNotFoundError, KeyError, TypeError, ValueError, json.JSONDecodeError, OSError):
            return None

        if self.ttl_seconds is not None and time.time() - created_at > self.ttl_seconds:
            with suppress(OSError):
                path.unlink()
            return None
        return CacheEntry(value=value, created_at=created_at)

    def set(self, key: str, value: dict[str, Any]) -> None:
        """Atomically write a JSON-compatible dictionary."""
        path = self.path_for(key)
        temporary = path.with_suffix(f".{os.getpid()}.tmp")
        payload = {"created_at": time.time(), "value": value}
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.replace(path)
