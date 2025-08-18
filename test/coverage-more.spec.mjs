import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distEntry = path.resolve(__dirname, "../dist/index.js");

// utils
function setGlobalFetch(fn) {
  const g = globalThis;
  if (fn) g.fetch = fn;
  else delete g.fetch;
}
function ok(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}
function errRaw(text, status = 400, headers = {}) {
  return new Response(text, { status, headers });
}
function reqToString(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object" && "url" in input) return input.url;
  return String(input);
}

const mod = await import(distEntry);
const { Dexcom, Region } = mod;

describe("Extra coverage", () => {
  beforeEach(() => setGlobalFetch(undefined));

  it("getLatestGlucoseReading returns null for empty array", async () => {
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount"))
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes("LoginPublisherAccountById"))
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes("ReadPublisherLatestGlucoseValues")) return Promise.resolve(ok([]));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = new Dexcom({ username: "u", password: "p", region: Region.US });
    const latest = await dex.getLatestGlucoseReading();
    assert.equal(latest ?? null, null);
  });

  it("fetchWithRetry parses HTTP-date Retry-After (past date) and succeeds with jitter=true", async () => {
    let calls = 0;
    const past = new Date(Date.now() - 1000).toUTCString(); // HTTP-date branch
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount"))
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes("LoginPublisherAccountById"))
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            new Response("{}", { status: 429, headers: { "retry-after": past } }),
          );
        }
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 88, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = new Dexcom({
      username: "u",
      password: "p",
      retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5, jitter: true },
    });

    const r = await dex.getCurrentGlucoseReading();
    assert.ok(r);
    assert.equal(r.mgDl, 88);
    assert.equal(calls >= 2, true);
  });

  it("error mapper: non-object JSON body produces SERVER_UNEXPECTED", async () => {
    // Authenticate returns JSON number "123" with 400 → not an object → SERVER_UNEXPECTED
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount")) {
        return Promise.resolve(errRaw("123", 400));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = new Dexcom({ username: "u", password: "p" });
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /Unexpected server response/i);
  });

  it("GlucoseReading mapping: arrows/descriptions/mmol rounding/timezone", async () => {
    // Return three different trends to cover arrow/description branches
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount"))
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes("LoginPublisherAccountById"))
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        return Promise.resolve(
          ok([
            { DT: "Date(1691455258000-0400)", Value: 86, Trend: "DoubleUp" }, // ↑↑
            { DT: "Date(1691455258000-0400)", Value: 95, Trend: "FortyFiveDown" }, // ↘
            { DT: "Date(1691455258000-0400)", Value: 100, Trend: "RateOutOfRange" }, // -
          ]),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = new Dexcom({ username: "u", password: "p" });
    const arr = await dex.getGlucoseReadings(10, 3);
    assert.equal(arr.length, 3);

    // mmol rounding: 86 * 0.0555 = 4.773 -> 4.8
    assert.equal(arr[0].mmolL, 4.8);
    assert.equal(arr[0].trendArrow, "↑↑");
    assert.equal(typeof arr[0].datetime.getTime(), "number");
    assert.equal(arr[0].timezone, "-0400");

    assert.equal(arr[1].trendArrow, "↘");
    // index 5 -> "falling slightly"
    assert.match(arr[1].trendDescription, /falling/i);

    assert.equal(arr[2].trendArrow, "-"); // RateOutOfRange
  });
});

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);
const distEntry2 = path.resolve(__dirname2, "../dist/index.js");
const mod2 = await import(distEntry2);
const { Dexcom: Dexcom2, Region: Region2 } = mod2;

it("current reading returns nullish for empty array", async () => {
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount"))
      return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes("LoginPublisherAccountById"))
      return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    if (s.includes("ReadPublisherLatestGlucoseValues")) return Promise.resolve(ok([]));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  const dex = new Dexcom2({ username: "u", password: "p" });
  const cur = await dex.getCurrentGlucoseReading();
  assert.equal(cur ?? null, null);
});

it("region JP uses JP base URL", async () => {
  let firstUrl = "";
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (!firstUrl) firstUrl = s;
    if (s.includes("AuthenticatePublisherAccount"))
      return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes("LoginPublisherAccountById"))
      return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    if (s.includes("ReadPublisherLatestGlucoseValues")) {
      return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 85, Trend: "Flat" }]));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  const dex = new Dexcom2({ username: "u", password: "p", region: Region2.JP });
  await dex.getLatestGlucoseReading();
  assert.match(firstUrl, /^https:\/\/share\.dexcom\.jp\/ShareWebServices\/Services\//);
});

it("upper bound validation: minutes>1440 and maxCount>288", async () => {
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount"))
      return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes("LoginPublisherAccountById"))
      return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  const dex = new Dexcom2({ username: "u", password: "p" });
  await assert.rejects(
    () => dex.getGlucoseReadings(1441, 1),
    /Minutes must be and integer between 1 and 1440/i,
  );
  await assert.rejects(
    () => dex.getGlucoseReadings(10, 289),
    /Max count must be and integer between 1 and 288/i,
  );
});

it("SSO_InternalError with unrelated message -> UNKNOWN_CODE", async () => {
  setGlobalFetch(() =>
    Promise.resolve(
      new Response(JSON.stringify({ Code: "SSO_InternalError", Message: "oops" }), { status: 400 }),
    ),
  );
  const dex = new Dexcom2({ username: "u", password: "p" });
  await assert.rejects(() => dex.getCurrentGlucoseReading(), /Unknown error code/i);
});
