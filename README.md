# commonly-cited

Find the people cited most often in a bibliography, including coauthors hidden
behind “et al.”.

**[Use the web app](https://commonly-cited.tomasortega.net/)** ·
[Documentation](https://commonly-cited.tomasortega.net/docs/)

Start with a DOI-bearing paper link, paste references, or upload a TXT, BibTeX,
or RIS file. The browser app uses Crossref and needs no account or API key.
Uncertain matches stay unresolved and visible in the audit.

## Command line

Requires Python 3.10 or newer.

```bash
uv tool install commonly-cited
commonly-cited references.txt --audit audit.json
```

Use `--ranking fractional` to divide each work's credit among its authors. Set
`OPENALEX_API_KEY` to enable optional author-identity enrichment. See
[Usage](docs/usage.md) for formats, exports, and configuration.

Reference text is sent to metadata providers. See
[Privacy & limits](docs/privacy.md) for network and cache behavior, and
[How matching works](docs/algorithm.md) for the counting and matching rules.

## Development

```bash
uv sync --group dev
npm --prefix web ci
npm --prefix web run dev
```

Local documentation builds automatically; restart the dev server after editing
it. See [Contributing](CONTRIBUTING.md) for checks and contribution guidelines.

Licensed under [BSD-3-Clause](LICENSE).
