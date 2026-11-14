"use client";

/**
 * Lead detail content: used inside the leads drawer and by /admin/leads/[id].
 * Status / assignee save immediately (PATCH); notes go to the activity log.
 */
import {
  ArrowRight,
  AtSign,
  CircleDot,
  MessageCircle,
  MessageSquareText,
  Phone,
  Sparkles,
  StickyNote,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "@/lib/admin/client";
import { CHANNEL_LABEL, formatDateTime, LEAD_STATUSES } from "@/lib/admin/format";
import { formatRelative } from "@/lib/admin/time";
import type { Lead, LeadActivity, LeadStatus, UserRef } from "@/lib/admin/types";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import { Alert } from "../ui/Alert";
import { LEAD_STATUS_SHORT, LeadStatusBadge } from "../ui/Badge";
import { Button, buttonClass } from "../ui/Button";
import { ErrorState } from "../ui/EmptyState";
import { Field, Select, Textarea } from "../ui/Field";
import { Skeleton, SkeletonText } from "../ui/Skeleton";
import { useToast } from "../ui/Toast";
import { leadName, lineHref, mailHref, preferredSlot, telHref, userLabel } from "./lead-utils";
import { useAssignees } from "./useAssignees";

const NOTE_MAX = 4000;

export function LeadPanel({
  id,
  onChanged,
  headingLevel = "h2",
}: {
  id: string;
  /** Called with the updated lead after a successful PATCH. */
  onChanged?: (lead: Lead) => void;
  headingLevel?: "h1" | "h2";
}) {
  const { request, can } = useAdmin();
  const toast = useToast();
  const writable = can("leads:write");
  const assignees = useAssignees();
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<LeadActivity[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"status" | "assign" | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    request<{ data: Lead }>(`leads/${encodeURIComponent(id)}`, { signal: ctrl.signal })
      .then((r) => {
        setLead(r.data);
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(err instanceof ApiError && err.status === 404 ? "ไม่พบข้อมูลผู้ติดต่อนี้ (อาจถูกลบไปแล้ว)" : m);
      });
    return () => ctrl.abort();
  }, [id, request, reload]);

  const loadActivity = useCallback(
    (signal?: AbortSignal) =>
      request<{ data: LeadActivity[] }>(`leads/${encodeURIComponent(id)}/activity`, { signal })
        .then((r) => {
          setActivity(r.data ?? []);
          setActivityError(null);
        })
        .catch((err) => {
          const m = errorMessage(err);
          if (m) setActivityError(m);
        }),
    [id, request],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void loadActivity(ctrl.signal);
    return () => ctrl.abort();
  }, [loadActivity, reload]);

  async function patch(body: { status?: LeadStatus; assigned_to?: string | null }, kind: "status" | "assign") {
    if (!lead) return;
    setSaving(kind);
    try {
      const r = await request<{ data: Lead }>(`leads/${encodeURIComponent(lead.id)}`, { method: "PATCH", json: body });
      setLead(r.data);
      onChanged?.(r.data);
      toast.success(kind === "status" ? `เปลี่ยนสถานะเป็น “${LEAD_STATUS_SHORT[r.data.status]}” แล้ว` : `มอบหมายให้ ${userLabel(r.data.assigned_to)} แล้ว`);
      void loadActivity();
    } catch (err) {
      if (!alreadyNotified(err)) {
        const fieldMsg = err instanceof ApiError ? err.fields.assigned_to || err.fields.status : undefined;
        toast.error(fieldMsg || errorMessage(err) || "บันทึกไม่สำเร็จ");
      }
    } finally {
      setSaving(null);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />;
  if (!lead) {
    return (
      <div className="grid gap-4" role="status">
        <span className="adm-sr-only">กำลังโหลดข้อมูลผู้ติดต่อ…</span>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
        <SkeletonText lines={6} />
      </div>
    );
  }

  const H = headingLevel;
  const tel = telHref(lead.phone);
  const line = lineHref(lead.line_id);
  const mail = mailHref(lead.email);
  const assigneeOptions: UserRef[] = (() => {
    const list = assignees ?? [];
    // Keep the current assignee selectable even if no longer in the list.
    if (lead.assigned_to && !list.some((u) => u.id === lead.assigned_to?.id)) return [lead.assigned_to, ...list];
    return list;
  })();

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <H className="text-xl font-semibold thai-heading">{leadName(lead)}</H>
            <p className="text-sm text-muted">
              {lead.company ? `${lead.company} · ` : ""}ส่งเมื่อ {formatDateTime(lead.created_at)}
            </p>
          </div>
          <LeadStatusBadge status={lead.status} />
        </div>
        <div className="flex flex-wrap gap-2" aria-label="ติดต่อด่วน" role="group">
          {tel ? (
            <a href={tel} className={buttonClass("secondary", "sm")}>
              <Phone size={15} aria-hidden="true" /> โทร
            </a>
          ) : null}
          {line ? (
            <a href={line} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
              <MessageCircle size={15} aria-hidden="true" /> LINE
            </a>
          ) : null}
          {mail ? (
            <a href={mail} className={buttonClass("secondary", "sm")}>
              <AtSign size={15} aria-hidden="true" /> อีเมล
            </a>
          ) : null}
          {!tel && !line && !mail ? <span className="text-sm text-muted">ไม่มีช่องทางติดต่อที่ใช้งานได้</span> : null}
        </div>
      </div>

      <section aria-label="การติดตาม" className="grid gap-3 rounded-xl border border-line bg-surface-2/50 p-4 sm:grid-cols-2">
        <Field label="สถานะ" hint={!writable ? "ดูได้อย่างเดียว" : undefined}>
          {(p) => (
            <Select
              {...p}
              value={lead.status}
              disabled={!writable || saving !== null}
              onChange={(e) => patch({ status: e.target.value as LeadStatus }, "status")}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_SHORT[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="ผู้รับผิดชอบ">
          {(p) => (
            <Select
              {...p}
              value={lead.assigned_to?.id ?? ""}
              disabled={!writable || saving !== null || assignees === null}
              onChange={(e) => patch({ assigned_to: e.target.value || null }, "assign")}
            >
              <option value="">— ยังไม่มอบหมาย —</option>
              {assigneeOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {saving ? (
          <p className="text-xs text-muted sm:col-span-2" role="status">
            กำลังบันทึก…
          </p>
        ) : null}
      </section>

      <section aria-labelledby="lead-info" className="grid gap-3">
        <h3 id="lead-info" className="text-sm font-semibold">
          ข้อมูลที่กรอก
        </h3>
        <dl className="adm-dl">
          <dt>ชื่อ–นามสกุล</dt>
          <dd>{leadName(lead)}</dd>
          <dt>บริษัท</dt>
          <dd>{lead.company || "—"}</dd>
          <dt>โทรศัพท์</dt>
          <dd>{tel ? <a className="adm-link" href={tel}>{lead.phone}</a> : lead.phone || "—"}</dd>
          <dt>อีเมล</dt>
          <dd>{mail ? <a className="adm-link break-all" href={mail}>{lead.email}</a> : lead.email || "—"}</dd>
          <dt>LINE ID</dt>
          <dd>{lead.line_id || "—"}</dd>
          <dt>ช่องทางที่สะดวก</dt>
          <dd>{CHANNEL_LABEL[lead.preferred_channel] ?? lead.preferred_channel}</dd>
          <dt>วัน/เวลาที่สะดวก</dt>
          <dd>{preferredSlot(lead)}</dd>
          <dt>ยินยอม PDPA</dt>
          <dd>{formatDateTime(lead.consent_at)}</dd>
          <dt>หน้าที่ส่งฟอร์ม</dt>
          <dd>{lead.source_page || "—"}</dd>
        </dl>
        <div className="rounded-xl border border-line p-3.5">
          <p className="mb-1 text-xs font-medium text-muted">ข้อความ</p>
          <p className="whitespace-pre-wrap break-words text-sm">{lead.message || "—"}</p>
        </div>
        <details className="text-xs text-muted">
          <summary className="w-fit">ข้อมูลทางเทคนิค</summary>
          <dl className="adm-dl mt-2 text-xs">
            <dt>IP</dt>
            <dd>{lead.ip || "—"}</dd>
            <dt>User agent</dt>
            <dd className="break-all">{lead.user_agent || "—"}</dd>
            <dt>อัปเดตล่าสุด</dt>
            <dd>{formatDateTime(lead.updated_at)}</dd>
          </dl>
        </details>
      </section>

      <section aria-labelledby="lead-activity" className="grid gap-3">
        <h3 id="lead-activity" className="text-sm font-semibold">
          กิจกรรม
        </h3>
        {writable ? <NoteForm leadId={lead.id} onAdded={(a) => setActivity((cur) => [a, ...(cur ?? [])])} /> : null}
        <Timeline lead={lead} activity={activity} error={activityError} onRetry={() => void loadActivity()} assignees={assigneeOptions} />
      </section>
    </div>
  );
}

function NoteForm({ leadId, onAdded }: { leadId: string; onAdded: (a: LeadActivity) => void }) {
  const { request } = useAdmin();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) {
      setErr("กรุณาพิมพ์บันทึก");
      return;
    }
    if (text.length > NOTE_MAX) {
      setErr(`บันทึกยาวเกินไป (สูงสุด ${NOTE_MAX.toLocaleString("th-TH")} ตัวอักษร)`);
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const r = await request<{ data: LeadActivity }>(`leads/${encodeURIComponent(leadId)}/notes`, { method: "POST", json: { body: text } });
      onAdded(r.data);
      setBody("");
      toast.success("เพิ่มบันทึกแล้ว");
    } catch (error) {
      if (error instanceof ApiError && error.fields.body) setErr(error.fields.body);
      else if (!alreadyNotified(error)) toast.error(errorMessage(error) || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <Field label="เพิ่มบันทึก" labelHidden error={err} hint={`${body.length.toLocaleString("th-TH")} / ${NOTE_MAX.toLocaleString("th-TH")}`}>
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            placeholder="เช่น โทรคุยแล้ว สนใจแพ็กเกจ Branding นัดคุยต่อสัปดาห์หน้า"
            value={body}
            maxLength={NOTE_MAX + 200}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="primary" loading={busy} icon={<StickyNote size={15} aria-hidden="true" />}>
          บันทึก
        </Button>
      </div>
    </form>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Timeline({
  lead,
  activity,
  error,
  onRetry,
  assignees,
}: {
  lead: Lead;
  activity: LeadActivity[] | null;
  error: string | null;
  onRetry: () => void;
  assignees: UserRef[];
}) {
  const who = (v: string) => {
    if (!v) return "ยังไม่มอบหมาย";
    if (UUID_RE.test(v)) {
      const u = assignees.find((x) => x.id === v);
      return u ? u.name || u.email : "ผู้ใช้ที่ถูกลบ";
    }
    return v;
  };
  const statusName = (v: string) => LEAD_STATUS_SHORT[v as LeadStatus] ?? v;

  return (
    <div className="grid gap-3">
      {lead.note?.trim() ? (
        <div className="rounded-xl border border-dashed border-line-strong p-3 text-sm">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <StickyNote size={13} aria-hidden="true" /> บันทึกภายใน (ระบบเดิม)
          </p>
          <p className="whitespace-pre-wrap break-words">{lead.note}</p>
        </div>
      ) : null}
      {error ? (
        <Alert action={<Button size="sm" onClick={onRetry}>ลองใหม่</Button>}>{error}</Alert>
      ) : activity === null ? (
        <SkeletonText lines={4} />
      ) : null}
      <ol className="relative grid gap-4 border-l border-line pl-5">
        {(activity ?? []).map((a) => (
          <TimelineItem
            key={a.id}
            icon={a.kind === "note" ? <MessageSquareText size={13} /> : a.kind === "status" ? <CircleDot size={13} /> : <UserCheck size={13} />}
            actor={a.actor ? a.actor.name || a.actor.email : "ระบบ"}
            at={a.created_at}
          >
            {a.kind === "note" ? (
              <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-2 px-3 py-2 text-sm">{a.body}</p>
            ) : a.kind === "status" ? (
              <p className="text-sm">
                เปลี่ยนสถานะ <span className="text-muted">{statusName(a.from)}</span>{" "}
                <ArrowRight size={13} aria-label="เป็น" className="inline" /> <strong>{statusName(a.to)}</strong>
              </p>
            ) : (
              <p className="text-sm">
                มอบหมาย <span className="text-muted">{who(a.from)}</span>{" "}
                <ArrowRight size={13} aria-label="เป็น" className="inline" /> <strong>{who(a.to)}</strong>
              </p>
            )}
          </TimelineItem>
        ))}
        <TimelineItem icon={<Sparkles size={13} />} actor="เว็บไซต์" at={lead.created_at}>
          <p className="text-sm">ส่งฟอร์มติดต่อเข้ามา{lead.source_page ? ` จาก ${lead.source_page}` : ""}</p>
        </TimelineItem>
      </ol>
    </div>
  );
}

function TimelineItem({ icon, actor, at, children }: { icon: ReactNode; actor: string; at: string; children: ReactNode }) {
  return (
    <li className="relative">
      <span
        className="absolute -left-[1.95rem] top-0.5 grid h-5 w-5 place-items-center rounded-full border border-line-strong bg-surface text-muted"
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="text-xs text-muted">
        <span className="font-medium text-fg">{actor}</span> ·{" "}
        <time dateTime={at} title={formatDateTime(at)}>
          {formatRelative(at)}
        </time>
      </p>
      {children}
    </li>
  );
}
