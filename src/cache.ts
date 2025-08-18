/**
 * Pluggable session cache with TTL.
 */

export interface SessionCache {
  /** Get current session id if not expired, else null. */
  get(): Promise<string | null>;
  /** Save session id with TTL in ms. */
  set(id: string, ttlMs: number): Promise<void>;
  /** Clear stored session. */
  clear(): Promise<void>;
}

/** Simple in-memory cache implementation. */
export class MemorySessionCache implements SessionCache {
  private id: string | null = null;
  private expiresAt = 0;

  get(): Promise<string | null> {
    if (this.id && Date.now() < this.expiresAt) return Promise.resolve(this.id);
    return Promise.resolve(null);
  }

  set(id: string, ttlMs: number): Promise<void> {
    this.id = id;
    this.expiresAt = Date.now() + Math.max(0, ttlMs);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.id = null;
    this.expiresAt = 0;
    return Promise.resolve();
  }
}
