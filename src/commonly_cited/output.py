"""Human-readable and machine-readable result rendering."""

from __future__ import annotations

import csv
import io
import json
from typing import TYPE_CHECKING, Any, Literal, TextIO

from rich.console import Console
from rich.table import Table

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pathlib import Path

    from .models import AnalysisResult, CandidateScore, PersonCount, Resolution

OutputFormat = Literal["table", "json", "csv", "markdown"]
RankingMode = Literal["full", "fractional"]


def _identifier(person: PersonCount) -> str:
    if person.orcid:
        return f"ORCID {person.orcid}"
    if person.openalex_id:
        return f"OpenAlex {person.openalex_id}"
    return ""


def ranked_people(
    people: Sequence[PersonCount], *, ranking: RankingMode, top: int
) -> list[PersonCount]:
    """Sort people by the selected counting convention and apply a top-N limit."""
    if ranking == "fractional":
        ordered = sorted(
            people,
            key=lambda person: (
                -person.fractional_count,
                -person.full_count,
                person.display_name.casefold(),
            ),
        )
    else:
        ordered = sorted(
            people,
            key=lambda person: (
                -person.full_count,
                -person.fractional_count,
                person.display_name.casefold(),
            ),
        )
    return ordered if top <= 0 else ordered[:top]


def render_table(
    result: AnalysisResult,
    *,
    stream: TextIO,
    ranking: RankingMode = "full",
    top: int = 25,
) -> None:
    """Render rankings as a terminal-friendly Rich table."""
    table = Table(title="Most commonly cited people", show_lines=False)
    table.add_column("Rank", justify="right")
    table.add_column("Person")
    table.add_column("Cited works", justify="right")
    table.add_column("Fractional", justify="right")
    table.add_column("Share", justify="right")
    table.add_column("Identifier")
    denominator = result.summary.distinct_matched_works
    for rank, person in enumerate(ranked_people(result.people, ranking=ranking, top=top), start=1):
        share = person.full_count / denominator if denominator else 0.0
        table.add_row(
            str(rank),
            person.display_name,
            str(person.full_count),
            f"{person.fractional_count:.3f}",
            f"{share:.1%}",
            _identifier(person),
        )
    Console(file=stream, force_terminal=None).print(table)


def _candidate_dict(candidate: CandidateScore) -> dict[str, Any]:
    return {
        "work_id": candidate.work.id,
        "title": candidate.work.title,
        "year": candidate.work.year,
        "doi": candidate.work.doi,
        "provider": candidate.work.provider,
        "score": round(candidate.score, 6),
        "title_score": round(candidate.title_score, 6),
        "author_score": (
            round(candidate.author_score, 6) if candidate.author_score is not None else None
        ),
        "year_score": (
            round(candidate.year_score, 6) if candidate.year_score is not None else None
        ),
        "venue_score": (
            round(candidate.venue_score, 6) if candidate.venue_score is not None else None
        ),
    }


def _resolution_dict(resolution: Resolution) -> dict[str, Any]:
    work = resolution.work
    return {
        "index": resolution.reference.index,
        "raw": resolution.reference.raw,
        "status": resolution.status,
        "confidence": round(resolution.confidence, 6),
        "method": resolution.method,
        "reason": resolution.reason,
        "input_doi": resolution.reference.doi,
        "input_years": list(resolution.reference.years),
        "visible_surnames": list(resolution.reference.visible_surnames),
        "had_et_al": resolution.reference.has_et_al,
        "hidden_authors_expanded": resolution.hidden_authors_expanded,
        "duplicate_of": resolution.duplicate_of,
        "provider_errors": list(resolution.provider_errors),
        "matched_work": (
            {
                "id": work.id,
                "title": work.title,
                "year": work.year,
                "doi": work.doi,
                "venue": work.venue,
                "provider": work.provider,
                "source_url": work.source_url,
                "authors": [
                    {
                        "name": author.display_name,
                        "given": author.given,
                        "family": author.family,
                        "orcid": author.orcid,
                        "openalex_id": author.openalex_id,
                        "is_collective": author.is_collective,
                    }
                    for author in work.authors
                ],
            }
            if work is not None
            else None
        ),
        "alternatives": [_candidate_dict(candidate) for candidate in resolution.alternatives],
    }


