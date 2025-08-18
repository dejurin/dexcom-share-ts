/**
 * Dexcom Share API client (TypeScript).
 * - Dual ESM/CJS build via tsup
 * - Zod validation for responses
 * - Exponential backoff retries
 * - Session caching with TTL (pluggable)
 */

import {
  DEFAULT_HEADERS,
  DEFAULT_UUID,
  DEXCOM_APPLICATION_IDS,
  DEXCOM_AUTHENTICATE_ENDPOINT,
  DEXCOM_BASE_URLS,
  DEXCOM_GLUCOSE_READINGS_ENDPOINT,
  DEXCOM_LOGIN_ID_ENDPOINT,
  MAX_MAX_COUNT,
  MAX_MINUTES,
  Region,
} from "./constants";
import {
  AccountError,
  ArgumentError,
  type DexcomError,
  DexcomErrorCode,
  ServerError,
  SessionError,
} from "./errors";
import { isValidUUID, toQuery, validateMinutesAndCount, fetchWithRetry } from "./util";
import type { RetryOptions } from "./util";
import { GlucoseReading } from "./glucoseReading";
import type { RawGlucoseReading } from "./types";
import { MemorySessionCache } from "./cache";
import type { SessionCache } from "./cache";
import { zAuthString, zRawGlucoseArray } from "./schemas";

type JSONObject = Record<string, unknown>;

export interface DexcomOptions {
  /** Region selector: 'us' (default) | 'ous' | 'jp' */
  region?: Region;
  /** Retry policy for network/5xx/429 errors. */
  retry?: RetryOptions;
  /** Session TTL in ms for caching (default 8 minutes). */
  sessionTtlMs?: number;
  /** Pluggable session cache (default in-memory). */
  cache?: SessionCache;
}

/**
 * Dexcom Share API client.
 *
 * Usage:
 * ```ts
 * const dex = new Dexcom({ username, password, region: Region.OUS });
 * const bg  = await dex.getCurrentGlucoseReading();
 * ```
 */
export class Dexcom {
  private baseUrl: string;
  private applicationId: string;

  private username?: string;
  private accountId?: string;
  private password: string;

  private cache: SessionCache;
  private sessionTtlMs: number;
  private retry: RetryOptions;

  constructor(params: { password: string; username?: string; accountId?: string } & DexcomOptions) {
    const {
      password,
      username,
      accountId,
      region = Region.US,
      retry = {},
      sessionTtlMs = 8 * 60 * 1000,
      cache = new MemorySessionCache(),
    } = params;

    this.validateRegion(region);
    this.validateUserIds(accountId, username);

    this.baseUrl = DEXCOM_BASE_URLS[region];
    this.applicationId = DEXCOM_APPLICATION_IDS[region];

    this.password = password;
    this.username = username;
    this.accountId = accountId;

    this.retry = retry;
    this.sessionTtlMs = sessionTtlMs;
    this.cache = cache;
  }

  get getUsername(): string | undefined {
    return this.username;
  }
  get getAccountId(): string | undefined {
    return this.accountId;
  }

  // ------------------------- Low-level HTTP -------------------------

