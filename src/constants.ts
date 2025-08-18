/**
 * Constants used in Dexcom Share TS client.
 */

export enum Region {
  US = "us",
  OUS = "ous",
  JP = "jp",
}

export const DEXCOM_APPLICATION_ID_US = "d89443d2-327c-4a6f-89e5-496bbb0317db";
export const DEXCOM_APPLICATION_ID_OUS = DEXCOM_APPLICATION_ID_US;
export const DEXCOM_APPLICATION_ID_JP = "d8665ade-9673-4e27-9ff6-92db4ce13d13";

export const DEXCOM_APPLICATION_IDS: Record<Region, string> = {
  [Region.US]: DEXCOM_APPLICATION_ID_US,
  [Region.OUS]: DEXCOM_APPLICATION_ID_OUS,
  [Region.JP]: DEXCOM_APPLICATION_ID_JP,
};

export const DEXCOM_BASE_URL_US = "https://share2.dexcom.com/ShareWebServices/Services/";
export const DEXCOM_BASE_URL_OUS = "https://shareous1.dexcom.com/ShareWebServices/Services/";
export const DEXCOM_BASE_URL_JP = "https://share.dexcom.jp/ShareWebServices/Services/";

export const DEXCOM_BASE_URLS: Record<Region, string> = {
  [Region.US]: DEXCOM_BASE_URL_US,
  [Region.OUS]: DEXCOM_BASE_URL_OUS,
  [Region.JP]: DEXCOM_BASE_URL_JP,
};

export const DEXCOM_LOGIN_ID_ENDPOINT = "General/LoginPublisherAccountById";
export const DEXCOM_AUTHENTICATE_ENDPOINT = "General/AuthenticatePublisherAccount";
export const DEXCOM_GLUCOSE_READINGS_ENDPOINT = "Publisher/ReadPublisherLatestGlucoseValues";

export const DEFAULT_HEADERS = {
  "Accept-Encoding": "application/json",
  "Content-Type": "application/json",
} as const;

export const DEFAULT_UUID = "00000000-0000-0000-0000-000000000000";

export const DEXCOM_TREND_DIRECTIONS: Record<string, number> = {
  None: 0,
  DoubleUp: 1,
  SingleUp: 2,
  FortyFiveUp: 3,
  Flat: 4,
  FortyFiveDown: 5,
  SingleDown: 6,
  DoubleDown: 7,
  NotComputable: 8,
  RateOutOfRange: 9,
};

export const TREND_DESCRIPTIONS = [
  "",
  "rising quickly",
  "rising",
  "rising slightly",
  "steady",
  "falling slightly",
  "falling",
  "falling quickly",
  "unable to determine trend",
  "trend unavailable",
] as const;

export const TREND_ARROWS = ["", "↑↑", "↑", "↗", "→", "↘", "↓", "↓↓", "?", "-"] as const;

export const MAX_MINUTES = 1440;
export const MAX_MAX_COUNT = 288;

export const MMOL_L_CONVERSION_FACTOR = 0.0555;
