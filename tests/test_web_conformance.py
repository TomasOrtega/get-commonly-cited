from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from commonly_cited.matching import choose_candidate
from commonly_cited.models import Author, Reference, Work
from commonly_cited.parsing import parse_references

_FIXTURE_DIRECTORY = Path(__file__).parents[1] / "shared-fixtures"


def test_shared_parsing_fixtures_match_python() -> None:
    fixture_path = _FIXTURE_DIRECTORY / "parsing.json"
    fixture: dict[str, Any] = json.loads(fixture_path.read_text(encoding="utf-8"))

    for case in fixture["cases"]:
        actual = [
            {
                "raw": reference.raw,
                "doi": reference.doi,
                "years": list(reference.years),
                "has_et_al": reference.has_et_al,
            }
            for reference in parse_references(case["input"])
        ]
        assert actual == case["expected"], case["name"]


def test_shared_matching_fixtures_match_python() -> None:
    fixture: dict[str, Any] = json.loads(
        (_FIXTURE_DIRECTORY / "matching.json").read_text(encoding="utf-8")
    )

    for case in fixture["cases"]:
        raw_reference = case["reference"]
        reference = Reference(
            index=1,
            raw=raw_reference["raw"],
            doi=raw_reference["doi"],
            years=tuple(raw_reference["years"]),
            visible_surnames=tuple(raw_reference["visible_surnames"]),
        )
        works = [
            Work(
                id=item["id"],
                title=item["title"],
                authors=tuple(
                    Author(author["display_name"], family=author["family"])
                    for author in item["authors"]
                ),
                provider="fixture",
                year=item["year"],
                doi=item["doi"],
                venue=item["venue"],
            )
            for item in case["works"]
        ]
        decision = choose_candidate(reference, works, min_margin=case["min_margin"])
        actual = {
            "accepted": decision.accepted,
            "ambiguous": decision.ambiguous,
            "best_id": decision.candidate.work.id if decision.candidate else None,
        }
        assert actual == case["expected"], case["name"]