  private async post(
    endpoint: string,
    options: { params?: JSONObject; json?: JSONObject } = {},
  ): Promise<unknown> {
    const url = this.baseUrl + endpoint + toQuery(options.params ?? {});
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: DEFAULT_HEADERS,
        body: JSON.stringify(options.json ?? {}),
      },
      this.retry,
    );

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new ServerError(DexcomErrorCode.SERVER_INVALID_JSON);
    }

    if (!res.ok) {
      throw this.handleErrorCode(data);
    }
    return data;
  }

  private handleErrorCode(json: unknown): DexcomError {
    let code: string | undefined;
    let message: string | undefined;

    if (typeof json === "object" && json !== null) {
      code = (json as { Code?: string }).Code;
      message = (json as { Message?: string }).Message;
    }

    if (code === "SessionIdNotFound") return new SessionError(DexcomErrorCode.SESSION_NOT_FOUND);
    if (code === "SessionNotValid") return new SessionError(DexcomErrorCode.SESSION_INVALID);
    if (code === "AccountPasswordInvalid")
      return new AccountError(DexcomErrorCode.ACCOUNT_FAILED_AUTHENTICATION);
    if (code === "SSO_AuthenticateMaxAttemptsExceeded")
      return new AccountError(DexcomErrorCode.ACCOUNT_MAX_ATTEMPTS);
    if (code === "SSO_InternalError") {
      if (
        message &&
        (message.includes("Cannot Authenticate by AccountName") ||
          message.includes("Cannot Authenticate by AccountId"))
      ) {
        return new AccountError(DexcomErrorCode.ACCOUNT_FAILED_AUTHENTICATION);
      }
    }
    if (code === "InvalidArgument") {
      if (message?.includes("accountName"))
        return new ArgumentError(DexcomErrorCode.USERNAME_INVALID);
      if (message?.includes("password")) return new ArgumentError(DexcomErrorCode.PASSWORD_INVALID);
      if (message?.includes("UUID")) return new ArgumentError(DexcomErrorCode.ACCOUNT_ID_INVALID);
    }
    if (code && message) return new ServerError(DexcomErrorCode.SERVER_UNKNOWN_CODE);
    return new ServerError(DexcomErrorCode.SERVER_UNEXPECTED);
  }

  // ------------------------- Validation helpers -------------------------

  private validateRegion(region: Region): void {
    if (!Object.values(Region).includes(region)) {
      throw new ArgumentError(DexcomErrorCode.REGION_INVALID);
    }
  }

  private validateUserIds(accountId?: string, username?: string): void {
    const count = Number(Boolean(accountId)) + Number(Boolean(username));
    if (count === 0) throw new ArgumentError(DexcomErrorCode.USER_ID_REQUIRED);
    if (count !== 1) throw new ArgumentError(DexcomErrorCode.USER_ID_MULTIPLE);
  }

  // ------------------------- Session handling (with TTL cache) -------------------------

  private async obtainAccountId(): Promise<string> {
    const json = {
      accountName: this.username,
      password: this.password,
      applicationId: this.applicationId,
    };
    const id = (await this.post(DEXCOM_AUTHENTICATE_ENDPOINT, { json }));
    const parsed = zAuthString.parse(id);
    return parsed;
  }

  private async obtainSessionId(): Promise<string> {
    const json = {
      accountId: this.accountId,
      password: this.password,
      applicationId: this.applicationId,
    };
    const id = (await this.post(DEXCOM_LOGIN_ID_ENDPOINT, { json }));
    const parsed = zAuthString.parse(id);
    return parsed;
  }

  private async ensureSession(): Promise<string> {
    // Get from cache first
    const cached = await this.cache.get();
    if (cached && isValidUUID(cached) && cached !== DEFAULT_UUID) {
      return cached;
    }

    // Build a fresh session
    if (!this.accountId) {
      if (typeof this.username !== "string" || !this.username) {
        throw new ArgumentError(DexcomErrorCode.USERNAME_INVALID);
      }
      if (typeof this.password !== "string" || !this.password) {
        throw new ArgumentError(DexcomErrorCode.PASSWORD_INVALID);
      }
      this.accountId = await this.obtainAccountId();
    }

    if (!isValidUUID(this.accountId)) throw new ArgumentError(DexcomErrorCode.ACCOUNT_ID_INVALID);
    if (this.accountId === DEFAULT_UUID)
      throw new ArgumentError(DexcomErrorCode.ACCOUNT_ID_DEFAULT);

    const sessionId = await this.obtainSessionId();
    if (!isValidUUID(sessionId)) throw new ArgumentError(DexcomErrorCode.SESSION_ID_INVALID);
    if (sessionId === DEFAULT_UUID) throw new ArgumentError(DexcomErrorCode.SESSION_ID_DEFAULT);

    // Cache with TTL
    await this.cache.set(sessionId, this.sessionTtlMs);
    return sessionId;
  }

  // ------------------------- Glucose readings -------------------------

  private async fetchRawReadings(
    minutes = MAX_MINUTES,
    maxCount = MAX_MAX_COUNT,
  ): Promise<RawGlucoseReading[]> {
    const sessionId = await this.ensureSession();
    const params = { sessionId, minutes, maxCount };
    const data: unknown = await this.post(DEXCOM_GLUCOSE_READINGS_ENDPOINT, { params });
    const parsed = zRawGlucoseArray.parse(data);
    return parsed;
  }

  /**
   * Returns up to `maxCount` glucose readings within `minutes`.
   * Handles one automatic session refresh if the session expired.
   */
  async getGlucoseReadings(
    minutes = MAX_MINUTES,
    maxCount = MAX_MAX_COUNT,
  ): Promise<GlucoseReading[]> {
    validateMinutesAndCount(minutes, maxCount, {
      minM: 1,
      maxM: MAX_MINUTES,
      minC: 1,
      maxC: MAX_MAX_COUNT,
    });

    try {
      const json = await this.fetchRawReadings(minutes, maxCount);
      return json.map((r) => new GlucoseReading(r));
    } catch (err) {
      if (err instanceof SessionError) {
        // clear cache and retry once
        await this.cache.clear();
        const json = await this.fetchRawReadings(minutes, maxCount);
        return json.map((r) => new GlucoseReading(r));
      }
      throw err;
    }
  }

  /** Latest available glucose reading (last 24h). */
  async getLatestGlucoseReading(): Promise<GlucoseReading | undefined> {
    const arr = await this.getGlucoseReadings(MAX_MINUTES, 1);
    return arr[0];
  }

  /** Current reading (last ~10 minutes). */
  async getCurrentGlucoseReading(): Promise<GlucoseReading | undefined> {
    const arr = await this.getGlucoseReadings(10, 1);
    return arr[0];
  }
}
