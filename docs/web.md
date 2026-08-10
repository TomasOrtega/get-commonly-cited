# Web app

The [commonly-cited web app](https://commonly-cited.tomasortega.net/) runs
entirely in the browser. Start with a DOI-bearing paper link or paste a
bibliography, then resolve its references and download the ranking without
installing Python or creating an API key.

## Paper links

Choose **Paper link** and enter a `doi.org` link or a publisher-page URL that
contains the paper's DOI. The app retrieves the bibliography deposited for that
DOI with Crossref, then sends each usable reference through the same matching
and ranking flow as a pasted list.

Crossref only has references that publishers deposited. Some DOI records have no
reference list, and some deposited entries are too incomplete to use. The app
reports those cases instead of guessing; paste the paper's references when link
retrieval is unavailable. Generic article and PDF URLs without a DOI in the URL
are not supported by the static browser app.

## How it differs from the CLI

The web app uses Crossref only. OpenAlex enrichment and its stronger author
identity matching remain available in the Python CLI when an OpenAlex API key is
configured.

The browser implementation preserves the Python matcher's evidence weights and
confidence gates, with shared fixtures covering core parsing and match
decisions. It uses a dependency-free fuzzy similarity implementation, so a
borderline score can differ slightly from the CLI's RapidFuzz result.

Crossref requests come from your browser and are subject to Crossref's public
API rate limits. DOI lookups are usually quick; bibliographic searches are
throttled and a large reference list can take several minutes. The browser app
accepts up to 100 usable references per analysis, including references loaded
from a paper link. It reports the limit before resolving any retrieved
references. Leave the tab open while analysis is running.

## Cache and privacy

Successful Crossref responses and their citation queries are cached in your
browser to reduce repeat requests. The cache is local to that browser profile,
expires after seven days, and can be cleared from the app or with the browser's
site-data controls.

Your source-paper DOI and reference text are sent directly from the browser to
Crossref for bibliography retrieval and metadata matching. They are not sent
through a commonly-cited server, and the ranking is computed locally. GitHub
Pages serves the static application files.

Do not submit confidential references unless sending their citation text to
Crossref is acceptable. See [Privacy](privacy.md) for the CLI's corresponding
network and cache behavior.
