import { describe, expect, it } from "vitest";

import { chooseCandidate, scoreCandidate } from "./matching";
import type { Reference, Work } from "./types";

function reference(overrides: Partial<Reference> = {}): Reference {
  return {
    index: 1,
    raw: "Smith, J. (2020). A useful paper. Journal of Useful Results.",
    doi: null,
    years: [2020],
    visibleSurnames: ["smith"],
    hasEtAl: false,
    ...overrides,
  };
}

function work(title: string, overrides: Partial<Work> = {}): Work {
  return {
    id: `work:${title}`,
    title,
    year: 2020,
    doi: null,
    venue: "Journal of Useful Results",
    provider: "test",
    sourceUrl: null,
    authors: [
      {
        displayName: "Jane Smith",
        given: "Jane",
        family: "Smith",
        orcid: null,
        openalexId: null,
        providerId: null,
        isCollective: false,
      },
    ],
    ...overrides,
  };
}

describe("candidate matching", () => {
  it("scores an exact DOI as one", () => {
    expect(
      scoreCandidate(
        reference({ raw: "noise", doi: "10.1000/example" }),
        work("Different title", { doi: "10.1000/EXAMPLE" }),
      ).score,
    ).toBe(1);
  });

  it("accepts strong title, author, year, and venue evidence", () => {
    const decision = chooseCandidate(reference(), [work("A useful paper")]);
    expect(decision.accepted).toBe(true);
    expect(decision.candidate?.score).toBeGreaterThan(0.9);
  });

  it("rejects a poor title that coincidentally shares author and year", () => {
    const decision = chooseCandidate(reference(), [work("Unrelated oceanography")]);
    expect(decision.accepted).toBe(false);
  });

  it("does not silently accept near-tied candidates", () => {
    const input = reference({ raw: "Smith (2020). Similar title." });
    const decision = chooseCandidate(
      input,
      [work("Similar title"), work("A similar title")],
      { minMargin: 0.2 },
    );
    expect(decision.accepted).toBe(false);
    expect(decision.ambiguous).toBe(true);
  });
});
