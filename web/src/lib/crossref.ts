import { BrowserJsonCache } from "./cache";
import { isCollectiveName, normalizeDoi, normalizeOrcid } from "./normalization";
import type {
  Author,
  FetchLike,
  Reference,
  StorageLike,
  Work,
} from "./types";

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const CROSSREF_BASE_URL = "https://api.crossref.org";

export class MetadataError extends Error {
  readonly status: number | null;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "MetadataError";
    this.status = options.status ?? null;
  }
}

export class InvalidMetadataResponse extends MetadataError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "InvalidMetadataResponse";
  }
}

type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, milliseconds);
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const found = value.find((item): item is string => typeof item === "string" && Boolean(item.trim()));
    return found?.trim() ?? null;
  }
  return null;
}

function dateYear(item: Record<string, unknown>): number | null {
  for (const key of [
    "published-print",
    "published-online",
    "published",
    "issued",
    "created",
  ]) {
    const value = item[key];
    if (!isRecord(value)) continue;
    const parts = value["date-parts"];
    if (!Array.isArray(parts) || !Array.isArray(parts[0])) continue;
    const year = parts[0][0];
    if (typeof year === "number" && Number.isInteger(year)) return year;
  }
  return null;
}

function parseAuthor(item: Record<string, unknown>): Author | null {
  const given = typeof item.given === "string" ? item.given.trim() || null : null;
  const family = typeof item.family === "string" ? item.family.trim() || null : null;
  const collective = typeof item.name === "string" ? item.name.trim() || null : null;
  const displayName = collective ?? [given, family].filter(Boolean).join(" ").trim();
  if (!displayName) return null;
  return {
    displayName,
    given,
    family,
    orcid: normalizeOrcid(typeof item.ORCID === "string" ? item.ORCID : null),
    openalexId: null,
    providerId: null,
    isCollective: collective !== null || isCollectiveName(displayName),
  };
}

function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  const left = (first >>> 0).toString(16).padStart(8, "0");
  const right = (second >>> 0).toString(16).padStart(8, "0");
  return `${left}${right}${left.slice(0, 4)}`;
}

export function parseCrossrefWork(item: Record<string, unknown>): Work {
  const title = firstString(item.title) ?? "Untitled work";
  const doi = normalizeDoi(typeof item.DOI === "string" ? item.DOI : null);
  const authors = Array.isArray(item.author)
    ? item.author
        .filter(isRecord)
        .map(parseAuthor)
        .filter((author): author is Author => author !== null)
    : [];
  const venue = firstString(item["container-title"]);
  const year = dateYear(item);
  const sourceUrl = doi
    ? `https://doi.org/${doi}`
    : firstString(item.URL);
  return {
    id: doi ? `doi:${doi}` : `crossref:${stableHash(`${title}|${year}|${venue ?? ""}`)}`,
    title,
    authors,
    provider: "crossref",
    year,
    doi,
    venue,
    sourceUrl,
  };
}

export interface CrossrefClientOptions {
  mailto?: string;
  fetchImpl?: FetchLike;
  storage?: StorageLike | null;
  cache?: BrowserJsonCache | null;
  signal?: AbortSignal;
  maxRetries?: number;
  now?: () => number;
  sleep?: Sleep;
}

export class CrossrefClient {
  readonly mailto: string | undefined;
  readonly fetchImpl: FetchLike;
  readonly cache: BrowserJsonCache | null;
  readonly signal: AbortSignal | undefined;
  readonly maxRetries: number;
  readonly now: () => number;
  readonly sleep: Sleep;
  private lastAnonymousSearchAt: number | null = null;

