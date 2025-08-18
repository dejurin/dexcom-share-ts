/**
 * Small utilities and retrying fetch.
 */

import { DexcomErrorCode, ArgumentError } from "./errors";

/** Validate a UUIDv4-like string (format check only). */
export function isValidUUID(uuid: unknown): boolean {
  if (typeof uuid !== "string") return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uuid);
}

/** Build query string from record (skips undefined/null). */
export function toQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    // Serialize objects/arrays as JSON, primitives as string
    qs.set(
      k,
      typeof v === "object" && v !== null
        ? JSON.stringify(v)
        : typeof v === "string" || typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : JSON.stringify(v),
    );
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** Guard for minutes and maxCount ranges. */
export function validateMinutesAndCount(
  minutes: number,
  maxCount: number,
  bounds = { minM: 1, maxM: 1440, minC: 1, maxC: 288 },
): void {
  if (!Number.isInteger(minutes) || minutes < bounds.minM || minutes > bounds.maxM) {
    throw new ArgumentError(DexcomErrorCode.MINUTES_INVALID);
  }
  if (!Number.isInteger(maxCount) || maxCount < bounds.minC || maxCount > bounds.maxC) {
    throw new ArgumentError(DexcomErrorCode.MAX_COUNT_INVALID);
  }
}

/** Options for exponential backoff retries. */
export interface RetryOptions {
  retries?: number; // max attempts (default 3)
  baseDelayMs?: number; // initial backoff (default 200ms)
  maxDelayMs?: number; // cap (default 4000ms)
  jitter?: boolean; // add jitter (default true)
  retryOnStatuses?: number[]; // HTTP statuses to retry (default [429, 500, 502, 503, 504])
}

/** Sleep helper. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with optional full jitter. */
function backoff(attempt: number, base: number, max: number, jitter: boolean): number {
  const delay = Math.min(max, base * 2 ** (attempt - 1));
  if (!jitter) return delay;
  return Math.floor(Math.random() * (delay + 1));
}

/**
 * fetch with retry for network errors and selected HTTP statuses.
 * Honors Retry-After (seconds) for 429/503 if present.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const {
    retries = 3,
    baseDelayMs = 200,
    maxDelayMs = 4000,
    jitter = true,
    retryOnStatuses = [429, 500, 502, 503, 504],
  } = opts;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      if (!retryOnStatuses.includes(res.status)) return res;

      // Respect Retry-After when present
      const ra = res.headers.get("retry-after");
      if (ra) {
        const raMs = Number.isFinite(Number(ra)) ? Number(ra) * 1000 : baseDelayMs;
        await sleep(Math.min(raMs, maxDelayMs));
      } else if (attempt < retries) {
        await sleep(backoff(attempt, baseDelayMs, maxDelayMs, jitter));
      }
      lastErr = new Error(`HTTP ${res.status}`);
      continue;
    } catch (e) {
      // network error
      lastErr = e;
      if (attempt < retries) {
        await sleep(backoff(attempt, baseDelayMs, maxDelayMs, jitter));
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
