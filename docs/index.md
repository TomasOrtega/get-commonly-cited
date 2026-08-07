# commonly-cited

`commonly-cited` identifies the people who appear most often across a pasted
bibliography, including coauthors hidden behind “et al.”.

The tool combines four concerns that are usually handled separately:

- tolerant segmentation of copied reference lists
- bibliographic matching with confidence and ambiguity gates
- recovery of complete author metadata
- transparent aggregation with a machine-readable audit trail

## Start here

```bash
commonly-cited references.txt --audit audit.json
```

Crossref is enabled by default and requires no account. Set
`OPENALEX_API_KEY` to enrich matched works with OpenAlex's disambiguated author
identities.

Read [Usage](usage.md) for all commands, [How matching works](algorithm.md) for
scoring details, and [Python API](reference.md) for library use.
