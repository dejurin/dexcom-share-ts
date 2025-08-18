/**
 * Zod schemas for responses validation.
 */

import { z } from "zod";
import { DEXCOM_TREND_DIRECTIONS } from "./constants";

export const zUuid = z.string().uuid();

export const zDexcomDate = z.string().regex(/^Date\(\d{13}[+-]\d{4}\)$/);

export const zRawGlucose = z.object({
  WT: z.string().optional(),
  ST: z.string().optional(),
  DT: zDexcomDate,
  Value: z.coerce.number().int(),
  Trend: z.string().refine((v) => v in DEXCOM_TREND_DIRECTIONS, { message: "Unknown trend" }),
});

export const zRawGlucoseArray = z.array(zRawGlucose);

// Dexcom endpoints for accountId/sessionId return string UUID
export const zAuthString = z
  .string()
  .refine((s) => /^[0-9a-fA-F-]{36}$/.test(s), { message: "Not UUID-like" });