  constructor(options: CrossrefClientOptions = {}) {
    this.mailto = options.mailto?.trim() || undefined;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.cache = options.cache === undefined
      ? new BrowserJsonCache(options.storage)
      : options.cache;
    this.signal = options.signal;
    this.maxRetries = options.maxRetries ?? 3;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private async respectAnonymousSearchLimit(): Promise<void> {
    if (this.mailto || this.lastAnonymousSearchAt === null) return;
    const wait = 1_000 - (this.now() - this.lastAnonymousSearchAt);
    if (wait > 0) await this.sleep(wait, this.signal);
  }

  private retryDelay(response: Response | null, attempt: number): number {
    const retryAfter = response?.headers.get("Retry-After");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return Math.min(60_000, Math.max(0, seconds * 1_000));
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return Math.min(60_000, Math.max(0, date - Date.now()));
    }
    return Math.min(30_000, 500 * 2 ** attempt);
  }

  private async getJson(
    pathname: string,
    params: Record<string, string | number | undefined>,
    kind: "doi" | "search",
  ): Promise<Record<string, unknown>> {
    const url = new URL(pathname, CROSSREF_BASE_URL);
    for (const [key, value] of Object.entries(params).sort(([left], [right]) => left.localeCompare(right))) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    if (this.mailto) url.searchParams.set("mailto", this.mailto);
    const cacheUrl = new URL(url);
    cacheUrl.searchParams.delete("mailto");
    const cacheKey = `GET ${cacheUrl.toString()}`;
    const cached = this.cache?.get(cacheKey);
    if (cached) return cached;

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      this.signal?.throwIfAborted();
      let response: Response | null = null;
      try {
        if (kind === "search") {
          await this.respectAnonymousSearchLimit();
          if (!this.mailto) this.lastAnonymousSearchAt = this.now();
        }
        response = await this.fetchImpl(url, {
          headers: { Accept: "application/json" },
          signal: this.signal,
        });
        if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
          await this.sleep(this.retryDelay(response, attempt), this.signal);
          continue;
        }
        if (!response.ok) {
          throw new MetadataError(
            `Crossref request failed with HTTP ${response.status}`,
            { status: response.status },
          );
        }
        const payload: unknown = await response.json();
        if (!isRecord(payload)) {
          throw new InvalidMetadataResponse("Crossref returned a non-object JSON response");
        }
        this.cache?.set(cacheKey, payload);
        return payload;
      } catch (error) {
        this.signal?.throwIfAborted();
        lastError = error;
        if (error instanceof MetadataError) throw error;
        if (attempt >= this.maxRetries) break;
        await this.sleep(this.retryDelay(response, attempt), this.signal);
      }
    }
    throw new MetadataError("Crossref metadata request failed", { cause: lastError });
  }

  async lookupDoi(doi: string): Promise<Work | null> {
    const item = await this.lookupDoiRecord(doi);
    return item ? parseCrossrefWork(item) : null;
  }

  async lookupDoiRecord(doi: string): Promise<Record<string, unknown> | null> {
    const normalized = normalizeDoi(doi);
    if (!normalized) return null;
    let payload: Record<string, unknown>;
    try {
      payload = await this.getJson(
        `/works/${encodeURIComponent(normalized)}`,
        {},
        "doi",
      );
    } catch (error) {
      if (error instanceof MetadataError && error.status === 404) return null;
      throw error;
    }
    if (!isRecord(payload.message)) {
      throw new InvalidMetadataResponse("Crossref DOI response did not contain a work object");
    }
    return payload.message;
  }

  async search(reference: Reference, limit: number): Promise<Work[]> {
    const payload = await this.getJson(
      "/works",
      {
        "query.bibliographic": reference.raw,
        rows: Math.max(1, Math.min(Math.floor(limit), 20)),
        select: [
          "DOI",
          "title",
          "author",
          "published",
          "published-print",
          "published-online",
          "issued",
          "created",
          "container-title",
          "URL",
          "type",
        ].join(","),
      },
      "search",
    );
    if (!isRecord(payload.message)) {
      throw new InvalidMetadataResponse("Crossref search response did not contain a message object");
    }
    const items = payload.message.items;
    if (!Array.isArray(items)) {
      throw new InvalidMetadataResponse("Crossref search response did not contain an items list");
    }
    return items.filter(isRecord).map(parseCrossrefWork);
  }
}
