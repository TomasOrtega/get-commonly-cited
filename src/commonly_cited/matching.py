"""Candidate scoring and ambiguity-aware match selection."""

from __future__ import annotations

from dataclasses import dataclass

from rapidfuzz import fuzz

from .models import CandidateScore, Reference, Work
from .normalization import normalize_doi, normalize_surname, normalize_text, stable_work_key


@dataclass(frozen=True, slots=True)
class MatchDecision:
    """Decision returned after ranking candidate works."""

    candidate: CandidateScore | None
    alternatives: tuple[CandidateScore, ...]
    accepted: bool
    ambiguous: bool
    reason: str


def _year_similarity(reference_years: tuple[int, ...], candidate_year: int | None) -> float | None:
    if not reference_years or candidate_year is None:
        return None
    distance = min(abs(candidate_year - year) for year in reference_years)
    if distance == 0:
        return 1.0
    if distance == 1:
        return 0.7
    if distance == 2:
        return 0.3
    return 0.0


def _author_similarity(reference: Reference, work: Work) -> float | None:
    if not reference.visible_surnames:
        return None
    candidate_surnames = {
        normalize_surname(author.family or author.display_name.rsplit(" ", maxsplit=1)[-1])
        for author in work.authors
        if author.display_name
    }
    if not candidate_surnames:
        return 0.0

    matched = 0
    for visible in reference.visible_surnames:
        if visible in candidate_surnames:
            matched += 1
            continue
        if any(fuzz.ratio(visible, candidate) >= 90 for candidate in candidate_surnames):
            matched += 1
    return matched / len(reference.visible_surnames)


def _venue_similarity(reference: Reference, work: Work) -> float | None:
    if not work.venue:
        return None
    normalized_venue = normalize_text(work.venue)
    normalized_reference = normalize_text(reference.raw)
    if not normalized_venue or not normalized_reference:
        return None
    return fuzz.partial_ratio(normalized_venue, normalized_reference) / 100.0


def score_candidate(reference: Reference, work: Work) -> CandidateScore:
    """Score a candidate using title, visible authors, year, and venue evidence."""
    if reference.doi and work.doi and normalize_doi(reference.doi) == normalize_doi(work.doi):
        return CandidateScore(
            work=work,
            score=1.0,
            title_score=1.0,
            author_score=1.0,
            year_score=1.0,
            venue_score=1.0,
        )

    normalized_title = normalize_text(work.title)
    normalized_reference = normalize_text(reference.raw)
    title_score = (
        fuzz.token_set_ratio(normalized_title, normalized_reference) / 100.0
        if normalized_title and normalized_reference
        else 0.0
    )
    author_score = _author_similarity(reference, work)
    year_score = _year_similarity(reference.years, work.year)
    venue_score = _venue_similarity(reference, work)

    weighted_components: list[tuple[float, float]] = [(0.64, title_score)]
    if author_score is not None:
        weighted_components.append((0.21, author_score))
    if year_score is not None:
        weighted_components.append((0.11, year_score))
    if venue_score is not None:
        weighted_components.append((0.04, venue_score))

    total_weight = sum(weight for weight, _ in weighted_components)
    score = sum(weight * value for weight, value in weighted_components) / total_weight
    # A very poor title fit should not be rescued by a coincidental year or surname.
    if title_score < 0.45:
        score *= title_score / 0.45

    return CandidateScore(
        work=work,
        score=max(0.0, min(1.0, score)),
        title_score=title_score,
        author_score=author_score,
        year_score=year_score,
        venue_score=venue_score,
    )


def _deduplicate_candidates(candidates: list[CandidateScore]) -> list[CandidateScore]:
    best_by_work: dict[str, CandidateScore] = {}
    for candidate in candidates:
        key = stable_work_key(candidate.work.id, candidate.work.doi)
        previous = best_by_work.get(key)
        if previous is None or candidate.score > previous.score:
            best_by_work[key] = candidate
    return list(best_by_work.values())


def choose_candidate(
    reference: Reference,
    works: list[Work],
    *,
    min_confidence: float = 0.74,
    min_margin: float = 0.04,
    alternatives_limit: int = 3,
) -> MatchDecision:
    """Choose a match only when its evidence clears confidence and margin gates."""
    scored = _deduplicate_candidates([score_candidate(reference, work) for work in works])
    scored.sort(key=lambda candidate: (candidate.score, candidate.title_score), reverse=True)
    alternatives = tuple(scored[:alternatives_limit])
    if not scored:
        return MatchDecision(None, (), False, False, "No metadata candidates were returned")

    best = scored[0]
    if best.score < min_confidence:
        return MatchDecision(
            best,
            alternatives,
            False,
            False,
            f"Best candidate confidence {best.score:.3f} is below {min_confidence:.3f}",
        )
    doi_matches = (
        reference.doi
        and best.work.doi
        and normalize_doi(reference.doi) == normalize_doi(best.work.doi)
    )
    if best.title_score < 0.55 and not doi_matches:
        return MatchDecision(
            best,
            alternatives,
            False,
            False,
            f"Best candidate title similarity {best.title_score:.3f} is too low",
        )

    if len(scored) > 1:
        second = scored[1]
        margin = best.score - second.score
        if margin < min_margin:
            return MatchDecision(
                best,
                alternatives,
                False,
                True,
                f"Top candidates are separated by only {margin:.3f}",
            )

    return MatchDecision(best, alternatives, True, False, "Candidate passed confidence gates")
