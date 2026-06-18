/**
 * Tiny in-memory TTL cache (Phase 5 · R).
 *
 * Process-local and dependency-free — enough to cut redundant calls to a slow,
 * rate-limited upstream (e.g. Adzuna) within a single API instance. Not a
 * distributed cache; on a multi-instance deployment each instance keeps its own.
 *
 * Degrades safely: a non-positive `ttlMs` disables caching (every lookup misses),
 * and a failed `getOrCompute` is never cached so the next call retries.
 */
export interface TtlCacheOptions {
  /** Entry lifetime in ms. `<= 0` disables caching entirely. */
  ttlMs: number;
  /** FIFO eviction cap. Default 500. */
  maxEntries?: number;
  /** Injectable clock (defaults to `Date.now`) so TTL is testable. */
  now?: () => number;
}

interface Entry<T> {
  value: T;
  expires: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 500;
    this.now = options.now ?? Date.now;
  }

  private get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get(key: string): T | undefined {
    if (!this.enabled) return undefined;
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expires) {
      this.store.delete(key); // lazily evict on read
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (!this.enabled) return;
    // Refresh insertion order so eviction is FIFO by last write.
    this.store.delete(key);
    this.store.set(key, { value, expires: this.now() + this.ttlMs });
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  /** Return the cached value or compute, cache (on success only), and return it. */
  async getOrCompute(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
