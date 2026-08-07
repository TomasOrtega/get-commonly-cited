"""Aggregate resolved works into commonly cited people."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .models import AnalysisResult, AnalysisSummary, Author, PersonCount, Resolution
from .normalization import (
    normalize_name,
    normalize_orcid,
    short_openalex_id,
    stable_work_key,
)

if TYPE_CHECKING:
    from collections.abc import Iterable


def _best_display_name(names: Iterable[str]) -> str:
    counts = Counter(name for name in names if name)
    if not counts:
        return "Unknown author"
    return max(counts, key=lambda name: (counts[name], len(name), name.casefold()))


def _strong_identity_keys(author: Author) -> tuple[str, ...]:
    """Return all stable identifiers carried by an author record."""
    keys: list[str] = []
    orcid = normalize_orcid(author.orcid)
    if orcid:
        keys.append(f"orcid:{orcid}")
    openalex_id = short_openalex_id(author.openalex_id)
    if openalex_id:
        keys.append(f"openalex:{openalex_id}")
    if author.provider_id and author.provider_id.strip():
        keys.append(f"provider:{author.provider_id.strip()}")
    return tuple(keys)


def _identity_priority(key: str) -> tuple[int, str]:
    if key.startswith("orcid:"):
        return 0, key
    if key.startswith("openalex:"):
        return 1, key
    return 2, key


class _UnionFind:
    """Minimal union-find for linking identifiers observed on the same record."""

    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, key: str) -> None:
        self.parent.setdefault(key, key)

    def find(self, key: str) -> str:
        parent = self.parent[key]
        if parent != key:
            self.parent[key] = self.find(parent)
        return self.parent[key]

    def union(self, left: str, right: str) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root != right_root:
            self.parent[right_root] = left_root


@dataclass(frozen=True, slots=True)
class _IdentityIndex:
    canonical_by_identifier: dict[str, str]
    canonical_by_unique_name: dict[str, str]

    def key_for(self, author: Author) -> str:
        """Return a canonical identity while avoiding ambiguous name-only merges."""
        identifiers = _strong_identity_keys(author)
        if identifiers:
            return self.canonical_by_identifier[identifiers[0]]
        normalized_name = normalize_name(author.display_name)
        return self.canonical_by_unique_name.get(
            normalized_name,
            f"name:{normalized_name}",
        )


def _build_identity_index(authors: Iterable[Author]) -> _IdentityIndex:
    """Link ORCID, OpenAlex, and provider identifiers transitively."""
    author_list = list(authors)
    union_find = _UnionFind()
    for author in author_list:
        identifiers = _strong_identity_keys(author)
        for identifier in identifiers:
            union_find.add(identifier)
        for identifier in identifiers[1:]:
            union_find.union(identifiers[0], identifier)

    identifiers_by_root: dict[str, list[str]] = defaultdict(list)
    for identifier in union_find.parent:
        identifiers_by_root[union_find.find(identifier)].append(identifier)

    canonical_by_root = {
        root: min(identifiers, key=_identity_priority)
        for root, identifiers in identifiers_by_root.items()
    }
    canonical_by_identifier = {
        identifier: canonical_by_root[union_find.find(identifier)]
        for identifier in union_find.parent
    }

    name_to_canonical: dict[str, set[str]] = defaultdict(set)
    for author in author_list:
        identifiers = _strong_identity_keys(author)
        if not identifiers:
            continue
        name_to_canonical[normalize_name(author.display_name)].add(
            canonical_by_identifier[identifiers[0]]
        )
    canonical_by_unique_name = {
        name: next(iter(canonical_keys))
        for name, canonical_keys in name_to_canonical.items()
        if len(canonical_keys) == 1
    }
    return _IdentityIndex(
        canonical_by_identifier=canonical_by_identifier,
        canonical_by_unique_name=canonical_by_unique_name,
    )


def _resolved_work_key(resolution: Resolution) -> str | None:
    if resolution.work is None:
        return None
    return stable_work_key(resolution.work.id, resolution.work.doi)


def aggregate_resolutions(
    resolutions: list[Resolution],
    *,
    deduplicate_works: bool = True,
    include_collective_authors: bool = False,
) -> AnalysisResult:
    """Count each person once per distinct cited work and compute fractional counts."""
    seen_work_at: dict[str, int] = {}
    included: list[Resolution] = []
    duplicate_count = 0
    warnings: list[str] = []

    for resolution in resolutions:
        if resolution.status != "matched" or resolution.work is None:
            continue
        key = _resolved_work_key(resolution)
        if key is None:
            continue
        if deduplicate_works and key in seen_work_at:
            resolution.duplicate_of = seen_work_at[key]
            duplicate_count += 1
            continue
        seen_work_at[key] = resolution.reference.index
        included.append(resolution)

    all_authors = [
        author
        for resolution in included
        if resolution.work is not None
        for author in resolution.work.authors
        if include_collective_authors or not author.is_collective
    ]
    identity_index = _build_identity_index(all_authors)

    people: dict[str, PersonCount] = {}
    names_by_key: dict[str, list[str]] = defaultdict(list)
    for resolution in included:
        work = resolution.work
        if work is None:
            continue
        work_key = stable_work_key(work.id, work.doi)
        authors = [
            author
            for author in work.authors
            if include_collective_authors or not author.is_collective
        ]
        if not authors:
            warnings.append(
                f"Reference {resolution.reference.index} matched '{work.title}' "
                "but had no countable authors"
            )
            continue

        unique_authors: dict[str, Author] = {}
        for author in authors:
            key = identity_index.key_for(author)
            unique_authors.setdefault(key, author)

        denominator = len(unique_authors)
        for key, author in unique_authors.items():
            person = people.get(key)
            if person is None:
                person = PersonCount(
                    key=key,
                    display_name=author.display_name,
                    orcid=author.orcid,
                    openalex_id=author.openalex_id,
                )
                people[key] = person
            person.aliases.add(author.display_name)
            person.work_ids.add(work_key)
            person.full_count += 1
            person.fractional_count += 1.0 / denominator
            person.orcid = person.orcid or author.orcid
            person.openalex_id = person.openalex_id or author.openalex_id
            names_by_key[key].append(author.display_name)

    for key, person in people.items():
        person.display_name = _best_display_name(names_by_key[key])

    ranked = sorted(
        people.values(),
        key=lambda person: (
            -person.full_count,
            -person.fractional_count,
            person.display_name.casefold(),
        ),
    )

    matched = sum(resolution.status == "matched" for resolution in resolutions)
    ambiguous = sum(resolution.status == "ambiguous" for resolution in resolutions)
    unmatched = sum(resolution.status == "unmatched" for resolution in resolutions)
    errored = sum(resolution.status == "error" for resolution in resolutions)
    summary = AnalysisSummary(
        input_references=len(resolutions),
        matched_references=matched,
        ambiguous_references=ambiguous,
        unmatched_references=unmatched,
        errored_references=errored,
        duplicate_references=duplicate_count,
        distinct_matched_works=len(included),
        ranked_people=len(ranked),
        et_al_references=sum(resolution.reference.has_et_al for resolution in resolutions),
        hidden_authors_expanded=sum(
            resolution.hidden_authors_expanded for resolution in resolutions
        ),
    )
    return AnalysisResult(
        resolutions=resolutions,
        people=ranked,
        summary=summary,
        warnings=warnings,
    )
