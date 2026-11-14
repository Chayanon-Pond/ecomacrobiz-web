/** Comment island pure logic: mention chip, payloads, list operations, messages. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Comment } from "../src/lib/community/types";
import {
  buildCommentPayload,
  charCount,
  chipRemovedByKey,
  insertAtCaret,
  replyTargetFor,
} from "../src/components/community/comments/mention";
import {
  appendPage,
  appendReply,
  dropComment,
  findComment,
  hiddenReplyCount,
  mergeReplies,
  prependTopLevel,
  removeComment,
  replaceComment,
  setLike,
} from "../src/components/community/comments/tree";
import { commentErrorMessage, oauthMessage } from "../src/components/community/comments/messages";
import { CommunityError } from "../src/lib/community/client";
import { checkImageFile } from "../src/components/community/comments/upload";

function c(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    post_slug: "p",
    parent_id: null,
    reply_to: null,
    author: { id: `m-${id}`, display_name: `Name ${id}`, avatar_url: null, role: "member" },
    body: "b",
    body_html: "b",
    image: null,
    status: "published",
    created_at: "2026-11-14T00:00:00Z",
    edited_at: null,
    like_count: 0,
    liked_by_me: false,
    reply_count: 0,
    replies: [],
    can_edit: false,
    can_delete: false,
    can_moderate: false,
    can_report: true,
    ...over,
  };
}

describe("reply target + mention chip", () => {
  test("replying to a top-level comment: thread = itself, chip = its author", () => {
    const t = replyTargetFor(c("a"), "me");
    assert.deepEqual(t, { parentId: "a", chip: { id: "a", name: "Name a" } });
  });
  test("replying to a reply stays in the same thread (depth 2)", () => {
    const t = replyTargetFor(c("r", { parent_id: "a" }), "me");
    assert.equal(t.parentId, "a");
    assert.deepEqual(t.chip, { id: "r", name: "Name r" });
  });
  test("no chip for own comments, deleted comments or deleted accounts", () => {
    assert.equal(replyTargetFor(c("a"), "m-a").chip, null);
    assert.equal(replyTargetFor(c("a", { status: "deleted" }), "me").chip, null);
    assert.equal(replyTargetFor(c("a", { author: null }), "me").chip, null);
  });
  test("Backspace at the very start removes the chip as one token", () => {
    assert.ok(chipRemovedByKey("Backspace", 0, 0, true));
    assert.ok(!chipRemovedByKey("Backspace", 1, 1, true));
    assert.ok(!chipRemovedByKey("Backspace", 0, 3, true)); // a selection deletes text, not the chip
    assert.ok(!chipRemovedByKey("Delete", 0, 0, true));
    assert.ok(!chipRemovedByKey("Backspace", 0, 0, false));
  });
  test("payload: removed chip -> reply_to_id null; top level has no thread fields", () => {
    const target = { parentId: "a", chip: { id: "r", name: "N" } };
    assert.deepEqual(
      buildCommentPayload({ body: "  hi ", target, chip: target.chip, imageId: "img", honeypot: "", elapsedMs: 3210.4 }),
      { body: "hi", website: "", elapsed_ms: 3210, parent_id: "a", reply_to_id: "r", image_id: "img" },
    );
    assert.equal(buildCommentPayload({ body: "x", target, chip: null, imageId: null, honeypot: "", elapsedMs: 1 }).reply_to_id, null);
    const top = buildCommentPayload({ body: "x", target: null, chip: null, imageId: null, honeypot: "bot", elapsedMs: 1 });
    assert.deepEqual(top, { body: "x", website: "bot", elapsed_ms: 1 });
  });
  test("emoji insertion at the caret and rune counting", () => {
    assert.deepEqual(insertAtCaret("ab", "😀", 1, 1), { value: "a😀b", caret: 3 });
    assert.deepEqual(insertAtCaret("abc", "!", 0, 3), { value: "!", caret: 1 });
    assert.deepEqual(insertAtCaret("ab", "!", null, null), { value: "ab!", caret: 3 });
    assert.equal(charCount(" 😀ก "), 2);
  });
});

describe("comment list operations", () => {
  const thread = () => [c("a", { reply_count: 3, replies: [c("r1", { parent_id: "a" }), c("r2", { parent_id: "a" })] }), c("b")];

  test("find / like at any depth", () => {
    assert.equal(findComment(thread(), "r2")?.id, "r2");
    const liked = setLike(thread(), "r1", true, 4);
    assert.equal(findComment(liked, "r1")?.like_count, 4);
    assert.equal(findComment(liked, "r1")?.liked_by_me, true);
  });
  test("optimistic insert + replace keeps loaded replies", () => {
    let list = prependTopLevel(thread(), c("tmp-1"));
    assert.equal(list[0].id, "tmp-1");
    list = replaceComment(list, "tmp-1", c("real"));
    assert.equal(list[0].id, "real");
    list = appendReply(list, "a", c("tmp-2", { parent_id: "a" }));
    assert.equal(findComment(list, "a")?.reply_count, 4);
    assert.deepEqual(findComment(list, "a")?.replies.map((r) => r.id), ["r1", "r2", "tmp-2"]);
    list = dropComment(list, "tmp-2");
    assert.equal(findComment(list, "a")?.reply_count, 3);
    // Replacing a top-level comment by a server copy without replies keeps the loaded ones.
    list = replaceComment(list, "a", c("a", { body: "edited" }));
    assert.equal(findComment(list, "a")?.replies.length, 2);
  });
  test("delete: thread with replies becomes a placeholder, others disappear", () => {
    let list = removeComment(thread(), "a");
    assert.equal(list[0].status, "deleted");
    assert.equal(list[0].body_html, "");
    list = removeComment(list, "b");
    assert.equal(findComment(list, "b"), null);
    list = removeComment(list, "r1");
    assert.equal(findComment(list, "a")?.reply_count, 2);
    // Last visible replies gone -> the placeholder goes too.
    list = removeComment(removeComment(list, "r2"), "x");
    assert.equal(findComment(list, "a")?.status, "deleted");
    const lone = removeComment([c("a", { status: "deleted", replies: [c("r", { parent_id: "a" })], reply_count: 1 })], "r");
    assert.equal(lone.length, 0);
  });
  test("pagination and replies merging dedupe", () => {
    assert.deepEqual(appendPage([c("a"), c("b")], [c("b"), c("c")]).map((x) => x.id), ["a", "b", "c"]);
    const merged = mergeReplies(thread(), "a", [c("r1"), c("r2"), c("r3")], true);
    assert.deepEqual(findComment(merged, "a")?.replies.map((r) => r.id), ["r1", "r2", "r3"]);
    assert.equal(hiddenReplyCount(findComment(thread(), "a")!), 1);
  });
});

describe("messages", () => {
  test("OAuth outcomes", () => {
    assert.equal(oauthMessage("signed-in"), null);
    assert.match(oauthMessage("error-denied")!, /ยกเลิก/);
    assert.match(oauthMessage("error-consent")!, /ยอมรับเงื่อนไข/);
    assert.match(oauthMessage("error-whatever")!, /ไม่สำเร็จ/);
  });
  test("comment errors: field message, rate limit, verification, ban", () => {
    assert.equal(
      commentErrorMessage(new CommunityError(422, "validation_failed", "x", { body: "ใส่ลิงก์ได้ไม่เกิน 2 ลิงก์" })),
      "ใส่ลิงก์ได้ไม่เกิน 2 ลิงก์",
    );
    assert.match(commentErrorMessage(new CommunityError(429, "rate_limited", "x", {}, 42)), /42 วินาที/);
    assert.match(commentErrorMessage(new CommunityError(403, "email_unverified", "x")), /ยืนยันอีเมล/);
    assert.match(commentErrorMessage(new CommunityError(403, "member_banned", "x")), /ระงับ/);
    assert.match(commentErrorMessage(new TypeError("fetch failed")), /การเชื่อมต่อ/);
  });
  test("image checks", () => {
    assert.equal(checkImageFile({ type: "image/png", size: 1000 }, 5), null);
    assert.match(checkImageFile({ type: "image/gif", size: 1000 }, 5)!, /JPG/);
    assert.match(checkImageFile({ type: "image/jpeg", size: 6 * 1024 * 1024 }, 5)!, /5 MB/);
  });
});
