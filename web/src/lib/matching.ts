import {
  normalizeDoi,
  normalizeSurname,
  normalizeText,
  stableWorkKey,
} from "./normalization";
import type {
  CandidateScore,
  MatchDecision,
  Reference,
  Work,
} from "./types";

function indelRatio(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  let previous = new Uint16Array(shorter.length + 1);
  for (const longChar of longer) {
    const current = new Uint16Array(shorter.length + 1);
    for (let index = 1; index <= shorter.length; index += 1) {
      const shortChar = shorter[index - 1];
      current[index] =
        shortChar === longChar
          ? (previous[index - 1] ?? 0) + 1
          : Math.max(previous[index] ?? 0, current[index - 1] ?? 0);
    }
    previous = current;
  }
  const lcs = previous[shorter.length] ?? 0;
  return (2 * lcs) / (left.length + right.length);
}

function tokenSetRatio(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).sort();
  if (intersection.length === 0) return indelRatio(left, right);

  const leftOnly = [...leftTokens].filter((token) => !rightTokens.has(token)).sort();
  const rightOnly = [...rightTokens].filter((token) => !leftTokens.has(token)).sort();
  if (leftOnly.length === 0 || rightOnly.length === 0) return 1;

  const common = intersection.join(" ");
  const combinedLeft = [...intersection, ...leftOnly].join(" ");
  const combinedRight = [...intersection, ...rightOnly].join(" ");
  return Math.max(
    indelRatio(common, combinedLeft),
    indelRatio(common, combinedRight),
    indelRatio(combinedLeft, combinedRight),
  );
}

function partialRatio(left: string, right: string): number {
  if (!left || !right) return 0;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (longer.includes(shorter)) return 1;

  let best = 0;
  const width = shorter.length;
  for (let start = 0; start <= longer.length - width; start += 1) {
    best = Math.max(best, indelRatio(shorter, longer.slice(start, start + width)));
    if (best >= 0.99) break;
  }
  return best;
}

function yearSimilarity(referenceYears: number[], candidateYear: number | null): number | null {
  if (referenceYears.length === 0 || candidateYear === null) return null;
  const distance = Math.min(...referenceYears.map((year) => Math.abs(candidateYear - year)));
  if (distance === 0) return 1;
  if (distance === 1) return 0.7;
  if (distance === 2) return 0.3;
  return 0;
}

function authorSimilarity(reference: Reference, work: Work): number | null {
  if (reference.visibleSurnames.length === 0) return null;
  const candidateSurnames = new Set(
    work.authors
      .filter((author) => author.displayName)
      .map((author) => {
        const fallback = author.displayName.split(/\s+/).at(-1) ?? "";
        return normalizeSurname(author.family ?? fallback);
      }),
  );
  if (candidateSurnames.size === 0) return 0;

  let matched = 0;
  for (const visible of reference.visibleSurnames) {
    if (
      candidateSurnames.has(visible) ||
      [...candidateSurnames].some((candidate) => indelRatio(visible, candidate) >= 0.9)
    ) {
      matched += 1;
    }
  }
  return matched / reference.visibleSurnames.length;
}

function venueSimilarity(reference: Reference, work: Work): number | null {
  if (!work.venue) return null;
  const venue = normalizeText(work.venue);
  const raw = normalizeText(reference.raw);
  return venue && raw ? partialRatio(venue, raw) : null;
}

export function scoreCandidate(reference: Reference, work: Work): CandidateScore {
  if (
    reference.doi &&
    work.doi &&
    normalizeDoi(reference.doi) === normalizeDoi(work.doi)
  ) {
    return {
      work,
      score: 1,
      titleScore: 1,
      authorScore: 1,
      yearScore: 1,
      venueScore: 1,
    };
  }

  const title = normalizeText(work.title);
  const raw = normalizeText(reference.raw);
  const titleScore = title && raw ? tokenSetRatio(title, raw) : 0;
  const authorScore = authorSimilarity(reference, work);
  const yearScore = yearSimilarity(reference.years, work.year);
  const venueScore = venueSimilarity(reference, work);
  const components: Array<[number, number]> = [[0.64, titleScore]];
  if (authorScore !== null) components.push([0.21, authorScore]);
  if (yearScore !== null) components.push([0.11, yearScore]);
  if (venueScore !== null) components.push([0.04, venueScore]);
  const totalWeight = components.reduce((sum, [weight]) => sum + weight, 0);
  let score = components.reduce((sum, [weight, value]) => sum + weight * value, 0) / totalWeight;
  if (titleScore < 0.45) score *= titleScore / 0.45;

  return {
    work,
    score: Math.max(0, Math.min(1, score)),
    titleScore,
    authorScore,
    yearScore,
    venueScore,
  };
}

export function chooseCandidate(
  reference: Reference,
  works: Work[],
  options: {
    minConfidence?: number;
    minMargin?: number;
    alternativesLimit?: number;
  } = {},
): MatchDecision {
  const minConfidence = options.minConfidence ?? 0.74;
  const minMargin = options.minMargin ?? 0.04;
  const alternativesLimit = options.alternativesLimit ?? 3;
  const bestByWork = new Map<string, CandidateScore>();
  for (const work of works) {
    const scored = scoreCandidate(reference, work);
    const key = stableWorkKey(work.id, work.doi);
    const previous = bestByWork.get(key);
    if (!previous || scored.score > previous.score) bestByWork.set(key, scored);
  }
  const scored = [...bestByWork.values()].sort(
    (left, right) => right.score - left.score || right.titleScore - left.titleScore,
  );
  const alternatives = scored.slice(0, alternativesLimit);
  const best = scored[0];
  if (!best) {
    return {
      candidate: null,
      alternatives: [],
      accepted: false,
      ambiguous: false,
      reason: "No metadata candidates were returned",
    };
  }
  if (best.score < minConfidence) {
    return {
      candidate: best,
      alternatives,
      accepted: false,
      ambiguous: false,
      reason: `Best candidate confidence ${best.score.toFixed(3)} is below ${minConfidence.toFixed(3)}`,
    };
  }
  const doiMatches = Boolean(
    reference.doi &&
      best.work.doi &&
      normalizeDoi(reference.doi) === normalizeDoi(best.work.doi),
  );
  if (best.titleScore < 0.55 && !doiMatches) {
    return {
      candidate: best,
      alternatives,
      accepted: false,
      ambiguous: false,
      reason: `Best candidate title similarity ${best.titleScore.toFixed(3)} is too low`,
    };
  }

  const second = scored[1];
  if (second) {
    const margin = best.score - second.score;
    if (margin < minMargin) {
      return {
        candidate: best,
        alternatives,
        accepted: false,
        ambiguous: true,
        reason: `Top candidates are separated by only ${margin.toFixed(3)}`,
      };
    }
  }
  return {
    candidate: best,
    alternatives,
    accepted: true,
    ambiguous: false,
    reason: "Candidate passed confidence gates",
  };
}
