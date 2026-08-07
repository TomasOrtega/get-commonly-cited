import { describe, expect, it } from "vitest";

import { aggregateResolutions } from "./aggregation";
import type { Author, Reference, Resolution, Work } from "./types";

function author(displayName: string, overrides: Partial<Author> = {}): Author {
  return {
    displayName,
    given: null,
    family: null,
    orcid: null,
    openalexId: null,
    providerId: null,
    isCollective: false,
    ...overrides,
  };
}

function work(id: string, authors: Author[], doi: string | null = null): Work {
  return {
    id,
    title: id,
    authors,
    provider: "test",
    year: null,
    doi,
    venue: null,
    sourceUrl: null,
  };
}

function resolution(index: number, matchedWork: Work, raw = "reference"): Resolution {
  const reference: Reference = {
    index,
    raw,
    doi: null,
    years: [],
    visibleSurnames: [],
    hasEtAl: raw.includes("et al"),
  };
  return {
    reference,
    status: "matched",
    work: matchedWork,
    confidence: 1,
    method: "test",
    reason: null,
    alternatives: [],
    providerErrors: [],
    duplicateOf: null,
    hiddenAuthorsExpanded: 0,
  };
}

describe("author aggregation", () => {
  it("counts each person once per distinct work and fractionally", () => {
    const alice = author("Alice Smith", { family: "Smith", openalexId: "A1" });
    const bob = author("Bob Doe", { family: "Doe", openalexId: "A2" });
    const one = work("w1", [alice, bob], "10.1000/one");
    const two = work("w2", [alice], "10.1000/two");
    const result = aggregateResolutions([
      resolution(1, one),
      resolution(2, two),
      resolution(3, one),
    ]);

    expect(result.summary.duplicateReferences).toBe(1);
    expect(result.summary.distinctMatchedWorks).toBe(2);
    expect(result.people[0]?.displayName).toBe("Alice Smith");
    expect(result.people[0]?.fullCount).toBe(2);
    expect(result.people[0]?.fractionalCount).toBe(1.5);
    expect(result.people[1]?.fractionalCount).toBe(0.5);
  });

  it("links identifiers transitively and attaches an unambiguous exact name", () => {
    const bridge = author("Alice Smith", {
      orcid: "0000-0001-0000-0001",
      openalexId: "A1",
    });
    const openalexOnly = author("Alice B. Smith", { openalexId: "A1" });
    const nameOnly = author("Alice Smith");
    const result = aggregateResolutions([
      resolution(1, work("w1", [bridge])),
      resolution(2, work("w2", [openalexOnly])),
      resolution(3, work("w3", [nameOnly])),
    ]);

    expect(result.people).toHaveLength(1);
    expect(result.people[0]?.key).toBe("orcid:0000-0001-0000-0001");
    expect(result.people[0]?.fullCount).toBe(3);
  });

  it("keeps ambiguous name-only identities separate and excludes collectives", () => {
    const result = aggregateResolutions([
      resolution(1, work("w1", [author("Alex Lee", { orcid: "0000-1" })])),
      resolution(2, work("w2", [author("Alex Lee", { orcid: "0000-2" })])),
      resolution(3, work("w3", [author("Alex Lee")])),
      resolution(4, work("w4", [author("Example Study Group", { isCollective: true })])),
    ]);

    expect(new Set(result.people.map((person) => person.key))).toEqual(new Set([
      "orcid:0000-1",
      "orcid:0000-2",
      "name:alex lee",
    ]));
    expect(result.warnings).toContain("Reference 4 matched 'w4' but had no countable authors");
  });
});
