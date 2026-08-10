import {
  normalizeDoi,
  normalizeSurname,
  uniquePreservingOrder,
} from "./normalization";
import type { Reference } from "./types";

const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
const YEAR_RE = /(?<!\d)(?:18|19|20|21)\d{2}[a-z]?(?!\d)/gi;
const ET_AL_RE = /\bet\s+al\.?\b/i;
const NUMBERED_START_RE =
  /^\s*(?:\[(\d{1,3})\]|\((\d{1,3})\)|(\d{1,3})[.)])\s*(.+?)\s*$/;
const INLINE_NUMBER_RE =
  /(?<!\w)(?:\[(\d{1,3})\]|\((\d{1,3})\)|(\d{1,3})[.)])\s+/g;
const DASH_CHARACTERS = "-‐‑‒–—―";
const BIBTEX_START_RE =
  /^\s*@(?:article|book|inproceedings|misc|phdthesis|mastersthesis|techreport|incollection|proceedings)\s*\{/i;
const RIS_START_RE = /^TY\s{0,2}-\s*/i;
const RIS_END_RE = /^ER\s{0,2}-\s*/i;
const HEADING_RE = /^\s*(?:references|bibliography|works\s+cited)\s*:?\s*$/i;
const BULLET_RE = /^\s*(?:[-*•‣▪◦])\s+/;

const SURNAME_COMMA_RE =
  /(?<![\p{Letter}\p{Number}_'-])(\p{Lu}[\p{L}'’-]{1,})\s*,\s*(?:\p{Lu}(?:\.|\p{Ll}+))/gu;
const INITIALS_SURNAME_RE =
  /(?:\b\p{Lu}\.?\s*){1,4}(\p{Lu}[\p{L}'’-]{1,})\b/gu;
const SURNAME_INITIALS_RE =
  /\b(\p{Lu}[\p{L}'’-]{1,})\s+(?:\p{Lu}\.?\s*){1,4}(?=,|;|\s+(?:and|&)\b|$)/gu;
const ET_AL_SURNAME_RE =
  /\b(\p{Lu}[\p{L}'’-]{1,})\s+(?:,\s*)?et\s+al\.?/giu;

function cleanText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\u00ad/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(?<=[A-Za-z])-[ \t]*\n[ \t]*(?=[a-z])/g, "");
}

function cleanReference(value: string): string {
  return value.trim().replace(BULLET_RE, "").replace(/\s+/g, " ").trim();
}

export function extractDoi(value: string): string | null {
  const match = DOI_RE.exec(value);
  return match ? normalizeDoi(match[0]) : null;
}

export function extractYears(value: string): number[] {
  const years: number[] = [];
  for (const match of value.matchAll(YEAR_RE)) {
    const year = Number(match[0].slice(0, 4));
    if (!years.includes(year)) years.push(year);
  }
  return years;
}

function captures(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)]
    .map((match) => match[1])
    .filter((item): item is string => item !== undefined);
}

export function extractVisibleSurnames(value: string): string[] {
  const yearMatch = new RegExp(YEAR_RE.source, "i").exec(value);
  let prefix = yearMatch ? value.slice(0, yearMatch.index) : value.slice(0, 300);
  const numbered = NUMBERED_START_RE.exec(prefix);
  if (numbered?.[4]) prefix = numbered[4];
  if (prefix.length > 180) prefix = prefix.split(".", 1)[0] ?? prefix;

  const candidates = [
    ...captures(prefix, SURNAME_COMMA_RE),
    ...captures(prefix, INITIALS_SURNAME_RE),
    ...captures(prefix, SURNAME_INITIALS_RE),
    ...captures(prefix, ET_AL_SURNAME_RE),
  ];
  return uniquePreservingOrder(candidates.map(normalizeSurname));
}

function splitBibtex(text: string): string[] {
  const entries: string[] = [];
  let current: string[] = [];
  let depth = 0;
  let inEntry = false;
  for (const line of text.split("\n")) {
    if (!inEntry && BIBTEX_START_RE.test(line)) {
      inEntry = true;
      current = [];
      depth = 0;
    }
    if (!inEntry) continue;
    current.push(line);
    depth += (line.match(/\{/g) ?? []).length - (line.match(/}/g) ?? []).length;
    if (depth <= 0 && current.length > 0) {
      entries.push(cleanReference(current.join("\n")));
      current = [];
      inEntry = false;
    }
  }
  if (current.length > 0) entries.push(cleanReference(current.join("\n")));
  return entries;
}

function splitRis(text: string): string[] {
  const entries: string[] = [];
  let current: string[] = [];
  for (const line of text.split("\n")) {
    if (RIS_START_RE.test(line)) {
      if (current.length > 0) entries.push(cleanReference(current.join("\n")));
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
      if (RIS_END_RE.test(line)) {
        entries.push(cleanReference(current.join("\n")));
        current = [];
      }
    }
  }
  if (current.length > 0) entries.push(cleanReference(current.join("\n")));
  return entries;
}

function splitInlineNumbered(text: string): string[] {
  const matches = [...text.matchAll(INLINE_NUMBER_RE)].filter((match) => {
    if (match[3] === undefined || match.index === undefined) return true;
    const preceding = text.slice(0, match.index).trimEnd().at(-1);
    return preceding === undefined || !DASH_CHARACTERS.includes(preceding);
  });
  if (matches.length < 2) return [];
  const first = matches[0];
  if (!first || first.index === undefined) return [];
  const prefix = text.slice(0, first.index).trim();
  if (prefix && !HEADING_RE.test(prefix)) return [];

  const styleIndex = [1, 2, 3].find((index) => first[index] !== undefined);
  if (styleIndex === undefined) return [];
  let expectedNumber = Number(first[styleIndex]) + 1;
  const sequence = [first];
  for (const match of matches.slice(1)) {
    if (match[styleIndex] !== undefined && Number(match[styleIndex]) === expectedNumber) {
      sequence.push(match);
      expectedNumber += 1;
    }
  }
  if (sequence.length < 2) return [];

  const entries: string[] = [];
  for (let index = 0; index < sequence.length; index += 1) {
    const match = sequence[index];
    if (!match || match.index === undefined) continue;
    const next = sequence[index + 1];
    const entry = cleanReference(
      text.slice(match.index + match[0].length, next?.index ?? text.length),
    );
    if (entry) entries.push(entry);
  }
  return entries;
}

function splitNumberedLines(lines: string[]): string[] {
  const entries: string[] = [];
  let current: string[] = [];
  let foundMarker = false;
  for (const line of lines) {
    const match = NUMBERED_START_RE.exec(line);
    if (match) {
      foundMarker = true;
      if (current.length > 0) entries.push(cleanReference(current.join(" ")));
      current = match[4] ? [match[4]] : [];
    } else if (current.length > 0 && line.trim()) {
      current.push(line.trim());
    }
  }
  if (current.length > 0) entries.push(cleanReference(current.join(" ")));
  return foundMarker ? entries : [];
}

function looksLikeReference(value: string): boolean {
  const cleaned = cleanReference(value);
  return cleaned.length >= 25 && (extractDoi(cleaned) !== null || extractYears(cleaned).length > 0);
}

function looksLikeReferenceStart(value: string): boolean {
  const cleaned = cleanReference(value);
  if (cleaned.length < 12) return false;
  const match = new RegExp(YEAR_RE.source, "i").exec(cleaned.slice(0, 180));
  if (!match) return false;
  const prefix = cleaned.slice(0, match.index);
  return (
    prefix.includes(",") ||
    ET_AL_RE.test(prefix) ||
    new RegExp(INITIALS_SURNAME_RE.source, "u").test(prefix)
  );
}

function splitBlankBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim()) {
      current.push(line.trim());
    } else if (current.length > 0) {
      blocks.push(cleanReference(current.join(" ")));
      current = [];
    }
  }
  if (current.length > 0) blocks.push(cleanReference(current.join(" ")));
  const plausible = blocks.filter(looksLikeReference).length;
  return blocks.length >= 2 && plausible >= blocks.length / 2 ? blocks : [];
}

