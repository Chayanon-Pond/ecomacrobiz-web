/** Member auth pure helpers: password rules/strength, validation, next paths, fragments. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD_MESSAGES,
  isPersonalPassword,
  passwordProblem,
  passwordRules,
  passwordStrength,
  runeCount,
} from "../src/lib/community/password";
import { cleanDisplayName, displayNameProblem, emailProblem, isValidEmail, normalizeEmail } from "../src/lib/community/validation";
import {
  currentNextPath,
  formatWait,
  googleStartUrl,
  oauthErrorMessage,
  parseFragment,
  pendingActionHref,
  readFragmentToken,
  readOAuthOutcome,
  safeNextPath,
} from "../src/components/community/auth/auth-urls";
import { describeUserAgent } from "../src/components/community/account/ua";

describe("password rules (mirror of the API)", () => {
  test("counts runes, not UTF-16 units", () => {
    assert.equal(runeCount("😀😀"), 2);
    assert.equal(runeCount("รหัสผ่าน"), 8);
  });
  test("length 10..128", () => {
    assert.equal(passwordProblem(""), PASSWORD_MESSAGES.required);
    assert.equal(passwordProblem("short9!"), PASSWORD_MESSAGES.tooShort);
    assert.equal(passwordProblem("😀".repeat(9)), PASSWORD_MESSAGES.tooShort);
    assert.equal(passwordProblem("a".repeat(129)), PASSWORD_MESSAGES.tooLong);
    assert.equal(passwordProblem("a".repeat(128)), null);
    assert.equal(passwordProblem("tenchars!!"), null);
  });
  test("not equal to e-mail / local part / display name, case-insensitive and trimmed", () => {
    const ctx = { email: " Somchai.Dee@Example.test ", displayName: "Somchai Superstar" };
    assert.equal(isPersonalPassword("somchai.dee@example.test", ctx), true);
    assert.equal(isPersonalPassword("SOMCHAI.DEE", ctx), true);
    assert.equal(isPersonalPassword(" somchai superstar ", ctx), true);
    assert.equal(isPersonalPassword("somchai.dee!", ctx), false);
    assert.equal(passwordProblem("Somchai.Dee", ctx), PASSWORD_MESSAGES.personal);
    assert.equal(passwordProblem("anything-long-enough", {}), null);
  });
  test("checklist", () => {
    const rules = passwordRules("abc", { email: "a@b.test" });
    assert.deepEqual(rules.map((r) => [r.id, r.ok]), [["length", false], ["personal", true]]);
    assert.equal(passwordRules("", {}).find((r) => r.id === "personal")!.ok, false);
  });
});

describe("password strength meter", () => {
  test("empty, weak, personal", () => {
    assert.deepEqual(passwordStrength(""), { score: 0, label: "" });
    assert.equal(passwordStrength("password123").score <= 1, true);
    assert.equal(passwordStrength("aaaaaaaaaaaa").score, 0);
    assert.equal(passwordStrength("1234567890").score, 0);
    assert.equal(passwordStrength("somchai.dee", { email: "somchai.dee@example.test" }).score, 0);
  });
  test("short passwords never rate above 1", () => {
    assert.equal(passwordStrength("Zq#8v!").score <= 1, true);
  });
  test("long mixed passwords rate high", () => {
    assert.equal(passwordStrength("correct horse battery staple 9").score >= 3, true);
    assert.equal(passwordStrength("T7#kq!Vm2@xLp9$w").score, 4);
    assert.equal(passwordStrength("ฉันชอบกินข้าวมันไก่ทุกวัน").score >= 3, true);
  });
  test("monotone in length for random-ish input", () => {
    const a = passwordStrength("Xk9#mQ2v").score;
    const b = passwordStrength("Xk9#mQ2vR7!pL4zW").score;
    assert.equal(b >= a, true);
  });
});

describe("display name + e-mail validation", () => {
  test("cleanDisplayName collapses whitespace and strips control/format chars", () => {
    assert.equal(cleanDisplayName("  สม​ชาย   ใจดี \n"), "สมชาย ใจดี");
    assert.equal(cleanDisplayName("a\u0007b"), "ab");
  });
  test("displayNameProblem", () => {
    assert.equal(displayNameProblem("   "), "กรุณากรอกชื่อที่แสดง");
    assert.match(displayNameProblem("a")!, /2-40/);
    assert.match(displayNameProblem("ก".repeat(41))!, /2-40/);
    assert.equal(displayNameProblem("ก".repeat(40)), null);
    assert.equal(displayNameProblem("--"), "ชื่อที่แสดงต้องมีตัวอักษรหรือตัวเลข");
    assert.equal(displayNameProblem("me@example.test"), "ชื่อที่แสดงห้ามมีอีเมลหรือลิงก์");
    assert.equal(displayNameProblem("see https://x.y"), "ชื่อที่แสดงห้ามมีอีเมลหรือลิงก์");
    assert.equal(displayNameProblem("WWW.spam"), "ชื่อที่แสดงห้ามมีอีเมลหรือลิงก์");
    assert.equal(displayNameProblem("Admin"), "ไม่สามารถใช้ชื่อนี้ได้");
    assert.equal(displayNameProblem("ผู้ใช้ที่ลบบัญชี"), "ไม่สามารถใช้ชื่อนี้ได้");
    assert.equal(displayNameProblem("สมชาย ใจดี"), null);
  });
  test("e-mail", () => {
    assert.equal(normalizeEmail("  A@B.Test "), "a@b.test");
    assert.equal(isValidEmail("user@example.test"), true);
    assert.equal(isValidEmail("user@localhost"), false);
    assert.equal(isValidEmail("user@.example.test"), false);
    assert.equal(isValidEmail("user@example..test"), false);
    assert.equal(isValidEmail("us er@example.test"), false);
    assert.equal(isValidEmail("a@b@c.test"), false);
    assert.equal(isValidEmail(`${"a".repeat(65)}@x.test`), false);
    assert.equal(emailProblem(""), "กรุณากรอกอีเมล");
    assert.equal(emailProblem("nope"), "รูปแบบอีเมลไม่ถูกต้อง");
    assert.equal(emailProblem("ok@example.test"), null);
  });
});

describe("next paths for the Google round-trip", () => {
  test("accepts same-origin paths and keeps the query", () => {
    assert.equal(safeNextPath("/knowledge/x?page=2"), "/knowledge/x?page=2");
    assert.equal(currentNextPath({ pathname: "/knowledge/abc", search: "?a=1" }), "/knowledge/abc?a=1");
  });
  test("rejects open redirects and junk", () => {
    for (const bad of ["//evil.test", "https://evil.test", "/\\evil.test", "javascript:alert(1)", "knowledge", "/a\nb", "", null, undefined, `/${"a".repeat(600)}`]) {
      assert.equal(safeNextPath(bad as string), "/", String(bad));
    }
    assert.equal(safeNextPath("//x", "/account"), "/account");
  });
  test("googleStartUrl encodes next and the consent flag", () => {
    assert.equal(googleStartUrl("/knowledge/a?b=1"), "/api/community/auth/google/start?next=%2Fknowledge%2Fa%3Fb%3D1&consent=1");
    assert.equal(googleStartUrl("/account?tab=connections", false), "/api/community/auth/google/start?next=%2Faccount%3Ftab%3Dconnections");
    assert.equal(googleStartUrl("//evil.test"), "/api/community/auth/google/start?next=%2F&consent=1");
  });
});

describe("fragments", () => {
  test("parseFragment", () => {
    assert.deepEqual(parseFragment("#token=abc&x=1"), { token: "abc", x: "1" });
    assert.deepEqual(parseFragment(""), {});
    assert.deepEqual(parseFragment("#"), {});
  });
  test("readFragmentToken only accepts base64url tokens", () => {
    const t = "Ab-_".repeat(10) + "x9";
    assert.equal(readFragmentToken(`#token=${t}`), t);
    assert.equal(readFragmentToken("#token=short"), null);
    assert.equal(readFragmentToken("#token=<script>alert(1)</script>xxxxxxxx"), null);
    assert.equal(readFragmentToken("#community=signed-in"), null);
  });
  test("readOAuthOutcome", () => {
    assert.deepEqual(readOAuthOutcome("#community=signed-in"), { kind: "signed-in" });
    assert.deepEqual(readOAuthOutcome("#community=link-required"), { kind: "link-required" });
    assert.deepEqual(readOAuthOutcome("#community=error-denied"), { kind: "error", code: "denied" });
    assert.deepEqual(readOAuthOutcome("#community=error-<b>"), { kind: "error", code: "internal" });
    assert.equal(readOAuthOutcome("#community=weird"), null);
    assert.equal(readOAuthOutcome("#section-2"), null);
  });
  test("oauthErrorMessage falls back to a generic message", () => {
    assert.match(oauthErrorMessage("denied"), /ยกเลิก/);
    assert.equal(oauthErrorMessage("nope"), oauthErrorMessage("internal"));
  });
});

describe("misc", () => {
  test("formatWait", () => {
    assert.equal(formatWait(0.2), "1 วินาที");
    assert.equal(formatWait(42), "42 วินาที");
    assert.equal(formatWait(600), "10 นาที");
  });
  test("pendingActionHref", () => {
    assert.equal(pendingActionHref({ kind: "like-post", slug: "abc-def" }), "/knowledge/abc-def");
    assert.equal(pendingActionHref({ kind: "comment", slug: "ทดสอบ", draft: "" }), `/knowledge/${encodeURIComponent("ทดสอบ")}`);
    assert.equal(pendingActionHref({ kind: "like-post", slug: "../../x" }), null);
    assert.equal(pendingActionHref({ kind: "none" }), null);
    assert.equal(pendingActionHref(null), null);
  });
  test("describeUserAgent", () => {
    assert.equal(
      describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"),
      "Chrome บน Windows",
    );
    assert.equal(
      describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"),
      "Safari บน iPhone",
    );
    assert.equal(describeUserAgent(""), "อุปกรณ์ที่ไม่รู้จัก");
  });
});
