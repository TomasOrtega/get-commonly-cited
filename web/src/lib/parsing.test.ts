import { describe, expect, it } from "vitest";

import {
  extractDoi,
  extractVisibleSurnames,
  parseReferences,
  splitReferences,
} from "./parsing";

describe("reference parsing", () => {
  it("joins numbered multiline references and extracts features", () => {
    const references = parseReferences(`
      References
      [1] Smith, J., Doe, A., et al. (2020). A useful paper.
          Journal of Useful Results 4, 10-20.
      [2] J. Smith and B. Roe. 2021. Another result.
          doi:10.1234/ABC.7
    `);

    expect(references).toHaveLength(2);
    expect(references[0]?.raw).toContain("Journal of Useful Results");
    expect(references[0]?.hasEtAl).toBe(true);
    expect(references[1]?.doi).toBe("10.1234/abc.7");
  });

  it("splits inline numbering", () => {
    expect(
      splitReferences("[1] Smith J. 2020. First title. [2] Doe A. 2021. Second title."),
    ).toEqual([
      "Smith J. 2020. First title.",
      "Doe A. 2021. Second title.",
    ]);
  });

  it("splits blank blocks, BibTeX, and RIS", () => {
    expect(
      splitReferences(
        "Smith, J. (2020). First title. Journal 1, 1-2.\n\nDoe, A. (2021). Second title. Journal 2, 3-4.",
      ),
    ).toHaveLength(2);
    expect(
      splitReferences(
        "@article{one,\n title={First},\n year={2020}\n}\n@article{two,\n title={Second},\n year={2021}\n}",
      ),
    ).toHaveLength(2);
    expect(
      splitReferences(
        "TY  - JOUR\nAU  - Smith, Jane\nPY  - 2020\nER  -\nTY  - JOUR\nAU  - Doe, Alex\nPY  - 2021\nER  -",
      ),
    ).toHaveLength(2);
  });

  it("normalizes DOI punctuation and recognizes common author styles", () => {
    expect(extractDoi("Available at https://doi.org/10.1000/XYZ.123)."))
      .toBe("10.1000/xyz.123");
    expect(extractVisibleSurnames("Smith, J., Doe, A., et al. (2020). A title."))
      .toEqual(expect.arrayContaining(["smith", "doe"]));
  });
});
