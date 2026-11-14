/** BlogPosting community additions (src/lib/seo/jsonld.tsx). */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Comment } from "../src/lib/community/types";
import { blogPostingJsonLd, commentPlainText, engagementJsonLd } from "../src/lib/seo/jsonld";

function c(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    post_slug: "p",
    parent_id: null,
    reply_to: null,
    author: { id: `m-${id}`, display_name: `สมาชิก ${id}`, avatar_url: null, role: "member" },
    body: "x",
    body_html: "x",
    image: null,
    status: "published",
    created_at: "2026-11-14T10:00:00Z",
    edited_at: null,
    like_count: 0,
    liked_by_me: false,
    reply_count: 0,
    replies: [],
    can_edit: false,
    can_delete: false,
    can_moderate: false,
    can_report: false,
    ...over,
  };
}

const base = {
  path: "/knowledge/p",
  title: "T",
  description: "D",
  image: { url: "/og.jpg", width: 1200, height: 630 },
  datePublished: "2026-11-01T00:00:00Z",
};

describe("commentPlainText", () => {
  test("strips the safe tags, keeps line breaks, decodes entities", () => {
    assert.equal(
      commentPlainText('ดี <strong>มาก</strong><br>ดู <a href="https://e.com" rel="ugc nofollow noopener" target="_blank">ลิงก์</a> &amp; &lt;b&gt; &quot;q&quot; &#39;s'),
      "ดี มาก\nดู ลิงก์ & <b> \"q\" 's",
    );
  });
});

describe("BlogPosting engagement", () => {
  test("no engagement -> no community keys (API unavailable)", () => {
    const ld = blogPostingJsonLd(base);
    assert.equal(ld.commentCount, undefined);
    assert.equal(ld.interactionStatistic, undefined);
    assert.equal(ld.comment, undefined);
  });

  test("real counts -> commentCount + Like/Comment/View InteractionCounters", () => {
    const ld = blogPostingJsonLd({
      ...base,
      engagement: { stats: { views: 120, likes: 5, comments: 3 }, commentCount: 3, comments: [] },
    });
    assert.equal(ld.commentCount, 3);
    assert.deepEqual(ld.interactionStatistic, [
      { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: 5 },
      { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: 3 },
      { "@type": "InteractionCounter", interactionType: "https://schema.org/ViewAction", userInteractionCount: 120 },
    ]);
  });

  test("without stats only commentCount from the comment list (no fake counters)", () => {
    const ld = engagementJsonLd({ stats: null, commentCount: 2, comments: [] }, "https://x/p");
    assert.equal(ld.commentCount, 2);
    assert.equal(ld.interactionStatistic, undefined);
  });

  test("comments: published only, deleted skipped, replies nested, plain text, author Person", () => {
    const ld = engagementJsonLd(
      {
        stats: { views: 1, likes: 0, comments: 2 },
        commentCount: 2,
        comments: [
          c("a", {
            body_html: "<strong>สวัสดี</strong>",
            like_count: 2,
            edited_at: "2026-11-14T11:00:00Z",
            replies: [c("r", { parent_id: "a", author: null, body_html: "ตอบ" })],
          }),
          c("d", { status: "deleted", body_html: "", replies: [c("r2", { parent_id: "d" })] }),
          c("p", { status: "pending" }),
        ],
      },
      "https://x/p",
    );
    const comments = ld.comment as Record<string, unknown>[];
    assert.equal(comments.length, 1);
    assert.deepEqual(comments[0], {
      "@type": "Comment",
      "@id": "https://x/p#comment-a",
      url: "https://x/p#comment-a",
      text: "สวัสดี",
      dateCreated: "2026-11-14T10:00:00.000Z",
      dateModified: "2026-11-14T11:00:00.000Z",
      author: { "@type": "Person", name: "สมาชิก a" },
      upvoteCount: 2,
      comment: [
        {
          "@type": "Comment",
          "@id": "https://x/p#comment-r",
          url: "https://x/p#comment-r",
          text: "ตอบ",
          dateCreated: "2026-11-14T10:00:00.000Z",
          author: { "@type": "Person", name: "ผู้ใช้ที่ลบบัญชี" },
        },
      ],
    });
  });
});
