from __future__ import annotations

import io
import json

from commonly_cited.cli import main
from commonly_cited.models import Author, Work
from commonly_cited.providers import CrossrefProvider


def test_cli_reads_stdin_and_emits_json(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    work = Work(
        id="doi:10.1000/example",
        title="A useful paper",
        year=2020,
        doi="10.1000/example",
        provider="crossref",
        authors=(Author("Jane Smith", family="Smith"), Author("Alex Doe", family="Doe")),
    )

    def fake_search(self, reference, *, limit):  # type: ignore[no-untyped-def]
        return [work]

    monkeypatch.setattr(CrossrefProvider, "search", fake_search)
    stdout = io.StringIO()
    stderr = io.StringIO()
    status = main(
        ["--provider", "crossref", "--format", "json", "--quiet", "-"],
        stdin=io.StringIO("Smith et al. (2020). A useful paper."),
        stdout=stdout,
        stderr=stderr,
    )

    assert status == 0
    payload = json.loads(stdout.getvalue())
    assert payload["summary"]["matched_references"] == 1
    assert payload["summary"]["hidden_authors_expanded"] == 1
    assert [person["name"] for person in payload["people"]] == ["Alex Doe", "Jane Smith"]
