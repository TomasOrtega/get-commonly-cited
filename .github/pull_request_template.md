## Summary

Describe the user-visible change and why it is needed.

## Validation

- [ ] Tests added or updated
- [ ] `uv run pytest --cov`
- [ ] `uv run ruff check .`
- [ ] `uv run ruff format --check .`
- [ ] `uv run mypy`
- [ ] Documentation and changelog updated when needed

## Matching and metadata checklist

- [ ] No live-network dependency was added to tests
- [ ] Low-confidence or ambiguous matches remain auditable
- [ ] API keys and contact information are not logged or serialized
- [ ] Existing complete author lists are not shortened
