import { Dexcom, Region, MemorySessionCache } from "dexcom-share-ts";
import dotenv from "dotenv";

dotenv.config({ path: "./.env", debug: true });

const dex = new Dexcom({
  username: process.env.DEXCOM_USER,
  password: process.env.DEXCOM_PASS,
  region: Region.OUS,
  retry: { retries: 4, baseDelayMs: 250, maxDelayMs: 3000, jitter: true },
  sessionTtlMs: 8 * 60 * 1000,
  cache: new MemorySessionCache(),
});

const bg = await dex.getCurrentGlucoseReading();
if (bg) {
  console.log("mg/dL:", bg.mgDl);
  console.log("mmol/L:", bg.mmolL);
  console.log("Trend Arrow:", bg.trendArrow);
  console.log("Trend Description:", bg.trendDescription);
  console.log("DateTime:", bg.datetime);
}
