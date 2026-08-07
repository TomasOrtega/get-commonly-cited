from __future__ import annotations

from commonly_cited.parsing import (
    extract_doi,
    extract_visible_surnames,
    parse_references,
    split_references,
)


def test_numbered_multiline_references_are_joined() -> None:
    text = """
    References
    [1] Smith, J., Doe, A., et al. (2020). A useful paper.
        Journal of Useful Results 4, 10-20.
    [2] J. Smith and B. Roe. 2021. Another result.
        doi:10.1234/ABC.7
    """

    references = parse_references(text)

    assert len(references) == 2
    assert "Journal of Useful Results" in references[0].raw
    assert references[0].has_et_al
    assert references[1].doi == "10.1234/abc.7"


def test_inline_numbering_is_split() -> None:
    text = "[1] Smith J. 2020. First title. [2] Doe A. 2021. Second title."
    assert split_references(text) == [
        "Smith J. 2020. First title.",
        "Doe A. 2021. Second title.",
    ]


def test_blank_line_blocks_are_split() -> None:
    text = """Smith, J. (2020). First title. Journal 1, 1-2.

Doe, A. (2021). Second title. Journal 2, 3-4."""
    assert len(split_references(text)) == 2


def test_one_reference_per_line_is_preserved() -> None:
    text = """Smith J. 2020. First title. Journal 1.
Doe A. 2021. Second title. Journal 2.
Roe B. 2022. Third title. Journal 3."""
    assert len(split_references(text)) == 3


def test_bibtex_entries_are_split() -> None:
    text = """@article{one,
      author = {Smith, Jane},
      title = {First title},
      year = {2020}
    }
    @article{two,
      author = {Doe, Alex},
      title = {Second title},
      year = {2021}
    }"""
    entries = split_references(text)
    assert len(entries) == 2
    assert "First title" in entries[0]
    assert "Second title" in entries[1]


def test_ris_entries_are_split() -> None:
    text = """TY  - JOUR
AU  - Smith, Jane
PY  - 2020
TI  - First title
ER  -
TY  - JOUR
AU  - Doe, Alex
PY  - 2021
TI  - Second title
ER  -"""
    assert len(split_references(text)) == 2


def test_doi_extraction_strips_url_and_trailing_punctuation() -> None:
    assert extract_doi("Available at https://doi.org/10.1000/XYZ.123).") == "10.1000/xyz.123"


def test_visible_surname_extraction_handles_common_styles() -> None:
    surnames = extract_visible_surnames("Smith, J., Doe, A., et al. (2020). A title.")
    assert "smith" in surnames
    assert "doe" in surnames
