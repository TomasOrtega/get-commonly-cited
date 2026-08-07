import { describe, expect, it, vi } from "vitest";

import { BrowserJsonCache, clearCrossrefCache } from "./cache";
import { CrossrefClient, parseCrossrefWork } from "./crossref";
import type { Reference, StorageLike } from "./types";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function input(raw: string): Reference {
  return {
    index: 1,
    raw,
    doi: null,
    years: [2020],
    visibleSurnames: ["smith"],
    hasEtAl: false,
  };
}

const crossrefItem = {
  DOI: "10.1000/Example",
  title: ["A useful paper"],
  author: [
    {
      given: "Jane",
      family: "Smith",
      ORCID: "https://orcid.org/0000-0001-0000-0001",
    },
    { name: "Example Study Group" },
  ],
  published: { "date-parts": [[2020, 1, 1]] },
  "container-title": ["Journal of Useful Results"],
};

describe("Crossref browser client", () => {
  it("normalizes works and authors", () => {
    const work = parseCrossrefWork(crossrefItem);
    expect(work.doi).toBe("10.1000/example");
    expect(work.authors[0]?.displayName).toBe("Jane Smith");
    expect(work.authors[0]?.orcid).toBe("0000-0001-0000-0001");
    expect(work.authors[1]?.isCollective).toBe(true);
  });

  it("spaces anonymous searches by at least one second", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: { items: [crossrefItem] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new CrossrefClient({
      fetchImpl,
      cache: null,
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    });

    await client.search(input("first reference"), 5);
    await client.search(input("second reference"), 5);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1_000]);
  });

  it("caches locally and allows only its own entries to be cleared", async () => {
    const storage = new MemoryStorage();
    storage.setItem("unrelated", "keep");
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: { items: [crossrefItem] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const cache = new BrowserJsonCache(storage);
    const first = new CrossrefClient({ fetchImpl, cache, mailto: "person@example.org" });
    const second = new CrossrefClient({ fetchImpl, cache });
    await first.search(input("same reference"), 5);
    await second.search(input("same reference"), 5);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clearCrossrefCache(storage);
    expect(storage.getItem("unrelated")).toBe("keep");
    expect(storage.length).toBe(1);
  });

  it("does not impose the search delay on exact DOI lookups", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: crossrefItem }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new CrossrefClient({ fetchImpl, cache: null, sleep });
    await client.lookupDoi("10.1000/one");
    await client.lookupDoi("10.1000/two");
    expect(sleep).not.toHaveBeenCalled();
  });
});
