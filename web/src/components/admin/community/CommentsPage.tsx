"use client";

/** /admin/comments — moderation queue and every community comment. Filters live in the URL. */
import {
  Check,
  CheckCircle2,
  ExternalLink,
  EyeOff,
  Flag,
  History,
  Image as ImageIcon,
  MessageSquare,
  MoreHorizontal,
  Reply,
  Search,
  ThumbsUp,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bulkSummary,
  COMMENT_FILTERS,
  commentActions,
  commentExcerpt,
  defaultCommentFilter,
  isCommentFilter,
  reportReasonLabel,
} from "@/lib/admin/community";
import { formatDateTime } from "@/lib/admin/format";
import { formatRelative } from "@/lib/admin/time";
import type {
  AdminComment,
  AdminCommentList,
  CommentBulkAction,
  CommentBulkResult,
  CommentCounts,
  CommentEdit,
  CommentFilter,
  ListResponse,
  PageMeta,
  PostSummary,
} from "@/lib/admin/types";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import {
  Alert,
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  ErrorState,
  Menu,
  NoAccess,
  PageHeader,
  Pagination,
  SearchBox,
  Select,
  Skeleton,
  Tabs,
  useToast,
  type MenuItem,
} from "../ui";
import { CommentStatusBadge, DELETED_AUTHOR, MemberAvatar, MemberRoleBadge } from "./shared";
import "../posts/posts.css";
import "./community.css";

const PER_PAGE = 20;

type Filters = { status: string; q: string; post: string; member: string; mname: string; page: number };

function useParamsState() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state: Filters = {
    status: sp.get("status") ?? "",
    q: sp.get("q") ?? "",
    post: sp.get("post") ?? "",
    member: sp.get("member") ?? "",
    mname: sp.get("mname") ?? "",
    page: Math.max(1, Number(sp.get("page")) || 1),
  };
  const set = useCallback(
    (patch: Partial<Filters>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === "" || (k === "page" && v === 1)) next.delete(k);
        else next.set(k, String(v));
      }
      if (!("page" in patch)) next.delete("page");
      const s = next.toString();
      router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
    },
    [sp, router, pathname],
  );
  return [state, set] as const;
}

function memberHref(c: AdminComment): string | null {
  if (!c.author) return null;
  const p = new URLSearchParams({ status: "all", member: c.author.id, mname: c.author.display_name });
  return `/admin/comments?${p}`;
}

