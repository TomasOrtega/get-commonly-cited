import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App", () => {
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
});
