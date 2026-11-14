/**
 * Admin community UI: the cosmetic RBAC mirror (src/lib/admin/permissions.ts)
 * must equal the Go matrix (api/internal/domain/rbac.go), every Go audit
 * action has a Thai label, and the pure moderation helpers behave.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  bulkSummary,
  COMMENT_FILTERS,
  commentActions,
  commentExcerpt,
  defaultCommentFilter,
  isCommentFilter,
  isEmailQuery,
  reportReasonLabel,
} from "../src/lib/admin/community";
import { AUDIT_ACTIONS, can, ROLE_PERMISSIONS, ROLES, type Permission, type Role } from "../src/lib/admin/permissions";
import { NAV_GROUPS } from "../src/components/admin/shell/nav";

const goFile = (rel: string) => readFileSync(fileURLToPath(new URL(`../../api/internal/domain/${rel}`, import.meta.url)), "utf8");

/** Parses the Go role -> permission map (consts, AllPermissions, RolePermissions). */
function goMatrix(): Record<string, string[]> {
  const src = goFile("rbac.go");
  const consts = new Map<string, string>();
  for (const m of src.matchAll(/^\s*(Perm\w+)\s+Permission\s*=\s*"([^"]+)"/gm)) consts.set(m[1], m[2]);
  const names = (list: string) =>
    list
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((n) => {
        const v = consts.get(n);
        assert.ok(v, `unknown Go permission constant ${n}`);
        return v;
      });
  const all = src.match(/var AllPermissions = \[\]Permission\{([^}]*)\}/);
  assert.ok(all, "AllPermissions not found in rbac.go");
  const allPerms = names(all[1]);
  const block = src.match(/var RolePermissions = map\[Role\]\[\]Permission\{([\s\S]*?)\n\}/);
  assert.ok(block, "RolePermissions not found in rbac.go");
  const out: Record<string, string[]> = {};
  for (const m of block[1].matchAll(/Role(\w+):\s*(AllPermissions|\{([^}]*)\})/g)) {
    out[m[1].toLowerCase()] = m[2] === "AllPermissions" ? allPerms : names(m[3]);
  }
  return out;
}

describe("RBAC mirror", () => {
  const go = goMatrix();

  test("same roles as Go", () => {
    assert.deepEqual(Object.keys(go).sort(), [...ROLES].sort());
  });

  test("every role has exactly the Go permissions", () => {
    for (const role of ROLES) {
      assert.deepEqual([...ROLE_PERMISSIONS[role]].sort(), [...go[role]].sort(), `role ${role}`);
    }
  });

  test("comments:moderate is owner + editor only", () => {
    const holders = ROLES.filter((r: Role) => can(ROLE_PERMISSIONS[r], "comments:moderate"));
    assert.deepEqual(holders, ["owner", "editor"]);
    assert.deepEqual(
      Object.entries(go)
        .filter(([, ps]) => ps.includes("comments:moderate"))
        .map(([r]) => r)
        .sort(),
      ["editor", "owner"],
    );
  });

  test("community nav items are gated by comments:moderate", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.href === "/admin/comments" || i.href === "/admin/members");
    assert.equal(items.length, 2);
    for (const i of items) assert.deepEqual(i.anyOf, ["comments:moderate" satisfies Permission]);
  });
});

describe("audit labels", () => {
  test("every Go audit action has a Thai label", () => {
    const actions = [...goFile("audit.go").matchAll(/^\s*Audit\w+\s*=\s*"([a-z_]+\.[a-z_]+)"/gm)].map((m) => m[1]);
    assert.ok(actions.includes("comment.approve") && actions.includes("member.hide_comments"));
    const missing = actions.filter((a) => !AUDIT_ACTIONS[a]);
    assert.deepEqual(missing, []);
  });
});

describe("moderation helpers", () => {
  test("filters", () => {
    assert.deepEqual(
      COMMENT_FILTERS.map((f) => f.value),
      ["pending", "reported", "published", "hidden", "deleted", "all"],
    );
    assert.equal(isCommentFilter("reported"), true);
    assert.equal(isCommentFilter("spam"), false);
    assert.equal(isCommentFilter(null), false);
  });

  test("default tab: the queue while it has items (or before counts arrive), else all", () => {
    assert.equal(defaultCommentFilter(null), "pending");
    assert.equal(defaultCommentFilter({ pending: 3, reported: 0 }), "pending");
    assert.equal(defaultCommentFilter({ pending: 0, reported: 5 }), "all");
  });

  test("e-mail search only when the query contains @", () => {
    assert.equal(isEmailQuery("somchai"), false);
    assert.equal(isEmailQuery("a@example.test"), true);
  });

  test("row actions per status", () => {
    assert.deepEqual(commentActions("pending"), { approve: true, hide: true, remove: true });
    assert.deepEqual(commentActions("published"), { approve: false, hide: true, remove: true });
    assert.deepEqual(commentActions("hidden"), { approve: true, hide: false, remove: true });
    assert.deepEqual(commentActions("deleted"), { approve: false, hide: false, remove: false });
  });

  test("bulk summary", () => {
    assert.equal(bulkSummary("approve", { succeeded: ["a", "b"], failed: [] }), "อนุมัติแล้ว 2 ความคิดเห็น");
    assert.equal(
      bulkSummary("delete", { succeeded: ["a"], failed: [{ id: "b", message: "x" }] }),
      "ลบแล้ว 1 ความคิดเห็น · ไม่สำเร็จ 1",
    );
  });

  test("excerpt collapses whitespace, clamps by code point, handles image-only", () => {
    assert.equal(commentExcerpt({ body: "  สวัสดี\n\nครับ  ", image: null }), "สวัสดี ครับ");
    assert.equal(commentExcerpt({ body: "😀".repeat(10), image: null }, 5), "😀😀😀😀…");
    assert.equal(commentExcerpt({ body: "", image: { url: "u", width: 1, height: 1 } }), "(รูปภาพ)");
    assert.equal(commentExcerpt({ body: "", image: null }), "(ไม่มีข้อความ)");
  });

  test("report reasons", () => {
    assert.equal(reportReasonLabel("spam"), "สแปม / โฆษณา");
    assert.equal(reportReasonLabel("something-new"), "something-new");
  });
});
