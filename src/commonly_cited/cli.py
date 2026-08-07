"""Command-line interface for commonly-cited."""

from __future__ import annotations

import argparse
import os
import sys
from contextlib import ExitStack
from pathlib import Path
from typing import TYPE_CHECKING, TextIO, cast

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

from . import __version__
from .analysis import aggregate_resolutions
from .cache import JsonCache
from .http import CachedHttpClient, MetadataError
from .output import render_output, write_audit_file
from .parsing import parse_references
from .providers import CrossrefProvider, OpenAlexProvider
from .resolver import ReferenceResolver

if TYPE_CHECKING:
    from .models import AnalysisSummary, Reference
    from .output import OutputFormat, RankingMode

_REPOSITORY_URL = "https://github.com/TomasOrtega/get-commonly-cited"


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="commonly-cited",
        description=(
            "Find the people who occur most often across a pasted reference list, "
            "including authors hidden behind 'et al.'"
        ),
    )
    parser.add_argument(
        "input",
        nargs="?",
        default="-",
        help="Reference-list file, or '-' to read from standard input (default: -)",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument(
        "--provider",
        choices=("auto", "crossref", "openalex", "both"),
        default="auto",
        help=(
            "Metadata source. 'auto' uses Crossref and enriches with OpenAlex when "
            "OPENALEX_API_KEY is set (default: auto)."
        ),
    )
    parser.add_argument(
        "--email",
        default=os.environ.get("CROSSREF_MAILTO"),
        help="Contact email for Crossref's polite pool (or CROSSREF_MAILTO)",
    )
    parser.add_argument(
        "--format",
        dest="output_format",
        choices=("table", "json", "csv", "markdown"),
        default="table",
        help="Output format (default: table)",
    )
    parser.add_argument("--output", type=Path, help="Write main output to this file")
    parser.add_argument(
        "--audit",
        type=Path,
        help="Write detailed match decisions, recovered authors, and alternatives as JSON",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=25,
        help="Number of people to show; 0 means all (default: 25)",
    )
    parser.add_argument(
        "--ranking",
        choices=("full", "fractional"),
        default="full",
        help="Rank by cited-work count or fractional authorship count (default: full)",
    )
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=0.74,
        help="Minimum fuzzy-match confidence from 0 to 1 (default: 0.74)",
    )
    parser.add_argument(
        "--min-margin",
        type=float,
        default=0.04,
        help="Required margin over the second candidate (default: 0.04)",
    )
    parser.add_argument(
        "--candidate-limit",
        type=int,
        default=5,
        help="Candidates requested from each provider per reference (default: 5)",
    )
    parser.add_argument(
        "--keep-duplicates",
        action="store_true",
        help="Count duplicate references instead of collapsing repeated works",
    )
    parser.add_argument(
        "--include-collective-authors",
        action="store_true",
        help="Include collaborations, consortia, and other group authors",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=(
            Path(os.environ["COMMONLY_CITED_CACHE_DIR"])
            if "COMMONLY_CITED_CACHE_DIR" in os.environ
            else None
        ),
        help="Metadata cache directory (or COMMONLY_CITED_CACHE_DIR)",
    )
    parser.add_argument(
        "--cache-ttl-days",
        type=float,
        default=30.0,
        help="Refresh cached metadata after this many days (default: 30)",
    )
    parser.add_argument("--no-cache", action="store_true", help="Disable metadata caching")
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Use cached responses only and never access metadata APIs",
    )
    parser.add_argument(
        "--fail-on-unmatched",
        action="store_true",
        help="Exit with status 2 when any reference is ambiguous, unmatched, or errored",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress progress and summary messages",
    )
    return parser


def _validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.top < 0:
        parser.error("--top must be non-negative")
    if not 0.0 <= args.min_confidence <= 1.0:
        parser.error("--min-confidence must be between 0 and 1")
    if not 0.0 <= args.min_margin <= 1.0:
        parser.error("--min-margin must be between 0 and 1")
    if not 1 <= args.candidate_limit <= 20:
        parser.error("--candidate-limit must be between 1 and 20")
    if args.cache_ttl_days <= 0:
        parser.error("--cache-ttl-days must be positive")
    if args.offline and args.no_cache:
        parser.error("--offline cannot be combined with --no-cache")
    if (
        args.output is not None
        and args.audit is not None
        and args.output.resolve() == args.audit.resolve()
    ):
        parser.error("--output and --audit must refer to different files")


def _read_input(path_value: str, stdin: TextIO) -> str:
    if path_value == "-":
        return stdin.read()
    return Path(path_value).read_text(encoding="utf-8-sig")


def _open_output(path: Path | None, stdout: TextIO, stack: ExitStack) -> TextIO:
    if path is None:
        return stdout
    path.parent.mkdir(parents=True, exist_ok=True)
    return cast("TextIO", stack.enter_context(path.open("w", encoding="utf-8", newline="")))


