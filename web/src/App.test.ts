import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App", () => {
  it("offers paper links without changing the default reference-list flow", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain("<legend>Start with</legend>");
    expect(markup).toContain('name="source-mode" value="paper"');
    expect(markup).toContain('name="source-mode" checked="" value="references"');
    expect(markup).toContain("Paste a reference list");
    expect(markup).toContain('<form id="analysis-workspace"');
    expect(markup).toContain('type="submit" disabled=""');
  });

  it("renders line breaks in the bibliography placeholder", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain(
      'placeholder="Paste references here…\n\nNumbered lists, BibTeX, RIS, DOIs, and wrapped citations are welcome."',
    );
    expect(markup).not.toContain("\\\\n");
  });

  it("links to privacy and limits from the main navigation", () => {
    const markup = renderToStaticMarkup(createElement(App));
    const navigation = markup.match(/<nav aria-label="Main navigation">([\s\S]*?)<\/nav>/)?.[1];

    expect(navigation).toContain(
      '<a href="./docs/privacy/">Privacy &amp; limits</a>',
    );
    expect(markup).not.toContain('id="privacy-title"');
    expect(markup).toContain("Clear local cache");
  });

  it("links to the developer's GitHub Sponsors page", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain(
      '<a href="https://github.com/sponsors/TomasOrtega">Sponsor the developer',
    );
  });
});
