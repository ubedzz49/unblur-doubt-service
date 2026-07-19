import { Redis } from "ioredis";

export interface FeedCache<T = unknown> {
  get(key: string): Promise<T[] | null>;
  set(key: string, items: T[], ttlSeconds: number): Promise<void>;
}

// Redis-backed feed cache. Deliberately no invalidation-on-write: a new doubt can take up to
// the cache's TTL to show up in a cached feed response. Doubts are created far less often than
// feeds are read, so a small amount of staleness is a good trade for cutting read load on
// Postgres -- see README for the same tradeoff spelled out for API consumers.
export class RedisFeedCache<T = unknown> implements FeedCache<T> {
  constructor(private client: Redis) {}

  async get(key: string): Promise<T[] | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T[];
  }

  async set(key: string, items: T[], ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(items), "EX", ttlSeconds);
  }
}

interface CacheEntry<T> {
  items: T[];
  expiresAtMs: number;
}

// test-only -- Map-based fake with an injectable clock so tests can simulate TTL expiry
// without real sleeping.
export class InMemoryFeedCache<T = unknown> implements FeedCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private now: () => number = () => Date.now()) {}

  async get(key: string): Promise<T[] | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.now() >= entry.expiresAtMs) {
      this.store.delete(key);
      return null;
    }
    return entry.items;
  }

  async set(key: string, items: T[], ttlSeconds: number): Promise<void> {
    this.store.set(key, { items, expiresAtMs: this.now() + ttlSeconds * 1000 });
  }
}
