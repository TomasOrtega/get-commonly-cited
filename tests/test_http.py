from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx
import pytest

from commonly_cited.cache import JsonCache
from commonly_cited.http import CachedHttpClient, OfflineCacheMiss

if TYPE_CHECKING:
    from pathlib import Path


def test_response_is_cached_and_replayed_offline(tmp_path: Path) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"ok": True}, request=request)

    cache = JsonCache(tmp_path)
    online_client = httpx.Client(transport=httpx.MockTransport(handler))
    http = CachedHttpClient(cache=cache, client=online_client)
    assert http.get_json("https://example.test/data", params={"q": "x"}) == {"ok": True}
    assert http.get_json("https://example.test/data", params={"q": "x"}) == {"ok": True}
    assert calls == 1

    offline = CachedHttpClient(cache=cache, offline=True, client=online_client)
    assert offline.get_json("https://example.test/data", params={"q": "x"}) == {"ok": True}


def test_offline_cache_miss_raises(tmp_path: Path) -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(500, request=request))
    )
    http = CachedHttpClient(cache=JsonCache(tmp_path), offline=True, client=client)
    with pytest.raises(OfflineCacheMiss):
        http.get_json("https://example.test/missing")


def test_api_key_is_not_part_of_cache_identity(tmp_path: Path) -> None:
    cache = JsonCache(tmp_path)
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=json.dumps({"value": 1}), request=request)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    http = CachedHttpClient(cache=cache, client=client)
    http.get_json("https://example.test", params={"api_key": "first", "q": "same"})
    http.get_json("https://example.test", params={"api_key": "second", "q": "same"})
    assert calls == 1
