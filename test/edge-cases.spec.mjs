// Extra edge-case tests against compiled dist build.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises"; // <-- import delay

// Resolve dist entry once
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distEntry = path.resolve(__dirname, "../dist/index.js");

// Lazy import compiled module
const mod = await import(distEntry);
const { Dexcom, Region, MemorySessionCache } = mod;

// Helpers
function setGlobalFetch(fn) {
  const g = globalThis;
  if (fn) g.fetch = fn;
  else delete g.fetch;
}
function ok(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}
function okRaw(text, status = 200, headers = {}) {
  return new Response(text, { status, headers });
}
function dexErr(code, message, status = 400) {
  return ok({ Code: code, Message: message }, status);
}
function reqToString(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object" && "url" in input) return input.url;
  return String(input);
}

describe("Dexcom client - edge cases & error coverage", () => {
  beforeEach(() => setGlobalFetch(undefined));

  it("uses accountId path directly (no authenticate by username)", async () => {
    let authCalls = 0;
    let loginCalls = 0;

    const fetchMock = (url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount")) {
        authCalls += 1;
        return Promise.resolve(ok("should-not-be-called"));
      }
      if (s.includes("LoginPublisherAccountById")) {
        loginCalls += 1;
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      }
      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        return Promise.resolve(
          ok([{ DT: "Date(1691455258000-0400)", Value: "77", Trend: "Flat" }]),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    };
    setGlobalFetch(fetchMock);

    const dex = new Dexcom({
      accountId: "12345678-90ab-cdef-1234-567890abcdef",
      password: "secret",
      region: Region.US,
    });

    const bg = await dex.getLatestGlucoseReading();
    assert.ok(bg);
    assert.equal(bg.mgDl, 77);
    assert.equal(authCalls, 0, "must not call AuthenticatePublisherAccount");
    assert.equal(loginCalls >= 1, true);
    assert.equal(typeof bg.toString(), "string");
    assert.equal(bg.timezone, "-0400");
  });

  it("maps SSO_InternalError with message to AccountError", async () => {
    const fetchMock = (url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount")) {
        // IMPORTANT: use 400 (non-retry) to trigger error mapping instead of fetch retry
        return Promise.resolve(
          dexErr("SSO_InternalError", "Cannot Authenticate by AccountName", 400),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    };
    setGlobalFetch(fetchMock);

    const dex = new Dexcom({ username: "u", password: "p" });
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /Failed to authenticate/i);
  });

  it("maps InvalidArgument for accountName/password/UUID", async () => {
    // 1) accountName
    setGlobalFetch(() => Promise.resolve(dexErr("InvalidArgument", "accountName is invalid", 400)));
    await assert.rejects(
      () => new Dexcom({ username: "u", password: "p" }).getCurrentGlucoseReading(),
      /Username must be non-empty string/i,
    );

    // 2) password
    setGlobalFetch(() => Promise.resolve(dexErr("InvalidArgument", "password wrong", 400)));
    await assert.rejects(
      () => new Dexcom({ username: "u", password: "" }).getCurrentGlucoseReading(),
      /Password must be non-empty string/i,
    );

    // 3) UUID (via accountId flow)
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("LoginPublisherAccountById")) {
        return Promise.resolve(dexErr("InvalidArgument", "UUID invalid", 400));
      }
      return Promise.resolve(ok("dummy"));
    });
    const dex = new Dexcom({ accountId: "12345678-90ab-cdef-1234-567890abcdef", password: "p" });
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /Account ID must be UUID|UUID/i);
  });

  it("maps unknown code+message -> SERVER_UNKNOWN_CODE; unexpected shape -> SERVER_UNEXPECTED", async () => {
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount")) {
        return Promise.resolve(dexErr("SomeNewCode", "new server behavior", 400));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    await assert.rejects(
      () => new Dexcom({ username: "u", password: "p" }).getLatestGlucoseReading(),
      /Unknown error code/i,
    );

    setGlobalFetch(() => Promise.resolve(ok({ not: "expected" }, 400)));
    await assert.rejects(
      () => new Dexcom({ username: "u", password: "p" }).getLatestGlucoseReading(),
      /Unexpected server response/i,
    );
  });

  it("throws SERVER_INVALID_JSON on malformed JSON body", async () => {
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount"))
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes("LoginPublisherAccountById"))
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes("ReadPublisherLatestGlucoseValues"))
        return Promise.resolve(okRaw("not-json", 200));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = new Dexcom({ username: "u", password: "p" });
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /Invalid or malformed JSON/i);
  });

  it("validateMinutesAndCount via public API (bad minutes / bad count)", async () => {
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount"))
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes("LoginPublisherAccountById"))
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = new Dexcom({ username: "u", password: "p" });

    await assert.rejects(() => dex.getGlucoseReadings(0, 1), /Minutes must be and integer/i);
    await assert.rejects(() => dex.getGlucoseReadings(10, 0), /Max count must be and integer/i);
  });

  it("fetchWithRetry respects Retry-After header", async () => {
    let attempts = 0;
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount"))
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes("LoginPublisherAccountById"))
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        attempts += 1;
        if (attempts === 1)
          return Promise.resolve(
            new Response("{}", { status: 429, headers: { "retry-after": "0" } }),
          );
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 101, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = new Dexcom({
      username: "u",
      password: "p",
      retry: { retries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    });

    const r = await dex.getCurrentGlucoseReading();
    assert.ok(r);
    assert.equal(r.mgDl, 101);
    assert.equal(attempts >= 2, true);
  });

  it("network error path in fetchWithRetry (eventual success)", async () => {
    let attempts = 0;
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount"))
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes("LoginPublisherAccountById"))
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error("network down"));
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 102, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = new Dexcom({
      username: "u",
      password: "p",
      retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    });

    const r = await dex.getCurrentGlucoseReading();
    assert.ok(r);
    assert.equal(r.mgDl, 102);
  });

  it("session TTL expiry path (uses very short TTL to force refresh)", async () => {
    let logins = 0;
    setGlobalFetch((url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount"))
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes("LoginPublisherAccountById")) {
        logins += 1;
        return Promise.resolve(
          ok(`aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee${String(logins).padStart(2, "0")}`),
        );
      }
      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 103, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const dex = new Dexcom({
      username: "u",
      password: "p",
      cache: new MemorySessionCache(),
      sessionTtlMs: 2,
    });

    const r1 = await dex.getCurrentGlucoseReading();
    await delay(3); // let TTL expire
    const r2 = await dex.getCurrentGlucoseReading();

    assert.equal(r1?.mgDl, 103);
    assert.equal(r2?.mgDl, 103);
    assert.equal(logins >= 2, true, "should re-login after TTL expiry");
  });
});

