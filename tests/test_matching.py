from __future__ import annotations

from commonly_cited.matching import choose_candidate, score_candidate
from commonly_cited.models import Author, Reference, Work


def _work(title: str, *, doi: str | None = None, year: int = 2020) -> Work:
    return Work(
        id=f"work:{title}",
        title=title,
        year=year,
        doi=doi,
        venue="Journal of Useful Results",
        provider="test",
        authors=(Author("Jane Smith", given="Jane", family="Smith"),),
    )


def test_exact_doi_always_scores_one() -> None:
    reference = Reference(index=1, raw="noise", doi="10.1000/example")
    candidate = _work("Different title", doi="10.1000/EXAMPLE")
    assert score_candidate(reference, candidate).score == 1.0


def test_good_title_author_and_year_match_is_accepted() -> None:
    reference = Reference(
        index=1,
        raw="Smith, J. (2020). A useful paper. Journal of Useful Results.",
        years=(2020,),
        visible_surnames=("smith",),
    )
    decision = choose_candidate(reference, [_work("A useful paper")])
    assert decision.accepted
    assert decision.candidate is not None
    assert decision.candidate.score > 0.9


def test_low_title_similarity_is_rejected() -> None:
    reference = Reference(index=1, raw="Smith, J. (2020). A useful paper.", years=(2020,))
    decision = choose_candidate(reference, [_work("Completely unrelated oceanography")])
    assert not decision.accepted


def test_near_tied_candidates_are_ambiguous() -> None:
    reference = Reference(index=1, raw="Smith (2020). Similar title.", years=(2020,))
    candidates = [_work("Similar title"), _work("A similar title")]
    decision = choose_candidate(reference, candidates, min_margin=0.2)
    assert not decision.accepted
    assert decision.ambiguous
