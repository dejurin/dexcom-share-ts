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

const distEntry2 = path.resolve(__dirname, "../dist/index.js");
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

const distEntry3 = path.resolve(__dirname, "../dist/index.js");
const mod3 = await import(distEntry3);
const { Dexcom: Dexcom3 } = mod3;

function dexErr(code, message, status = 400) {
  return ok({ Code: code, Message: message }, status);
}

/** 1) Auto-heal on SessionIdNotFound (retry path distinct from SessionNotValid) */
it("auto-heals on SessionIdNotFound by re-authing and retrying", async () => {
  let loginCalls = 0;
  let first = true;

  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount"))
      return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes("LoginPublisherAccountById")) {
      loginCalls += 1;
      return Promise.resolve(
        ok(`aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee${String(loginCalls).padStart(2, "0")}`),
      );
    }
    if (s.includes("ReadPublisherLatestGlucoseValues")) {
      if (first) {
        first = false;
        return Promise.resolve(dexErr("SessionIdNotFound", "missing", 401));
      }
      return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 111, Trend: "Flat" }]));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });

  const dex = new Dexcom3({ username: "u", password: "p" });
  const r = await dex.getCurrentGlucoseReading();
  assert.ok(r);
  assert.equal(r.mgDl, 111);
  assert.equal(loginCalls >= 2, true); // relogin occurred
});

/** 2) Non-retryable HTTP status in fetchWithRetry -> immediate throw */
it("fetchWithRetry immediate throw on non-retryable status (418)", async () => {
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount"))
      return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes("LoginPublisherAccountById"))
      return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    if (s.includes("ReadPublisherLatestGlucoseValues")) {
      return Promise.resolve(new Response("{}", { status: 418 })); // not in retry list
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });

  const dex = new Dexcom3({
    username: "u",
    password: "p",
    retry: { retries: 3, baseDelayMs: 1, maxDelayMs: 5 },
  });
  await assert.rejects(() => dex.getCurrentGlucoseReading(), /Unexpected server response/i);
});

/** 3) GlucoseReading arrows/descriptions for 'None' and 'NotComputable' */
it("GlucoseReading maps 'None' and 'NotComputable' trends", async () => {
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount"))
      return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes("LoginPublisherAccountById"))
      return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    if (s.includes("ReadPublisherLatestGlucoseValues")) {
      return Promise.resolve(
        ok([
          { DT: "Date(1691455258000-0400)", Value: 90, Trend: "None" }, // arrow: "" (empty)
          { DT: "Date(1691455258000-0400)", Value: 91, Trend: "NotComputable" }, // arrow: "?"
        ]),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });

  const dex = new Dexcom3({ username: "u", password: "p" });
  const arr = await dex.getGlucoseReadings(10, 2);
  assert.equal(arr[0].trendArrow, "");
  assert.match(arr[1].trendDescription, /unable to determine|unavailable|trend/i);
  assert.equal(arr[1].trendArrow, "?");
});

const distEntry4 = path.resolve(__dirname, "../dist/index.js");
const mod4 = await import(distEntry4);
const { Dexcom: Dex4 } = mod4;

/** Local validation: empty password throws before any network call */
it("local validation: empty password throws immediately", async () => {
  let called = false;
  setGlobalFetch(() => {
    called = true;
    return Promise.resolve(new Response("{}", { status: 500 }));
  });

  const dex = new Dex4({ username: "u", password: "" });
  await assert.rejects(() => dex.getCurrentGlucoseReading(), /Password must be non-empty string/i);
  assert.equal(called, false); // no network call
});

/** Local validation: invalid accountId UUID throws immediately */
it("local validation: invalid accountId UUID", async () => {
  let called = false;
  setGlobalFetch(() => {
    called = true;
    return Promise.resolve(new Response("{}", { status: 500 }));
  });

  const dex = new Dex4({ accountId: "not-a-uuid", password: "p" });
  await assert.rejects(() => dex.getCurrentGlucoseReading(), /Account ID must be UUID/i);
  assert.equal(called, false); // no network call
});

const distEntry5 = path.resolve(__dirname, "../dist/index.js");
const mod5 = await import(distEntry5);
const { Dexcom: Dex5 } = mod5;

/** A) GlucoseReading getters: json/mgDl/toString (hits uncovered lines in glucoseReading.ts) */
it("GlucoseReading exposes raw json, mgDl alias and toString()", async () => {
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount"))
      return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes("LoginPublisherAccountById"))
      return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    if (s.includes("ReadPublisherLatestGlucoseValues")) {
      return Promise.resolve(
        ok([{ DT: "Date(1691455258000-0400)", Value: 87, Trend: "FortyFiveUp" }]),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });

  const dex = new Dex5({ username: "u", password: "p" });
  const [g] = await dex.getGlucoseReadings(10, 1);
  assert.equal(g.mgDl, 87); // mgDl alias
  assert.equal(String(g), "87"); // toString()
  assert.equal(g.json.Value, 87); // raw json getter
  assert.ok(g.json.DT.includes("Date(")); // sanity
});

