"use client";

/** /admin/account — profile, password, active sessions (every role). */
import { Globe, LogOut, Monitor, Smartphone, Tablet } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/admin/client";
import { formatDateTime } from "@/lib/admin/format";
import { ROLE_DESCRIPTION } from "@/lib/admin/permissions";
import { validateNewPassword } from "@/lib/admin/password";
import { formatRelative } from "@/lib/admin/time";
import type { AccountSession, AdminUser } from "@/lib/admin/types";
import { NewPasswordFields, PasswordInput } from "../auth/PasswordFields";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import { Alert } from "../ui/Alert";
import { Avatar } from "../ui/Avatar";
import { Badge, RoleBadge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { ConfirmDialog } from "../ui/Dialog";
import { ErrorState } from "../ui/EmptyState";
import { Field, Input } from "../ui/Field";
import { PageHeader } from "../ui/PageHeader";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../ui/Toast";

/** Small UA parser: browser + OS + device kind (display only). */
export function describeUA(ua: string): { label: string; kind: "mobile" | "tablet" | "desktop" | "other" } {
  if (!ua) return { label: "อุปกรณ์ไม่ทราบชนิด", kind: "other" };
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Line\//.test(ua)
          ? "LINE"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Chrome\//.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : /curl|Go-http|python|node/i.test(ua)
                  ? "สคริปต์/โปรแกรม"
                  : "เบราว์เซอร์";
  const os = /iPad/.test(ua)
    ? "iPadOS"
    : /iPhone|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  const kind = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "tablet" : /Mobi|iPhone|Android/.test(ua) ? "mobile" : "desktop";
  return { label: os ? `${browser} บน ${os}` : browser, kind };
}

export function AccountPage() {
  const { user } = useAdmin();
  return (
    <>
      <PageHeader title="บัญชีของฉัน" description="ข้อมูลส่วนตัว รหัสผ่าน และอุปกรณ์ที่เข้าสู่ระบบ" />
      <div className="grid gap-4 xl:grid-cols-2">
        <ProfileCard user={user} />
        <PasswordCard />
        <div className="xl:col-span-2">
          <SessionsCard />
        </div>
      </div>
    </>
  );
}

function ProfileCard({ user }: { user: AdminUser }) {
  const { request, updateUser } = useAdmin();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = name.trim() !== user.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr("กรุณากรอกชื่อ");
    if (n.length > 100) return setErr("ชื่อยาวเกินไป (สูงสุด 100 ตัวอักษร)");
    setErr(null);
    setBusy(true);
    try {
      const r = await request<{ data: AdminUser }>("account/profile", { method: "PUT", json: { name: n } });
      updateUser(r.data);
      setName(r.data.name);
      toast.success("บันทึกชื่อแล้ว");
    } catch (error) {
      if (error instanceof ApiError && error.fields.name) setErr(error.fields.name);
      else if (!alreadyNotified(error)) toast.error(errorMessage(error) || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="acc-profile">
      <CardHeader titleId="acc-profile" title="โปรไฟล์" />
      <CardBody>
        <form onSubmit={submit} className="grid gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} email={user.email} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-medium">{user.email}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <RoleBadge role={user.role} />
                <span className="text-xs text-muted">{ROLE_DESCRIPTION[user.role]}</span>
              </div>
            </div>
          </div>
          <Field label="ชื่อที่แสดง" required error={err} hint="อีเมลและบทบาทเปลี่ยนได้โดยเจ้าของระบบเท่านั้น">
            {(p) => <Input {...p} value={name} maxLength={100} autoComplete="name" onChange={(e) => setName(e.target.value)} />}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={!dirty} loading={busy}>
              บันทึกชื่อ
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function PasswordCard() {
  const { request, user } = useAdmin();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ current?: string; password?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fe: typeof errors = validateNewPassword(pw, confirm);
    if (!current) fe.current = "กรุณากรอกรหัสผ่านปัจจุบัน";
    else if (pw && pw === current) fe.password = "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม";
    setErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      await request<void>("account/password", { method: "PUT", json: { current_password: current, new_password: pw } });
      setCurrent("");
      setPw("");
      setConfirm("");
      toast.success("เปลี่ยนรหัสผ่านแล้ว · ออกจากระบบอุปกรณ์อื่นแล้ว");
      window.dispatchEvent(new Event("adm-sessions-changed"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setErrors({ current: err.fields.current_password, password: err.fields.new_password });
        if (!err.fields.current_password && !err.fields.new_password) setError(err.message);
      } else if (!alreadyNotified(err)) {
        setError(errorMessage(err) || "เปลี่ยนรหัสผ่านไม่สำเร็จ");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="acc-password">
      <CardHeader titleId="acc-password" title="เปลี่ยนรหัสผ่าน" description="เมื่อเปลี่ยนแล้ว อุปกรณ์อื่นทั้งหมดจะถูกออกจากระบบ" />
      <CardBody>
        <form onSubmit={submit} noValidate className="grid gap-4">
          {error ? <Alert>{error}</Alert> : null}
          <input type="email" autoComplete="username" value={user.email} readOnly hidden />
          <Field label="รหัสผ่านปัจจุบัน" required error={errors.current}>
            {(p) => <PasswordInput {...p} value={current} onChange={setCurrent} autoComplete="current-password" />}
          </Field>
          <NewPasswordFields password={pw} confirm={confirm} onPassword={setPw} onConfirm={setConfirm} errors={errors} />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={busy} loadingText="กำลังบันทึก…">
              เปลี่ยนรหัสผ่าน
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function SessionsCard() {
  const { request } = useAdmin();
  const toast = useToast();
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    request<{ data: AccountSession[] }>("account/sessions", { signal: ctrl.signal })
      .then((r) => {
        setSessions(r.data ?? []);
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener("adm-sessions-changed", refresh);
    return () => window.removeEventListener("adm-sessions-changed", refresh);
  }, [refresh]);

  const others = (sessions ?? []).filter((s) => !s.current).length;

  async function revokeOthers() {
    setBusy(true);
    try {
      const r = await request<{ data: { revoked: number } }>("account/sessions/others", { method: "DELETE" });
      toast.success(`ออกจากระบบอุปกรณ์อื่นแล้ว ${r.data?.revoked ?? others} เครื่อง`);
      setConfirm(false);
      refresh();
    } catch (err) {
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="acc-sessions">
      <CardHeader
        titleId="acc-sessions"
        title="อุปกรณ์ที่เข้าสู่ระบบอยู่"
        description="หากพบอุปกรณ์ที่ไม่รู้จัก ให้ออกจากระบบทั้งหมดแล้วเปลี่ยนรหัสผ่าน"
        actions={
          <Button variant="danger" size="sm" icon={<LogOut size={15} aria-hidden="true" />} disabled={!others} onClick={() => setConfirm(true)}>
            ออกจากระบบอุปกรณ์อื่นทั้งหมด
          </Button>
        }
      />
      <CardBody>
        {error && sessions === null ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : sessions === null ? (
          <div className="grid gap-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => {
              const d = describeUA(s.user_agent);
              const Icon = d.kind === "mobile" ? Smartphone : d.kind === "tablet" ? Tablet : d.kind === "desktop" ? Monitor : Globe;
              return (
                <li key={s.id} className="flex items-start gap-3 py-3">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {d.label}
                      {s.current ? (
                        <Badge tone="success" dot>
                          อุปกรณ์นี้
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted">
                      IP {s.ip || "—"} · ใช้งานล่าสุด {s.last_seen_at ? formatRelative(s.last_seen_at) : "—"}
                    </p>
                    <p className="text-xs text-subtle">
                      เข้าสู่ระบบ {formatDateTime(s.created_at)} · หมดอายุ {formatDateTime(s.expires_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirm}
        title="ออกจากระบบอุปกรณ์อื่นทั้งหมด?"
        danger
        busy={busy}
        confirmLabel="ออกจากระบบอุปกรณ์อื่น"
        message={`อุปกรณ์อื่น ${others} เครื่องจะต้องเข้าสู่ระบบใหม่ อุปกรณ์นี้ยังใช้งานต่อได้`}
        onClose={() => setConfirm(false)}
        onConfirm={revokeOthers}
      />
    </Card>
  );
}