export function CommentsPage() {
  const { request, can } = useAdmin();
  const toast = useToast();
  const allowed = can("comments:moderate");
  const [f, set] = useParamsState();
  // No ?status: show the queue while it has items, otherwise everything.
  const [queueEmpty, setQueueEmpty] = useState(false);
  const explicit = isCommentFilter(f.status);
  const status: CommentFilter = explicit ? (f.status as CommentFilter) : queueEmpty ? "all" : "pending";

  const [data, setData] = useState<{ key: string; rows: AdminComment[]; meta: PageMeta } | null>(null);
  const [counts, setCounts] = useState<CommentCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFailed, setBulkFailed] = useState<{ action: CommentBulkAction; result: CommentBulkResult; excerpts: Map<string, string> } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "one"; comment: AdminComment } | { kind: "bulk" } | null>(null);
  const [detail, setDetail] = useState<AdminComment | null>(null);

  useEffect(() => {
    if (!allowed || !can("posts:read")) return;
    const ctrl = new AbortController();
    request<ListResponse<PostSummary>>("posts", { query: { status: "published", sort: "title_asc", per_page: 50 }, signal: ctrl.signal })
      .then((r) => setPosts(r.data ?? []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [request, allowed, can]);

  const queryKey = JSON.stringify([status, f.q, f.post, f.member, f.page, reload]);
  const rows = data?.key === queryKey ? data.rows : null;
  const meta = data?.meta ?? null;

  useEffect(() => {
    if (!allowed) return;
    const ctrl = new AbortController();
    request<AdminCommentList>("comments", {
      query: { status, q: f.q, post: f.post, member_id: f.member, page: f.page, per_page: PER_PAGE },
      signal: ctrl.signal,
    })
      .then((r) => {
        setCounts(r.counts ?? null);
        if (!explicit && status !== defaultCommentFilter(r.counts ?? null)) {
          setQueueEmpty(true);
          return;
        }
        setData({ key: queryKey, rows: r.data ?? [], meta: r.meta });
        setError(null);
        setSelected(new Set());
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, allowed, queryKey, status, explicit, f.q, f.post, f.member, f.page]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const excerpts = useMemo(() => new Map((rows ?? []).map((c) => [c.id, commentExcerpt(c, 60)])), [rows]);
  const selectable = (rows ?? []).filter((c) => c.status !== "deleted");
  const allChecked = selectable.length > 0 && selectable.every((c) => selected.has(c.id));
  const filtered = f.q !== "" || f.post !== "" || f.member !== "";
  const postTitle = posts.find((p) => p.slug === f.post)?.title;

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function markBusy(id: string, on: boolean) {
    setBusyIds((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  async function moderate(c: AdminComment, to: "published" | "hidden") {
    markBusy(c.id, true);
    try {
      const r = await request<{ data: AdminComment }>(`comments/${encodeURIComponent(c.id)}`, { method: "PATCH", json: { status: to } });
      toast.success(to === "published" ? "อนุมัติความคิดเห็นแล้ว — แสดงบนเว็บไซต์" : "ซ่อนความคิดเห็นแล้ว");
      setDetail((d) => (d && d.id === c.id ? r.data : d));
      refresh();
    } catch (err) {
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "ดำเนินการไม่สำเร็จ");
    } finally {
      markBusy(c.id, false);
    }
  }

  async function removeOne(c: AdminComment) {
    markBusy(c.id, true);
    try {
      await request<void>(`comments/${encodeURIComponent(c.id)}`, { method: "DELETE" });
      toast.success("ลบความคิดเห็นแล้ว");
      setConfirm(null);
      setDetail((d) => (d && d.id === c.id ? null : d));
      refresh();
    } catch (err) {
      setConfirm(null);
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "ลบไม่สำเร็จ");
    } finally {
      markBusy(c.id, false);
    }
  }

  async function runBulk(action: CommentBulkAction) {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const r = await request<{ data: CommentBulkResult }>("comments/bulk", { method: "POST", json: { action, ids } });
      const result = r.data;
      if (result.failed.length === 0) {
        toast.success(bulkSummary(action, result));
        setBulkFailed(null);
      } else {
        toast.warning(bulkSummary(action, result));
        setBulkFailed({ action, result, excerpts });
      }
      setConfirm(null);
      refresh();
    } catch (err) {
      setConfirm(null);
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "ดำเนินการไม่สำเร็จ");
    } finally {
      setBulkBusy(false);
    }
  }

  const header = <PageHeader title="ความคิดเห็น" description="ตรวจ อนุมัติ หรือซ่อนความคิดเห็นจากสมาชิกในหน้า Knowledge" />;
  if (!allowed) {
    return (
      <>
        {header}
        <NoAccess />
      </>
    );
  }

  const rowProps = (c: AdminComment) => ({
    comment: c,
    busy: busyIds.has(c.id),
    onModerate: (to: "published" | "hidden") => moderate(c, to),
    onDelete: () => setConfirm({ kind: "one", comment: c }),
    onDetail: () => setDetail(c),
    onFilterPost: () => set({ post: c.post.slug }),
  });

  return (
    <>
      {header}

      <div className="pl-filters">
        <Tabs<CommentFilter>
          label="กรองตามสถานะ"
          idBase="comments"
          value={status}
          onChange={(v) => set({ status: v })}
          tabs={COMMENT_FILTERS.map((o) => ({
            value: o.value,
            label: (
              <>
                {o.label}
                {o.value === "pending" && counts && counts.pending > 0 ? (
                  <span className="cm-count" aria-label={`${counts.pending} รายการ`}>
                    {counts.pending.toLocaleString("th-TH")}
                  </span>
                ) : null}
                {o.value === "reported" && counts && counts.reported > 0 ? (
                  <span className="cm-count" data-tone="danger" aria-label={`${counts.reported} รายการ`}>
                    {counts.reported.toLocaleString("th-TH")}
                  </span>
                ) : null}
              </>
            ),
          }))}
        />
        <div className="pl-filter-row">
          <SearchBox value={f.q} onSearch={(q) => set({ q })} label="ค้นหาข้อความในความคิดเห็น…" />
          {posts.length > 0 || f.post ? (
            <div className="w-full sm:w-72">
              <Select inputSize="sm" aria-label="กรองตามบทความ" value={f.post} onChange={(e) => set({ post: e.target.value })}>
                <option value="">ทุกบทความ</option>
                {f.post && !postTitle ? <option value={f.post}>/knowledge/{f.post}</option> : null}
                {posts.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {f.member ? (
            <span className="cm-filter-chip">
              <UserRound size={14} aria-hidden="true" />
              <span>สมาชิก: {f.mname || "ที่เลือก"}</span>
              <button type="button" aria-label="ล้างตัวกรองสมาชิก" onClick={() => set({ member: "", mname: "" })}>
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          ) : null}
        </div>
      </div>

      {bulkFailed ? (
        <Alert
          tone="warning"
          className="mb-4"
          title={bulkSummary(bulkFailed.action, bulkFailed.result)}
          action={
            <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden="true" />} onClick={() => setBulkFailed(null)}>
              ปิด
            </Button>
          }
        >
          <ul className="mt-1 grid gap-0.5">
            {bulkFailed.result.failed.map((x) => (
              <li key={x.id}>
                <strong className="text-fg">{bulkFailed.excerpts.get(x.id) ?? x.id}</strong>: {x.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {selected.size > 0 ? (
        <div className="pl-bulk" role="region" aria-label="การดำเนินการกับรายการที่เลือก">
          <span className="text-sm font-medium">เลือก {selected.size} รายการ</span>
          <span className="flex-1" />
          <Button size="sm" icon={<Check size={14} aria-hidden="true" />} loading={bulkBusy} onClick={() => runBulk("approve")}>
            อนุมัติ
          </Button>
          <Button size="sm" icon={<EyeOff size={14} aria-hidden="true" />} disabled={bulkBusy} onClick={() => runBulk("hide")}>
            ซ่อน
          </Button>
          <Button size="sm" variant="danger" icon={<Trash2 size={14} aria-hidden="true" />} disabled={bulkBusy} onClick={() => setConfirm({ kind: "bulk" })}>
            ลบ
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            ล้าง
          </Button>
        </div>
      ) : null}

      <div role="tabpanel" id={`comments-panel-${status}`} aria-labelledby={`comments-tab-${status}`}>
        {error ? (
          <div className="adm-card">
            <ErrorState message={error} onRetry={refresh} />
          </div>
        ) : rows === null ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <div className="adm-card">
            {filtered ? (
              <EmptyState
                icon={<Search size={22} />}
                title="ไม่พบความคิดเห็นที่ตรงกับตัวกรอง"
                description="ลองเปลี่ยนคำค้น บทความ หรือสมาชิก"
                action={
                  <Button size="sm" onClick={() => set({ q: "", post: "", member: "", mname: "" })}>
                    ล้างตัวกรอง
                  </Button>
                }
              />
            ) : status === "pending" ? (
              <EmptyState icon={<CheckCircle2 size={22} />} title="ไม่มีความคิดเห็นรอตรวจ" description="ความคิดเห็นใหม่ที่ต้องอนุมัติจะแสดงที่นี่" />
            ) : status === "reported" ? (
              <EmptyState icon={<Flag size={22} />} title="ไม่มีความคิดเห็นที่ถูกรายงาน" />
            ) : (
              <EmptyState icon={<MessageSquare size={22} />} title="ยังไม่มีความคิดเห็นในหมวดนี้" />
            )}
          </div>
        ) : (
          <>
            {/* table (md+) */}
            <div className="adm-table-wrap pl-table">
              <table className="adm-table">
                <caption className="adm-sr-only">รายการความคิดเห็น</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-10">
                      <input
                        type="checkbox"
                        className="pl-check"
                        aria-label="เลือกทั้งหมดในหน้านี้"
                        checked={allChecked}
                        disabled={selectable.length === 0}
                        onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((c) => c.id)) : new Set())}
                      />
                    </th>
                    <th scope="col">ความคิดเห็น</th>
                    <th scope="col">สถานะ</th>
                    <th scope="col" className="adm-num">
                      ถูกใจ
                    </th>
                    <th scope="col">
                      <span className="adm-sr-only">การทำงาน</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} data-selected={selected.has(c.id) || undefined}>
                      <td className="align-top">
                        <RowCheck comment={c} checked={selected.has(c.id)} onChange={(on) => toggle(c.id, on)} />
                      </td>
                      <td className="min-w-[22rem] align-top">
                        <CommentContent comment={c} />
                      </td>
                      <td className="align-top">
                        <StatusCell comment={c} onReports={() => setDetail(c)} />
                      </td>
                      <td className="adm-num align-top text-sm tabular-nums">{c.like_count.toLocaleString("th-TH")}</td>
                      <td className="align-top">
                        <RowActions {...rowProps(c)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* cards (< md) */}
            <ul className="pl-cards" aria-label="รายการความคิดเห็น">
              {rows.map((c) => (
                <li key={c.id} className="pl-card" data-selected={selected.has(c.id) || undefined}>
                  <RowCheck comment={c} checked={selected.has(c.id)} onChange={(on) => toggle(c.id, on)} />
                  <div className="min-w-0 flex-1">
                    <CommentContent comment={c} />
                    <div className="cm-card-row">
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusCell comment={c} onReports={() => setDetail(c)} />
                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                          <ThumbsUp size={12} aria-hidden="true" />
                          {c.like_count.toLocaleString("th-TH")}
                          <span className="adm-sr-only">ถูกใจ</span>
                        </span>
                      </span>
                      <RowActions {...rowProps(c)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <Pagination meta={meta} onPage={(p) => set({ page: p })} label="เปลี่ยนหน้ารายการความคิดเห็น" />

      <CommentDrawer
        comment={detail}
        busy={detail ? busyIds.has(detail.id) : false}
        onClose={() => setDetail(null)}
        onModerate={(to) => detail && moderate(detail, to)}
        onDelete={() => detail && setConfirm({ kind: "one", comment: detail })}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "bulk" ? `ลบความคิดเห็น ${selected.size} รายการ?` : "ลบความคิดเห็นนี้?"}
        danger
        busy={confirm?.kind === "bulk" ? bulkBusy : confirm ? busyIds.has(confirm.comment.id) : false}
        confirmLabel={confirm?.kind === "bulk" ? `ลบ ${selected.size} รายการ` : "ลบความคิดเห็น"}
        message={
          confirm?.kind === "one" ? (
            <div className="grid gap-2">
              <p className="cm-quote">“{commentExcerpt(confirm.comment, 140)}”</p>
              <p>ข้อความและรูปภาพจะถูกลบถาวร ถ้ามีคนตอบกลับไว้ จะเหลือเพียงข้อความ “ความคิดเห็นนี้ถูกลบ” — ถ้าต้องการซ่อนชั่วคราว ให้ใช้ “ซ่อน” แทน</p>
            </div>
          ) : (
            <p>ข้อความและรูปภาพของความคิดเห็นที่เลือกจะถูกลบถาวร การกระทำนี้ย้อนกลับไม่ได้</p>
          )
        }
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "bulk") void runBulk("delete");
          else if (confirm?.kind === "one") void removeOne(confirm.comment);
        }}
      />
    </>
  );
}

function RowCheck({ comment: c, checked, onChange }: { comment: AdminComment; checked: boolean; onChange: (on: boolean) => void }) {
  if (c.status === "deleted") return <span className="inline-block w-4" aria-hidden="true" />;
  return (
    <input
      type="checkbox"
      className="pl-check"
      aria-label={`เลือกความคิดเห็นของ ${c.author?.display_name ?? DELETED_AUTHOR}`}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function CommentContent({ comment: c }: { comment: AdminComment }) {
  const name = c.author?.display_name ?? DELETED_AUTHOR;
  const href = memberHref(c);
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <MemberAvatar id={c.author?.id ?? c.id} name={c.author ? name : "?"} size="sm" />
        {href ? (
          <Link href={href} className="pl-title truncate text-sm" title="ดูความคิดเห็นทั้งหมดของสมาชิกนี้">
            {name}
          </Link>
        ) : (
          <span className="truncate text-sm text-muted">{name}</span>
        )}
        {c.author && c.author.role !== "member" ? <MemberRoleBadge role={c.author.role} /> : null}
      </div>
      {c.body_html ? (
        // body_html is rendered and sanitized by the Go API (strong/em/a/br only).
        <div className="cm-body" data-clamp="" dangerouslySetInnerHTML={{ __html: c.body_html }} />
      ) : c.status === "deleted" ? (
        <p className="cm-empty-body">ข้อความถูกลบแล้ว</p>
      ) : null}
      {c.image ? (
        <a href={c.image.url} target="_blank" rel="noopener noreferrer" className="cm-img" aria-label="เปิดรูปภาพในแท็บใหม่">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.image.url} alt="" loading="lazy" decoding="async" width={c.image.width} height={c.image.height} />
        </a>
      ) : null}
      <div className="cm-meta">
        {c.parent_id ? (
          <span className="inline-flex items-center gap-1">
            <Reply size={12} aria-hidden="true" /> ตอบกลับ
          </span>
        ) : null}
        <a href={`/knowledge/${encodeURIComponent(c.post.slug)}`} target="_blank" rel="noopener" className="cm-post" title={c.post.title}>
          <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
          <span>{c.post.title || `/knowledge/${c.post.slug}`}</span>
          <span className="adm-sr-only">(เปิดในแท็บใหม่)</span>
        </a>
        <time dateTime={c.created_at} title={formatDateTime(c.created_at)}>
          {formatRelative(c.created_at)}
        </time>
        {c.edited_at ? <span title={`แก้ไขเมื่อ ${formatDateTime(c.edited_at)}`}>· แก้ไขแล้ว</span> : null}
        {c.image ? (
          <span className="inline-flex items-center gap-1">
            <ImageIcon size={12} aria-hidden="true" /> มีรูปภาพ
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatusCell({ comment: c, onReports }: { comment: AdminComment; onReports: () => void }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <CommentStatusBadge status={c.status} />
      {c.report_count > 0 ? (
        <button type="button" className="cm-reports" onClick={onReports} aria-label={`ถูกรายงาน ${c.report_count} ครั้ง — ดูเหตุผล`}>
          <Flag size={12} aria-hidden="true" />
          {c.report_count.toLocaleString("th-TH")}
        </button>
      ) : null}
    </span>
  );
}

function RowActions({
  comment: c,
  busy,
  onModerate,
  onDelete,
  onDetail,
  onFilterPost,
}: {
  comment: AdminComment;
  busy: boolean;
  onModerate: (to: "published" | "hidden") => void;
  onDelete: () => void;
  onDetail: () => void;
  onFilterPost: () => void;
}) {
  const a = commentActions(c.status);
  const who = c.author?.display_name ?? DELETED_AUTHOR;
  const items: MenuItem[] = [
    { label: c.edited_at ? "รายละเอียดและประวัติการแก้ไข" : "รายละเอียด", icon: <History size={16} aria-hidden="true" />, onSelect: onDetail },
    { label: "ดูเฉพาะบทความนี้", icon: <Search size={16} aria-hidden="true" />, onSelect: onFilterPost },
    { label: "ความคิดเห็นทั้งหมดของสมาชิกนี้", icon: <UserRound size={16} aria-hidden="true" />, href: memberHref(c) ?? undefined, hidden: !c.author },
    { label: "เปิดบทความ", icon: <ExternalLink size={16} aria-hidden="true" />, href: `/knowledge/${encodeURIComponent(c.post.slug)}`, external: true },
    { type: "separator", hidden: !a.remove },
    { label: "ลบความคิดเห็น", icon: <Trash2 size={16} aria-hidden="true" />, danger: true, hidden: !a.remove, onSelect: onDelete },
  ];
  return (
    <span className="cm-actions">
      {a.approve ? (
        <Button size="sm" variant={c.status === "pending" ? "primary" : "secondary"} icon={<Check size={14} aria-hidden="true" />} disabled={busy} onClick={() => onModerate("published")}>
          {c.status === "hidden" ? "แสดงอีกครั้ง" : "อนุมัติ"}
        </Button>
      ) : null}
      {a.hide ? (
        <Button size="sm" icon={<EyeOff size={14} aria-hidden="true" />} disabled={busy} onClick={() => onModerate("hidden")}>
          ซ่อน
        </Button>
      ) : null}
      <Menu
        label={`การทำงานสำหรับความคิดเห็นของ ${who}`}
        items={items}
        trigger={(p) => (
          <button type="button" className="adm-icon-btn" {...p} aria-label={`การทำงานเพิ่มเติมสำหรับความคิดเห็นของ ${who}`}>
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        )}
      />
    </span>
  );
}

function CommentDrawer({
  comment: c,
  busy,
  onClose,
  onModerate,
  onDelete,
}: {
  comment: AdminComment | null;
  busy: boolean;
  onClose: () => void;
  onModerate: (to: "published" | "hidden") => void;
  onDelete: () => void;
}) {
  const { request } = useAdmin();
  const [history, setHistory] = useState<{ id: string; items: CommentEdit[] | null; error: string | null } | null>(null);
  const id = c?.id ?? null;
  const edited = Boolean(c?.edited_at);

  useEffect(() => {
    if (!id || !edited) return;
    const ctrl = new AbortController();
    request<{ data: CommentEdit[] }>(`comments/${encodeURIComponent(id)}/history`, { signal: ctrl.signal })
      .then((r) => setHistory({ id, items: r.data ?? [], error: null }))
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setHistory({ id, items: null, error: m });
      });
    return () => ctrl.abort();
  }, [request, id, edited]);

  const h = history && history.id === id ? history : null;
  const a = c ? commentActions(c.status) : null;

  return (
    <Drawer
      open={c !== null}
      onClose={onClose}
      title="รายละเอียดความคิดเห็น"
      description={c ? `${c.author?.display_name ?? DELETED_AUTHOR} · ${formatDateTime(c.created_at)}` : undefined}
      width="34rem"
      footer={
        c && a ? (
          <div className="flex flex-wrap justify-end gap-2">
            {a.remove ? (
              <Button variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} disabled={busy} onClick={onDelete}>
                ลบ
              </Button>
            ) : null}
            <span className="flex-1" />
            {a.hide ? (
              <Button icon={<EyeOff size={15} aria-hidden="true" />} disabled={busy} onClick={() => onModerate("hidden")}>
                ซ่อน
              </Button>
            ) : null}
            {a.approve ? (
              <Button variant="primary" icon={<Check size={15} aria-hidden="true" />} loading={busy} onClick={() => onModerate("published")}>
                {c.status === "hidden" ? "แสดงอีกครั้ง" : "อนุมัติ"}
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {c ? (
        <div className="grid gap-5">
          <section className="grid gap-2" aria-label="ความคิดเห็น">
            <div className="flex flex-wrap items-center gap-2">
              <CommentStatusBadge status={c.status} />
              {c.author ? <MemberRoleBadge role={c.author.role} /> : null}
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <ThumbsUp size={12} aria-hidden="true" /> {c.like_count.toLocaleString("th-TH")} ถูกใจ
              </span>
            </div>
            <div className="cm-quote">
              {c.body_html ? (
                <div className="cm-body" dangerouslySetInnerHTML={{ __html: c.body_html }} />
              ) : (
                <p className="cm-empty-body">{c.status === "deleted" ? "ข้อความถูกลบแล้ว" : "(ไม่มีข้อความ)"}</p>
              )}
              {c.image ? (
                <a href={c.image.url} target="_blank" rel="noopener noreferrer" className="mt-3 block" aria-label="เปิดรูปภาพขนาดเต็มในแท็บใหม่">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.image.url} alt="" width={c.image.width} height={c.image.height} className="h-auto max-h-80 w-auto max-w-full rounded-lg" />
                </a>
              ) : null}
            </div>
            <dl className="adm-dl text-sm">
              <dt>บทความ</dt>
              <dd>
                <a href={`/knowledge/${encodeURIComponent(c.post.slug)}`} target="_blank" rel="noopener" className="adm-link">
                  {c.post.title || c.post.slug}
                </a>
              </dd>
              <dt>เขียนเมื่อ</dt>
              <dd>{formatDateTime(c.created_at)}</dd>
              {c.edited_at ? (
                <>
                  <dt>แก้ไขล่าสุด</dt>
                  <dd>{formatDateTime(c.edited_at)}</dd>
                </>
              ) : null}
              {c.moderated_at ? (
                <>
                  <dt>ตรวจล่าสุด</dt>
                  <dd>
                    {formatDateTime(c.moderated_at)}
                    {c.moderated_by ? ` โดย ${c.moderated_by.name}${c.moderated_by.kind === "member" ? " (ผู้ดูแลความคิดเห็น)" : ""}` : ""}
                  </dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className="grid gap-2" aria-labelledby="cm-reports-h">
            <h3 id="cm-reports-h" className="flex items-center gap-2 text-sm font-semibold">
              <Flag size={15} aria-hidden="true" /> การรายงาน ({c.report_count.toLocaleString("th-TH")})
            </h3>
            {c.reports.length === 0 ? (
              <p className="text-sm text-muted">ยังไม่มีผู้รายงานความคิดเห็นนี้</p>
            ) : (
              <ul className="cm-list">
                {c.reports.map((r, i) => (
                  <li key={i}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm">{reportReasonLabel(r.reason)}</strong>
                      <time className="text-xs text-muted" dateTime={r.created_at} title={formatDateTime(r.created_at)}>
                        {formatRelative(r.created_at)}
                      </time>
                    </div>
                    {r.note ? <p className="cm-history-body text-muted">{r.note}</p> : null}
                  </li>
                ))}
              </ul>
            )}
            {c.report_count > c.reports.length ? <p className="text-xs text-subtle">แสดง {c.reports.length} รายการล่าสุด</p> : null}
          </section>

          {c.edited_at ? (
            <section className="grid gap-2" aria-labelledby="cm-history-h">
              <h3 id="cm-history-h" className="flex items-center gap-2 text-sm font-semibold">
                <History size={15} aria-hidden="true" /> ข้อความก่อนแก้ไข
              </h3>
              {h?.error ? (
                <Alert>{h.error}</Alert>
              ) : !h?.items ? (
                <div className="grid gap-2" role="status" aria-label="กำลังโหลดประวัติการแก้ไข">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : h.items.length === 0 ? (
                <p className="text-sm text-muted">ไม่มีประวัติการแก้ไข</p>
              ) : (
                <ol className="cm-list">
                  {h.items.map((e, i) => (
                    <li key={i}>
                      <time className="text-xs text-muted" dateTime={e.edited_at}>
                        แก้ไขเมื่อ {formatDateTime(e.edited_at)} — ข้อความเดิม
                      </time>
                      <p className="cm-history-body">{e.body || "(ไม่มีข้อความ)"}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}

function ListSkeleton() {
  return (
    <div className="adm-card grid" role="status" aria-label="กำลังโหลดความคิดเห็น">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-line px-4 py-4 last:border-b-0" aria-hidden="true">
          <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 w-1/4" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="hidden h-7 w-28 md:block" />
        </div>
      ))}
    </div>
  );
}
