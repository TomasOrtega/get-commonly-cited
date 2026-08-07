import { describe, expect, it, vi } from "vitest";

import { analyzeBibliography } from "./analysis";
import { resultToCsv, resultToJson } from "./serialization";

function exactPayload(doi: string): Record<string, unknown> {
  const isFirst = doi.endsWith("one");
  return {
    message: {
      DOI: doi,
      title: [isFirst ? "First useful paper" : "Second useful paper"],
      author: [
        { given: "Alice", family: "Smith", ORCID: "https://orcid.org/0000-0001" },
        ...(isFirst ? [{ given: "Bob", family: "Doe" }] : []),
      ],
      published: { "date-parts": [[2020]] },
    },
  };
}

describe("browser analysis facade", () => {
  it("resolves sequentially, reports progress, aggregates, and serializes", async () => {
    let active = 0;
    let maximumActive = 0;
    const fetchImpl = vi.fn(async (request: RequestInfo | URL) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      const url = new URL(String(request));
      const doi = decodeURIComponent(url.pathname.slice("/works/".length));
      active -= 1;
      return new Response(JSON.stringify(exactPayload(doi)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const progress: number[] = [];
    const result = await analyzeBibliography(
      `Smith et al. (2020). First useful paper. doi:10.1000/one

       Smith, A. (2020). Second useful paper. doi:10.1000/two`,
      { fetchImpl, storage: null, top: 0 },
      (event) => progress.push(event.current),
    );

    expect(maximumActive).toBe(1);
    expect(progress).toEqual([1, 2]);
    expect(result.summary.matchedReferences).toBe(2);
    expect(result.summary.hiddenAuthorsExpanded).toBe(1);
    expect(result.people[0]?.displayName).toBe("Alice Smith");
    expect(result.people[0]?.fullCount).toBe(2);

    const json = JSON.parse(resultToJson(result)) as Record<string, unknown>;
    expect(json.ranking_mode).toBe("full");
    expect(json.references).toBeInstanceOf(Array);
    const csv = resultToCsv(result);
    expect(csv).toContain("rank,name,cited_works");
    expect(csv).toContain("Alice Smith,2");

    const firstPerson = result.people[0];
    if (!firstPerson) throw new Error("Expected an aggregated person");
    firstPerson.displayName = "=1+1";
    firstPerson.aliases = new Set(["=1+1", "+2+2"]);
    const safeCsv = resultToCsv(result);
    expect(safeCsv).toContain("'=1+1");
    expect(safeCsv).toContain("'+2+2");
  });

  it("propagates cancellation instead of turning it into an errored reference", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzeBibliography("Smith (2020). A useful paper.", {
        signal: controller.signal,
        storage: null,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
