/**
 * GlucoseReading implementation compatible with pydexcom behavior.
 */

import {
  DEXCOM_TREND_DIRECTIONS,
  MMOL_L_CONVERSION_FACTOR,
  TREND_ARROWS,
  TREND_DESCRIPTIONS,
} from "./constants";
import type { RawGlucoseReading, GlucoseReadingLike } from "./types";
import { ArgumentError, DexcomErrorCode } from "./errors";

const DT_REGEX = /Date\((?<timestamp>\d+)(?<timezone>[+-]\d{4})\)/;

/** Parse "Date(1691455258000-0400)" -> { date: Date, tz: string } */
function parseDexcomDate(dt: string): { date: Date; tz?: string } {
  const m = DT_REGEX.exec(dt);
  if (!m || !m.groups) return { date: new Date(NaN) };
  const ts = Number(m.groups["timestamp"]);
  const tz = m.groups["timezone"];
  return { date: new Date(ts), tz };
}

export class GlucoseReading implements GlucoseReadingLike {
  private _json: RawGlucoseReading;
  private _value: number;
  private _trend: number;
  private _trendDirection: string;
  private _datetime: Date;
  private _timezone?: string;

  /**
   * Create a GlucoseReading from Dexcom Share JSON.
   * @param json JSON glucose reading from Dexcom Share API
   */
  constructor(json: RawGlucoseReading) {
    this._json = json;

    try {
      const rawVal = json["Value"];
      const value = typeof rawVal === "string" ? parseInt(rawVal, 10) : rawVal;
      if (!Number.isFinite(value)) throw new Error("Value parse error");

      const direction = String(json["Trend"]);
      const trend = DEXCOM_TREND_DIRECTIONS[direction];
      if (trend === undefined) throw new Error("Unknown trend");

      const { date, tz } = parseDexcomDate(String(json["DT"]));
      if (Number.isNaN(date.getTime())) throw new Error("DT parse error");

      this._value = value!;
      this._trendDirection = direction;
      this._trend = trend;
      this._datetime = date;
      this._timezone = tz;
    } catch {
      throw new ArgumentError(DexcomErrorCode.GLUCOSE_READING_INVALID);
    }
  }

  get value(): number {
    return this._value;
  }
  get mgDl(): number {
    return this._value;
  }
  get mmolL(): number {
    return Math.round(this._value * MMOL_L_CONVERSION_FACTOR * 10) / 10;
  }
  get trend(): number {
    return this._trend;
  }
  get trendDirection(): string {
    return this._trendDirection;
  }
  get trendDescription(): string {
    return TREND_DESCRIPTIONS[this._trend] ?? "";
  }
  get trendArrow(): string {
    return TREND_ARROWS[this._trend] ?? "";
  }
  get datetime(): Date {
    return this._datetime;
  }
  get timezone(): string | undefined {
    return this._timezone;
  }
  get json(): RawGlucoseReading {
    return this._json;
  }

  toString(): string {
    return String(this._value);
  }
}
