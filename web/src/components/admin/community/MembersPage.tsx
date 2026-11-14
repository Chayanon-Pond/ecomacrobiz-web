"use client";

/** /admin/members — community members: search, role, ban / unban. Filters live in the URL. */
import { Ban, CheckCircle2, MessageSquare, MoreHorizontal, Search, Shield, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/admin/client";
import {
  ASSIGNABLE_MEMBER_ROLES,
  isEmailQuery,
  MEMBER_ROLE_DESCRIPTION,
  MEMBER_ROLE_FILTERS,
  MEMBER_ROLE_LABEL,
  MEMBER_ROLE_OPTION_LABEL,
} from "@/lib/admin/community";
import { formatDateTime } from "@/lib/admin/format";
import { formatRelative } from "@/lib/admin/time";
import type { AdminMember, ListResponse, MemberPatch, MemberRole, PageMeta } from "@/lib/admin/types";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Menu,
  NoAccess,
  PageHeader,
  Pagination,
  SearchBox,
  Select,
  Skeleton,
  Textarea,
  useToast,
  type MenuItem,
} from "../ui";
import { MemberAvatar, MemberRoleBadge } from "./shared";
import "../posts/posts.css";
import "./community.css";

const PER_PAGE = 25;

type Filters = { q: string; role: string; page: number };
type Pending = { kind: "role"; member: AdminMember } | { kind: "ban"; member: AdminMember } | { kind: "unban"; member: AdminMember } | null;

