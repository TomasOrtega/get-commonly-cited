# Web app

The [commonly-cited web app](https://tomasortega.github.io/get-commonly-cited/)
runs entirely in the browser. Paste a bibliography, resolve its references, and
download the ranking without installing Python or creating an API key.

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
accepts up to 100 references per analysis. Leave the tab open while analysis is
running.

## Cache and privacy

Successful Crossref responses and their citation queries are cached in your
browser to reduce repeat requests. The cache is local to that browser profile,
expires after seven days, and can be cleared from the app or with the browser's
site-data controls.

Your reference text is sent directly from the browser to Crossref for metadata
matching. It is not sent through a commonly-cited server, and the ranking is
computed locally. GitHub Pages serves the static application files.

Do not submit confidential references unless sending their citation text to
Crossref is acceptable. See [Privacy](privacy.md) for the CLI's corresponding
network and cache behavior.
