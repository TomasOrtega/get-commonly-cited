const DOI_URL_PREFIX = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i;
const COLLECTIVE_TERMS = new Set([
  "collaboration",
  "consortium",
  "committee",
  "group",
  "initiative",
  "network",
  "team",
  "study",
  "investigators",
]);

export function stripAccents(value: string): string {
  return value.normalize("NFKD").replace(/\p{Mark}/gu, "");
}

export function normalizeText(value: string): string {
  return stripAccents(value.normalize("NFKC"))
    .toLocaleLowerCase("und")
    .replace(/[^\p{Letter}\p{Number}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const normalizeName = normalizeText;

export function normalizeSurname(value: string): string {
  return normalizeText(value).replace(/\s/g, "");
}

export function normalizeDoi(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value
    .trim()
    .replace(DOI_URL_PREFIX, "")
    .trim()
    .replace(/[.,;:)\]}>"']+$/g, "")
    .replace(/^[([{<"']+/g, "")
    .toLocaleLowerCase("und");
  return cleaned || null;
}

export function normalizeOrcid(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .toLocaleLowerCase("und")
    .replace(/^https?:\/\/orcid\.org\//, "");
  return cleaned || null;
}

export function shortOpenAlexId(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/\/+$/, "");
  const part = cleaned.slice(cleaned.lastIndexOf("/") + 1);
  return part || null;
}

export function isCollectiveName(value: string): boolean {
  return normalizeText(value)
    .split(" ")
    .some((token) => COLLECTIVE_TERMS.has(token));
}

export function stableWorkKey(workId: string, doi: string | null): string {
  const normalized = normalizeDoi(doi);
  return normalized ? `doi:${normalized}` : workId;
}

export function uniquePreservingOrder(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))];
}
