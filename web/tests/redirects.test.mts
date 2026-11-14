/** Managed redirects map (src/lib/seo/redirects.ts): parsing, normalisation, cache + fail-open. */
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  TTL_MS,
  invalidateRedirects,
  lookupRedirect,
  normalizeRedirectPath,
  parseRedirects,
  resetRedirectsForTests,
} from "../src/lib/seo/redirects";

describe("normalizeRedirectPath", () => {
  test("decodes percent-encoding (Thai) and applies NFC", () => {
    assert.equal(normalizeRedirectPath("/knowledge/%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A"), "/knowledge/ทดสอบ");
  });
  test("strips trailing slashes but keeps the root", () => {
    assert.equal(normalizeRedirectPath("/old-page/"), "/old-page");
    assert.equal(normalizeRedirectPath("/"), "/");
  });
  test("malformed escapes are compared as-is", () => {
    assert.equal(normalizeRedirectPath("/bad%E0%B8"), "/bad%E0%B8");
  });
});

describe("parseRedirects", () => {
  test("keeps valid 301/410 rules and drops garbage", () => {
    const map = parseRedirects({
      data: [
        { from: "/a", to: "/b", status: 301 },
        { from: "/gone", to: null, status: 410 },
        { from: "/ext", to: "https://example.com/x", status: 301 },
        { from: "/self", to: "/self/", status: 301 },
        { from: "/proto", to: "//evil.example", status: 301 },
        { from: "/js", to: "javascript:alert(1)", status: 301 },
        { from: "/temp", to: "/b", status: 302 },
        { from: "no-slash", to: "/b", status: 301 },
        { from: "/nul", to: null, status: 301 },
      ],
    });
    assert.deepEqual([...map.keys()].sort(), ["/a", "/ext", "/gone"]);
    assert.deepEqual(map.get("/gone"), { from: "/gone", to: null, status: 410 });
  });
  test("throws on a body without data[] (caller fails open)", () => {
    assert.throws(() => parseRedirects({ error: { code: "x" } }));
  });
});

describe("lookupRedirect", () => {
  let fetchMock: ReturnType<typeof mock.fn>;
  let body: unknown;
  let status: number;

  beforeEach(() => {
    resetRedirectsForTests();
    process.env.API_URL = "http://api.test";
    body = { data: [{ from: "/knowledge/old", to: "/knowledge/new", status: 301 }] };
    status = 200;
    fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status }));
    mock.method(console, "warn", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
    delete process.env.API_URL;
  });

  test("loads once and answers from memory", async () => {
    assert.equal((await lookupRedirect("/knowledge/old"))?.to, "/knowledge/new");
    assert.equal(await lookupRedirect("/knowledge/other"), null);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  test("trailing slash and encoded paths match", async () => {
    body = { data: [{ from: "/knowledge/ทดสอบ", to: null, status: 410 }] };
    assert.equal((await lookupRedirect("/knowledge/%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A/"))?.status, 410);
  });

  test("invalidation makes the next lookup wait for a fresh map", async () => {
    await lookupRedirect("/x");
    body = { data: [{ from: "/knowledge/new", to: null, status: 410 }] };
    invalidateRedirects();
    assert.equal((await lookupRedirect("/knowledge/new"))?.status, 410);
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  test("after the TTL the stale map answers while it refreshes in the background", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    await lookupRedirect("/x");
    body = { data: [] };
    mock.timers.setTime(1_000_000 + TTL_MS + 1);
    assert.equal((await lookupRedirect("/knowledge/old"))?.to, "/knowledge/new"); // stale answer, no wait
    await new Promise((r) => setImmediate(r));
    assert.equal(await lookupRedirect("/knowledge/old"), null); // refreshed
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  test("API down -> no redirect, never throws", async () => {
    fetchMock.mock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    assert.equal(await lookupRedirect("/knowledge/old"), null);
  });

  test("API 500 keeps the last good map", async () => {
    await lookupRedirect("/x");
    status = 500;
    body = { error: { code: "internal" } };
    invalidateRedirects();
    assert.equal((await lookupRedirect("/knowledge/old"))?.to, "/knowledge/new");
  });

  test("API_URL unset -> no fetch, no redirect", async () => {
    delete process.env.API_URL;
    assert.equal(await lookupRedirect("/knowledge/old"), null);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
