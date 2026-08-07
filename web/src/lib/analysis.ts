import { aggregateResolutions } from "./aggregation";
import { CrossrefClient, MetadataError } from "./crossref";
import { chooseCandidate } from "./matching";
import { parseReferences } from "./parsing";
import type {
  AnalysisResult,
  AnalyzeOptions,
  ProgressCallback,
  Reference,
  Resolution,
  Work,
} from "./types";

export const DEFAULT_ANALYZE_OPTIONS: Readonly<AnalyzeOptions> = {
  ranking: "full",
  top: 25,
  minConfidence: 0.74,
  minMargin: 0.04,
  candidateLimit: 5,
  deduplicate: true,
  includeCollective: false,
};

function hiddenAuthorsExpanded(reference: Reference, work: Work | null): number {
  if (!work || !reference.hasEtAl) return 0;
  return Math.max(0, work.authors.length - Math.max(1, reference.visibleSurnames.length));
}

function providerError(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${label}: ${message}`;
}

async function resolveReference(
  reference: Reference,
  crossref: CrossrefClient,
  options: AnalyzeOptions,
): Promise<Resolution> {
  const errors: string[] = [];
  if (reference.doi) {
    try {
      const exact = await crossref.lookupDoi(reference.doi);
      if (exact) {
        return {
          reference,
          status: "matched",
          work: exact,
          confidence: 1,
          method: "crossref_doi",
          reason: "Exact DOI lookup",
          alternatives: [],
          providerErrors: errors,
          duplicateOf: null,
          hiddenAuthorsExpanded: hiddenAuthorsExpanded(reference, exact),
        };
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      errors.push(providerError("Crossref", error));
    }
  }

  let works: Work[] = [];
  let searchMethod: string | null = null;
  try {
    works = await crossref.search(reference, options.candidateLimit);
    searchMethod = "crossref_search";
  } catch (error) {
    options.signal?.throwIfAborted();
    errors.push(providerError("Crossref search", error));
  }
  const decision = chooseCandidate(reference, works, {
    minConfidence: options.minConfidence,
    minMargin: options.minMargin,
  });
  if (decision.accepted && decision.candidate) {
    const matched = decision.candidate.work;
    return {
      reference,
      status: "matched",
      work: matched,
      confidence: decision.candidate.score,
      method: searchMethod ?? "crossref_search",
      reason: decision.reason,
      alternatives: decision.alternatives,
      providerErrors: errors,
      duplicateOf: null,
      hiddenAuthorsExpanded: hiddenAuthorsExpanded(reference, matched),
    };
  }
  const status = works.length === 0 && errors.length > 0
    ? "error"
    : decision.ambiguous
      ? "ambiguous"
      : "unmatched";
  return {
    reference,
    status,
    work: null,
    confidence: decision.candidate?.score ?? 0,
    method: searchMethod,
    reason: decision.reason,
    alternatives: decision.alternatives,
    providerErrors: errors,
    duplicateOf: null,
    hiddenAuthorsExpanded: 0,
  };
}

export async function analyzeBibliography(
  text: string,
  suppliedOptions: Partial<AnalyzeOptions> = {},
  progress?: ProgressCallback,
): Promise<AnalysisResult> {
  const options: AnalyzeOptions = { ...DEFAULT_ANALYZE_OPTIONS, ...suppliedOptions };
  options.signal?.throwIfAborted();
  const references = parseReferences(text);
  const crossref = new CrossrefClient({
    mailto: options.mailto,
    fetchImpl: options.fetchImpl,
    storage: options.storage,
    signal: options.signal,
  });
  const resolutions: Resolution[] = [];
  for (let offset = 0; offset < references.length; offset += 1) {
    options.signal?.throwIfAborted();
    const reference = references[offset];
    if (!reference) continue;
    progress?.({ current: offset + 1, total: references.length, reference });
    resolutions.push(await resolveReference(reference, crossref, options));
  }
  return aggregateResolutions(resolutions, {
    deduplicate: options.deduplicate,
    includeCollective: options.includeCollective,
    ranking: options.ranking,
    top: options.top,
  });
}

export { MetadataError };
