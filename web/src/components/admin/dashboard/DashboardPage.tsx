"use client";

import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Download,
  FilePen,
  FilePlus2,
  FileText,
  PhoneCall,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { downloadResponse, toApiError } from "@/lib/admin/client";
import { formatDateTime, LEAD_STATUSES, POST_STATUS_LABEL } from "@/lib/admin/format";
import { formatRelative, todayLong } from "@/lib/admin/time";
import type { Dashboard as DashboardData, Lead, PostSummary } from "@/lib/admin/types";
import { LeadsDailyChart } from "./LeadsDailyChart";
import { leadName } from "../leads/lead-utils";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import { Badge, LEAD_STATUS_SHORT, LEAD_STATUS_TONE, LeadStatusBadge } from "../ui/Badge";
import { Button, ButtonLink } from "../ui/Button";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { EmptyState, ErrorState, NoAccess } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { Skeleton } from "../ui/Skeleton";
import { Delta, StatCard } from "../ui/Stat";
import { useToast } from "../ui/Toast";

export function DashboardPage() {
  const { request, requestRaw, user, can, canAny } = useAdmin();
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  const allowed = canAny("posts:read", "leads:read");

  useEffect(() => {
    if (!allowed) return;
    const ctrl = new AbortController();
    request<{ data: DashboardData }>("dashboard", { signal: ctrl.signal })
      .then((r) => {
        setData(r.data);
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, reload, allowed]);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const res = await requestRaw("leads/export.csv");
      if (!res.ok) throw await toApiError(res);
      await downloadResponse(res, "leads.csv");
      toast.success("ดาวน์โหลดไฟล์ CSV แล้ว");
    } catch (err) {
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "ส่งออกไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }, [requestRaw, toast]);

  const firstName = user.name.trim().split(/\s+/)[0];
  const header = (
    <PageHeader
      title={`สวัสดี${firstName ? ` คุณ${firstName}` : ""}`}
      description={todayLong()}
      actions={
        <>
          {can("posts:write") ? (
            <ButtonLink href="/admin/posts/new" variant="primary" icon={<FilePlus2 size={16} aria-hidden="true" />}>
              เขียนบทความใหม่
            </ButtonLink>
          ) : null}
          {can("users:manage") ? (
            <ButtonLink href="/admin/users?invite=1" icon={<UserPlus size={16} aria-hidden="true" />}>
              เชิญผู้ใช้
            </ButtonLink>
          ) : null}
          {can("leads:export") ? (
            <Button onClick={exportCsv} loading={exporting} icon={<Download size={16} aria-hidden="true" />}>
              ส่งออก Leads
            </Button>
          ) : null}
        </>
      }
    />
  );

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

  const loading = data === null;
  const showLeads = loading ? can("leads:read") : data.leads !== null;
  const showPosts = loading ? can("posts:read") : data.posts !== null;
  const L = data?.leads ?? null;
  const P = data?.posts ?? null;

  return (
    <>
      {header}
      <div className="grid grid-cols-1 gap-6">
        {showLeads ? (
          <section aria-labelledby="dash-leads" className="grid min-w-0 grid-cols-1 gap-3">
            <h2 id="dash-leads" className="text-base font-semibold">
              ผู้ติดต่อ (Leads)
            </h2>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard
                label="วันนี้"
                icon={<CalendarDays size={16} aria-hidden="true" />}
                value={L?.today}
                loading={loading}
                foot={L ? <Delta current={L.today} previous={L.yesterday} label="เทียบเมื่อวาน" /> : null}
                href="/admin/leads"
              />
              <StatCard
                label="7 วันล่าสุด"
                icon={<CalendarRange size={16} aria-hidden="true" />}
                value={L?.last7}
                loading={loading}
                foot={L ? <Delta current={L.last7} previous={L.prev7} label="เทียบ 7 วันก่อน" /> : null}
              />
              <StatCard
                label="30 วันล่าสุด"
                icon={<CalendarRange size={16} aria-hidden="true" />}
                value={L?.last30}
                loading={loading}
                foot={L ? <Delta current={L.last30} previous={L.prev30} label="เทียบ 30 วันก่อน" /> : null}
              />
              <StatCard
                label="รอติดต่อกลับ"
                icon={<PhoneCall size={16} aria-hidden="true" />}
                value={L?.by_status.new}
                loading={loading}
                href="/admin/leads?status=new"
                foot={<span className="adm-stat-foot">สถานะ “ใหม่” ทั้งหมด</span>}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <Card as="section" aria-labelledby="dash-chart">
                <CardHeader titleId="dash-chart" as="h3" title="Leads ใหม่รายวัน" description="30 วันล่าสุด (เวลาประเทศไทย)" />
                <CardBody>{L ? <LeadsDailyChart daily={L.daily} /> : <Skeleton className="h-[15rem] w-full" />}</CardBody>
              </Card>
              <Card as="section" aria-labelledby="dash-status">
                <CardHeader titleId="dash-status" as="h3" title="ตามสถานะ" description="Leads ทั้งหมดในระบบ" />
                <CardBody>
                  {L ? <StatusBreakdown byStatus={L.by_status} /> : <Skeleton className="h-48 w-full" />}
                </CardBody>
              </Card>
            </div>
          </section>
        ) : null}

        {showPosts ? (
          <section aria-labelledby="dash-posts" className="grid min-w-0 grid-cols-1 gap-3">
            <h2 id="dash-posts" className="text-base font-semibold">
              บทความ
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatCard
                label="เผยแพร่แล้ว"
                icon={<Send size={16} aria-hidden="true" />}
                value={P?.published}
                loading={loading}
                href="/admin/posts?status=published"
              />
              <StatCard
                label="ฉบับร่าง"
                icon={<FilePen size={16} aria-hidden="true" />}
                value={P?.drafts}
                loading={loading}
                href="/admin/posts?status=draft"
              />
              <StatCard
                className="col-span-2 lg:col-span-1"
                label="ตั้งเวลาเผยแพร่"
                icon={<CalendarClock size={16} aria-hidden="true" />}
                value={P?.scheduled}
                loading={loading}
                href="/admin/posts?status=scheduled"
                foot={
                  P ? (
                    <span className="adm-stat-foot">
                      {P.next_scheduled_at
                        ? `ถัดไป ${formatDateTime(P.next_scheduled_at)} (${formatRelative(P.next_scheduled_at)})`
                        : "ไม่มีบทความที่รอเผยแพร่"}
                    </span>
                  ) : null
                }
              />
            </div>
          </section>
        ) : null}

        {showLeads || showPosts ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {showLeads ? <RecentLeads leads={L?.recent ?? null} /> : null}
            {showPosts ? <RecentPosts posts={P?.recent ?? null} canWrite={can("posts:write")} /> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function StatusBreakdown({ byStatus }: { byStatus: Record<string, number> }) {
  const total = LEAD_STATUSES.reduce((a, s) => a + (byStatus[s] ?? 0), 0);
  if (total === 0) return <p className="text-sm text-muted">ยังไม่มี Leads</p>;
  const max = Math.max(...LEAD_STATUSES.map((s) => byStatus[s] ?? 0));
  return (
    <ul className="grid gap-3">
      {LEAD_STATUSES.map((s) => {
        const v = byStatus[s] ?? 0;
        return (
          <li key={s}>
            <Link href={`/admin/leads?status=${s}`} className="group grid gap-1.5 rounded-lg no-underline">
              <span className="flex items-center justify-between gap-2 text-sm">
                <span className="group-hover:underline">{LEAD_STATUS_SHORT[s]}</span>
                <span className="font-display font-semibold tabular-nums">
                  {v.toLocaleString("th-TH")}
                  <span className="ml-1.5 text-xs font-normal text-muted">{total ? Math.round((v / total) * 100) : 0}%</span>
                </span>
              </span>
              <span className="block h-1.5 rounded-full bg-surface-2" aria-hidden="true">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${max ? Math.max(v ? 3 : 0, (v / max) * 100) : 0}%`,
                    background: `var(--adm-${LEAD_STATUS_TONE[s] === "neutral" ? "chart-axis" : LEAD_STATUS_TONE[s]})`,
                  }}
                />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function RecentLeads({ leads }: { leads: Lead[] | null }) {
  return (
    <Card as="section" aria-labelledby="dash-recent-leads">
      <CardHeader
        titleId="dash-recent-leads"
        title="Leads ล่าสุด"
        actions={
          <Link href="/admin/leads" className="adm-link text-sm">
            ดูทั้งหมด
          </Link>
        }
      />
      <CardBody className="pt-2">
        {leads === null ? (
          <div className="grid gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <EmptyState icon={<Users size={22} />} title="ยังไม่มีผู้ติดต่อ" description="Leads จากฟอร์มหน้า Contact จะแสดงที่นี่" />
        ) : (
          <ul className="divide-y divide-line">
            {leads.map((l) => (
              <li key={l.id}>
                <Link href={`/admin/leads?lead=${encodeURIComponent(l.id)}`} className="flex items-center gap-3 py-2.5 no-underline hover:bg-transparent">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium hover:underline">{leadName(l)}</span>
                    <span className="block truncate text-xs text-muted">{l.company || l.email || l.phone || "—"}</span>
                  </span>
                  <span className="hidden text-xs text-muted sm:inline" title={formatDateTime(l.created_at)}>
                    {formatRelative(l.created_at)}
                  </span>
                  <LeadStatusBadge status={l.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function RecentPosts({ posts, canWrite }: { posts: PostSummary[] | null; canWrite: boolean }) {
  return (
    <Card as="section" aria-labelledby="dash-recent-posts">
      <CardHeader
        titleId="dash-recent-posts"
        title="บทความที่แก้ไขล่าสุด"
        actions={
          <Link href="/admin/posts" className="adm-link text-sm">
            ดูทั้งหมด
          </Link>
        }
      />
      <CardBody className="pt-2">
        {posts === null ? (
          <div className="grid gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={<FileText size={22} />}
            title="ยังไม่มีบทความ"
            action={
              canWrite ? (
                <ButtonLink href="/admin/posts/new" variant="primary" size="sm">
                  เขียนบทความแรก
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {posts.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/posts/${encodeURIComponent(p.id)}`} className="flex items-center gap-3 py-2.5 no-underline">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium hover:underline">{p.title || "(ไม่มีชื่อ)"}</span>
                    <span className="block truncate text-xs text-muted">
                      แก้ไข {formatRelative(p.updated_at)}
                      {p.created_by ? ` · โดย ${p.created_by.name || p.created_by.email}` : ""}
                    </span>
                  </span>
                  <Badge tone={p.status === "published" ? "success" : p.status === "scheduled" ? "info" : "neutral"} dot>
                    {POST_STATUS_LABEL[p.status] ?? p.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
