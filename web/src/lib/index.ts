export { aggregateResolutions, rankPeople } from "./aggregation";
export {
  analyzeBibliography,
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
  parseReferences,
  splitReferences,
} from "./parsing";
export { resultAsObject, resultToCsv, resultToJson } from "./serialization";
export type * from "./types";
