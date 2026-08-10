# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- analyze a paper's deposited bibliography from a DOI-bearing link in the web
  app

## [0.2.0] - 2026-08-07

### Added

- a keyless, Crossref-only browser app hosted on GitHub Pages
- local-browser response caching and downloadable analysis results
- combined deployment of the web app and MkDocs documentation
- web lint, test, and production-build checks in CI

### Fixed

- avoid treating page-range endings as inline bibliography number markers
- escape formula-leading author text in CSV exports

## [0.1.0] - 2026-08-07

### Added

- tolerant parsing for pasted, numbered, wrapped, BibTeX, and RIS references
- exact DOI lookup and fuzzy Crossref bibliographic matching
- optional OpenAlex author-identity enrichment
- recovery and counting of authors hidden behind “et al.”
- conservative confidence and ambiguity gates with a detailed audit trail
- duplicate-work handling, full counts, and fractional counts
- terminal, JSON, CSV, and Markdown output
- filesystem caching, retries, API etiquette, and offline replay
- typed Python API, tests, documentation, CI, release automation, and community
  files

[Unreleased]:
  https://github.com/TomasOrtega/get-commonly-cited/compare/v0.2.0...HEAD
[0.2.0]:
  https://github.com/TomasOrtega/get-commonly-cited/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TomasOrtega/get-commonly-cited/releases/tag/v0.1.0
