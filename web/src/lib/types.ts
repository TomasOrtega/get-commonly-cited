export type ResolutionStatus = "matched" | "ambiguous" | "unmatched" | "error";

export type RankingMode = "full" | "fractional";

export interface Reference {
  index: number;
  raw: string;
  doi: string | null;
  years: number[];
  visibleSurnames: string[];
  hasEtAl: boolean;
}

export interface Author {
  displayName: string;
  given: string | null;
  family: string | null;
  orcid: string | null;
  openalexId: string | null;
  providerId: string | null;
  isCollective: boolean;
}

export interface Work {
  id: string;
  title: string;
  authors: Author[];
  provider: string;
  year: number | null;
  doi: string | null;
  venue: string | null;
  sourceUrl: string | null;
}

export interface CandidateScore {
  work: Work;
  score: number;
  titleScore: number;
  authorScore: number | null;
  yearScore: number | null;
  venueScore: number | null;
}

export interface MatchDecision {
  candidate: CandidateScore | null;
  alternatives: CandidateScore[];
  accepted: boolean;
  ambiguous: boolean;
  reason: string;
}

export interface Resolution {
  reference: Reference;
  status: ResolutionStatus;
  work: Work | null;
  confidence: number;
  method: string | null;
  reason: string | null;
  alternatives: CandidateScore[];
  providerErrors: string[];
  duplicateOf: number | null;
  hiddenAuthorsExpanded: number;
}

export interface PersonCount {
  key: string;
  displayName: string;
  aliases: Set<string>;
  workIds: Set<string>;
  fullCount: number;
  fractionalCount: number;
  orcid: string | null;
  openalexId: string | null;
}

export interface AnalysisSummary {
  inputReferences: number;
  matchedReferences: number;
  ambiguousReferences: number;
  unmatchedReferences: number;
  erroredReferences: number;
  duplicateReferences: number;
  distinctMatchedWorks: number;
  rankedPeople: number;
  etAlReferences: number;
  hiddenAuthorsExpanded: number;
}

export interface AnalysisResult {
  resolutions: Resolution[];
  people: PersonCount[];
  summary: AnalysisSummary;
  warnings: string[];
  ranking: RankingMode;
}

export interface AnalysisProgress {
  current: number;
  total: number;
  reference: Reference;
}

export type ProgressCallback = (progress: AnalysisProgress) => void;

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface StorageLike {
  readonly length?: number;
  getItem(key: string): string | null;
  key?(index: number): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AnalyzeOptions {
  ranking: RankingMode;
  top: number;
  minConfidence: number;
  minMargin: number;
  candidateLimit: number;
  deduplicate: boolean;
  includeCollective: boolean;
  mailto?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  storage?: StorageLike | null;
}

export interface SerializationOptions {
  ranking?: RankingMode;
  top?: number;
  includeAudit?: boolean;
}
