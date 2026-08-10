# Privacy and external services

## Web app

The web app is a static application hosted on GitHub Pages. Bibliography
retrieval and matching run in the browser, which sends source-paper DOIs and
citation text directly to Crossref. There is no commonly-cited application
server. Rankings stay in the browser. Successful Crossref responses and their
citation queries are cached for seven days in the browser's local site data.
Crossref and GitHub apply their own privacy policies to requests they receive.

Clear cached responses from the app or with the browser's site-data controls. Do
not submit confidential references unless sending their citation text to
Crossref is acceptable.

## Python package

Reference resolution transmits citation text to the selected metadata providers.
In the default configuration this is Crossref. When an OpenAlex API key is
configured, accepted DOI matches are enriched through OpenAlex and OpenAlex
search is used as a fallback.

The tool does not send local filenames, result rankings, or the contents of
other files. Contact emails and API keys are used only for the provider that
requires them. API keys are removed from cache identities and are not written to
audit output.

Successful JSON responses are cached locally. The cache can contain public
bibliographic metadata and the search results associated with the normalized
reference query. Disable it with `--no-cache`, choose a dedicated directory with
`--cache-dir`, or use `--offline` to prohibit all network access.