/** B) Non-integer minutes/maxCount should also be rejected (different branch than <=0/>max) */
it("validateMinutesAndCount rejects non-integers", async () => {
  // Сеть не понадобится, ошибка валидируется локально до запросов
  setGlobalFetch(() => Promise.resolve(new Response("{}", { status: 500 })));

  const dex = new Dex5({ username: "u", password: "p" });

  await assert.rejects(() => dex.getGlucoseReadings(1.5, 1), /Minutes must be and integer/i);
  await assert.rejects(() => dex.getGlucoseReadings(10, 1.1), /Max count must be and integer/i);
});

/** C) Retry-After: invalid value 'foo' => fallback to exponential backoff path (util.ts extra lines) */
it("Retry-After invalid value falls back to backoff, then succeeds", async () => {
  let calls = 0;
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount"))
      return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes("LoginPublisherAccountById"))
      return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    if (s.includes("ReadPublisherLatestGlucoseValues")) {
      calls += 1;
      if (calls === 1) {
        // invalid Retry-After → should ignore and use backoff path
        return Promise.resolve(
          new Response("{}", { status: 429, headers: { "retry-after": "foo" } }),
        );
      }
      return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 104, Trend: "Flat" }]));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });

  const dex = new Dex5({
    username: "u",
    password: "p",
    retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });

  const r = await dex.getCurrentGlucoseReading();
  assert.ok(r);
  assert.equal(r.mgDl, 104);
  assert.equal(calls >= 2, true);
});

const distEntry6 = path.resolve(__dirname, "../dist/index.js");
const mod6 = await import(distEntry6);
const { Dexcom: Dex6 } = mod6;

it("local validation: empty username throws immediately (no network)", () => {
  let called = false;
  setGlobalFetch(() => {
    called = true;
    return Promise.resolve(new Response("{}", { status: 500 }));
  });
  // Constructor throws synchronously on validateUserIds
  assert.throws(
    () => new Dex6({ username: "", password: "p" }),
    /At least one of account_id, username should be provided/i,
  );
  assert.equal(called, false);
});

it("upper bound exact values are accepted (1440, 288)", async () => {
  setGlobalFetch((url) => {
    const s = String(url);
    if (s.includes("AuthenticatePublisherAccount"))
      return Promise.resolve(new Response(JSON.stringify("12345678-90ab-cdef-1234-567890abcdef")));
    if (s.includes("LoginPublisherAccountById"))
      return Promise.resolve(new Response(JSON.stringify("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")));
    if (s.includes("ReadPublisherLatestGlucoseValues")) {
      return Promise.resolve(
        new Response(
          JSON.stringify([{ DT: "Date(1691455258000-0400)", Value: 80, Trend: "Flat" }]),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  const { Dexcom } = await import("../dist/index.js");
  const dex = new Dexcom({ username: "u", password: "p" });
  const arr = await dex.getGlucoseReadings(1440, 288);
  assert.equal(arr.length, 1);
});

const __filename7 = fileURLToPath(import.meta.url);
const __dirname7 = path.dirname(__filename7);
const distEntry7 = path.resolve(__dirname7, "../dist/index.js");
const mod7 = await import(distEntry7);
const { Dexcom: Dex7 } = mod7;

// SSO_InternalError with "Cannot Authenticate by AccountId" -> AccountError(Failed to authenticate)
it('maps SSO_InternalError("Cannot Authenticate by AccountId") to AccountError', async () => {
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount")) {
      return Promise.resolve(dexErr("SSO_InternalError", "Cannot Authenticate by AccountId", 400));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });

  const dex = new Dex7({ username: "u", password: "p" });
  await assert.rejects(() => dex.getCurrentGlucoseReading(), /Failed to authenticate/i);
});

// SSO_AuthenticateMaxAttemptsExceeded -> AccountError(Max attempts)
it("maps SSO_AuthenticateMaxAttemptsExceeded to AccountError (max attempts)", async () => {
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount")) {
      return Promise.resolve(
        dexErr("SSO_AuthenticateMaxAttemptsExceeded", "Too many attempts", 400),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });

  const dex = new Dex7({ username: "u", password: "p" });
  await assert.rejects(
    () => dex.getCurrentGlucoseReading(),
    /Maximum authentication attempts exceeded/i,
  );
});

const __filename8 = fileURLToPath(import.meta.url);
const __dirname8 = path.dirname(__filename8);
const distEntry8 = path.resolve(__dirname8, "../dist/index.js");
const mod8 = await import(distEntry8);
const { Dexcom: Dex8 } = mod8;

it("Retry-After future HTTP-date triggers short wait then success", async () => {
  let calls = 0;
  const future = new Date(Date.now() + 5).toUTCString(); // short future delay
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
          new Response("{}", { status: 429, headers: { "retry-after": future } }),
        );
      }
      return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 106, Trend: "Flat" }]));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });

  const dex = new Dex8({
    username: "u",
    password: "p",
    retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 10, jitter: false },
  });

  const r = await dex.getCurrentGlucoseReading();
  assert.ok(r);
  assert.equal(r.mgDl, 106);
  assert.equal(calls >= 2, true);
});
