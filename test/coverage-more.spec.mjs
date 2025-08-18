// test/coverage-more.spec.mjs
// Node >=18, runs against compiled ESM build (dist/index.js)

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// --- Resolve dist entry once and import everything we need ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distEntry = path.resolve(__dirname, "../dist/index.js");
const {
  Dexcom,
  Region,
  MemorySessionCache,
  toQuery, // exported by the lib; used for coverage
} = await import(distEntry);

// --- Constants (endpoints substrings Dexcom hits) ---
const P = {
  AUTH: "AuthenticatePublisherAccount",
  LOGIN: "LoginPublisherAccountById",
  READ: "ReadPublisherLatestGlucoseValues",
};

// --- Small helpers (DRY) ---
const reqToString = (input) =>
  typeof input === "string"
    ? input
    : input instanceof URL
    ? input.href
    : input && typeof input === "object" && "url" in input
    ? input.url
    : String(input);

const ok = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const okRaw = (text, status = 200, headers = {}) =>
  new Response(text, { status, headers });

const err = (code, message, status = 400) =>
  ok({ Code: code, Message: message }, status);

const setFetch = (fn) => {
  const g = globalThis;
  if (fn) g.fetch = fn;
  else delete g.fetch;
};

const mkDex = (overrides = {}) =>
  new Dexcom({ username: "u", password: "p", ...overrides });

// Common happy reading used in many tests
const reading = [{ DT: "Date(1691455258000-0400)", Value: 85, Trend: "Flat" }];

// Reset fetch before each test
beforeEach(() => setFetch(undefined));

// ------------------------------
// Extra coverage & utility tests
// ------------------------------
describe("Extra coverage", () => {
  it("getLatestGlucoseReading returns null for empty array", async () => {
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) return Promise.resolve(ok([]));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = mkDex({ region: Region.US });
    const latest = await dex.getLatestGlucoseReading();
    assert.equal(latest ?? null, null);
  });

  it("fetchWithRetry parses HTTP-date Retry-After (past date) and succeeds with jitter=true", async () => {
    let calls = 0;
    const past = new Date(Date.now() - 1000).toUTCString();
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(new Response("{}", { status: 429, headers: { "retry-after": past } }));
        }
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 88, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = mkDex({ retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5, jitter: true } });
    const r = await dex.getCurrentGlucoseReading();
    assert.ok(r);
    assert.equal(r.mgDl, 88);
    assert.equal(calls >= 2, true);
  });

  it("error mapper: non-object JSON body produces SERVER_UNEXPECTED", async () => {
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(okRaw("123", 400)); // not an object JSON
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = mkDex();
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /Unexpected server response/i);
  });

  it("GlucoseReading mapping: arrows/descriptions/mmol rounding/timezone", async () => {
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) {
        return Promise.resolve(
          ok([
            { DT: "Date(1691455258000-0400)", Value: 86, Trend: "DoubleUp" },     // ↑↑
            { DT: "Date(1691455258000-0400)", Value: 95, Trend: "FortyFiveDown" },// ↘
            { DT: "Date(1691455258000-0400)", Value: 100, Trend: "RateOutOfRange" }, // -
          ]),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = mkDex();
    const arr = await dex.getGlucoseReadings(10, 3);
    assert.equal(arr.length, 3);
    assert.equal(arr[0].mmolL, 4.8); // 86 * 0.0555 = 4.773 -> 4.8
    assert.equal(arr[0].trendArrow, "↑↑");
    assert.equal(typeof arr[0].datetime.getTime(), "number");
    assert.equal(arr[0].timezone, "-0400");
    assert.equal(arr[1].trendArrow, "↘");
    assert.match(arr[1].trendDescription, /falling/i);
    assert.equal(arr[2].trendArrow, "-");
  });

  it("toQuery encodes primitives, arrays and objects (via private post path)", async () => {
    let capturedUrl = "";
    setFetch((url) => {
      capturedUrl = reqToString(url);
      return Promise.resolve(err("X", "M", 400)); // stop request after one call
    });

    const dex = mkDex();
    await assert.rejects(() =>
      dex["post"]("General/AuthenticatePublisherAccount", {
        params: { a: 1, b: true, f: [1, 2, "x"], e: { x: 1 } },
        json: {},
      }),
    );
    assert.match(capturedUrl, /a=1/);
    assert.match(capturedUrl, /b=true/);
    assert.ok(capturedUrl.includes("f=%5B1%2C2%2C%22x%22%5D")); // array JSON-encoded
    assert.ok(capturedUrl.includes("e=%7B%22x%22%3A1%7D"));     // object JSON-encoded

    // direct toQuery export, too (keeps util.ts covered if exported)
    if (typeof toQuery === "function") {
      const q = toQuery({ g: [1, "y"] });
      assert.ok(q.includes("g=%5B1%2C%22y%22%5D"));
    }
  });
});