def result_as_dict(
    result: AnalysisResult,
    *,
    ranking: RankingMode = "full",
    top: int = 0,
    include_audit: bool = True,
) -> dict[str, Any]:
    """Serialize a complete analysis result."""
    return {
        "summary": result.summary.as_dict(),
        "ranking_mode": ranking,
        "people": [
            person.as_dict(result.summary.distinct_matched_works)
            for person in ranked_people(result.people, ranking=ranking, top=top)
        ],
        "references": (
            [_resolution_dict(resolution) for resolution in result.resolutions]
            if include_audit
            else None
        ),
        "warnings": result.warnings,
    }


def render_json(
    result: AnalysisResult,
    *,
    stream: TextIO,
    ranking: RankingMode = "full",
    top: int = 0,
    include_audit: bool = True,
) -> None:
    """Render stable, UTF-8 JSON."""
    json.dump(
        result_as_dict(
            result,
            ranking=ranking,
            top=top,
            include_audit=include_audit,
        ),
        stream,
        ensure_ascii=False,
        indent=2,
        sort_keys=False,
    )
    stream.write("\n")


def render_csv(
    result: AnalysisResult,
    *,
    stream: TextIO,
    ranking: RankingMode = "full",
    top: int = 0,
) -> None:
    """Render the people ranking as CSV."""
    writer = csv.DictWriter(
        stream,
        fieldnames=[
            "rank",
            "name",
            "cited_works",
            "fractional_count",
            "share_of_matched_works",
            "orcid",
            "openalex_id",
            "aliases",
        ],
        lineterminator="\n",
    )
    writer.writeheader()
    denominator = result.summary.distinct_matched_works
    for rank, person in enumerate(ranked_people(result.people, ranking=ranking, top=top), start=1):
        writer.writerow(
            {
                "rank": rank,
                "name": person.display_name,
                "cited_works": person.full_count,
                "fractional_count": f"{person.fractional_count:.6f}",
                "share_of_matched_works": (
                    f"{person.full_count / denominator:.6f}" if denominator else "0.000000"
                ),
                "orcid": person.orcid or "",
                "openalex_id": person.openalex_id or "",
                "aliases": " | ".join(sorted(person.aliases - {person.display_name})),
            }
        )


def render_markdown(
    result: AnalysisResult,
    *,
    stream: TextIO,
    ranking: RankingMode = "full",
    top: int = 25,
) -> None:
    """Render a portable Markdown table."""
    stream.write("| Rank | Person | Cited works | Fractional | Share | Identifier |\n")
    stream.write("| ---: | --- | ---: | ---: | ---: | --- |\n")
    denominator = result.summary.distinct_matched_works
    for rank, person in enumerate(ranked_people(result.people, ranking=ranking, top=top), start=1):
        share = person.full_count / denominator if denominator else 0.0
        name = person.display_name.replace("|", "\\|")
        stream.write(
            f"| {rank} | {name} | {person.full_count} | "
            f"{person.fractional_count:.3f} | {share:.1%} | {_identifier(person)} |\n"
        )


def render_output(
    result: AnalysisResult,
    *,
    stream: TextIO,
    output_format: OutputFormat,
    ranking: RankingMode,
    top: int,
) -> None:
    """Dispatch to the requested output renderer."""
    if output_format == "table":
        render_table(result, stream=stream, ranking=ranking, top=top)
    elif output_format == "json":
        render_json(result, stream=stream, ranking=ranking, top=top, include_audit=True)
    elif output_format == "csv":
        render_csv(result, stream=stream, ranking=ranking, top=top)
    elif output_format == "markdown":
        render_markdown(result, stream=stream, ranking=ranking, top=top)
    else:  # pragma: no cover - protected by argparse choices
        raise ValueError(f"Unsupported output format: {output_format}")


def write_audit_file(result: AnalysisResult, path: Path) -> None:
    """Write a complete JSON audit trail regardless of the main output format."""
    buffer = io.StringIO()
    render_json(result, stream=buffer, ranking="full", top=0, include_audit=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(buffer.getvalue(), encoding="utf-8")
