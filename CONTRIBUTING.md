# Contributing

Thank you for improving `commonly-cited`. Contributions to parsing, matching,
provider support, tests, documentation, and usability are welcome.

## Before opening an issue

Search existing issues first. For a bad match or parsing failure, include a
small anonymized reference example when possible, the command used, the tool
version, and the relevant audit entry. Do not post private reference lists or
API keys.

Security problems should follow [SECURITY.md](SECURITY.md), not the public issue
tracker.

## Development setup

The project supports Python 3.10 and newer and uses `uv` for the documented
workflow.

```bash
git clone https://github.com/TomasOrtega/get-commonly-cited.git
cd get-commonly-cited
uv sync --group dev
uv run prek install
```

Run the checks before submitting a pull request:

```bash
uv run pytest --cov
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run mkdocs build --strict
uv build
```

Equivalent Nox sessions are available:

```bash
uvx nox -s lint tests docs build
```

## Tests for reference matching

Matching changes must include focused tests. Prefer small synthetic references
and mocked provider responses over live API calls. Tests must not require an
API key or network access.

A regression test should establish at least one of these properties:

- reference boundaries are recovered correctly
- the right work clears the confidence gates
- a low-confidence or near-tied match remains unresolved
- complete authorships are retained
- identities are merged only when evidence is unambiguous
- output and audit data remain stable

Live metadata changes over time, so recorded tests should assert normalized
fields rather than provider ranking scores that are outside this project's
control.

## Design expectations

- Keep network access behind provider interfaces.
- Never log or serialize API keys.
- Prefer transparent heuristics with audit evidence over opaque acceptance.
- Preserve provider metadata rather than inventing missing authors.
- Avoid aggressive name clustering that can merge different people.
- Keep the command useful with Crossref alone.
- Maintain Python 3.10 compatibility.
- Add dependencies only when they provide clear value.

## Pull requests

Keep each pull request focused. Explain the user-visible behavior, algorithmic
tradeoffs, and validation performed. Update the changelog and documentation for
observable changes.

By contributing, you agree that your contribution is licensed under the BSD
3-Clause License.