function splitSemicolonCandidates(text: string): string[] {
  const parts = text
    .split(/\s*;\s*(?=[A-Z]|\[)/)
    .map(cleanReference)
    .filter(Boolean);
  return parts.length >= 2 && parts.every(looksLikeReference) ? parts : [];
}

export function splitReferences(input: string): string[] {
  const text = cleanText(input);
  const lines = text.split("\n").filter((line) => !HEADING_RE.test(line));
  const textWithoutHeading = lines.join("\n").trim();
  if (!textWithoutHeading) return [];

  if (textWithoutHeading.split("\n").some((line) => BIBTEX_START_RE.test(line))) {
    const entries = splitBibtex(textWithoutHeading);
    if (entries.length > 0) return entries;
  }
  if (lines.some((line) => RIS_START_RE.test(line))) {
    const entries = splitRis(textWithoutHeading);
    if (entries.length > 0) return entries;
  }

  let entries = splitInlineNumbered(textWithoutHeading);
  if (entries.length > 0) return entries;
  entries = splitNumberedLines(lines);
  if (entries.length > 0) return entries;
  entries = splitBlankBlocks(lines);
  if (entries.length > 0) return entries;

  const nonempty = lines.map(cleanReference).filter(Boolean);
  const plausibleLines = nonempty.filter(looksLikeReference).length;
  if (nonempty.length >= 2 && plausibleLines >= 0.7 * nonempty.length) return nonempty;

  entries = [];
  let current: string[] = [];
  for (const line of nonempty) {
    if (
      current.length > 0 &&
      looksLikeReferenceStart(line) &&
      looksLikeReference(current.join(" "))
    ) {
      entries.push(cleanReference(current.join(" ")));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) entries.push(cleanReference(current.join(" ")));
  if (entries.length >= 2) return entries;

  const semicolonEntries = splitSemicolonCandidates(textWithoutHeading);
  return semicolonEntries.length > 0
    ? semicolonEntries
    : [cleanReference(textWithoutHeading)];
}

export function parseReference(value: string, index = 1): Reference {
  const raw = cleanReference(value);
  return {
    index,
    raw,
    doi: extractDoi(raw),
    years: extractYears(raw),
    visibleSurnames: extractVisibleSurnames(raw),
    hasEtAl: ET_AL_RE.test(raw),
  };
}

export function parseReferences(text: string): Reference[] {
  return splitReferences(text).map((raw, offset) => parseReference(raw, offset + 1));
}

export function joinReferenceLines(lines: Iterable<string>): string {
  return cleanReference([...lines].filter((line) => line.trim()).join(" "));
}
