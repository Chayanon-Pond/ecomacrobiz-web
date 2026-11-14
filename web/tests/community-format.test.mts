/** Thai relative time, compact numbers and initials avatars (src/lib/community/{time,format,avatar}.ts). */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fullThaiDateTime, relativeTimeTh, thaiShortDate } from "../src/lib/community/time";
import { compactNumber, fullNumber, statLabels } from "../src/lib/community/format";
import { AVATAR_COLORS, avatarColor, initials } from "../src/lib/community/avatar";

const NOW = Date.parse("2026-11-14T10:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTimeTh", () => {
  test("Facebook-style buckets", () => {
    assert.equal(relativeTimeTh(ago(0), NOW), "เมื่อสักครู่");
    assert.equal(relativeTimeTh(ago(59_000), NOW), "เมื่อสักครู่");
    assert.equal(relativeTimeTh(ago(MIN), NOW), "1 นาที");
    assert.equal(relativeTimeTh(ago(59 * MIN), NOW), "59 นาที");
    assert.equal(relativeTimeTh(ago(3 * HOUR), NOW), "3 ชม.");
    assert.equal(relativeTimeTh(ago(23 * HOUR + 59 * MIN), NOW), "23 ชม.");
    assert.equal(relativeTimeTh(ago(2 * DAY), NOW), "2 วัน");
    assert.equal(relativeTimeTh(ago(6 * DAY), NOW), "6 วัน");
    assert.equal(relativeTimeTh(ago(7 * DAY), NOW), "1 สัปดาห์");
    assert.equal(relativeTimeTh(ago(5 * 7 * DAY), NOW), "5 สัปดาห์");
  });
  test("after 8 weeks: Thai short date (Bangkok time, Buddhist year only when different)", () => {
    assert.equal(relativeTimeTh(ago(70 * DAY), NOW), "5 ก.ย.");
    assert.equal(thaiShortDate("2025-03-01T10:00:00Z", NOW), "1 มี.ค. 2568");
    // 2026-12-31 20:00 UTC is already 1 Jan 2027 (2570) in Bangkok.
    assert.equal(thaiShortDate("2026-12-31T20:00:00Z", "2027-02-01T00:00:00Z"), "1 ม.ค.");
  });
  test("future timestamps (clock skew) and garbage", () => {
    assert.equal(relativeTimeTh(new Date(NOW + 30_000).toISOString(), NOW), "เมื่อสักครู่");
    assert.equal(relativeTimeTh("not a date", NOW), "");
  });
  test("full tooltip timestamp", () => {
    assert.equal(fullThaiDateTime("2026-11-14T10:46:00Z"), "14 พฤศจิกายน 2569 เวลา 17:46 น.");
  });
});

describe("compactNumber", () => {
  test("Thai-friendly compact counts", () => {
    assert.equal(compactNumber(0), "0");
    assert.equal(compactNumber(999), "999");
    assert.equal(compactNumber(1000), "1K");
    assert.equal(compactNumber(1234), "1.2K");
    assert.equal(compactNumber(1299), "1.2K"); // floored, never rounds up
    assert.equal(compactNumber(9999), "9.9K");
    assert.equal(compactNumber(12_500), "12K");
    assert.equal(compactNumber(999_999), "999K");
    assert.equal(compactNumber(1_250_000), "1.2M");
    assert.equal(compactNumber(25_000_000), "25M");
  });
  test("negative / non-finite are zero", () => {
    assert.equal(compactNumber(-5), "0");
    assert.equal(compactNumber(Number.NaN), "0");
  });
  test("screen-reader labels use the full number", () => {
    assert.equal(fullNumber(1234567), "1,234,567");
    assert.equal(statLabels.views(120), "ยอดเข้าชม 120 ครั้ง");
    assert.equal(statLabels.comments(1234), "ความคิดเห็น 1,234 รายการ");
    assert.equal(statLabels.likes(3), "ถูกใจ 3 ครั้ง");
  });
});

describe("initials avatar", () => {
  test("Latin names: two initials; Thai: first consonant", () => {
    assert.equal(initials("Jane Doe"), "JD");
    assert.equal(initials("jane"), "J");
    assert.equal(initials("สมชาย ทดสอบ"), "ส");
    assert.equal(initials("เอกชัย"), "อ"); // leading vowel skipped
    assert.equal(initials("  "), "?");
    assert.equal(initials("ทดสอบ W2"), "ท"); // mixed Thai + Latin: one glyph
  });
  test("colour is deterministic and from the palette", () => {
    const c = avatarColor("9854d11d-97f5-4d9e-b8bf-45a1ed927b9a");
    assert.equal(c, avatarColor("9854d11d-97f5-4d9e-b8bf-45a1ed927b9a"));
    assert.ok((AVATAR_COLORS as readonly string[]).includes(c));
    const spread = new Set(Array.from({ length: 40 }, (_, i) => avatarColor(`member-${i}`)));
    assert.ok(spread.size >= 4, "ids should spread over the palette");
  });
});
