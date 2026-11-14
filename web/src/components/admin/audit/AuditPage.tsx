"use client";

/** /admin/audit — filterable audit log (owner). Filters live in the URL. */
import { ChevronDown, ClipboardList, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { AUDIT_ACTIONS } from "@/lib/admin/permissions";
import { formatAbsolute, formatRelative } from "@/lib/admin/time";
import type { AdminUser, AuditEntry, ListResponse, PageMeta } from "@/lib/admin/types";
import { describeUA } from "../account/AccountPage";
import { errorMessage, useAdmin } from "../SessionProvider";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState, ErrorState, NoAccess } from "../ui/EmptyState";
import { Input, Select } from "../ui/Field";
import { PageHeader } from "../ui/PageHeader";
import { Pagination } from "../ui/Pagination";
import { TableSkeleton } from "../ui/Skeleton";
import { Table } from "../ui/Table";

const PER_PAGE = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function actionTone(action: string): BadgeTone {
  if (/failed|delete|revoke|deactivate/.test(action)) return "danger";
  if (/^auth\./.test(action)) return "neutral";
  if (/^user\./.test(action)) return "violet";
  if (/^lead\./.test(action)) return "success";
  if (/^(post|media)\./.test(action)) return "info";
  return "neutral";
}

const TARGET_LABEL: Record<string, string> = {
  post: "บทความ",
  media: "สื่อ",
  lead: "Lead",
  user: "ผู้ใช้",
  invite: "คำเชิญ",
  session: "เซสชัน",
  redirect: "Redirect",
};

export function AuditPage() {
  const { request, can } = useAdmin();
  const allowed = can("audit:read");
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f = {
    actor: sp.get("actor") ?? "",
    action: sp.get("action") ?? "",
    from: DATE_RE.test(sp.get("from") ?? "") ? (sp.get("from") as string) : "",
    to: DATE_RE.test(sp.get("to") ?? "") ? (sp.get("to") as string) : "",
    page: Math.max(1, Number(sp.get("page")) || 1),
  };
  const set = useCallback(
    (patch: Partial<typeof f>) => {
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

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!allowed || !can("users:read")) return;
    const ctrl = new AbortController();
    request<{ data: AdminUser[] }>("users", { signal: ctrl.signal })
      .then((r) => setUsers(r.data ?? []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [request, allowed, can]);

  useEffect(() => {
    if (!allowed) return;
    const ctrl = new AbortController();
    request<ListResponse<AuditEntry>>("audit", {
      query: { actor_id: f.actor, action: f.action, from: f.from, to: f.to, page: f.page, per_page: PER_PAGE },
      signal: ctrl.signal,
    })
      .then((r) => {
        setRows(r.data ?? []);
        setMeta(r.meta);
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, allowed, f.actor, f.action, f.from, f.to, f.page, reload]);

  const header = <PageHeader title="บันทึกกิจกรรม" description="ใครทำอะไร เมื่อไร (เวลาประเทศไทย)" />;
  if (!allowed) {
    return (
      <>
        {header}
        <NoAccess />
      </>
    );
  }

  const filtered = Boolean(f.actor || f.action || f.from || f.to);
  const toggle = (id: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="กรองตามผู้ใช้" value={f.actor} onChange={(e) => set({ actor: e.target.value })} className="sm:w-52">
          <option value="">ผู้ใช้ทั้งหมด</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name || u.email}
            </option>
          ))}
        </Select>
        <Select aria-label="กรองตามการกระทำ" value={f.action} onChange={(e) => set({ action: e.target.value })} className="sm:w-56">
          <option value="">ทุกการกระทำ</option>
          {Object.entries(AUDIT_ACTIONS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label="ตั้งแต่วันที่" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} className="sm:w-40" />
          <span className="text-muted" aria-hidden="true">
            –
          </span>
          <Input type="date" aria-label="ถึงวันที่" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} className="sm:w-40" />
        </div>
        {filtered ? (
          <Button variant="ghost" size="sm" icon={<X size={14} aria-hidden="true" />} onClick={() => set({ actor: "", action: "", from: "", to: "" })}>
            ล้างตัวกรอง
          </Button>
        ) : null}
      </div>

      {error && rows === null ? (
        <div className="adm-card">
          <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={10} cols={5} />
      ) : rows.length === 0 ? (
        <div className="adm-card">
          <EmptyState
            icon={<ClipboardList size={22} />}
            title={filtered ? "ไม่พบกิจกรรมตามเงื่อนไข" : "ยังไม่มีบันทึกกิจกรรม"}
            description={filtered ? "ลองเปลี่ยนหรือล้างตัวกรอง" : undefined}
          />
        </div>
      ) : (
        <>
          <Table caption="บันทึกกิจกรรม" minWidth="52rem">
            <thead>
              <tr>
                <th scope="col">เวลา</th>
                <th scope="col">ผู้ใช้</th>
                <th scope="col">การกระทำ</th>
                <th scope="col">เป้าหมาย</th>
                <th scope="col">
                  <span className="adm-sr-only">รายละเอียด</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = expanded.has(r.id);
                const detailId = `audit-${r.id}`;
                const hasMeta = r.metadata && Object.keys(r.metadata).length > 0;
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="whitespace-nowrap text-sm">
                        <time dateTime={r.created_at} className="block">
                          {formatRelative(r.created_at)}
                        </time>
                        <span className="block text-xs text-muted">{formatAbsolute(r.created_at)}</span>
                      </td>
                      <td className="text-sm">
                        <span className="block max-w-[14rem] truncate font-medium">{r.actor.name || r.actor.email || "ระบบ"}</span>
                        {r.actor.name && r.actor.email ? <span className="block max-w-[14rem] truncate text-xs text-muted">{r.actor.email}</span> : null}
                      </td>
                      <td>
                        <Badge tone={actionTone(r.action)}>{AUDIT_ACTIONS[r.action] ?? r.action}</Badge>
                      </td>
                      <td className="text-sm">
                        {r.target_type ? (
                          <>
                            <span className="block">{TARGET_LABEL[r.target_type] ?? r.target_type}</span>
                            <span className="block max-w-[14rem] truncate font-mono text-xs text-muted" title={r.target_id}>
                              {r.target_id}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="w-12 text-right">
                        <button
                          type="button"
                          className="adm-icon-btn"
                          aria-expanded={open}
                          aria-controls={detailId}
                          aria-label={open ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}
                          onClick={() => toggle(r.id)}
                        >
                          <ChevronDown size={16} aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr id={detailId}>
                        <td colSpan={5} className="bg-surface-2/40">
                          <dl className="adm-dl text-xs">
                            <dt>รหัสการกระทำ</dt>
                            <dd className="font-mono">{r.action}</dd>
                            <dt>IP</dt>
                            <dd>{r.ip || "—"}</dd>
                            <dt>อุปกรณ์</dt>
                            <dd>
                              {describeUA(r.user_agent).label}
                              <span className="block break-all text-subtle">{r.user_agent}</span>
                            </dd>
                            <dt>ข้อมูลเพิ่มเติม</dt>
                            <dd>
                              {hasMeta ? (
                                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-ink-2 p-2.5 font-mono text-[0.75rem] leading-relaxed">
                                  {JSON.stringify(r.metadata, null, 2)}
                                </pre>
                              ) : (
                                "—"
                              )}
                            </dd>
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
          <Pagination meta={meta} onPage={(p) => set({ page: p })} />
        </>
      )}
    </>
  );
}
