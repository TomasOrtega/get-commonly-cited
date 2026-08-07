from __future__ import annotations

from commonly_cited.analysis import aggregate_resolutions
from commonly_cited.models import Author, Reference, Resolution, Work


def _resolution(index: int, work: Work, raw: str = "reference") -> Resolution:
    return Resolution(
        reference=Reference(index=index, raw=raw, has_et_al="et al" in raw),
        status="matched",
        work=work,
        confidence=1.0,
    )


def test_counts_people_once_per_distinct_work_and_fractionally() -> None:
    alice = Author("Alice Smith", family="Smith", openalex_id="A1")
    bob = Author("Bob Doe", family="Doe", openalex_id="A2")
    work_one = Work("w1", "One", (alice, bob), "test", doi="10.1/one")
    work_two = Work("w2", "Two", (alice,), "test", doi="10.1/two")

    result = aggregate_resolutions(
        [
            _resolution(1, work_one),
            _resolution(2, work_two),
            _resolution(3, work_one),
        ]
    )

    assert result.summary.duplicate_references == 1
    assert result.summary.distinct_matched_works == 2
    assert result.people[0].display_name == "Alice Smith"
    assert result.people[0].full_count == 2
    assert result.people[0].fractional_count == 1.5
    assert result.people[1].full_count == 1
    assert result.people[1].fractional_count == 0.5


def test_exact_name_can_attach_to_unique_identified_identity() -> None:
    identified = Author("Alice Smith", orcid="0000-0001-0000-0001")
    name_only = Author("Alice Smith")
    first = Work("w1", "One", (identified,), "test")
    second = Work("w2", "Two", (name_only,), "test")

    result = aggregate_resolutions([_resolution(1, first), _resolution(2, second)])

    assert len(result.people) == 1
    assert result.people[0].full_count == 2
    assert result.people[0].orcid == "0000-0001-0000-0001"


def test_collective_authors_are_excluded_by_default() -> None:
    group = Author("Example Study Group", is_collective=True)
    person = Author("Alice Smith")
    work = Work("w1", "One", (group, person), "test")

    result = aggregate_resolutions([_resolution(1, work)])

    assert [item.display_name for item in result.people] == ["Alice Smith"]


def test_orcid_and_openalex_identifiers_are_linked_transitively() -> None:
    bridge = Author(
        "Alice Smith",
        orcid="0000-0001-0000-0001",
        openalex_id="A1",
    )
    openalex_only = Author("Alice B. Smith", openalex_id="A1")
    first = Work("w1", "One", (bridge,), "test")
    second = Work("w2", "Two", (openalex_only,), "test")

    result = aggregate_resolutions([_resolution(1, first), _resolution(2, second)])

    assert len(result.people) == 1
    assert result.people[0].key == "orcid:0000-0001-0000-0001"
    assert result.people[0].full_count == 2
    assert result.people[0].openalex_id == "A1"


def test_ambiguous_exact_name_is_not_attached_to_an_identifier() -> None:
    first_person = Author("Alex Lee", orcid="0000-0001-0000-0001")
    second_person = Author("Alex Lee", orcid="0000-0002-0000-0002")
    name_only = Author("Alex Lee")
    works = [
        Work("w1", "One", (first_person,), "test"),
        Work("w2", "Two", (second_person,), "test"),
        Work("w3", "Three", (name_only,), "test"),
    ]

    result = aggregate_resolutions(
        [_resolution(index, work) for index, work in enumerate(works, start=1)]
    )

    assert len(result.people) == 3
    assert {person.key for person in result.people} == {
        "orcid:0000-0001-0000-0001",
        "orcid:0000-0002-0000-0002",
        "name:alex lee",
    }
