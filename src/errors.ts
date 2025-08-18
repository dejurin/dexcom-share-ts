/**
 * Error types mirroring pydexcom errors.
 */

export enum DexcomErrorCode {
  ACCOUNT_FAILED_AUTHENTICATION = "Failed to authenticate",
  ACCOUNT_MAX_ATTEMPTS = "Maximum authentication attempts exceeded",

  SESSION_NOT_FOUND = "Session ID not found",
  SESSION_INVALID = "Session not active or timed out",

  MINUTES_INVALID = "Minutes must be and integer between 1 and 1440",
  MAX_COUNT_INVALID = "Max count must be and integer between 1 and 288",
  USERNAME_INVALID = "Username must be non-empty string",
  USER_ID_MULTIPLE = "Only one of account_id, username should be provided",
  USER_ID_REQUIRED = "At least one of account_id, username should be provided",
  PASSWORD_INVALID = "Password must be non-empty string",
  REGION_INVALID = "Region must be 'us', 'ous, or 'jp'",
  ACCOUNT_ID_INVALID = "Account ID must be UUID",
  ACCOUNT_ID_DEFAULT = "Account ID default",
  SESSION_ID_INVALID = "Session ID must be UUID",
  SESSION_ID_DEFAULT = "Session ID default",
  GLUCOSE_READING_INVALID = "JSON glucose reading incorrectly formatted",

  SERVER_INVALID_JSON = "Invalid or malformed JSON in server response",
  SERVER_UNKNOWN_CODE = "Unknown error code in server response",
  SERVER_UNEXPECTED = "Unexpected server response",
}

export class DexcomError extends Error {
  constructor(public readonly code: DexcomErrorCode) {
    super(code);
    this.name = "DexcomError";
  }
}
export class AccountError extends DexcomError {
  constructor(code: DexcomErrorCode) {
    super(code);
    this.name = "AccountError";
  }
}
export class SessionError extends DexcomError {
  constructor(code: DexcomErrorCode) {
    super(code);
    this.name = "SessionError";
  }
}
export class ArgumentError extends DexcomError {
  constructor(code: DexcomErrorCode) {
    super(code);
    this.name = "ArgumentError";
  }
}
export class ServerError extends DexcomError {
  constructor(code: DexcomErrorCode) {
    super(code);
    this.name = "ServerError";
  }
}