// ------------------------------
// Basic & region checks
// ------------------------------
it("current reading returns nullish for empty array", async () => {
  setFetch((url) => {
    const s = reqToString(url);
    if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    if (s.includes(P.READ)) return Promise.resolve(ok([]));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  const dex = mkDex();
  const cur = await dex.getCurrentGlucoseReading();
  assert.equal(cur ?? null, null);
});

it("region JP uses JP base URL", async () => {
  let firstUrl = "";
  setFetch((url) => {
    const s = reqToString(url);
    if (!firstUrl) firstUrl = s;
    if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    if (s.includes(P.READ)) return Promise.resolve(ok(reading));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  const dex = mkDex({ region: Region.JP });
  await dex.getLatestGlucoseReading();
  assert.match(firstUrl, /^https:\/\/share\.dexcom\.jp\/ShareWebServices\/Services\//);
});

// ------------------------------
// Validation & limits
// ------------------------------
it("upper bound validation: minutes>1440 and maxCount>288", async () => {
  setFetch((url) => {
    const s = reqToString(url);
    if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  const dex = mkDex();
  await assert.rejects(() => dex.getGlucoseReadings(1441, 1), /Minutes must be and integer/i);
  await assert.rejects(() => dex.getGlucoseReadings(10, 289), /Max count must be and integer/i);
});

it("validateMinutesAndCount rejects non-integers", async () => {
  setFetch(() => Promise.resolve(new Response("{}", { status: 500 }))); // no network expected
  const dex = mkDex();
  await assert.rejects(() => dex.getGlucoseReadings(1.5, 1), /Minutes must be and integer/i);
  await assert.rejects(() => dex.getGlucoseReadings(10, 1.1), /Max count must be and integer/i);
});

it("upper bound exact values are accepted (1440, 288)", async () => {
  setFetch((url) => {
    const s = reqToString(url);
    if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    if (s.includes(P.READ)) return Promise.resolve(ok(reading));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  const dex = mkDex();
  const arr = await dex.getGlucoseReadings(1440, 288);
  assert.equal(arr.length, 1);
});

// ------------------------------
// Error mapping
// ------------------------------
describe("Error mapping", () => {
  it("SSO_InternalError with unrelated message -> UNKNOWN_CODE", async () => {
    setFetch(() => Promise.resolve(ok({ Code: "SSO_InternalError", Message: "oops" }, 400)));
    await assert.rejects(() => mkDex().getCurrentGlucoseReading(), /Unknown error code/i);
  });

  it('maps SSO_InternalError("Cannot Authenticate by AccountId") to AccountError', async () => {
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(err("SSO_InternalError", "Cannot Authenticate by AccountId", 400));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    await assert.rejects(() => mkDex().getCurrentGlucoseReading(), /Failed to authenticate/i);
  });

  it("maps SSO_AuthenticateMaxAttemptsExceeded to AccountError (max attempts)", async () => {
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(err("SSO_AuthenticateMaxAttemptsExceeded", "Too many", 400));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    await assert.rejects(() => mkDex().getCurrentGlucoseReading(), /Maximum authentication attempts exceeded/i);
  });

  it("AccountPasswordInvalid -> AccountError", async () => {
    setFetch((url) => (reqToString(url).includes(P.AUTH) ? Promise.resolve(err("AccountPasswordInvalid", "bad", 401)) : Promise.resolve(new Response("{}", { status: 404 }))));
    await assert.rejects(() => mkDex().getCurrentGlucoseReading(), /Failed to authenticate/i);
  });

  it("SessionIdNotFound -> SessionError", async () => {
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) return Promise.resolve(err("SessionIdNotFound", "missing", 401));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    await assert.rejects(() => mkDex().getGlucoseReadings(10, 1), /Session ID not found/i);
  });

  it("unknown code+message -> SERVER_UNKNOWN_CODE; unexpected shape -> SERVER_UNEXPECTED", async () => {
    setFetch((url) => (reqToString(url).includes(P.AUTH) ? Promise.resolve(err("SomeNewCode", "new", 400)) : Promise.resolve(new Response("{}", { status: 404 }))));
    await assert.rejects(() => mkDex().getLatestGlucoseReading(), /Unknown error code/i);

    setFetch(() => Promise.resolve(ok({ not: "expected" }, 400)));
    await assert.rejects(() => mkDex().getLatestGlucoseReading(), /Unexpected server response/i);
  });

  it("SERVER_INVALID_JSON on malformed JSON body", async () => {
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) return Promise.resolve(okRaw("not-json", 200));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    await assert.rejects(() => mkDex().getCurrentGlucoseReading(), /Invalid or malformed JSON/i);
  });
});

// ------------------------------
// fetchWithRetry behavior
// ------------------------------
describe("fetchWithRetry", () => {
  it("respects Retry-After header (0 seconds)", async () => {
    let attempts = 0;
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) {
        attempts += 1;
        if (attempts === 1)
          return Promise.resolve(new Response("{}", { status: 429, headers: { "retry-after": "0" } }));
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 101, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    const dex = mkDex({ retry: { retries: 3, baseDelayMs: 1, maxDelayMs: 5 } });
    const r = await dex.getCurrentGlucoseReading();
    assert.ok(r);
    assert.equal(r.mgDl, 101);
    assert.equal(attempts >= 2, true);
  });

  it("network error path (eventual success)", async () => {
    let attempts = 0;
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error("network down"));
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 102, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    const dex = mkDex({ retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5 } });
    const r = await dex.getCurrentGlucoseReading();
    assert.ok(r);
    assert.equal(r.mgDl, 102);
  });

  it("immediate throw on non-retryable status (418)", async () => {
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) return Promise.resolve(new Response("{}", { status: 418 }));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    const dex = mkDex({ retry: { retries: 3, baseDelayMs: 1, maxDelayMs: 5 } });
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /Unexpected server response/i);
  });

  it("Retry-After invalid value falls back to backoff, then succeeds", async () => {
    let calls = 0;
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) {
        calls += 1;
        if (calls === 1)
          return Promise.resolve(new Response("{}", { status: 429, headers: { "retry-after": "foo" } }));
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 104, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    const dex = mkDex({ retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5, jitter: false } });
    const r = await dex.getCurrentGlucoseReading();
    assert.ok(r);
    assert.equal(r.mgDl, 104);
    assert.equal(calls >= 2, true);
  });

  it("Retry-After future HTTP-date triggers short wait then success", async () => {
    let calls = 0;
    const future = new Date(Date.now() + 5).toUTCString();
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) {
        calls += 1;
        if (calls === 1)
          return Promise.resolve(new Response("{}", { status: 429, headers: { "retry-after": future } }));
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 106, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    const dex = mkDex({ retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 10, jitter: false } });
    const r = await dex.getCurrentGlucoseReading();
    assert.ok(r);
    assert.equal(r.mgDl, 106);
    assert.equal(calls >= 2, true);
  });

  it("exhausted network retries -> throws last error", async () => {
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) return Promise.reject(new Error("network down"));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    const dex = mkDex({ retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 2, jitter: false } });
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /network down/i);
  });
});

