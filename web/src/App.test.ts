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
    expect(markup).toContain('<form class="workspace"');
    expect(markup).toContain('class="primary-button" type="submit"');
  });

  it("renders line breaks in the bibliography placeholder", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain(
      'placeholder="Paste references here…\n\nNumbered lists, BibTeX, RIS, DOIs, and wrapped citations are welcome."',
    );
    expect(markup).not.toContain("\\\\n");
  });

  it("uses the section label pattern for privacy", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain(
      '<p class="eyebrow"><span>03</span> Privacy &amp; limits</p>',
    );
    expect(markup).not.toContain('class="privacy-index"');
  });

  it("links to the developer's GitHub Sponsors page", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain(
      '<a href="https://github.com/sponsors/TomasOrtega">Sponsor the developer',
    );
  });
});
