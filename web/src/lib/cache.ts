import type { StorageLike } from "./types";

export const CROSSREF_CACHE_PREFIX = "commonly-cited:crossref:v1:";
export const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

interface StoredEntry {
  key: string;
  createdAt: number;
  value: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export class BrowserJsonCache {
  readonly storage: StorageLike | null;
  readonly ttlMs: number;
  readonly now: () => number;

  constructor(
    storage: StorageLike | null = browserStorage(),
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.storage = storage;
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  private storageKey(key: string): string {
    return `${CROSSREF_CACHE_PREFIX}${digest(key)}`;
  }

  get(key: string): Record<string, unknown> | null {
    if (!this.storage) return null;
    const storageKey = this.storageKey(key);
    try {
      const raw = this.storage.getItem(storageKey);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return null;
      const entry = parsed as Partial<StoredEntry>;
      if (
        entry.key !== key ||
        typeof entry.createdAt !== "number" ||
        !isRecord(entry.value)
      ) {
        return null;
      }
      if (this.now() - entry.createdAt > this.ttlMs) {
        this.storage.removeItem(storageKey);
        return null;
      }
      return entry.value;
    } catch {
      return null;
    }
  }

  set(key: string, value: Record<string, unknown>): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        this.storageKey(key),
        JSON.stringify({ key, createdAt: this.now(), value } satisfies StoredEntry),
      );
    } catch {
      // Storage is an optimization; private mode and quotas must not break analysis.
    }
  }
}

export function clearCrossrefCache(storage: StorageLike | null = browserStorage()): void {
  if (!storage || storage.length === undefined || !storage.key) return;
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(CROSSREF_CACHE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Clearing a cache should remain best-effort in restricted browser contexts.
  }
}

export const clearBrowserCache = clearCrossrefCache;