function useParamsState() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const roleRaw = sp.get("role") ?? "";
  const state: Filters = {
    q: sp.get("q") ?? "",
    role: MEMBER_ROLE_FILTERS.some((r) => r.value === roleRaw) ? roleRaw : "",
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

function commentsHref(m: AdminMember) {
  return `/admin/comments?${new URLSearchParams({ status: "all", member: m.id, mname: m.display_name })}`;
}

const PROVIDER_LABEL: Record<string, string> = { password: "อีเมล", google: "Google" };

export function MembersPage() {
  const { request, can } = useAdmin();
  const toast = useToast();
  const allowed = can("comments:moderate");
  const [f, set] = useParamsState();
  const [data, setData] = useState<{ key: string; rows: AdminMember[]; meta: PageMeta } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const queryKey = JSON.stringify([f.q, f.role, f.page, reload]);
  const rows = data?.key === queryKey ? data.rows : null;
  const meta = data?.meta ?? null;

  useEffect(() => {
    if (!allowed) return;
    const ctrl = new AbortController();
    request<ListResponse<AdminMember>>("members", {
      query: { q: f.q, role: f.role, page: f.page, per_page: PER_PAGE },
      signal: ctrl.signal,
    })
      .then((r) => {
        setData({ key: queryKey, rows: r.data ?? [], meta: r.meta });
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, allowed, queryKey, f.q, f.role, f.page]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const header = <PageHeader title="สมาชิก" description="สมาชิกที่สมัครเพื่อแสดงความคิดเห็นในหน้า Knowledge (แยกจากผู้ใช้ระบบหลังบ้าน)" />;
  if (!allowed) {
    return (
      <>
        {header}
        <NoAccess />
      </>
    );
  }

  function open(p: Pending) {
    setDialogError(null);
    setPending(p);
  }
  function closePending() {
    if (!busy) setPending(null);
  }

  async function patch(m: AdminMember, body: MemberPatch, ok: (m: AdminMember) => string) {
    setBusy(true);
    setDialogError(null);
    try {
      const r = await request<{ data: AdminMember }>(`members/${encodeURIComponent(m.id)}`, { method: "PATCH", json: body });
      setData((d) => (d ? { ...d, rows: d.rows.map((x) => (x.id === r.data.id ? r.data : x)) } : d));
      toast.success(ok(r.data));
      setPending(null);
    } catch (err) {
      if (!alreadyNotified(err)) {
        const fieldMsg = err instanceof ApiError ? Object.values(err.fields ?? {})[0] : undefined;
        setDialogError(fieldMsg || errorMessage(err) || "ทำรายการไม่สำเร็จ");
      }
    } finally {
      setBusy(false);
    }
  }

  function actions(m: AdminMember): MenuItem[] {
    const banned = m.role === "banned";
    return [
      { label: "ดูความคิดเห็นของสมาชิก", icon: <MessageSquare size={16} aria-hidden="true" />, href: commentsHref(m) },
      { label: "เปลี่ยนบทบาท", icon: <Shield size={16} aria-hidden="true" />, hidden: banned, onSelect: () => open({ kind: "role", member: m }) },
      { type: "separator" },
      banned
        ? { label: "ยกเลิกการระงับ", icon: <CheckCircle2 size={16} aria-hidden="true" />, onSelect: () => open({ kind: "unban", member: m }) }
        : { label: "ระงับสมาชิก", icon: <Ban size={16} aria-hidden="true" />, danger: true, onSelect: () => open({ kind: "ban", member: m }) },
    ];
  }

  const emailMode = isEmailQuery(f.q);

  return (
    <>
      {header}

      <div className="pl-filters">
        <div className="pl-filter-row">
          <SearchBox value={f.q} onSearch={(q) => set({ q })} label="ค้นหาชื่อ หรืออีเมลแบบเต็ม…" />
          <div className="w-full sm:w-56">
            <Select inputSize="sm" aria-label="กรองตามบทบาท" value={f.role} onChange={(e) => set({ role: e.target.value })}>
              {MEMBER_ROLE_FILTERS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p className="adm-hint" aria-live="polite">
          {emailMode
            ? "กำลังค้นหาด้วยอีเมล — ต้องพิมพ์อีเมลให้ครบและตรงทุกตัวอักษร (ระบบเข้ารหัสอีเมลไว้ จึงค้นหาบางส่วนไม่ได้)"
            : "พิมพ์บางส่วนของชื่อที่แสดง หรือพิมพ์อีเมลแบบเต็มเพื่อค้นหาด้วยอีเมล"}
        </p>
      </div>

      {error ? (
        <div className="adm-card">
          <ErrorState message={error} onRetry={refresh} />
        </div>
      ) : rows === null ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <div className="adm-card">
          {f.q || f.role ? (
            <EmptyState
              icon={<Search size={22} />}
              title="ไม่พบสมาชิกที่ตรงกับตัวกรอง"
              description={emailMode ? "ตรวจสอบว่าพิมพ์อีเมลครบถ้วน" : "ลองเปลี่ยนคำค้นหรือบทบาท"}
              action={
                <Button size="sm" onClick={() => set({ q: "", role: "" })}>
                  ล้างตัวกรอง
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<UserRound size={22} />} title="ยังไม่มีสมาชิก" description="สมาชิกที่สมัครจากหน้าเว็บไซต์จะแสดงที่นี่" />
          )}
        </div>
      ) : (
        <>
          {/* table (md+) */}
          <div className="adm-table-wrap pl-table">
            <table className="adm-table" style={{ minWidth: "60rem" }}>
              <caption className="adm-sr-only">รายชื่อสมาชิก</caption>
              <thead>
                <tr>
                  <th scope="col">สมาชิก</th>
                  <th scope="col">เข้าสู่ระบบด้วย</th>
                  <th scope="col">บทบาท</th>
                  <th scope="col" className="adm-num">
                    ความคิดเห็น
                  </th>
                  <th scope="col">เข้าร่วม</th>
                  <th scope="col">เข้าสู่ระบบล่าสุด</th>
                  <th scope="col">
                    <span className="adm-sr-only">การทำงาน</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <MemberIdentity member={m} />
                    </td>
                    <td>
                      <Providers member={m} />
                    </td>
                    <td>
                      <RoleCell member={m} />
                    </td>
                    <td className="adm-num">
                      <CommentCount member={m} />
                    </td>
                    <td className="whitespace-nowrap text-sm text-muted">
                      <span title={formatDateTime(m.created_at)}>{formatRelative(m.created_at)}</span>
                    </td>
                    <td className="whitespace-nowrap text-sm">
                      {m.last_login_at ? (
                        <span title={formatDateTime(m.last_login_at)}>{formatRelative(m.last_login_at)}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="w-12 text-right">
                      <RowMenu member={m} items={actions(m)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* cards (< md) */}
          <ul className="pl-cards" aria-label="รายชื่อสมาชิก">
            {rows.map((m) => (
              <li key={m.id} className="pl-card">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <MemberIdentity member={m} />
                    <RowMenu member={m} items={actions(m)} />
                  </div>
                  <div className="cm-card-row justify-start">
                    <RoleCell member={m} />
                    <Providers member={m} />
                  </div>
                  <div className="cm-meta mt-2">
                    <CommentCount member={m} long />
                    <span title={formatDateTime(m.created_at)}>เข้าร่วม {formatRelative(m.created_at)}</span>
                    {m.last_login_at ? <span title={formatDateTime(m.last_login_at)}>ล่าสุด {formatRelative(m.last_login_at)}</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination meta={meta} onPage={(p) => set({ page: p })} label="เปลี่ยนหน้ารายชื่อสมาชิก" />

      {pending?.kind === "role" ? (
        <RoleDialog
          member={pending.member}
          busy={busy}
          error={dialogError}
          onClose={closePending}
          onSave={(role) => patch(pending.member, { role }, (m) => `เปลี่ยนบทบาทของ ${m.display_name} เป็น “${MEMBER_ROLE_LABEL[m.role]}” แล้ว`)}
        />
      ) : null}

      {pending?.kind === "ban" ? (
        <BanDialog
          member={pending.member}
          busy={busy}
          error={dialogError}
          onClose={closePending}
          onBan={(reason, hide) =>
            patch(pending.member, { role: "banned", banned_reason: reason, hide_comments: hide }, (m) =>
              hide ? `ระงับ ${m.display_name} และซ่อนความคิดเห็นทั้งหมดแล้ว` : `ระงับ ${m.display_name} แล้ว`,
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={pending?.kind === "unban"}
        title="ยกเลิกการระงับสมาชิก?"
        busy={busy}
        confirmLabel="ยกเลิกการระงับ"
        message={
          pending?.kind === "unban" ? (
            <>
              <p>
                <strong className="text-fg">{pending.member.display_name}</strong> จะกลับมาเข้าสู่ระบบและแสดงความคิดเห็นได้อีกครั้งในบทบาท “สมาชิก”
                ความคิดเห็นที่ถูกซ่อนไว้จะยังซ่อนอยู่ — แสดงอีกครั้งได้จากหน้าความคิดเห็น
              </p>
              {dialogError ? <Alert className="mt-3">{dialogError}</Alert> : null}
            </>
          ) : null
        }
        onClose={closePending}
        onConfirm={() => {
          if (pending?.kind !== "unban") return;
          void patch(pending.member, { role: "member" }, (m) => `ยกเลิกการระงับ ${m.display_name} แล้ว`);
        }}
      />
    </>
  );
}

function MemberIdentity({ member: m }: { member: AdminMember }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <MemberAvatar id={m.id} name={m.display_name} url={m.avatar_url} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{m.display_name || "—"}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span className="truncate">{m.email ?? m.email_masked}</span>
          {m.email_verified ? (
            <Badge tone="success" icon={<CheckCircle2 size={11} aria-hidden="true" />}>
              ยืนยันแล้ว
            </Badge>
          ) : (
            <Badge tone="neutral">ยังไม่ยืนยันอีเมล</Badge>
          )}
        </span>
      </span>
    </span>
  );
}

function Providers({ member: m }: { member: AdminMember }) {
  if (!m.providers.length) return <span className="text-sm text-muted">—</span>;
  return (
    <span className="cm-chips">
      {m.providers.map((p) => (
        <Badge key={p} tone={p === "google" ? "info" : "neutral"}>
          {PROVIDER_LABEL[p] ?? p}
        </Badge>
      ))}
    </span>
  );
}

function RoleCell({ member: m }: { member: AdminMember }) {
  if (m.role !== "banned") return <MemberRoleBadge role={m.role} />;
  const reason = m.banned_reason?.trim();
  return (
    <span className="grid gap-0.5">
      <MemberRoleBadge role="banned" title={reason ? `เหตุผล: ${reason}` : undefined} />
      {m.banned_at ? <span className="text-xs text-muted">{formatDateTime(m.banned_at)}</span> : null}
      {reason ? <span className="max-w-[14rem] truncate text-xs text-muted">เหตุผล: {reason}</span> : null}
    </span>
  );
}

function CommentCount({ member: m, long }: { member: AdminMember; long?: boolean }) {
  const n = m.comment_count.toLocaleString("th-TH");
  if (m.comment_count === 0) return <span className="text-sm text-muted">{long ? "ยังไม่มีความคิดเห็น" : "0"}</span>;
  return (
    <Link href={commentsHref(m)} className="adm-link text-sm tabular-nums" aria-label={`ดูความคิดเห็น ${n} รายการของ ${m.display_name}`}>
      {long ? `${n} ความคิดเห็น` : n}
    </Link>
  );
}

function RowMenu({ member: m, items }: { member: AdminMember; items: MenuItem[] }) {
  return (
    <Menu
      label={`การทำงานสำหรับ ${m.display_name}`}
      items={items}
      trigger={(p) => (
        <button type="button" className="adm-icon-btn" {...p} aria-label={`การทำงานสำหรับ ${m.display_name}`}>
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
      )}
    />
  );
}

function RoleDialog({
  member,
  busy,
  error,
  onClose,
  onSave,
}: {
  member: AdminMember;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (r: MemberRole) => void;
}) {
  const [role, setRole] = useState<MemberRole>(member.role);
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title="เปลี่ยนบทบาทสมาชิก"
      description={member.display_name}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button variant="primary" loading={busy} disabled={role === member.role} onClick={() => onSave(role)}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <fieldset className="grid gap-2">
          <legend className="adm-label">บทบาท</legend>
          {ASSIGNABLE_MEMBER_ROLES.map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors"
              style={{
                borderColor: role === r ? "var(--adm-accent-border)" : "var(--line)",
                background: role === r ? "var(--adm-accent-bg)" : "transparent",
              }}
            >
              <input type="radio" name="member-role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1 accent-[var(--accent)]" />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium text-fg">{MEMBER_ROLE_OPTION_LABEL[r]}</span>
                <span className="text-xs text-muted">{MEMBER_ROLE_DESCRIPTION[r]}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}

function BanDialog({
  member,
  busy,
  error,
  onClose,
  onBan,
}: {
  member: AdminMember;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onBan: (reason: string, hideComments: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [hide, setHide] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!busy) onBan(reason.trim(), hide);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title="ระงับสมาชิก"
      description={member.display_name}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" form="ban-form" variant="danger-solid" loading={busy} icon={<Ban size={16} aria-hidden="true" />}>
            ระงับสมาชิก
          </Button>
        </>
      }
    >
      <form id="ban-form" onSubmit={submit} className="grid gap-4">
        <p className="text-sm text-muted">
          สมาชิกจะถูกออกจากระบบทุกอุปกรณ์ทันที เข้าสู่ระบบไม่ได้ และแสดงความคิดเห็น กดถูกใจ หรือรายงานไม่ได้ จนกว่าจะยกเลิกการระงับ
        </p>
        {error ? <Alert>{error}</Alert> : null}
        <Field label="เหตุผล (บันทึกภายใน ไม่แสดงต่อสมาชิก)" hint="เช่น โพสต์สแปมซ้ำหลายครั้ง">
          {(p) => <Textarea {...p} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
        </Field>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" className="pl-check mt-0.5" checked={hide} onChange={(e) => setHide(e.target.checked)} />
          <span>
            ซ่อนความคิดเห็นทั้งหมดของสมาชิกนี้
            <span className="block text-xs text-muted">ความคิดเห็นที่เผยแพร่อยู่ทั้งหมดจะถูกซ่อนจากหน้าเว็บไซต์ (แสดงอีกครั้งทีละรายการได้ภายหลัง)</span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}

function ListSkeleton() {
  return (
    <div className="adm-card grid" role="status" aria-label="กำลังโหลดรายชื่อสมาชิก">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0" aria-hidden="true">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-5 w-24 md:block" />
        </div>
      ))}
    </div>
  );
}
