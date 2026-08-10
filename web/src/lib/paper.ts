import {
  CrossrefClient,
  InvalidMetadataResponse,
  type CrossrefClientOptions,
} from "./crossref";
import { extractDoi } from "./parsing";

const DOI_VALUE_RE = /^10\.\d{4,9}\/\S+$/iu;
const DOI_IN_URL_RE = /10\.\d{4,9}\/[^\s?#]+/iu;

export interface PaperBibliography {
  doi: string;
  title: string;
  references: string[];
  skippedReferences: number;
}

export type PaperLinkErrorCode = "invalid_link" | "not_found" | "no_references";

export class PaperLinkError extends Error {
  readonly code: PaperLinkErrorCode;

  constructor(
    message: string,
    options: { code: PaperLinkErrorCode; cause?: unknown },
  ) {
    super(message, options);
    this.name = "PaperLinkError";
    this.code = options.code;
  }
}

function normalizedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/\s+/g, " ").trim() || null;
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = normalizedString(item);
      if (found) return found;
    }
    return null;
  }
  return normalizedString(value);
}

function withoutTrailingPeriod(value: string): string {
  return value.replace(/[.\s]+$/g, "");
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeDoiValue(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "")
    .replace(/^\/+/, "")
    .toLocaleLowerCase("und");
  return DOI_VALUE_RE.test(cleaned) ? cleaned : null;
}

function doiUrl(value: unknown): string | null {
  const normalized = normalizedString(value);
  if (!normalized) return null;
  const doi = normalizeDoiValue(normalized);
  return doi ? `https://doi.org/${doi}` : null;
}

export function extractDoiFromPaperLink(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  if (/^(?:dx\.)?doi\.org$/i.test(url.hostname)) {
    return normalizeDoiValue(decodeUrlPart(url.pathname));
  }

  const candidates = [
    decodeUrlPart(url.pathname),
    ...[...url.searchParams.values()].map(decodeUrlPart),
    decodeUrlPart(url.hash.slice(1)),
  ];
  for (const candidate of candidates) {
    const match = DOI_IN_URL_RE.exec(candidate);
    if (!match) continue;
    const doi = normalizeDoiValue(match[0]);
    if (doi) return doi;
  }
  return null;
}

export function parseCrossrefReference(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const exactDoi = doiUrl(item.DOI);
  const unstructured = normalizedString(item.unstructured);
  if (unstructured) {
    const depositedDoi = exactDoi?.slice("https://doi.org/".length) ?? null;
    return exactDoi && extractDoi(unstructured) !== depositedDoi
      ? `${exactDoi} ${unstructured}`
      : unstructured;
  }

  const parts: string[] = [];
  const author = normalizedString(item.author);
  const year = normalizedString(item.year);
  const articleTitle = normalizedString(item["article-title"]);
  const volumeTitle = normalizedString(item["volume-title"]);
  if (!articleTitle && !volumeTitle && !(author && year)) return exactDoi;
  if (author) parts.push(author);
  if (year) parts.push(`(${year})`);
  for (const part of [
    articleTitle,
    volumeTitle,
    normalizedString(item["journal-title"]),
    normalizedString(item["series-title"]),
    normalizedString(item.volume),
    normalizedString(item.issue),
    normalizedString(item["first-page"]),
  ]) {
    if (part) parts.push(part);
  }

  const citation = parts.map(withoutTrailingPeriod).filter(Boolean).join(". ");
  if (citation && exactDoi) return `${exactDoi} ${citation}`;
  return citation || exactDoi;
}

export function isPaperBibliographyOverLimit(
  bibliography: PaperBibliography,
  maximum: number,
): boolean {
  return bibliography.references.length > maximum;
}

export async function loadPaperBibliography(
  paperLink: string,
  options: CrossrefClientOptions = {},
): Promise<PaperBibliography> {
  const doi = extractDoiFromPaperLink(paperLink);
  if (!doi) {
    throw new PaperLinkError(
      "That paper link does not contain a DOI. Use a doi.org link or a publisher URL that includes the DOI.",
      { code: "invalid_link" },
    );
  }

  const client = new CrossrefClient(options);
  const item = await client.lookupDoiRecord(doi);
  if (!item) {
    throw new PaperLinkError(
      "Crossref could not find that DOI. Check the paper link and try again.",
      { code: "not_found" },
    );
  }
  if (item.reference != null && !Array.isArray(item.reference)) {
    throw new InvalidMetadataResponse("Crossref returned a malformed reference list");
  }

  const deposited = Array.isArray(item.reference) ? item.reference : [];
  const references = deposited
    .map(parseCrossrefReference)
    .filter((reference): reference is string => reference !== null);
  if (references.length === 0) {
    throw new PaperLinkError(
      "Crossref does not include a reference list for this paper. Paste the references instead.",
      { code: "no_references" },
    );
  }

  return {
    doi,
    title: firstString(item.title) ?? "Untitled paper",
    references,
    skippedReferences: deposited.length - references.length,
  };
}