// ------------------------------
// Local validation & constructors
// ------------------------------
describe("Local validation & constructors", () => {
  it("empty password -> immediate throw (no network)", async () => {
    let called = false;
    setFetch(() => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 500 }));
    });
    const dex = mkDex({ password: "" });
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /Password must be non-empty string/i);
    assert.equal(called, false);
  });

  it("invalid accountId UUID -> immediate throw (no network)", async () => {
    let called = false;
    setFetch(() => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 500 }));
    });
    const dex = mkDex({ username: undefined, accountId: "not-a-uuid" });
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /Account ID must be UUID/i);
    assert.equal(called, false);
  });

  it("empty username -> immediate constructor throw (no network)", () => {
    let called = false;
    setFetch(() => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 500 }));
    });
    assert.throws(() => new Dexcom({ username: "", password: "p" }), /At least one of account_id, username should be provided/i);
    assert.equal(called, false);
  });

  it("constructor validation errors: region invalid / both ids / neither id", () => {
    assert.throws(() => new Dexcom({ username: "u", password: "p", region: "xx" }), /Region must be 'us', 'ous, or 'jp'/i);
    assert.throws(() => new Dexcom({ username: "u", accountId: "12345678-90ab-cdef-1234-567890abcdef", password: "p" }), /Only one of account_id, username/i);
    // @ts-ignore construct with only password (JS test)
    assert.throws(() => new Dexcom({ password: "p" }), /At least one of account_id, username/i);
  });
});

