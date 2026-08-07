import { describe, expect, it } from "vitest";

import matchingFixture from "../../../shared-fixtures/matching.json";
import parsingFixture from "../../../shared-fixtures/parsing.json";
import { chooseCandidate } from "./matching";
import { parseReferences } from "./parsing";
import type { Reference, Work } from "./types";

describe("shared Python/browser conformance", () => {
  for (const testCase of parsingFixture.cases) {
    it(testCase.name, () => {
      const actual = parseReferences(testCase.input).map((reference) => ({
        raw: reference.raw,
        doi: reference.doi,
        years: reference.years,
        has_et_al: reference.hasEtAl,
      }));

      expect(actual).toEqual(testCase.expected);
    });
  }

  for (const testCase of matchingFixture.cases) {
    it(testCase.name, () => {
      const reference: Reference = {
        index: 1,
        raw: testCase.reference.raw,
        doi: testCase.reference.doi,
        years: testCase.reference.years,
        visibleSurnames: testCase.reference.visible_surnames,
        hasEtAl: false,
      };
      const works: Work[] = testCase.works.map((item) => ({
        id: item.id,
        title: item.title,
        authors: item.authors.map((author) => ({
          displayName: author.display_name,
          given: null,
          family: author.family,
          orcid: null,
          openalexId: null,
          providerId: null,
          isCollective: false,
        })),
        provider: "fixture",
        year: item.year,
        doi: item.doi,
        venue: item.venue,
        sourceUrl: null,
      }));
      const decision = chooseCandidate(reference, works, {
        minMargin: testCase.min_margin,
      });

      expect({
        accepted: decision.accepted,
        ambiguous: decision.ambiguous,
        best_id: decision.candidate?.work.id ?? null,
      }).toEqual(testCase.expected);
    });
  }
});
