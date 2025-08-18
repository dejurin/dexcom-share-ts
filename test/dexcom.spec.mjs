// ESM JS tests against compiled dist build.
// Node >=18

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve dist entry (dual-exports: we import ESM build)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distEntry = path.resolve(__dirname, "../dist/index.js");

// Dynamic import compiled module
const { Dexcom, Region, MemorySessionCache } = await import(distEntry);

// Narrow fetch-like type (JS version, no TS)
function setGlobalFetch(fn) {
  const g = globalThis;
  if (fn) g.fetch = fn;
  else delete g.fetch;
}

// Build JSON Response with status=200 by default
function ok(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

// Build JSON error payload like Dexcom error
function dexErr(code, message, status = 400) {
  return ok({ Code: code, Message: message }, status);
}

// Safe stringify RequestInfo -> string
function reqToString(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object" && "url" in input) return input.url;
  return String(input);
}

describe("Dexcom client (happy path + resilience)", () => {
  beforeEach(() => {
    setGlobalFetch(undefined);
  });

  it("authenticates (username → accountId → sessionId) and fetches current reading", async () => {
    const fetchMock = (url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount")) {
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      }
      if (s.includes("LoginPublisherAccountById")) {
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      }
      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 85, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    };
    setGlobalFetch(fetchMock);

    const dex = new Dexcom({
      username: "user@example.com",
      password: "secret",
      region: Region.US,
      cache: new MemorySessionCache(),
      sessionTtlMs: 60_000,
    });

    const bg = await dex.getCurrentGlucoseReading();
    assert.ok(bg, "reading expected");
    assert.equal(bg.mgDl, 85);
    assert.equal(bg.trendDirection, "Flat");
    assert.equal(bg.trendDescription, "steady");
    assert.equal(bg.trendArrow, "→");
  });

  it("retries once on 500 and then succeeds", async () => {
    let calls = 0;
    const fetchMock = (url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount")) {
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      }
      if (s.includes("LoginPublisherAccountById")) {
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      }
      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        calls += 1;
        if (calls < 2) {
          return Promise.resolve(new Response("{}", { status: 500 }));
        }
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 90, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    };
    setGlobalFetch(fetchMock);

    const dex = new Dexcom({
      username: "user@example.com",
      password: "secret",
      retry: { retries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    });

    const r = await dex.getLatestGlucoseReading();
    assert.ok(r, "reading expected");
    assert.equal(r.mgDl, 90);
    assert.equal(calls >= 2, true, "should retry at least once");
  });

  it("handles SessionNotValid by clearing cache and re-authing", async () => {
    let loginCalls = 0;
    let stage = "first";

    const fetchMock = (url) => {
      const s = reqToString(url);

      if (s.includes("AuthenticatePublisherAccount")) {
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      }

      if (s.includes("LoginPublisherAccountById")) {
        loginCalls += 1;
        const id =
          loginCalls === 1
            ? "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
            : "ffffffff-1111-2222-3333-444444444444";
        return Promise.resolve(ok(id));
      }

      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        if (stage === "first") {
          stage = "second";
          return Promise.resolve(dexErr("SessionNotValid", "Session expired", 401));
        }
        return Promise.resolve(ok([{ DT: "Date(1691455258000-0400)", Value: 100, Trend: "Flat" }]));
      }

      return Promise.resolve(new Response("{}", { status: 404 }));
    };
    setGlobalFetch(fetchMock);

    const dex = new Dexcom({
      username: "user@example.com",
      password: "secret",
      cache: new MemorySessionCache(),
      sessionTtlMs: 10_000,
    });

    const r = await dex.getCurrentGlucoseReading();
    assert.ok(r, "reading expected");
    assert.equal(r.mgDl, 100);
    assert.equal(loginCalls >= 2, true, "should re-login after SessionNotValid");
  });

  it("validates Zod schema and rejects on invalid DT", async () => {
    const fetchMock = (url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount"))
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes("LoginPublisherAccountById"))
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        return Promise.resolve(ok([{ DT: "Date(bad)", Value: 85, Trend: "Flat" }]));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    };
    setGlobalFetch(fetchMock);

    const dex = new Dexcom({ username: "u", password: "p" });
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /ZodError|Unexpected|Invalid/i);
  });
});

describe("Dexcom client (error mapping)", () => {
  beforeEach(() => {
    setGlobalFetch(undefined);
  });

  it("maps AccountPasswordInvalid to AccountError", async () => {
    const fetchMock = (url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount")) {
        return Promise.resolve(dexErr("AccountPasswordInvalid", "bad password", 401));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    };
    setGlobalFetch(fetchMock);

    const dex = new Dexcom({ username: "user@example.com", password: "wrong" });
    await assert.rejects(() => dex.getCurrentGlucoseReading(), /Failed to authenticate/i);
  });

  it("maps SessionIdNotFound to SessionError", async () => {
    const fetchMock = (url) => {
      const s = reqToString(url);
      if (s.includes("AuthenticatePublisherAccount"))
        return Promise.resolve(ok("12345678-90ab-cdef-1234-567890abcdef"));
      if (s.includes("LoginPublisherAccountById"))
        return Promise.resolve(ok("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
      if (s.includes("ReadPublisherLatestGlucoseValues")) {
        return Promise.resolve(dexErr("SessionIdNotFound", "missing session", 401));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    };
    setGlobalFetch(fetchMock);

    const dex = new Dexcom({ username: "u", password: "p" });
    await assert.rejects(() => dex.getGlucoseReadings(10, 1), /Session ID not found/i);
  });
});
