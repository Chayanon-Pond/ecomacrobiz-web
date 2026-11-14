"use client";

/**
 * Live comments island (lazy chunk). Renders the same markup as the static
 * server version (CommentsFrame + CommentView) with the member's live data,
 * and handles likes, replies (mention chip), edit, delete, report, moderation,
 * sorting, pagination and the sign-in flow (openAuth + replay, including the
 * Google round-trip `#community=…`).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CommunityError, communityEnvelope, communityJson } from "@/lib/community/client";
import {
  getServerSnapshot,
  getSnapshot,
  loadSession,
  subscribe,
  takePendingAction,
} from "@/lib/community/session";
import type {
  Comment,
  CommentSort,
  CommentsMeta,
  LikeState,
  Me,
  PendingAction,
  RepliesPage,
  ReportReason,
} from "@/lib/community/types";
import { openAuth, type AuthReason } from "@/components/community/auth/open-auth";
import { takeIntent, takeOAuthOutcome, type Intent } from "../engagement/loader";
import { bootData, fetchComments } from "../engagement/runtime";
import { bumpCommentCount, getStatsState, likePost, setCommentCount, subscribeStats } from "../engagement/stats-store";
import { CommentView, commentDomId } from "./CommentView";
import { CommentsFrame, GuidelinesNote, SignInComposer, moreButtonClass } from "./CommentsFrame";
import { RepliesToggle } from "./CommentsStatic";
import { CommentMenu, type MenuItem } from "./CommentMenu";
import { Composer, type ComposerSubmit } from "./Composer";
import { ConfirmDeleteDialog, ReportDialog } from "./Dialogs";
import { actionErrorMessage, oauthMessage } from "./messages";
import { buildCommentPayload, replyTargetFor, type MentionChip, type ReplyTarget } from "./mention";
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
  updateComment,
} from "./tree";

const REPLIES_PER_PAGE = 50;
const TOP_COMPOSER_ID = "comment-composer";

type Thread = { collapsed?: boolean; loading?: boolean; page?: number; loaded?: boolean };
type Replying = { target: ReplyTarget; draft: string; key: number };
type DialogState = { kind: "delete" | "report"; id: string } | null;

let tmpSeq = 0;

/** The member right now (the session store is updated by the auth modal). */
function currentMe(): Me | null {
  const s = getSnapshot();
  return s.status === "member" ? s.me : null;
}

function optimisticComment(slug: string, me: Me, body: string, target: ReplyTarget | null, chip: MentionChip | null, image: ComposerSubmit["image"]): Comment {
  return {
    id: `tmp-${Date.now()}-${++tmpSeq}`,
    post_slug: slug,
    parent_id: target?.parentId ?? null,
    reply_to: chip ? { id: chip.id, display_name: chip.name } : null,
    author: { id: me.id, display_name: me.display_name, avatar_url: me.avatar_url, role: me.role === "banned" ? "member" : me.role },
    body,
    // Escaped plain text until the server's rendered HTML arrives.
    body_html: body
      .trim()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>"),
    image: image ? { url: image.url, width: image.width, height: image.height } : null,
    status: "published",
    created_at: new Date().toISOString(),
    edited_at: null,
    like_count: 0,
    liked_by_me: false,
    reply_count: 0,
    replies: [],
    can_edit: false,
    can_delete: false,
    can_moderate: false,
    can_report: false,
  };
}

