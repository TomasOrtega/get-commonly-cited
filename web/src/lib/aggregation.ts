import {
  normalizeName,
  normalizeOrcid,
  shortOpenAlexId,
  stableWorkKey,
} from "./normalization";
import type {
  AnalysisResult,
  Author,
  PersonCount,
  RankingMode,
  Resolution,
} from "./types";

function compareText(left: string, right: string): number {
  const normalizedLeft = left.toLocaleLowerCase("und");
  const normalizedRight = right.toLocaleLowerCase("und");
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function bestDisplayName(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best = "Unknown author";
  let bestCount = -1;
  for (const [name, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount && name.length > best.length) ||
      (count === bestCount && name.length === best.length && compareText(name, best) > 0)
    ) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

function strongIdentityKeys(author: Author): string[] {
  const keys: string[] = [];
  const orcid = normalizeOrcid(author.orcid);
  if (orcid) keys.push(`orcid:${orcid}`);
  const openalexId = shortOpenAlexId(author.openalexId);
  if (openalexId) keys.push(`openalex:${openalexId}`);
  if (author.providerId?.trim()) keys.push(`provider:${author.providerId.trim()}`);
  return keys;
}

function identityPriority(key: string): number {
  if (key.startsWith("orcid:")) return 0;
  if (key.startsWith("openalex:")) return 1;
  return 2;
}

class UnionFind {
  readonly parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    const parent = this.parent.get(key);
    if (parent === undefined) throw new Error(`Unknown identity key: ${key}`);
    if (parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot);
  }
}

interface IdentityIndex {
  keyFor(author: Author): string;
}

function buildIdentityIndex(authors: Author[]): IdentityIndex {
  const unionFind = new UnionFind();
  for (const author of authors) {
    const identifiers = strongIdentityKeys(author);
    identifiers.forEach((identifier) => unionFind.add(identifier));
    const first = identifiers[0];
    if (first) identifiers.slice(1).forEach((identifier) => unionFind.union(first, identifier));
  }

  const identifiersByRoot = new Map<string, string[]>();
  for (const identifier of unionFind.parent.keys()) {
    const root = unionFind.find(identifier);
    const identifiers = identifiersByRoot.get(root) ?? [];
    identifiers.push(identifier);
    identifiersByRoot.set(root, identifiers);
  }
  const canonicalByRoot = new Map<string, string>();
  for (const [root, identifiers] of identifiersByRoot) {
    identifiers.sort((left, right) =>
      identityPriority(left) - identityPriority(right) || compareText(left, right),
    );
    const first = identifiers[0];
    if (first) canonicalByRoot.set(root, first);
  }
  const canonicalByIdentifier = new Map<string, string>();
  for (const identifier of unionFind.parent.keys()) {
    const canonical = canonicalByRoot.get(unionFind.find(identifier));
    if (canonical) canonicalByIdentifier.set(identifier, canonical);
  }

  const canonicalByName = new Map<string, Set<string>>();
  for (const author of authors) {
    const first = strongIdentityKeys(author)[0];
    if (!first) continue;
    const canonical = canonicalByIdentifier.get(first);
    if (!canonical) continue;
    const name = normalizeName(author.displayName);
    const keys = canonicalByName.get(name) ?? new Set<string>();
    keys.add(canonical);
    canonicalByName.set(name, keys);
  }
  const uniqueName = new Map<string, string>();
  for (const [name, keys] of canonicalByName) {
    if (keys.size === 1) {
      const key = keys.values().next().value as string | undefined;
      if (key) uniqueName.set(name, key);
    }
  }

  return {
    keyFor(author: Author): string {
      const first = strongIdentityKeys(author)[0];
      if (first) return canonicalByIdentifier.get(first) ?? first;
      const name = normalizeName(author.displayName);
      return uniqueName.get(name) ?? `name:${name}`;
    },
  };
}

export function rankPeople(
  people: PersonCount[],
  ranking: RankingMode,
  top = 0,
): PersonCount[] {
  const ordered = [...people].sort((left, right) => {
    if (ranking === "fractional") {
      return (
        right.fractionalCount - left.fractionalCount ||
        right.fullCount - left.fullCount ||
        compareText(left.displayName, right.displayName)
      );
    }
    return (
      right.fullCount - left.fullCount ||
      right.fractionalCount - left.fractionalCount ||
      compareText(left.displayName, right.displayName)
    );
  });
  return top <= 0 ? ordered : ordered.slice(0, Math.floor(top));
}

export function aggregateResolutions(
  resolutions: Resolution[],
  options: {
    deduplicate?: boolean;
    includeCollective?: boolean;
    ranking?: RankingMode;
    top?: number;
  } = {},
): AnalysisResult {
  const deduplicate = options.deduplicate ?? true;
  const includeCollective = options.includeCollective ?? false;
  const ranking = options.ranking ?? "full";
  const seenWorkAt = new Map<string, number>();
  const included: Resolution[] = [];
  let duplicateCount = 0;
  const warnings: string[] = [];

  for (const resolution of resolutions) {
    resolution.duplicateOf = null;
    if (resolution.status !== "matched" || !resolution.work) continue;
    const key = stableWorkKey(resolution.work.id, resolution.work.doi);
    const firstSeen = seenWorkAt.get(key);
    if (deduplicate && firstSeen !== undefined) {
      resolution.duplicateOf = firstSeen;
      duplicateCount += 1;
      continue;
    }
    seenWorkAt.set(key, resolution.reference.index);
    included.push(resolution);
  }

  const allAuthors = included.flatMap((resolution) =>
    (resolution.work?.authors ?? []).filter(
      (author) => includeCollective || !author.isCollective,
    ),
  );
  const identityIndex = buildIdentityIndex(allAuthors);
  const people = new Map<string, PersonCount>();
  const namesByKey = new Map<string, string[]>();
  for (const resolution of included) {
    const work = resolution.work;
    if (!work) continue;
    const workKey = stableWorkKey(work.id, work.doi);
    const authors = work.authors.filter(
      (author) => includeCollective || !author.isCollective,
    );
    if (authors.length === 0) {
      warnings.push(
        `Reference ${resolution.reference.index} matched '${work.title}' but had no countable authors`,
      );
      continue;
    }
    const uniqueAuthors = new Map<string, Author>();
    for (const author of authors) {
      const key = identityIndex.keyFor(author);
      if (!uniqueAuthors.has(key)) uniqueAuthors.set(key, author);
    }
    const denominator = uniqueAuthors.size;
    for (const [key, author] of uniqueAuthors) {
      let person = people.get(key);
      if (!person) {
        person = {
          key,
          displayName: author.displayName,
          aliases: new Set<string>(),
          workIds: new Set<string>(),
          fullCount: 0,
          fractionalCount: 0,
          orcid: author.orcid,
          openalexId: author.openalexId,
        };
        people.set(key, person);
      }
      person.aliases.add(author.displayName);
      person.workIds.add(workKey);
      person.fullCount += 1;
      person.fractionalCount += 1 / denominator;
      person.orcid ??= author.orcid;
      person.openalexId ??= author.openalexId;
      const names = namesByKey.get(key) ?? [];
      names.push(author.displayName);
      namesByKey.set(key, names);
    }
  }
  for (const [key, person] of people) {
    person.displayName = bestDisplayName(namesByKey.get(key) ?? []);
  }

  const allPeople = rankPeople([...people.values()], ranking);
  const summary = {
    inputReferences: resolutions.length,
    matchedReferences: resolutions.filter((item) => item.status === "matched").length,
    ambiguousReferences: resolutions.filter((item) => item.status === "ambiguous").length,
    unmatchedReferences: resolutions.filter((item) => item.status === "unmatched").length,
    erroredReferences: resolutions.filter((item) => item.status === "error").length,
    duplicateReferences: duplicateCount,
    distinctMatchedWorks: included.length,
    rankedPeople: allPeople.length,
    etAlReferences: resolutions.filter((item) => item.reference.hasEtAl).length,
    hiddenAuthorsExpanded: resolutions.reduce(
      (total, item) => total + item.hiddenAuthorsExpanded,
      0,
    ),
  };
  return {
    resolutions,
    people: options.top === undefined ? allPeople : rankPeople(allPeople, ranking, options.top),
    summary,
    warnings,
    ranking,
  };
}
