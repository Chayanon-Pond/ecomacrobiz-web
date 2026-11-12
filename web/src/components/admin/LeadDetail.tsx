"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "@/lib/admin/client";
import { CHANNEL_LABEL, formatDateTime, LEAD_STATUS_LABEL, LEAD_STATUSES } from "@/lib/admin/format";
import type { Lead, LeadStatus } from "@/lib/admin/types";
import { PageHeader, Spinner } from "./AdminShell";
import { LEAD_TONE, leadName, preferredSlot } from "./LeadsList";
import { errorMessage, useAdmin } from "./SessionProvider";
import { useToast } from "./Toast";

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const { request } = useAdmin();
  const toast = useToast();
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LeadStatus>("new");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const ctrl = new AbortController();
    request<{ data: Lead }>(`leads/${encodeURIComponent(id)}`, { signal: ctrl.signal })
      .then((r) => {
        setLead(r.data);
        setStatus(r.data.status);
        setNote(r.data.note ?? "");
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(err instanceof ApiError && err.status === 404 ? "ไม่พบข้อมูลผู้ติดต่อนี้" : m);
      });
    return () => ctrl.abort();
  }, [id, request]);

  const dirty = lead !== null && (status !== lead.status || note !== (lead.note ?? ""));

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!lead || !dirty) return;
    setSaving(true);
    setFieldErrors({});
    try {
      const r = await request<{ data: Lead }>(`leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH",
        json: { status, note },
      });
      setLead(r.data);
      setStatus(r.data.status);
      setNote(r.data.note ?? "");
      toast("บันทึกสถานะแล้ว");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setFieldErrors(err.fields);
      toast(errorMessage(err) || "บันทึกไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <>
        <PageHeader title="รายละเอียดผู้ติดต่อ" />
        <p className="adm-alert" role="alert">
          {error}
        </p>
        <Link href="/admin/leads" className="adm-btn mt-4">
          ← กลับไปหน้ารายการ
        </Link>
      </>
    );
  }
  if (!lead) return <Spinner />;

  return (
    <>
      <PageHeader
        title={leadName(lead)}
        subtitle={`ส่งเมื่อ ${formatDateTime(lead.created_at)}${lead.company ? ` · ${lead.company}` : ""}`}
        actions={
          <Link href="/admin/leads" className="adm-btn">
            ← รายการทั้งหมด
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="adm-card p-5" aria-labelledby="lead-info">
          <h2 id="lead-info" className="mb-4 font-semibold">
            ข้อมูลที่กรอก
          </h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[11rem_1fr]">
            <Row label="ชื่อ">{lead.first_name || "—"}</Row>
            <Row label="นามสกุล">{lead.last_name || "—"}</Row>
            <Row label="บริษัท">{lead.company || "—"}</Row>
            <Row label="โทรศัพท์">
              {lead.phone ? (
                <a className="adm-link" href={`tel:${lead.phone}`}>
                  {lead.phone}
                </a>
              ) : (
                "—"
              )}
            </Row>
            <Row label="อีเมล">
              {lead.email ? (
                <a className="adm-link break-all" href={`mailto:${lead.email}`}>
                  {lead.email}
                </a>
              ) : (
                "—"
              )}
            </Row>
            <Row label="LINE ID">{lead.line_id || "—"}</Row>
            <Row label="ช่องทางที่สะดวก">{CHANNEL_LABEL[lead.preferred_channel] ?? lead.preferred_channel}</Row>
            <Row label="วัน/เวลาที่สะดวก">{preferredSlot(lead)}</Row>
            <Row label="ข้อความ">
              <span className="whitespace-pre-wrap break-words">{lead.message || "—"}</span>
            </Row>
            <Row label="ยินยอม PDPA เมื่อ">{formatDateTime(lead.consent_at)}</Row>
            <Row label="หน้าที่ส่งฟอร์ม">{lead.source_page || "—"}</Row>
            <Row label="IP">{lead.ip || "—"}</Row>
            <Row label="User agent">
              <span className="break-all text-xs text-muted">{lead.user_agent || "—"}</span>
            </Row>
            <Row label="อัปเดตล่าสุด">{formatDateTime(lead.updated_at)}</Row>
          </dl>
        </section>

        <form onSubmit={onSave} className="adm-card h-fit space-y-4 p-5" aria-labelledby="lead-manage">
          <div className="flex items-center justify-between gap-2">
            <h2 id="lead-manage" className="font-semibold">
              การติดตาม
            </h2>
            <span className="adm-badge" data-tone={LEAD_TONE[lead.status] || undefined}>
              {LEAD_STATUS_LABEL[lead.status] ?? lead.status}
            </span>
          </div>
          <div>
            <label htmlFor="lead-status-select" className="adm-label">
              สถานะ (Status)
            </label>
            <select
              id="lead-status-select"
              className="adm-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as LeadStatus)}
              aria-invalid={fieldErrors.status ? true : undefined}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {fieldErrors.status ? <p className="adm-field-error">{fieldErrors.status}</p> : null}
          </div>
          <div>
            <label htmlFor="lead-note" className="adm-label">
              บันทึกภายใน (Note)
            </label>
            <textarea
              id="lead-note"
              rows={5}
              className="adm-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={fieldErrors.note ? true : undefined}
            />
            {fieldErrors.note ? <p className="adm-field-error">{fieldErrors.note}</p> : null}
          </div>
          <button type="submit" className="adm-btn adm-btn-primary w-full" disabled={!dirty || saving}>
            {saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </form>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