export function CommentsApp({ slug }: { slug: string }) {
  const boot = bootData(slug)!;
  const config = boot.config;
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const me = session.status === "member" ? session.me : null;

  const [comments, setComments] = useState<Comment[]>(boot.comments.data);
  const [meta, setMeta] = useState<CommentsMeta>(boot.comments.meta);
  const [sort, setSort] = useState<CommentSort>("newest");
  const [page, setPage] = useState(1);
  const [listBusy, setListBusy] = useState<null | "sort" | "more">(null);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [replying, setReplying] = useState<Replying | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [topDraft, setTopDraft] = useState<{ text: string; key: number } | null>(null);
  const [flash, setFlash] = useState<Set<string>>(() => new Set());
  const [sending, setSending] = useState<Set<string>>(() => new Set());
  const [likeBusy, setLikeBusy] = useState<Set<string>>(() => new Set());
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const wantFocusTop = useRef(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  const statsSnap = useCallback(() => getStatsState(slug), [slug]);
  const stats = useSyncExternalStore(subscribeStats, statsSnap, statsSnap);
  const count = stats?.stats.comments ?? meta.comment_count;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  /** Focuses the top composer once it exists (it appears after sign-in). */
  const focusTopComposer = useCallback(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById(TOP_COMPOSER_ID);
      if (!el) return;
      wantFocusTop.current = false;
      el.focus();
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, []);

  const requestTopFocus = useCallback(() => {
    wantFocusTop.current = true;
    focusTopComposer();
  }, [focusTopComposer]);

  const announce = useCallback((text: string) => {
    setStatus("");
    requestAnimationFrame(() => setStatus(text));
  }, []);

  const markFlash = useCallback((id: string) => {
    setFlash((s) => new Set(s).add(id));
    window.setTimeout(
      () =>
        setFlash((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        }),
      2600,
    );
  }, []);

  const focusIn = useCallback((selector: string) => {
    requestAnimationFrame(() => sectionRef.current?.querySelector<HTMLElement>(selector)?.focus());
  }, []);

  /** Returns the member, opening the sign-in modal when needed. */
  const requireMember = useCallback(
    async (reason: AuthReason, pending: PendingAction): Promise<Me | null> => {
      if (currentMe()) return currentMe();
      const s = await loadSession();
      if (s.status === "member") return s.me;
      try {
        return await openAuth({ reason, pending, returnFocus: document.activeElement as HTMLElement | null });
      } catch {
        setNotice({ tone: "error", text: "เปิดหน้าต่างเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
        return null;
      }
    },
    [],
  );

  /** After a sign-in the list is refetched so can_* / liked_by_me / own pending are right. */
  const refreshList = useCallback(
    async (s: CommentSort = sort) => {
      try {
        const res = await fetchComments(slug, s, 1);
        setComments(res.data);
        setMeta(res.meta);
        setPage(1);
        setThreads({});
        setCommentCount(slug, res.meta.comment_count);
      } catch {
        /* keep what we have */
      }
    },
    [slug, sort],
  );

  // Sign-in/out started elsewhere (post like button, another tab's modal):
  // refetch so can_* / liked_by_me / own pending match the new viewer.
  const viewerId = me?.id ?? null;
  const lastViewer = useRef(viewerId);
  useEffect(() => {
    if (lastViewer.current === viewerId) return;
    lastViewer.current = viewerId;
    void refreshList();
  }, [viewerId, refreshList]);

  const ensureSignedIn = useCallback(
    async (reason: AuthReason, pending: PendingAction): Promise<Me | null> => {
      const wasMember = !!currentMe();
      const m = await requireMember(reason, pending);
      if (m && !wasMember) await refreshList();
      return m;
    },
    [refreshList, requireMember],
  );

  /* ---------------- likes ---------------- */

  const likeComment = useCallback(
    async (id: string, want?: boolean) => {
      const m = await ensureSignedIn("like", { kind: "like-comment", slug, commentId: id });
      if (!m) return;
      const c = findComment(comments, id);
      if (!c || c.status !== "published") return;
      const liked = want ?? !c.liked_by_me;
      if (want !== undefined && c.liked_by_me === want) return;
      setLikeBusy((s) => new Set(s).add(id));
      setComments((list) => setLike(list, id, liked, c.like_count + (liked ? 1 : -1)));
      try {
        const res = await communityJson<LikeState>(`comments/${encodeURIComponent(id)}/like`, {
          method: liked ? "PUT" : "DELETE",
        });
        setComments((list) => setLike(list, id, res.liked, res.likes));
      } catch (err) {
        setComments((list) => setLike(list, id, c.liked_by_me, c.like_count));
        setNotice({ tone: "error", text: actionErrorMessage(err) });
        if (err instanceof CommunityError && err.status === 401) void loadSession(true);
      } finally {
        setLikeBusy((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }
    },
    [comments, ensureSignedIn, slug],
  );

  /* ---------------- reply ---------------- */

  const startReply = useCallback(
    async (id: string, draft = "", replyToId?: string | null) => {
      const c0 = findComment(comments, id);
      if (!c0) return;
      const m = await ensureSignedIn("reply", {
        kind: "reply",
        slug,
        parentId: c0.parent_id ?? c0.id,
        replyToId: c0.id,
        draft,
      });
      if (!m) return;
      const target = replyTargetFor(c0, m.id);
      if (replyToId === null) target.chip = null;
      setThreads((t) => ({ ...t, [target.parentId]: { ...t[target.parentId], collapsed: false } }));
      setEditingId(null);
      setReplying({ target, draft, key: Date.now() });
    },
    [comments, ensureSignedIn, slug],
  );

  /* ---------------- create ---------------- */

  const submitComment = useCallback(
    async (v: ComposerSubmit, target: ReplyTarget | null) => {
      const m = currentMe();
      if (!m) {
        throw new CommunityError(401, "unauthorized", "กรุณาเข้าสู่ระบบ");
      }
      const temp = optimisticComment(slug, m, v.body, target, v.chip, v.image);
      setSending((s) => new Set(s).add(temp.id));
      setComments((list) => (target ? appendReply(list, target.parentId, temp) : prependTopLevel(list, temp)));
      announce("กำลังส่งความคิดเห็น…");
      try {
        const created = await communityJson<Comment>(`posts/${encodeURIComponent(slug)}/comments`, {
          method: "POST",
          json: buildCommentPayload({
            body: v.body,
            target,
            chip: v.chip,
            imageId: v.image?.id ?? null,
            honeypot: v.honeypot,
            elapsedMs: v.elapsedMs,
          }),
        });
        setComments((list) => replaceComment(list, temp.id, created));
        markFlash(created.id);
        if (created.status === "published") {
          bumpCommentCount(slug, 1);
          announce(target ? "ส่งคำตอบแล้ว" : "ส่งความคิดเห็นแล้ว");
        } else {
          announce("ส่งแล้ว ความคิดเห็นของคุณรอการอนุมัติจากทีมงาน");
        }
        if (target) setReplying(null);
        if (target) focusIn(`#${CSS.escape(commentDomId(created.id))} [data-engage="reply"], #${CSS.escape(commentDomId(created.id))} [data-engage="menu"]`);
      } catch (err) {
        setComments((list) => dropComment(list, temp.id));
        // Session expired/revoked elsewhere: keep the composer + draft and ask to sign in again.
        if (err instanceof CommunityError && err.status === 401) {
          void openAuth({ reason: target ? "reply" : "comment" }).catch(() => {});
        }
        announce("ส่งความคิดเห็นไม่สำเร็จ");
        throw err;
      } finally {
        setSending((s) => {
          const n = new Set(s);
          n.delete(temp.id);
          return n;
        });
      }
    },
    [announce, focusIn, markFlash, slug],
  );

  /* ---------------- edit / delete / report / moderate ---------------- */

  const submitEdit = useCallback(
    async (id: string, v: ComposerSubmit) => {
      const updated = await communityJson<Comment>(`comments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        json: { body: v.body.trim() },
      });
      setComments((list) => replaceComment(list, id, updated));
      setEditingId(null);
      markFlash(id);
      announce("บันทึกการแก้ไขแล้ว");
      focusIn(`#${CSS.escape(commentDomId(id))} [data-engage="menu"]`);
    },
    [announce, focusIn, markFlash],
  );

  const doDelete = useCallback(
    async (id: string) => {
      const c = findComment(comments, id);
      try {
        await communityJson<null>(`comments/${encodeURIComponent(id)}`, { method: "DELETE" });
        setComments((list) => removeComment(list, id));
        if (c?.status === "published") bumpCommentCount(slug, -1);
        setDialog(null);
        announce("ลบความคิดเห็นแล้ว");
        focusIn("#comments-title");
      } catch (err) {
        setDialog(null);
        setNotice({ tone: "error", text: actionErrorMessage(err) });
      }
    },
    [announce, comments, focusIn, slug],
  );

  const doReport = useCallback(async (id: string, reason: ReportReason, note: string) => {
    try {
      await communityJson<null>(`comments/${encodeURIComponent(id)}/report`, {
        method: "POST",
        json: note ? { reason, note } : { reason },
      });
    } catch (err) {
      throw new Error(actionErrorMessage(err));
    }
  }, []);

  const moderate = useCallback(
    async (id: string, action: "approve" | "hide") => {
      const before = findComment(comments, id);
      try {
        const updated = await communityJson<Comment>(`comments/${encodeURIComponent(id)}/moderate`, {
          method: "POST",
          json: { action },
        });
        setComments((list) => replaceComment(list, id, updated));
        if (before?.status !== "published" && updated.status === "published") bumpCommentCount(slug, 1);
        if (before?.status === "published" && updated.status !== "published") bumpCommentCount(slug, -1);
        announce(action === "approve" ? "อนุมัติความคิดเห็นแล้ว" : "ซ่อนความคิดเห็นแล้ว");
      } catch (err) {
        setNotice({ tone: "error", text: actionErrorMessage(err) });
      }
    },
    [announce, comments, slug],
  );

  const openReport = useCallback(
    async (id: string) => {
      const m = await ensureSignedIn("report", { kind: "none" });
      if (!m) return;
      const c = findComment(comments, id);
      if (c && c.author?.id === m.id) {
        setNotice({ tone: "info", text: "ไม่สามารถรายงานความคิดเห็นของตัวเองได้" });
        return;
      }
      setDialog({ kind: "report", id });
    },
    [comments, ensureSignedIn],
  );

  /* ---------------- list: sort / more / replies ---------------- */

  const changeSort = useCallback(
    async (s: CommentSort) => {
      if (s === sort || listBusy) return;
      setListBusy("sort");
      try {
        const res = await fetchComments(slug, s, 1);
        setSort(s);
        setComments(res.data);
        setMeta(res.meta);
        setPage(1);
        setThreads({});
        announce(s === "top" ? "เรียงตามความนิยมแล้ว" : "เรียงตามล่าสุดแล้ว");
      } catch (err) {
        setNotice({ tone: "error", text: actionErrorMessage(err) });
      } finally {
        setListBusy(null);
      }
    },
    [announce, listBusy, slug, sort],
  );

  const loadMore = useCallback(async () => {
    if (listBusy || page >= meta.total_pages) return;
    setListBusy("more");
    try {
      const res = await fetchComments(slug, sort, page + 1);
      const firstNew = res.data[0]?.id;
      setComments((list) => appendPage(list, res.data));
      setMeta(res.meta);
      setPage(res.meta.page);
      announce(`โหลดความคิดเห็นเพิ่มอีก ${res.data.length} รายการ`);
      if (firstNew) focusIn(`#${CSS.escape(commentDomId(firstNew))} [data-engage]`);
    } catch (err) {
      setNotice({ tone: "error", text: actionErrorMessage(err) });
    } finally {
      setListBusy(null);
    }
  }, [announce, focusIn, listBusy, meta.total_pages, page, slug, sort]);

  const toggleReplies = useCallback(
    async (parentId: string) => {
      const c = findComment(comments, parentId);
      if (!c) return;
      const t = threads[parentId] ?? {};
      if (t.loading) return;
      if (t.collapsed) {
        setThreads((all) => ({ ...all, [parentId]: { ...t, collapsed: false } }));
        return;
      }
      if (hiddenReplyCount(c) === 0) {
        setThreads((all) => ({ ...all, [parentId]: { ...t, collapsed: true } }));
        if (replying?.target.parentId === parentId) setReplying(null);
        return;
      }
      const nextPage = t.loaded ? (t.page ?? 1) + 1 : 1;
      setThreads((all) => ({ ...all, [parentId]: { ...t, loading: true } }));
      try {
        const res = await communityEnvelope<RepliesPage>(`comments/${encodeURIComponent(parentId)}/replies`, {
          query: { page: nextPage, per_page: REPLIES_PER_PAGE },
        });
        setComments((list) => {
          const merged = mergeReplies(list, parentId, res.data, nextPage === 1);
          // Trust the server's total when it knows better (replies deleted meanwhile).
          return updateComment(merged, parentId, (p) =>
            res.meta.page >= res.meta.total_pages ? { ...p, reply_count: Math.max(p.replies.length, 0) } : p,
          );
        });
        setThreads((all) => ({ ...all, [parentId]: { loaded: true, page: nextPage, loading: false } }));
        announce(`แสดงการตอบกลับ ${res.data.length} รายการ`);
      } catch (err) {
        setThreads((all) => ({ ...all, [parentId]: { ...t, loading: false } }));
        setNotice({ tone: "error", text: actionErrorMessage(err) });
      }
    },
    [announce, comments, replying, threads],
  );

  /* ---------------- replay: intents + pending actions ---------------- */

  const replayPending = useCallback(
    async (action: PendingAction | null) => {
      if (!action || action.kind === "none" || action.slug !== slug) return;
      switch (action.kind) {
        case "like-post":
          await likePost(slug, true);
          return;
        case "like-comment":
          await likeComment(action.commentId, true);
          return;
        case "comment":
          setTopDraft({ text: action.draft, key: Date.now() });
          requestTopFocus();
          return;
        case "reply": {
          const known = action.replyToId && findComment(comments, action.replyToId);
          await startReply(known ? action.replyToId! : action.parentId, action.draft, known ? undefined : null);
          return;
        }
      }
    },
    [comments, likeComment, requestTopFocus, slug, startReply],
  );

  const runIntent = useCallback(
    async (intent: Intent) => {
      const id = intent.id ?? "";
      // Restore focus to the live twin of the clicked control (reply/menu move focus themselves).
      if (id && (intent.action === "like-comment" || intent.action === "replies")) {
        focusIn(`[data-engage="${intent.action}"][data-id="${CSS.escape(id)}"]`);
      }
      switch (intent.action) {
        case "like-comment":
          return likeComment(id);
        case "reply":
          return startReply(id);
        case "menu":
          setMenuOpenFor(id);
          return;
        case "replies":
          return toggleReplies(id);
        case "more":
          return loadMore();
        case "sort":
          return changeSort(intent.value === "top" ? "top" : "newest");
        case "compose": {
          const m = await ensureSignedIn("comment", { kind: "comment", slug, draft: "" });
          if (m) requestTopFocus();
          return;
        }
      }
    },
    [changeSort, ensureSignedIn, focusIn, likeComment, loadMore, requestTopFocus, slug, startReply, toggleReplies],
  );

  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (Date.now() - boot.at > 30_000) queueMicrotask(() => void refreshList("newest"));
    const outcome = takeOAuthOutcome();
    if (outcome) {
      history.replaceState(history.state, "", location.pathname + location.search);
      document.getElementById("comments")?.scrollIntoView({ block: "start" });
      if (outcome === "signed-in") {
        void loadSession(true).then(async () => {
          await refreshList("newest");
          await replayPending(takePendingAction());
        });
      } else {
        const msg = oauthMessage(outcome);
        if (msg) queueMicrotask(() => setNotice({ tone: "error", text: msg }));
      }
    }
    const intent = takeIntent("comments");
    if (intent) queueMicrotask(() => void runIntent(intent));
  }, [boot.at, refreshList, replayPending, runIntent]);

  useEffect(() => {
    if (me && wantFocusTop.current) focusTopComposer();
  }, [focusTopComposer, me]);

  /* ---------------- render ---------------- */

  const menuItems = useCallback(
    (c: Comment): MenuItem[] => {
      const items: MenuItem[] = [];
      if (c.id.startsWith("tmp-")) return items;
      if (me && c.can_edit && (c.status === "published" || c.status === "pending")) {
        items.push({
          key: "edit",
          label: "แก้ไข",
          onSelect: () => {
            setReplying(null);
            setEditingId(c.id);
          },
        });
      }
      if (me && c.can_delete) items.push({ key: "delete", label: "ลบ", danger: true, onSelect: () => setDialog({ kind: "delete", id: c.id }) });
      if (me && c.can_moderate) {
        if (c.status !== "published") items.push({ key: "approve", label: "อนุมัติ", onSelect: () => void moderate(c.id, "approve") });
        if (c.status !== "hidden") items.push({ key: "hide", label: "ซ่อน", onSelect: () => void moderate(c.id, "hide") });
      }
      const own = me && c.author?.id === me.id;
      if (!own && c.status === "published" && (!me || c.can_report)) {
        items.push({ key: "report", label: "รายงาน", onSelect: () => void openReport(c.id) });
      }
      return items;
    },
    [me, moderate, openReport],
  );

  const renderComment = (c: Comment, reply: boolean, childrenItems?: React.ReactNode, hasChildren = false) => {
    const name = c.author?.display_name ?? "ผู้ใช้ที่ลบบัญชี";
    const editing = editingId === c.id && me;
    return (
      <CommentView
        key={c.id}
        c={c}
        now={now}
        reply={reply}
        flash={flash.has(c.id)}
        sending={sending.has(c.id)}
        likeBusy={likeBusy.has(c.id)}
        onLike={() => void likeComment(c.id)}
        onReply={() => void startReply(c.id)}
        menu={
          <CommentMenu
            key={menuOpenFor === c.id ? "open" : "closed"}
            commentId={c.id}
            label={`ตัวเลือกสำหรับความคิดเห็นของ ${name}`}
            items={menuItems(c)}
            defaultOpen={menuOpenFor === c.id}
          />
        }
        editor={
          editing ? (
            <Composer
              me={me}
              config={config}
              mode="edit"
              initialBody={c.body}
              autoFocus
              onSubmit={(v) => submitEdit(c.id, v)}
              onCancel={() => {
                setEditingId(null);
                focusIn(`#${CSS.escape(commentDomId(c.id))} [data-engage="menu"]`);
              }}
            />
          ) : undefined
        }
        childrenItems={childrenItems}
        hasChildren={hasChildren}
      />
    );
  };

  const items = comments.map((c) => {
    const t = threads[c.id] ?? {};
    const replies = t.collapsed ? [] : (c.replies ?? []);
    const hidden = hiddenReplyCount(c);
    const showToggle = t.collapsed ? c.reply_count > 0 : hidden > 0 || (t.loaded && replies.length > 0);
    const composing = replying && replying.target.parentId === c.id && me;
    const hasChildren = replies.length > 0 || showToggle || !!composing;
    return renderComment(
      c,
      false,
      hasChildren ? (
        <>
          {replies.map((r) => renderComment(r, true))}
          {showToggle && (
            <RepliesToggle
              parentId={c.id}
              count={t.collapsed ? c.reply_count : hidden}
              expanded={!t.collapsed && hidden === 0}
              busy={!!t.loading}
              onClick={() => void toggleReplies(c.id)}
            />
          )}
          {composing && (
            <li key={replying.key}>
              <Composer
                me={me}
                config={config}
                mode="reply"
                initialChip={replying.target.chip}
                initialBody={replying.draft}
                autoFocus
                onSubmit={(v) => submitComment(v, replying.target)}
                onCancel={() => {
                  setReplying(null);
                  focusIn(`#${CSS.escape(commentDomId(c.id))} [data-engage="reply"]`);
                }}
              />
            </li>
          )}
        </>
      ) : null,
      hasChildren,
    );
  });

  const banned = me?.role === "banned";
  const needsVerify = !!me && !me.email_verified && config.require_verified_email;

  const renderTop = () => {
    if (!me) {
      return (
        <>
          <SignInComposer
            onClick={async () => {
              const m = await ensureSignedIn("comment", { kind: "comment", slug, draft: "" });
              if (m) requestTopFocus();
            }}
          />
          <GuidelinesNote />
        </>
      );
    }
    return (
      <>
        <p className="mb-3 text-sm text-subtle">
          เข้าสู่ระบบในชื่อ <strong className="font-semibold text-fg">{me.display_name}</strong>
          <span aria-hidden="true"> · </span>
          <a href="/account" className="text-accent-soft underline-offset-4 hover:underline">
            บัญชีของฉัน
          </a>
        </p>
        {banned ? (
          <p role="note" className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            บัญชีของคุณถูกระงับการแสดงความคิดเห็น หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อทีมงาน
          </p>
        ) : needsVerify ? (
          <p role="note" className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            กรุณายืนยันอีเมลก่อนแสดงความคิดเห็น — ตรวจสอบกล่องจดหมายของคุณ หรือส่งลิงก์ยืนยันอีกครั้งที่{" "}
            <a href="/account" className="font-semibold underline underline-offset-4">
              บัญชีของฉัน
            </a>
          </p>
        ) : (
          <>
            {!me.email_verified && (
              <p className="mb-3 text-xs text-subtle">
                <a href="/account" className="underline underline-offset-4 hover:text-fg">
                  ยืนยันอีเมลเพื่อความปลอดภัยของบัญชี
                </a>
              </p>
            )}
            <Composer
              key={topDraft?.key ?? "top"}
              me={me}
              config={config}
              mode="comment"
              initialBody={topDraft?.text ?? ""}
              textareaId={TOP_COMPOSER_ID}
              onSubmit={(v) => submitComment(v, null)}
            />
            <GuidelinesNote />
          </>
        )}
      </>
    );
  };

  return (
    <div ref={sectionRef}>
      <CommentsFrame
        live
        count={count}
        sort={sort}
        onSort={(s) => void changeSort(s)}
        sortDisabled={listBusy === "sort"}
        top={
          <>
            {notice && (
              <div
                role={notice.tone === "error" ? "alert" : "status"}
                className={`mb-4 flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
                  notice.tone === "error"
                    ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                    : "border-line bg-surface-2 text-muted"
                }`}
              >
                <span>{notice.text}</span>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  className="-my-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-white/5"
                  aria-label="ปิดข้อความ"
                >
                  ×
                </button>
              </div>
            )}
            {renderTop()}
          </>
        }
        empty={comments.length === 0}
        items={items}
        more={
          page < meta.total_pages ? (
            <button
              type="button"
              data-engage="more"
              onClick={() => void loadMore()}
              disabled={listBusy === "more"}
              aria-busy={listBusy === "more" || undefined}
              className={moreButtonClass}
            >
              {listBusy === "more" ? "กำลังโหลด…" : "ดูความคิดเห็นเพิ่มเติม"}
            </button>
          ) : undefined
        }
        status={status}
      />
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog onConfirm={() => doDelete(dialog.id)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "report" && (
        <ReportDialog onSubmit={(r, n) => doReport(dialog.id, r, n)} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
