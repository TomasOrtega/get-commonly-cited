import { describe, expect, it, vi } from "vitest";

import {
  extractDoiFromPaperLink,
  isPaperBibliographyOverLimit,
  loadPaperBibliography,
  parseCrossrefReference,
} from "./paper";
import { analyzeReferences } from "./analysis";
import { parseReference } from "./parsing";

describe("paper links", () => {
  it("extracts DOIs from resolver, publisher, and URL-encoded links", () => {
    expect(
      extractDoiFromPaperLink("https://doi.org/10.1126/science.185.4157.1124"),
    ).toBe("10.1126/science.185.4157.1124");
    expect(
      extractDoiFromPaperLink(
        "https://example.org/article/10.1000/Useful.Paper?download=1",
      ),
    ).toBe("10.1000/useful.paper");
    expect(
      extractDoiFromPaperLink("https://example.org/article?doi=10.1000%2FEncoded.7"),
    ).toBe("10.1000/encoded.7");
    expect(
      extractDoiFromPaperLink(
        "https://doi.org/10.1002/(SICI)1099-0844(199912)17:4%3C290::AID-CBF849%3E3.0.CO;2-P",
      ),
    ).toBe("10.1002/(sici)1099-0844(199912)17:4<290::aid-cbf849>3.0.co;2-p");
    expect(extractDoiFromPaperLink("https://example.org/paper/10.1000/A+B"))
      .toBe("10.1000/a+b");
  });

  it("rejects non-web and DOI-free inputs", () => {
    expect(extractDoiFromPaperLink("10.1000/not-a-link")).toBeNull();
    expect(extractDoiFromPaperLink("file:///tmp/paper.pdf")).toBeNull();
    expect(extractDoiFromPaperLink("https://example.org/paper/123")).toBeNull();
  });

  it("preserves deposited citation text and adds exact DOI evidence", () => {
    expect(
      parseCrossrefReference({
        DOI: "10.1000/Cited.1",
        unstructured: "A less useful citation",
      }),
    ).toBe("https://doi.org/10.1000/cited.1 A less useful citation");
    const conflictingDoi = parseCrossrefReference({
      DOI: "10.1000/Right",
      unstructured: "Correction to https://doi.org/10.1000/wrong",
    });
    expect(conflictingDoi).toBe(
      "https://doi.org/10.1000/right Correction to https://doi.org/10.1000/wrong",
    );
    expect(parseReference(conflictingDoi ?? "").doi).toBe("10.1000/right");
    expect(
      parseCrossrefReference({
        author: "Smith, J.",
        year: "2020",
        "article-title": "A useful result",
        "journal-title": "Journal of Results",
        volume: "4",
        "first-page": "10",
      }),
    ).toBe("Smith, J. (2020). A useful result. Journal of Results. 4. 10");
    expect(parseCrossrefReference({ unstructured: "  Roe A. (2021). Another result.  " }))
      .toBe("Roe A. (2021). Another result.");
    expect(parseCrossrefReference({ key: "ref-4" })).toBeNull();
    expect(parseCrossrefReference({ year: "2020" })).toBeNull();
    expect(parseCrossrefReference({ author: "Smith" })).toBeNull();
    expect(parseCrossrefReference({ "journal-title": "Journal", volume: "4" }))
      .toBeNull();
    expect(parseCrossrefReference({ "article-title": "A distinctive result" }))
      .toBe("A distinctive result");
  });

  it("parses already-separated references without interpreting inner markers", () => {
    const references = [
      parseReference("https://doi.org/10.1000/cited.1", 1),
      parseReference("Roe A. (2021). Result from experiment [2] in the appendix.", 2),
    ];

    expect(references[0]?.doi).toBe("10.1000/cited.1");
    expect(references[1]?.raw).toContain("[2]");
    expect(references).toHaveLength(2);
  });

  it("loads a deposited bibliography for a paper link", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        message: {
          DOI: "10.1000/Source",
          title: ["The source paper"],
          reference: [
            { DOI: "10.1000/Cited.1" },
            { unstructured: "Roe A. (2021). Another useful result." },
            { key: "unusable" },
          ],
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const bibliography = await loadPaperBibliography(
      "https://doi.org/10.1000/Source",
      { fetchImpl, storage: null },
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(requestedUrls[0]).toContain("/works/10.1000%2Fsource");
    expect(bibliography).toEqual({
      doi: "10.1000/source",
      title: "The source paper",
      references: [
        "https://doi.org/10.1000/cited.1",
        "Roe A. (2021). Another useful result.",
      ],
      skippedReferences: 1,
    });
  });

  it("feeds linked-paper references into the recurring-author analysis", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let message: Record<string, unknown>;
      if (url.includes("10.1000%2Fsource")) {
        message = {
          DOI: "10.1000/source",
          title: ["The source paper"],
          reference: [{ DOI: "10.1000/first" }, { DOI: "10.1000/second" }],
        };
      } else if (url.includes("10.1000%2Ffirst")) {
        message = {
          DOI: "10.1000/first",
          title: ["First cited paper"],
          author: [{ given: "Jane", family: "Smith" }, { given: "Alex", family: "Roe" }],
          published: { "date-parts": [[2020]] },
        };
      } else if (url.includes("10.1000%2Fsecond")) {
        message = {
          DOI: "10.1000/second",
          title: ["Second cited paper"],
          author: [{ given: "Jane", family: "Smith" }, { given: "Sam", family: "Doe" }],
          published: { "date-parts": [[2021]] },
        };
      } else {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify({ message }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const bibliography = await loadPaperBibliography(
      "https://doi.org/10.1000/source",
      { fetchImpl, storage: null },
    );
    const result = await analyzeReferences(
      bibliography.references.map((reference, index) => parseReference(reference, index + 1)),
      { fetchImpl, storage: null, top: 0 },
    );

    expect(result.summary.inputReferences).toBe(2);
    expect(result.summary.matchedReferences).toBe(2);
    expect(result.people.find((person) => person.displayName === "Jane Smith")?.fullCount)
      .toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("exposes the paper-reference limit without truncating", () => {
    const bibliography = {
      doi: "10.1000/source",
      title: "Source",
      references: Array.from({ length: 101 }, (_, index) => `Reference ${index + 1}`),
      skippedReferences: 0,
    };

    const atLimit = {
      ...bibliography,
      references: bibliography.references.slice(0, 100),
    };
    expect(isPaperBibliographyOverLimit(atLimit, 100)).toBe(false);
    expect(isPaperBibliographyOverLimit(bibliography, 100)).toBe(true);
    expect(bibliography.references).toHaveLength(101);
  });

  it("cancels while loading the source paper", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener(
          "abort",
          () => {
            reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
          },
          { once: true },
        );
      }),
    );

    const pending = loadPaperBibliography("https://doi.org/10.1000/source", {
      fetchImpl,
      storage: null,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports unsupported links, unknown papers, and missing bibliographies", async () => {
    await expect(loadPaperBibliography("https://example.org/paper/123"))
      .rejects.toThrow("does not contain a DOI");

    const missingFetch = vi.fn(async () => new Response("not found", { status: 404 }));
    await expect(
      loadPaperBibliography("https://doi.org/10.1000/missing", {
        fetchImpl: missingFetch,
        storage: null,
      }),
    ).rejects.toThrow("could not find that DOI");

    const emptyFetch = vi.fn(async () =>
      new Response(JSON.stringify({
        message: { DOI: "10.1000/empty", title: ["No deposited references"] },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(
      loadPaperBibliography("https://doi.org/10.1000/empty", {
        fetchImpl: emptyFetch,
        storage: null,
      }),
    ).rejects.toThrow("does not include a reference list");

    const nullFetch = vi.fn(async () =>
      new Response(JSON.stringify({
        message: {
          DOI: "10.1000/null",
          title: ["Null references"],
          reference: null,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(
      loadPaperBibliography("https://doi.org/10.1000/null", {
        fetchImpl: nullFetch,
        storage: null,
      }),
    ).rejects.toThrow("does not include a reference list");

    const malformedFetch = vi.fn(async () =>
      new Response(JSON.stringify({
        message: {
          DOI: "10.1000/malformed",
          title: ["Malformed references"],
          reference: {},
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(
      loadPaperBibliography("https://doi.org/10.1000/malformed", {
        fetchImpl: malformedFetch,
        storage: null,
      }),
    ).rejects.toThrow("malformed reference list");
  });
});
