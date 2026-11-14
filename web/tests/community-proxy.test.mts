/** Member API proxy helpers (src/lib/community/proxy.ts) + revalidate tag allowlist. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BODY_BYTES,
  isAllowedSetCookie,
  isOAuthPath,
  isPublicCacheable,
  rewriteSetCookie,
  safeCommunityPath,
  upstreamCookie,
} from "../src/lib/community/proxy";

describe("safeCommunityPath", () => {
  test("accepts the community API roots", () => {
    assert.equal(safeCommunityPath(["config"]), "config");
    assert.equal(safeCommunityPath(["posts", "branding-vs-marketing", "comments"]), "posts/branding-vs-marketing/comments");
    assert.equal(safeCommunityPath(["auth", "google", "callback"]), "auth/google/callback");
    assert.equal(safeCommunityPath(["uploads", "comment-image"]), "uploads/comment-image");
  });
  test("Thai slugs are allowed and percent-encoded upstream", () => {
    assert.equal(safeCommunityPath(["posts", "ทดสอบ", "stats"]), `posts/${encodeURIComponent("ทดสอบ")}/stats`);
  });
  test("rejects unknown roots (no reaching admin or other API areas)", () => {
    assert.equal(safeCommunityPath(["admin", "comments"]), null);
    assert.equal(safeCommunityPath(["..", "admin"]), null);
    assert.equal(safeCommunityPath([]), null);
    assert.equal(safeCommunityPath(undefined), null);
  });
  test("rejects traversal and unsafe segments", () => {
    assert.equal(safeCommunityPath(["posts", ".."]), null);
    assert.equal(safeCommunityPath(["posts", "."]), null);
    assert.equal(safeCommunityPath(["posts", "a/b"]), null);
    assert.equal(safeCommunityPath(["posts", "a?b"]), null);
    assert.equal(safeCommunityPath(["posts", "a b"]), null);
    assert.equal(safeCommunityPath(["posts", "%2e%2e"]), null);
    assert.equal(safeCommunityPath(["posts", "a", "b", "c", "d", "e", "f"]), null);
  });
});

describe("upstreamCookie (identity separation)", () => {
  const jar = [
    { name: "escoma_admin", value: "ADMIN" },
    { name: "escoma_member", value: "MEMBER" },
    { name: "escoma_oauth", value: "BIND" },
    { name: "_ga", value: "x" },
  ];
  test("forwards only escoma_member on normal routes", () => {
    assert.equal(upstreamCookie(jar, ["posts", "x", "comments"]), "escoma_member=MEMBER");
  });
  test("adds escoma_oauth on auth/google/* only", () => {
    assert.equal(upstreamCookie(jar, ["auth", "google", "callback"]), "escoma_member=MEMBER; escoma_oauth=BIND");
    assert.equal(upstreamCookie(jar, ["auth", "login"]), "escoma_member=MEMBER");
    assert.ok(isOAuthPath(["auth", "google", "start"]));
    assert.ok(!isOAuthPath(["auth", "me"]));
  });
  test("never forwards the admin cookie", () => {
    assert.equal(upstreamCookie([{ name: "escoma_admin", value: "ADMIN" }], ["auth", "me"]), null);
    for (const segs of [["auth", "google", "start"], ["account"], ["comments", "1", "like"]]) {
      assert.ok(!(upstreamCookie(jar, segs) ?? "").includes("escoma_admin"));
    }
  });
  test("drops values that could smuggle extra pairs, and duplicates", () => {
    assert.equal(upstreamCookie([{ name: "escoma_member", value: "a; escoma_admin=b" }], ["auth", "me"]), null);
    assert.equal(
      upstreamCookie(
        [
          { name: "escoma_member", value: "first" },
          { name: "escoma_member", value: "second" },
        ],
        ["auth", "me"],
      ),
      "escoma_member=first",
    );
  });
});

describe("Set-Cookie rewrite", () => {
  test("keeps Path (oauth cookie stays scoped) and every other attribute, drops Domain", () => {
    assert.equal(
      rewriteSetCookie("escoma_oauth=abc; Path=/api/community/auth/google; Domain=api.example.com; Max-Age=600; HttpOnly; SameSite=Lax"),
      "escoma_oauth=abc; Path=/api/community/auth/google; Max-Age=600; HttpOnly; SameSite=Lax",
    );
    assert.equal(
      rewriteSetCookie("escoma_member=; Path=/; domain=.example.com; Max-Age=0; HttpOnly; Secure; SameSite=Lax"),
      "escoma_member=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    );
  });
  test("only member cookies may pass", () => {
    assert.ok(isAllowedSetCookie("escoma_member=x; Path=/"));
    assert.ok(isAllowedSetCookie("escoma_oauth=x; Path=/api/community/auth/google"));
    assert.ok(!isAllowedSetCookie("escoma_admin=x; Path=/"));
    assert.ok(!isAllowedSetCookie("other=x"));
  });
});

describe("caching + limits", () => {
  test("only GET config and stats keep a public Cache-Control", () => {
    assert.ok(isPublicCacheable("GET", ["config"]));
    assert.ok(isPublicCacheable("GET", ["stats"]));
    assert.ok(!isPublicCacheable("POST", ["stats"]));
    assert.ok(!isPublicCacheable("GET", ["posts", "x", "stats"]));
    assert.ok(!isPublicCacheable("GET", ["auth", "me"]));
  });
  test("body cap fits a 5 MB image plus multipart overhead, under 6.5 MB", () => {
    assert.ok(MAX_BODY_BYTES > 6 * 1024 * 1024);
    assert.ok(MAX_BODY_BYTES < 6.5 * 1024 * 1024);
  });
});

describe("POST /api/revalidate tag allowlist", () => {
  test("accepts comments:<slug> and post-stats", async () => {
    process.env.REVALIDATE_SECRET = "s3cret";
    const { POST } = await import("../src/app/api/revalidate/route");
    const call = (tags: unknown) =>
      POST(
        new Request("http://x/api/revalidate", {
          method: "POST",
          headers: { "x-revalidate-secret": "s3cret" },
          body: JSON.stringify({ tags }),
        }),
      );
    // Validation runs before revalidateTag: invalid tags are rejected with 400.
    assert.equal((await call(["comments:"])).status, 400);
    assert.equal((await call(["comments:a b"])).status, 400);
    assert.equal((await call(["stats"])).status, 400);
    // Valid tags reach revalidateTag (which needs a Next request store outside
    // tests): anything but a 400 means the allowlist accepted them.
    for (const tags of [["comments:branding-vs-marketing"], ["post-stats"], ["comments:ทดสอบ", "posts"]]) {
      let status = 0;
      try {
        status = (await call(tags)).status;
      } catch {
        status = -1; // revalidateTag threw outside Next = validation passed
      }
      assert.notEqual(status, 400, `rejected ${tags.join(",")}`);
    }
  });
});
