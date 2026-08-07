"""HTTP transport with caching, backoff, and offline replay."""

from __future__ import annotations

import json
import time
from contextlib import suppress
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

import httpx

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

    from .cache import JsonCache

_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
_SECRET_PARAMETERS = {"api_key", "token", "access_token"}


class MetadataError(RuntimeError):
    """Base error for metadata-provider failures."""


class OfflineCacheMiss(MetadataError):
    """Raised when offline mode cannot satisfy a request from cache."""


class InvalidMetadataResponse(MetadataError):
    """Raised when an API returns data with an unexpected shape."""


class CachedHttpClient:
    """A synchronous JSON client designed for public scholarly APIs."""

    def __init__(
        self,
        *,
        cache: JsonCache | None,
        offline: bool = False,
        timeout: float = 20.0,
        max_retries: int = 3,
        min_interval: float = 0.0,
        user_agent: str = "commonly-cited/0.2.0",
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.cache = cache
        self.offline = offline
        self.max_retries = max_retries
        self.min_interval = max(0.0, min_interval)
        self.sleep = sleep
        self.monotonic = monotonic
        self._last_request_at: float | None = None
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": user_agent, "Accept": "application/json"},
        )

    def __enter__(self) -> CachedHttpClient:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        """Close the underlying client when this instance created it."""
        if self._owns_client:
            self.client.close()

    @staticmethod
    def _cache_key(url: str, params: Mapping[str, str | int | float | None]) -> str:
        safe_params = {
            key: value
            for key, value in params.items()
            if value is not None and key.casefold() not in _SECRET_PARAMETERS
        }
        return f"GET {url}?{urlencode(sorted(safe_params.items()))}"

    def _respect_interval(self) -> None:
        if self._last_request_at is None or self.min_interval <= 0:
            return
        elapsed = self.monotonic() - self._last_request_at
        if elapsed < self.min_interval:
            self.sleep(self.min_interval - elapsed)

    @staticmethod
    def _retry_delay(response: httpx.Response | None, attempt: int) -> float:
        if response is not None:
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                try:
                    return min(60.0, max(0.0, float(retry_after)))
                except ValueError:
                    pass
        return min(30.0, 0.5 * (2.0**attempt))

    def get_json(
        self,
        url: str,
        *,
        params: Mapping[str, str | int | float | None] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> dict[str, Any]:
        """GET and decode a JSON object, using cache and exponential backoff."""
        request_params = dict(params or {})
        key = self._cache_key(url, request_params)
        if self.cache is not None:
            cached = self.cache.get(key)
            if cached is not None:
                return cached.value
        if self.offline:
            raise OfflineCacheMiss(f"No cached response for {url}")

        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            response: httpx.Response | None = None
            try:
                self._respect_interval()
                response = self.client.get(url, params=request_params, headers=headers)
                self._last_request_at = self.monotonic()
                if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self.max_retries:
                    self.sleep(self._retry_delay(response, attempt))
                    continue
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise InvalidMetadataResponse(f"Expected a JSON object from {url}")
                if self.cache is not None:
                    # Caching is an optimization and should not discard a valid response.
                    with suppress(OSError):
                        self.cache.set(key, payload)
                return payload
            except (httpx.HTTPError, json.JSONDecodeError, InvalidMetadataResponse) as error:
                last_error = error
                retryable = isinstance(error, httpx.TransportError)
                if isinstance(error, httpx.HTTPStatusError):
                    retryable = error.response.status_code in _RETRYABLE_STATUS_CODES
                if not retryable or attempt >= self.max_retries:
                    break
                self.sleep(self._retry_delay(response, attempt))

        raise MetadataError(f"Metadata request failed for {url}: {last_error}") from last_error
