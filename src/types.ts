/**
 * Public and internal types.
 */

export interface RawGlucoseReading {
  WT?: string;
  ST?: string;
  DT: string; // "Date(1691455258000-0400)"
  Value: number | string;
  Trend: string; // e.g., "Flat"
}

export interface GlucoseReadingLike {
  value: number;
  mgDl: number;
  mmolL: number;
  trend: number;
  trendDirection: string;
  trendDescription: string;
  trendArrow: string;
  datetime: Date;
  json: RawGlucoseReading;
  timezone?: string;
}