// --- extra coverage tests ---

it("constructor validation errors: region invalid / user id multiple / user id required", async () => {
  // region invalid
  assert.throws(
    () => new Dexcom({ username: "u", password: "p", region: "xx" }),
    /Region must be 'us', 'ous, or 'jp'/i,
  );
  // both username and accountId provided
  assert.throws(
    () =>
      new Dexcom({
        username: "u",
        accountId: "12345678-90ab-cdef-1234-567890abcdef",
        password: "p",
      }),
    /Only one of account_id, username/i,
  );
  // neither username nor accountId provided
  assert.throws(
    // @ts-ignore - JS test, allows constructing with only password
    () => new Dexcom({ password: "p" }),
    /At least one of account_id, username/i,
  );
});

it("DEFAULT_UUID handling: accountId default & sessionId default", async () => {
  // Account ID default from AuthenticatePublisherAccount
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount")) {
      return Promise.resolve(ok("00000000-0000-0000-0000-000000000000")); // DEFAULT_UUID
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  await assert.rejects(
    () => new Dexcom({ username: "u", password: "p" }).getCurrentGlucoseReading(),
    /Account ID default/i,
  );

  // Session ID default from LoginPublisherAccountById
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount")) {
      return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    }
    if (s.includes("LoginPublisherAccountById")) {
      return Promise.resolve(ok("00000000-0000-0000-0000-000000000000")); // DEFAULT_UUID
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  await assert.rejects(
    () => new Dexcom({ username: "u", password: "p" }).getCurrentGlucoseReading(),
    /Session ID default/i,
  );
});

it("fetchWithRetry: exhausted network retries -> throws last error", async () => {
  // Bootstrap ok for auth/login, but glucose endpoint always network-fails
  setGlobalFetch((url) => {
    const s = reqToString(url);
    if (s.includes("AuthenticatePublisherAccount"))
      return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
    if (s.includes("LoginPublisherAccountById"))
      return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
    if (s.includes("ReadPublisherLatestGlucoseValues"))
      return Promise.reject(new Error("network down"));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });

  const dex = new Dexcom({
    username: "u",
    password: "p",
    retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 2, jitter: false },
  });

  await assert.rejects(() => dex.getCurrentGlucoseReading(), /network down/i);
});

it("toQuery encodes primitives, arrays and objects (via private post path)", async () => {
  let capturedUrl = "";
  setGlobalFetch((url) => {
    capturedUrl = reqToString(url);
    // Non-retryable error to stop after one request and hit error mapping
    return Promise.resolve(ok({ Code: "X", Message: "M" }, 400));
  });

  const dex = new Dexcom({ username: "u", password: "p" });
  // Access private `post` at runtime (TS private is erased in JS)
  await assert.rejects(() =>
    dex["post"]("General/AuthenticatePublisherAccount", {
      params: { a: 1, b: true, c: [1, 2, "x"], e: { x: 1 } },
      json: {},
    }),
  );

  assert.ok(capturedUrl.includes("a=1"));
  assert.ok(capturedUrl.includes("b=true"));
  assert.ok(capturedUrl.includes("c=%5B1%2C2%2C%22x%22%5D"));
  // object gets JSON-encoded and URL-escaped
  assert.ok(capturedUrl.includes("e=%7B%22x%22%3A1%7D"));
});

// sanity: getters coverage (functions counter)
it("exposes getters for username/accountId", async () => {
  const dex1 = new Dexcom({ username: "u", password: "p" });
  assert.equal(dex1.getUsername, "u");
  assert.equal(dex1.getAccountId, undefined);

  const dex2 = new Dexcom({ accountId: "12345678-90ab-cdef-1234-567890abcdef", password: "p" });
  assert.equal(dex2.getUsername, undefined);
  assert.equal(dex2.getAccountId, "12345678-90ab-cdef-1234-567890abcdef");
});
