import { rankPeople } from "./aggregation";
import type {
  AnalysisResult,
  CandidateScore,
  PersonCount,
  Resolution,
  SerializationOptions,
} from "./types";

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function personObject(person: PersonCount, denominator: number): Record<string, unknown> {
  return {
    key: person.key,
    name: person.displayName,
    aliases: [...person.aliases]
      .filter((alias) => alias !== person.displayName)
      .sort(),
    cited_works: person.fullCount,
    fractional_count: rounded(person.fractionalCount),
    share_of_matched_works: rounded(denominator ? person.fullCount / denominator : 0),
    orcid: person.orcid,
    openalex_id: person.openalexId,
  };
}

function candidateObject(candidate: CandidateScore): Record<string, unknown> {
  return {
    work_id: candidate.work.id,
    title: candidate.work.title,
    year: candidate.work.year,
    doi: candidate.work.doi,
    provider: candidate.work.provider,
    score: rounded(candidate.score),
    title_score: rounded(candidate.titleScore),
    author_score: candidate.authorScore === null ? null : rounded(candidate.authorScore),
    year_score: candidate.yearScore === null ? null : rounded(candidate.yearScore),
    venue_score: candidate.venueScore === null ? null : rounded(candidate.venueScore),
  };
}

function resolutionObject(resolution: Resolution): Record<string, unknown> {
  const work = resolution.work;
  return {
    index: resolution.reference.index,
    raw: resolution.reference.raw,
    status: resolution.status,
    confidence: rounded(resolution.confidence),
    method: resolution.method,
    reason: resolution.reason,
    input_doi: resolution.reference.doi,
    input_years: resolution.reference.years,
    visible_surnames: resolution.reference.visibleSurnames,
    had_et_al: resolution.reference.hasEtAl,
    hidden_authors_expanded: resolution.hiddenAuthorsExpanded,
    duplicate_of: resolution.duplicateOf,
    provider_errors: resolution.providerErrors,
    matched_work: work
      ? {
          id: work.id,
          title: work.title,
          year: work.year,
          doi: work.doi,
          venue: work.venue,
          provider: work.provider,
          source_url: work.sourceUrl,
          authors: work.authors.map((author) => ({
            name: author.displayName,
            given: author.given,
            family: author.family,
            orcid: author.orcid,
            openalex_id: author.openalexId,
            is_collective: author.isCollective,
          })),
        }
      : null,
    alternatives: resolution.alternatives.map(candidateObject),
  };
}

export function resultAsObject(
  result: AnalysisResult,
  options: SerializationOptions = {},
): Record<string, unknown> {
  const ranking = options.ranking ?? result.ranking;
  const people = rankPeople(result.people, ranking, options.top ?? 0);
  return {
    summary: {
      input_references: result.summary.inputReferences,
      matched_references: result.summary.matchedReferences,
      ambiguous_references: result.summary.ambiguousReferences,
      unmatched_references: result.summary.unmatchedReferences,
      errored_references: result.summary.erroredReferences,
      duplicate_references: result.summary.duplicateReferences,
      distinct_matched_works: result.summary.distinctMatchedWorks,
      ranked_people: result.summary.rankedPeople,
      et_al_references: result.summary.etAlReferences,
      hidden_authors_expanded: result.summary.hiddenAuthorsExpanded,
    },
    ranking_mode: ranking,
    people: people.map((person) =>
      personObject(person, result.summary.distinctMatchedWorks),
    ),
    references: options.includeAudit === false
      ? null
      : result.resolutions.map(resolutionObject),
    warnings: result.warnings,
  };
}

export function resultToJson(
  result: AnalysisResult,
  options: SerializationOptions = {},
): string {
  return `${JSON.stringify(resultAsObject(result, options), null, 2)}\n`;
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function resultToCsv(
  result: AnalysisResult,
  options: Omit<SerializationOptions, "includeAudit"> = {},
): string {
  const ranking = options.ranking ?? result.ranking;
  const people = rankPeople(result.people, ranking, options.top ?? 0);
  const denominator = result.summary.distinctMatchedWorks;
  const rows: Array<Array<string | number>> = [[
    "rank",
    "name",
    "cited_works",
    "fractional_count",
    "share_of_matched_works",
    "orcid",
    "openalex_id",
    "aliases",
  ]];
  people.forEach((person, offset) => {
    rows.push([
      offset + 1,
      person.displayName,
      person.fullCount,
      person.fractionalCount.toFixed(6),
      (denominator ? person.fullCount / denominator : 0).toFixed(6),
      person.orcid ?? "",
      person.openalexId ?? "",
      [...person.aliases]
        .filter((alias) => alias !== person.displayName)
        .sort()
        .join(" | "),
    ]);
  });
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
