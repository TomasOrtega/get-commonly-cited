export { aggregateResolutions, rankPeople } from "./aggregation";
export {
  analyzeBibliography,
  analyzeReferences,
  DEFAULT_ANALYZE_OPTIONS,
  MetadataError,
} from "./analysis";
export {
  browserStorage,
  BrowserJsonCache,
  clearBrowserCache,
  clearCrossrefCache,
  CROSSREF_CACHE_PREFIX,
  DEFAULT_CACHE_TTL_MS,
} from "./cache";
export {
  CrossrefClient,
  InvalidMetadataResponse,
  parseCrossrefWork,
} from "./crossref";
export { chooseCandidate, scoreCandidate } from "./matching";
export {
  isCollectiveName,
  normalizeDoi,
  normalizeName,
  normalizeOrcid,
  normalizeSurname,
  normalizeText,
  shortOpenAlexId,
  stableWorkKey,
} from "./normalization";
export {
  extractDoi,
  extractVisibleSurnames,
  extractYears,
  joinReferenceLines,
  parseReference,
  parseReferences,
  splitReferences,
} from "./parsing";
export {
  extractDoiFromPaperLink,
  isPaperBibliographyOverLimit,
  loadPaperBibliography,
  PaperLinkError,
  parseCrossrefReference,
} from "./paper";
export type { PaperBibliography, PaperLinkErrorCode } from "./paper";
export { resultAsObject, resultToCsv, resultToJson } from "./serialization";
export type * from "./types";
