# Python API

The command-line application is built from the same small public API that can
be used in Python.

## Parsing

```python
from commonly_cited import parse_references

references = parse_references(reference_text)
for reference in references:
    print(reference.index, reference.doi, reference.has_et_al)
```

## Complete analysis

Construct providers and a resolver explicitly so network, cache, and identity
settings remain visible:

```python
from commonly_cited import analyze_text
from commonly_cited.cache import JsonCache
from commonly_cited.http import CachedHttpClient
from commonly_cited.providers import CrossrefProvider, OpenAlexProvider
from commonly_cited.resolver import ReferenceResolver

cache = JsonCache(ttl_seconds=30 * 24 * 60 * 60)

with CachedHttpClient(cache=cache) as crossref_http:
    crossref = CrossrefProvider(crossref_http, mailto="you@example.org")
    resolver = ReferenceResolver(crossref=crossref, openalex=None)
    result = analyze_text(reference_text, resolver=resolver)

print(result.people[0].display_name)
print(result.people[0].full_count)
```

The main immutable data types are `Reference`, `Author`, and `Work`. Resolution
and aggregation outputs are represented by `Resolution`, `PersonCount`, and
`AnalysisResult`.

## API documentation

::: commonly_cited
    options:
      show_root_heading: true
      members_order: source

::: commonly_cited.resolver.ReferenceResolver
    options:
      show_root_heading: true

::: commonly_cited.providers.CrossrefProvider
    options:
      show_root_heading: true

::: commonly_cited.providers.OpenAlexProvider
    options:
      show_root_heading: true