// ------------------------------
// Session management & getters
// ------------------------------
describe("Session & getters", () => {
  it("reuses cached session (no second login)", async () => {
    let authCalls = 0;
    let loginCalls = 0;
    let glucoseCalls = 0;

    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) {
        authCalls += 1;
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      }
      if (s.includes(P.LOGIN)) {
        loginCalls += 1;
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      }
      if (s.includes(P.READ)) {
        glucoseCalls += 1;
        return Promise.resolve(ok(reading));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = mkDex({ cache: new MemorySessionCache(), sessionTtlMs: 60_000 });
    const r1 = await dex.getCurrentGlucoseReading();
    const r2 = await dex.getCurrentGlucoseReading();

    assert.equal(authCalls, 1);
    assert.equal(loginCalls, 1);
    assert.equal(glucoseCalls, 2);
    assert.equal(r1?.mgDl, 85);
    assert.equal(r2?.mgDl, 85);
  });

  it("auto-heals on SessionIdNotFound by re-authing and retrying", async () => {
    let loginCalls = 0;
    let first = true;

    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) {
        loginCalls += 1;
        return Promise.resolve(ok(`aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee${String(loginCalls).padStart(2, "0")}`));
      }
      if (s.includes(P.READ)) {
        if (first) {
          first = false;
          return Promise.resolve(err("SessionIdNotFound", "missing", 401));
        }
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 111, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = mkDex();
    const r = await dex.getCurrentGlucoseReading();
    assert.ok(r);
    assert.equal(r.mgDl, 111);
    assert.equal(loginCalls >= 2, true);
  });

  it("session TTL expiry -> re-login on second call", async () => {
    let logins = 0;
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) {
        logins += 1;
        return Promise.resolve(ok(`aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee${String(logins).padStart(2, "0")}`));
      }
      if (s.includes(P.READ)) return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 103, Trend: "Flat" }]));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = mkDex({ cache: new MemorySessionCache(), sessionTtlMs: 2 });
    const r1 = await dex.getCurrentGlucoseReading();
    await delay(3); // let TTL expire
    const r2 = await dex.getCurrentGlucoseReading();
    assert.equal(r1?.mgDl, 103);
    assert.equal(r2?.mgDl, 103);
    assert.equal(logins >= 2, true);
  });

  it("uses accountId path directly (no authenticate by username)", async () => {
    let authCalls = 0;
    let loginCalls = 0;

    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) {
        authCalls += 1;
        return Promise.resolve(ok("should-not-be-called"));
      }
      if (s.includes(P.LOGIN)) {
        loginCalls += 1;
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      }
      if (s.includes(P.READ)) {
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: "77", Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = mkDex({ username: undefined, accountId: "12345678-90ab-cdef-1234-567890abcdef" });
    const bg = await dex.getLatestGlucoseReading();
    assert.ok(bg);
    assert.equal(bg.mgDl, 77);
    assert.equal(authCalls, 0);
    assert.equal(loginCalls >= 1, true);
    assert.equal(typeof bg.toString(), "string");
    assert.equal(bg.timezone, "-0400");
  });

  it("DEFAULT_UUID handling: accountId default & sessionId default", async () => {
    // Account ID default
    setFetch((url) => (reqToString(url).includes(P.AUTH) ? Promise.resolve(ok("00000000-0000-0000-0000-000000000000")) : Promise.resolve(new Response("{}", { status: 404 }))));
    await assert.rejects(() => mkDex().getCurrentGlucoseReading(), /Account ID default/i);

    // Session ID default
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("00000000-0000-0000-0000-000000000000"));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    await assert.rejects(() => mkDex().getCurrentGlucoseReading(), /Session ID default/i);
  });

  it("exposes getters for username/accountId", () => {
    const dex1 = mkDex();
    assert.equal(dex1.getUsername, "u");
    assert.equal(dex1.getAccountId, undefined);

    const dex2 = mkDex({ username: undefined, accountId: "12345678-90ab-cdef-1234-567890abcdef" });
    assert.equal(dex2.getUsername, undefined);
    assert.equal(dex2.getAccountId, "12345678-90ab-cdef-1234-567890abcdef");
  });

  it("GlucoseReading maps 'None' and 'NotComputable' + exposes json/mgDl/toString()", async () => {
    setFetch((url) => {
      const s = reqToString(url);
      if (s.includes(P.AUTH)) return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes(P.LOGIN)) return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes(P.READ)) {
        return Promise.resolve(
          ok([
            { DT: "Date(1691455258000-0400)", Value: 90, Trend: "None" },          // arrow ""
            { DT: "Date(1691455258000-0400)", Value: 91, Trend: "NotComputable" }, // arrow "?"
            { DT: "Date(1691455258000-0400)", Value: 87, Trend: "FortyFiveUp" },   // for getters assertions
          ]),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = mkDex();
    const arr = await dex.getGlucoseReadings(10, 3);
    assert.equal(arr[0].trendArrow, "");
    assert.match(arr[1].trendDescription, /unable to determine|unavailable|trend/i);
    assert.equal(arr[1].trendArrow, "?");

    const g = arr[2];
    assert.equal(g.mgDl, 87);
    assert.equal(String(g), "87");
    assert.equal(g.json.Value, 87);
    assert.ok(g.json.DT.includes("Date("));
  });
});