def _summary_message(summary: AnalysisSummary) -> str:
    return (
        f"Parsed {summary.input_references} references; matched {summary.matched_references}, "
        f"ambiguous {summary.ambiguous_references}, unmatched {summary.unmatched_references}, "
        f"errors {summary.errored_references}; {summary.distinct_matched_works} distinct works, "
        f"{summary.hidden_authors_expanded} authors expanded from et al."
    )


def main(
    argv: list[str] | None = None,
    *,
    stdin: TextIO = sys.stdin,
    stdout: TextIO = sys.stdout,
    stderr: TextIO = sys.stderr,
) -> int:
    """Run the command-line application and return a process exit status."""
    parser = build_parser()
    args = parser.parse_args(argv)
    _validate_args(parser, args)
    console = Console(file=stderr, force_terminal=None)

    try:
        text = _read_input(args.input, stdin)
    except OSError as error:
        console.print(f"[bold red]error:[/] could not read input: {error}")
        return 1

    references = parse_references(text)
    if not references:
        console.print("[bold red]error:[/] no references were found in the input")
        return 1

    openalex_key = os.environ.get("OPENALEX_API_KEY", "").strip()
    use_crossref = args.provider in {"auto", "crossref", "both"}
    use_openalex = args.provider in {"openalex", "both"} or (
        args.provider == "auto" and bool(openalex_key)
    )
    if use_openalex and not openalex_key:
        console.print(
            "[bold red]error:[/] OpenAlex now requires an API key. Set OPENALEX_API_KEY "
            "or use --provider crossref."
        )
        return 1

    if args.provider == "auto" and not openalex_key and not args.quiet:
        console.print(
            "[yellow]OpenAlex enrichment is disabled because OPENALEX_API_KEY is not set. "
            "Crossref will still recover full deposited author lists.[/]"
        )
    if use_crossref and not args.email and not args.quiet:
        console.print(
            "[yellow]Tip: set CROSSREF_MAILTO or pass --email to use Crossref's polite pool.[/]"
        )

    cache = None
    if not args.no_cache:
        try:
            cache = JsonCache(
                args.cache_dir,
                ttl_seconds=args.cache_ttl_days * 24 * 60 * 60,
            )
        except OSError as error:
            console.print(f"[bold red]error:[/] could not initialize cache: {error}")
            return 1

    user_agent = f"commonly-cited/{__version__} ({_REPOSITORY_URL}"
    if args.email:
        user_agent += f"; mailto:{args.email}"
    user_agent += ")"

    with ExitStack() as stack:
        crossref = None
        openalex = None
        if use_crossref:
            crossref_http = stack.enter_context(
                CachedHttpClient(
                    cache=cache,
                    offline=args.offline,
                    min_interval=0.1,
                    user_agent=user_agent,
                )
            )
            crossref = CrossrefProvider(crossref_http, mailto=args.email)
        if use_openalex:
            openalex_http = stack.enter_context(
                CachedHttpClient(
                    cache=cache,
                    offline=args.offline,
                    min_interval=0.02,
                    user_agent=user_agent,
                )
            )
            openalex = OpenAlexProvider(openalex_http, api_key=openalex_key)

        resolver = ReferenceResolver(
            crossref=crossref,
            openalex=openalex,
            candidate_limit=args.candidate_limit,
            min_confidence=args.min_confidence,
            min_margin=args.min_margin,
        )

        try:
            if args.quiet:
                resolutions = resolver.resolve_all(references)
            else:
                with Progress(
                    SpinnerColumn(),
                    TextColumn("{task.description}"),
                    console=console,
                    transient=True,
                ) as progress:
                    task = progress.add_task("Resolving references", total=len(references))

                    def update(position: int, total: int, _reference: Reference) -> None:
                        progress.update(
                            task,
                            completed=position - 1,
                            description=f"Resolving reference {position}/{total}",
                        )

                    resolutions = resolver.resolve_all(references, progress=update)
                    progress.update(
                        task,
                        completed=len(references),
                        description="Resolution complete",
                    )
        except MetadataError as error:
            console.print(f"[bold red]error:[/] {error}")
            return 1

        result = aggregate_resolutions(
            resolutions,
            deduplicate_works=not args.keep_duplicates,
            include_collective_authors=args.include_collective_authors,
        )

        output_format = cast("OutputFormat", args.output_format)
        ranking = cast("RankingMode", args.ranking)
        try:
            output_stream = _open_output(args.output, stdout, stack)
            render_output(
                result,
                stream=output_stream,
                output_format=output_format,
                ranking=ranking,
                top=args.top,
            )
        except OSError as error:
            console.print(f"[bold red]error:[/] could not write output: {error}")
            return 1
        if args.audit:
            try:
                write_audit_file(result, args.audit)
            except OSError as error:
                console.print(f"[bold red]error:[/] could not write audit file: {error}")
                return 1

    if not args.quiet:
        console.print(_summary_message(result.summary))
        if args.audit:
            console.print(f"Audit trail: {args.audit}")

    unresolved_count = (
        result.summary.ambiguous_references
        + result.summary.unmatched_references
        + result.summary.errored_references
    )
    return 2 if args.fail_on_unmatched and unresolved_count else 0
