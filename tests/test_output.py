from __future__ import annotations

import csv
import io

from commonly_cited.models import AnalysisResult, AnalysisSummary, PersonCount
from commonly_cited.output import render_csv


def test_csv_escapes_spreadsheet_formulas() -> None:
    person = PersonCount(
        key="name:formula",
        display_name="=1+1",
        aliases={"=1+1", "+2+2"},
        work_ids={"work:one"},
        full_count=1,
        fractional_count=1.0,
    )
    summary = AnalysisSummary(
        input_references=1,
        matched_references=1,
        ambiguous_references=0,
        unmatched_references=0,
        errored_references=0,
        duplicate_references=0,
        distinct_matched_works=1,
        ranked_people=1,
        et_al_references=0,
        hidden_authors_expanded=0,
    )
    result = AnalysisResult(resolutions=[], people=[person], summary=summary)
    output = io.StringIO()

    render_csv(result, stream=output)

    row = next(csv.DictReader(io.StringIO(output.getvalue())))
    assert row["name"] == "'=1+1"
    assert row["aliases"] == "'+2+2"
