"use client";

/** /admin/settings — read-only overview of server configuration (no secrets). */
import { Clock, Globe, Mail, MessageCircle, Server, Upload, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { SettingsOverview } from "@/lib/admin/types";
import { errorMessage, useAdmin } from "../SessionProvider";
import { Alert } from "../ui/Alert";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { ErrorState, NoAccess } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { Skeleton } from "../ui/Skeleton";

function Configured({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge tone="success" dot>
      ตั้งค่าแล้ว
    </Badge>
  ) : (
    <Badge tone="warning" dot>
      ยังไม่ได้ตั้งค่า
    </Badge>
  );
}

function hours(h: number) {
  if (h >= 24 && h % 24 === 0) return `${h / 24} วัน`;
  return `${h} ชั่วโมง`;
}

function SettingCard({ icon: Icon, title, status, children }: { icon: LucideIcon; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <Card as="section" className="p-5" aria-label={title}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface-2 text-muted" aria-hidden="true">
            <Icon size={18} />
          </span>
          <h2 className="font-semibold">{title}</h2>
        </div>
        {status}
      </div>
      <dl className="adm-dl">{children}</dl>
    </Card>
  );
}

function Url({ value }: { value: string }) {
  if (!value) return <span className="text-muted">— ไม่ได้ตั้งค่า</span>;
  return /^https?:\/\//.test(value) ? (
    <a href={value} target="_blank" rel="noopener noreferrer" className="adm-link break-all">
      {value}
    </a>
  ) : (
    <span className="break-all">{value}</span>
  );
}

export function SettingsPage() {
  const { request, can } = useAdmin();
  const allowed = can("settings:manage");
  const [data, setData] = useState<SettingsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!allowed) return;
    const ctrl = new AbortController();
    request<{ data: SettingsOverview }>("settings/overview", { signal: ctrl.signal })
      .then((r) => {
        setData(r.data);
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, allowed, reload]);

  const header = <PageHeader title="การตั้งค่า" description="ภาพรวมการตั้งค่าเซิร์ฟเวอร์ (อ่านอย่างเดียว)" />;
  if (!allowed) {
    return (
      <>
        {header}
        <NoAccess />
      </>
    );
  }
  if (error && !data) {
    return (
      <>
        {header}
        <div className="adm-card">
          <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />
        </div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <Alert tone="info" className="mb-4">
        ค่าเหล่านี้กำหนดผ่านตัวแปรสภาพแวดล้อม (Environment variables) บนเซิร์ฟเวอร์ — แก้ไขที่ Railway แล้ว deploy ใหม่ หน้านี้ไม่แสดงรหัสลับใด ๆ
      </Alert>
      <div className="grid gap-4 md:grid-cols-2">
        <SettingCard
          icon={Server}
          title="ระบบ"
          status={<Badge tone={data.app_env === "production" ? "success" : "info"}>{data.app_env || "—"}</Badge>}
        >
          <dt>Migrate ตอนเริ่มระบบ</dt>
          <dd>{data.migrate_on_start ? "เปิด" : "ปิด"}</dd>
          <dt>ตัวตั้งเวลาเผยแพร่</dt>
          <dd>ตรวจทุก {data.scheduler_interval_seconds.toLocaleString("th-TH")} วินาที</dd>
        </SettingCard>

        <SettingCard icon={Globe} title="URL" status={<Configured ok={Boolean(data.public_base_url && data.web_base_url)} />}>
          <dt>API (Public base URL)</dt>
          <dd>
            <Url value={data.public_base_url} />
          </dd>
          <dt>เว็บไซต์ (Web base URL)</dt>
          <dd>
            <Url value={data.web_base_url} />
          </dd>
          <dt>Revalidate webhook</dt>
          <dd>
            <Configured ok={data.revalidate_webhook} />
          </dd>
        </SettingCard>

        <SettingCard icon={Mail} title="อีเมลแจ้งเตือน" status={<Configured ok={data.email.configured} />}>
          <dt>ผู้ให้บริการ</dt>
          <dd>{data.email.provider === "resend" ? "Resend" : data.email.provider === "smtp" ? "SMTP" : "—"}</dd>
          <dt>จำนวนผู้รับ</dt>
          <dd>{data.email.recipients.toLocaleString("th-TH")} คน</dd>
          <dt>ส่งลิงก์เชิญทางอีเมล</dt>
          <dd>{data.email.configured && data.web_base_url ? "พร้อมใช้งาน" : "ไม่พร้อม — ต้องตั้งค่าอีเมลและ Web base URL"}</dd>
        </SettingCard>

        <SettingCard icon={MessageCircle} title="LINE แจ้งเตือน" status={<Configured ok={data.line.configured} />}>
          <dt>ช่องทาง</dt>
          <dd>LINE Messaging API (push)</dd>
          <dt>สถานะ</dt>
          <dd>{data.line.configured ? "ส่งแจ้งเตือน Lead ใหม่ทาง LINE" : "ไม่ส่งแจ้งเตือนทาง LINE"}</dd>
        </SettingCard>

        <SettingCard icon={Clock} title="ความปลอดภัย">
          <dt>อายุเซสชัน</dt>
          <dd>{hours(data.session_ttl_hours)}</dd>
          <dt>อายุลิงก์เชิญ/รีเซ็ต</dt>
          <dd>{hours(data.invite_ttl_hours)}</dd>
        </SettingCard>

        <SettingCard icon={Upload} title="คลังสื่อ">
          <dt>ขนาดไฟล์สูงสุด</dt>
          <dd>{data.max_upload_mb.toLocaleString("th-TH")} MB</dd>
          <dt>ชนิดไฟล์</dt>
          <dd>JPEG, PNG, WebP, AVIF, GIF</dd>
        </SettingCard>
      </div>
    </>
  );
}
