"use client";

/** /admin/users — users table, pending invites, invite + per-user actions (owner). */
import {
  Ban,
  CheckCircle2,
  Clock,
  KeyRound,
  Mail,
  MailCheck,
  MailX,
  MoreHorizontal,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/admin/client";
import { formatDateTime } from "@/lib/admin/format";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES, type Role } from "@/lib/admin/permissions";
import { formatRelative } from "@/lib/admin/time";
import type { AdminUser, Invite, InviteCreated, ResetLink } from "@/lib/admin/types";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import { Alert } from "../ui/Alert";
import { Avatar } from "../ui/Avatar";
import { ActiveBadge, Badge, RoleBadge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { CopyField } from "../ui/CopyField";
import { ConfirmDialog, Dialog } from "../ui/Dialog";
import { EmptyState, ErrorState, NoAccess } from "../ui/EmptyState";
import { Field, Input } from "../ui/Field";
import { Menu, type MenuItem } from "../ui/Menu";
import { PageHeader } from "../ui/PageHeader";
import { TableSkeleton } from "../ui/Skeleton";
import { Table } from "../ui/Table";
import { Tabs } from "../ui/Tabs";
import { useToast } from "../ui/Toast";

type Tab = "users" | "invites";
type LinkResult = { kind: "invite" | "resend" | "reset"; email: string; token: string; expires_at: string; email_sent: boolean };
type Pending =
  | { kind: "role"; user: AdminUser }
  | { kind: "active"; user: AdminUser; to: boolean }
  | { kind: "reset"; user: AdminUser }
  | { kind: "delete"; user: AdminUser }
  | { kind: "revoke"; invite: Invite }
  | null;

function inviteUrl(token: string) {
  return `${window.location.origin}/admin/invite#token=${encodeURIComponent(token)}`;
}

/** 409 last_owner / conflict messages come straight from the API (Thai). */
function apiMsg(err: unknown, fallback: string) {
  return errorMessage(err) || fallback;
}

export function UsersPage() {
  const { request, can, user: me } = useAdmin();
  const toast = useToast();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const manage = can("users:manage");

  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [result, setResult] = useState<LinkResult | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // ?invite=1 (command palette / dashboard) opens the invite dialog once.
  const wantsInvite = sp.get("invite") === "1";
  useEffect(() => {
    if (!wantsInvite) return;
    if (manage) Promise.resolve().then(() => setInviteOpen(true));
    router.replace(pathname, { scroll: false });
  }, [wantsInvite, manage, router, pathname]);

  useEffect(() => {
    if (!can("users:read")) return;
    const ctrl = new AbortController();
    Promise.all([
      request<{ data: AdminUser[] }>("users", { signal: ctrl.signal }),
      request<{ data: Invite[] }>("invites", { signal: ctrl.signal }),
    ])
      .then(([u, i]) => {
        setUsers(u.data ?? []);
        setInvites(i.data ?? []);
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, can, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  if (!can("users:read")) {
    return (
      <>
        <PageHeader title="ผู้ใช้และสิทธิ์" />
        <NoAccess />
      </>
    );
  }

  const activeOwners = (users ?? []).filter((u) => u.role === "owner" && u.is_active);
  const isLastOwner = (u: AdminUser) => u.role === "owner" && u.is_active && activeOwners.length <= 1;

  function open(p: Pending) {
    setDialogError(null);
    setPending(p);
  }
  function closePending() {
    if (!busy) setPending(null);
  }

  async function run<T>(fn: () => Promise<T>, onOk: (v: T) => void) {
    setBusy(true);
    setDialogError(null);
    try {
      const v = await fn();
      onOk(v);
      setPending(null);
    } catch (err) {
      if (!alreadyNotified(err)) setDialogError(apiMsg(err, "ทำรายการไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  function replaceUser(u: AdminUser) {
    setUsers((list) => (list ? list.map((x) => (x.id === u.id ? u : x)) : list));
  }

  function userActions(u: AdminUser): MenuItem[] {
    const self = u.id === me.id;
    const lastOwner = isLastOwner(u);
    return [
      {
        label: "เปลี่ยนบทบาท",
        icon: <Shield size={16} aria-hidden="true" />,
        // Self: only a demotion while another active owner exists; never the last owner.
        hidden: lastOwner || (self && activeOwners.length <= 1),
        onSelect: () => open({ kind: "role", user: u }),
      },
      {
        label: "สร้างลิงก์ตั้งรหัสผ่าน",
        icon: <KeyRound size={16} aria-hidden="true" />,
        hidden: self || !u.is_active,
        onSelect: () => open({ kind: "reset", user: u }),
      },
      { type: "separator", hidden: self || lastOwner },
      {
        label: u.is_active ? "ระงับการใช้งาน" : "เปิดใช้งานอีกครั้ง",
        icon: u.is_active ? <Ban size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />,
        hidden: self || lastOwner,
        danger: u.is_active,
        onSelect: () => open({ kind: "active", user: u, to: !u.is_active }),
      },
      {
        label: "ลบผู้ใช้",
        icon: <Trash2 size={16} aria-hidden="true" />,
        hidden: self || lastOwner,
        danger: true,
        onSelect: () => open({ kind: "delete", user: u }),
      },
    ];
  }

  const openInvites = invites?.length ?? 0;

  return (
    <>
      <PageHeader
        title="ผู้ใช้และสิทธิ์"
        description="จัดการทีมงานที่เข้าถึงระบบหลังบ้าน และบทบาทของแต่ละคน"
        actions={
          manage ? (
            <Button variant="primary" icon={<UserPlus size={16} aria-hidden="true" />} onClick={() => setInviteOpen(true)}>
              เชิญผู้ใช้
            </Button>
          ) : null
        }
      />

      <Tabs<Tab>
        label="ส่วนของหน้า"
        idBase="users"
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { value: "users", label: `ผู้ใช้${users ? ` (${users.length})` : ""}` },
          { value: "invites", label: `คำเชิญที่รอตอบรับ${invites ? ` (${openInvites})` : ""}` },
        ]}
      />

      <div role="tabpanel" id={`users-panel-${tab}`} aria-labelledby={`users-tab-${tab}`}>
        {error && users === null ? (
          <div className="adm-card">
            <ErrorState message={error} onRetry={refresh} />
          </div>
        ) : users === null || invites === null ? (
          <TableSkeleton rows={5} cols={5} />
        ) : tab === "users" ? (
          <Table caption="รายชื่อผู้ใช้" minWidth="48rem">
            <thead>
              <tr>
                <th scope="col">ผู้ใช้</th>
                <th scope="col">บทบาท</th>
                <th scope="col">สถานะ</th>
                <th scope="col">เข้าสู่ระบบล่าสุด</th>
                {manage ? (
                  <th scope="col">
                    <span className="adm-sr-only">การทำงาน</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const items = userActions(u).filter((i) => !i.hidden);
                const hasItems = items.some((i) => i.type !== "separator");
                return (
                  <tr key={u.id}>
                    <td>
                      <span className="flex items-center gap-3">
                        <Avatar name={u.name} email={u.email} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 font-medium">
                            <span className="truncate">{u.name || "—"}</span>
                            {u.id === me.id ? <Badge tone="info">คุณ</Badge> : null}
                          </span>
                          <span className="block truncate text-xs text-muted">{u.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <RoleBadge role={u.role} />
                    </td>
                    <td>
                      <ActiveBadge active={u.is_active} />
                    </td>
                    <td className="whitespace-nowrap text-sm">
                      {u.last_login_at ? (
                        <span title={formatDateTime(u.last_login_at)}>{formatRelative(u.last_login_at)}</span>
                      ) : (
                        <span className="text-muted">ยังไม่เคยเข้าสู่ระบบ</span>
                      )}
                    </td>
                    {manage ? (
                      <td className="w-12 text-right">
                        {hasItems ? (
                          <Menu
                            label={`การทำงานสำหรับ ${u.name || u.email}`}
                            items={items}
                            trigger={(p) => (
                              <button type="button" className="adm-icon-btn" {...p} aria-label={`การทำงานสำหรับ ${u.name || u.email}`}>
                                <MoreHorizontal size={18} aria-hidden="true" />
                              </button>
                            )}
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : invites.length === 0 ? (
          <div className="adm-card">
            <EmptyState
              icon={<Mail size={22} />}
              title="ไม่มีคำเชิญที่รอตอบรับ"
              description="คำเชิญที่ส่งแล้วแต่ยังไม่ได้ตั้งค่าบัญชีจะแสดงที่นี่"
              action={
                manage ? (
                  <Button variant="primary" size="sm" icon={<UserPlus size={15} aria-hidden="true" />} onClick={() => setInviteOpen(true)}>
                    เชิญผู้ใช้
                  </Button>
                ) : null
              }
            />
          </div>
        ) : (
          <Table caption="คำเชิญที่รอตอบรับ" minWidth="48rem">
            <thead>
              <tr>
                <th scope="col">อีเมล</th>
                <th scope="col">บทบาท</th>
                <th scope="col">เชิญโดย</th>
                <th scope="col">หมดอายุ</th>
                {manage ? (
                  <th scope="col">
                    <span className="adm-sr-only">การทำงาน</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-medium">{inv.email}</td>
                  <td>
                    <RoleBadge role={inv.role} />
                  </td>
                  <td className="text-sm text-muted">{inv.invited_by ? inv.invited_by.name || inv.invited_by.email : "—"}</td>
                  <td className="whitespace-nowrap text-sm">
                    {inv.expired ? (
                      <Badge tone="danger" icon={<Clock size={12} aria-hidden="true" />}>
                        หมดอายุแล้ว
                      </Badge>
                    ) : (
                      <span title={formatDateTime(inv.expires_at)}>{formatRelative(inv.expires_at)}</span>
                    )}
                  </td>
                  {manage ? (
                    <td className="whitespace-nowrap text-right">
                      <span className="inline-flex gap-1.5">
                        <Button
                          size="sm"
                          icon={<RefreshCw size={14} aria-hidden="true" />}
                          onClick={async () => {
                            try {
                              const r = await request<{ data: InviteCreated }>(`invites/${encodeURIComponent(inv.id)}/resend`, { method: "POST" });
                              setInvites((l) => (l ? l.map((x) => (x.id === inv.id ? r.data.invite : x)) : l));
                              setResult({ kind: "resend", email: inv.email, token: r.data.token, expires_at: r.data.invite.expires_at, email_sent: r.data.email_sent });
                            } catch (err) {
                              if (!alreadyNotified(err)) toast.error(apiMsg(err, "ส่งคำเชิญใหม่ไม่สำเร็จ"));
                            }
                          }}
                        >
                          ส่งใหม่
                        </Button>
                        <Button size="sm" variant="danger" icon={<XCircle size={14} aria-hidden="true" />} onClick={() => open({ kind: "revoke", invite: inv })}>
                          ยกเลิก
                        </Button>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {manage ? (
        <InviteDialog
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          onCreated={(r) => {
            setInviteOpen(false);
            setInvites((l) => [r.invite, ...(l ?? []).filter((x) => x.email.toLowerCase() !== r.invite.email.toLowerCase())]);
            setResult({ kind: "invite", email: r.invite.email, token: r.token, expires_at: r.invite.expires_at, email_sent: r.email_sent });
            setTab("invites");
          }}
        />
      ) : null}

      <LinkResultDialog result={result} onClose={() => setResult(null)} />

      {pending?.kind === "role" ? (
        <RoleDialog
          user={pending.user}
          self={pending.user.id === me.id}
          busy={busy}
          error={dialogError}
          onClose={closePending}
          onSave={(role) =>
            run(
              () => request<{ data: AdminUser }>(`users/${encodeURIComponent(pending.user.id)}`, { method: "PATCH", json: { role } }),
              (r) => {
                replaceUser(r.data);
                toast.success(`เปลี่ยนบทบาทของ ${r.data.name || r.data.email} เป็น ${ROLE_LABEL[r.data.role]} แล้ว`);
                // Demoting yourself changes what you can do: reload with fresh permissions.
                if (r.data.id === me.id) window.location.reload();
              },
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={pending?.kind === "active"}
        title={pending?.kind === "active" && pending.to ? "เปิดใช้งานผู้ใช้อีกครั้ง?" : "ระงับการใช้งานผู้ใช้?"}
        danger={pending?.kind === "active" && !pending.to}
        busy={busy}
        confirmLabel={pending?.kind === "active" && pending.to ? "เปิดใช้งาน" : "ระงับการใช้งาน"}
        message={
          pending?.kind === "active" ? (
            <>
              {pending.to ? (
                <p>
                  <strong className="text-fg">{pending.user.name || pending.user.email}</strong> จะเข้าสู่ระบบได้อีกครั้งด้วยรหัสผ่านเดิม
                </p>
              ) : (
                <p>
                  <strong className="text-fg">{pending.user.name || pending.user.email}</strong> จะถูกออกจากระบบทุกอุปกรณ์ทันที
                  และเข้าสู่ระบบไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง ข้อมูลและประวัติการทำงานยังอยู่ครบ
                </p>
              )}
              {dialogError ? <Alert className="mt-3">{dialogError}</Alert> : null}
            </>
          ) : null
        }
        onClose={closePending}
        onConfirm={() => {
          if (pending?.kind !== "active") return;
          void run(
            () => request<{ data: AdminUser }>(`users/${encodeURIComponent(pending.user.id)}`, { method: "PATCH", json: { is_active: pending.to } }),
            (r) => {
              replaceUser(r.data);
              toast.success(r.data.is_active ? "เปิดใช้งานผู้ใช้แล้ว" : "ระงับผู้ใช้และออกจากระบบทุกอุปกรณ์แล้ว");
            },
          );
        }}
      />

      <ConfirmDialog
        open={pending?.kind === "reset"}
        title="สร้างลิงก์ตั้งรหัสผ่านใหม่?"
        busy={busy}
        confirmLabel="สร้างลิงก์"
        message={
          pending?.kind === "reset" ? (
            <>
              <p>
                ระบบจะสร้างลิงก์สำหรับ <strong className="text-fg">{pending.user.email}</strong> ให้ตั้งรหัสผ่านใหม่ ลิงก์เดิมที่ยังไม่ถูกใช้จะใช้ไม่ได้
                เมื่อผู้ใช้ตั้งรหัสผ่านใหม่ อุปกรณ์ทั้งหมดของเขาจะถูกออกจากระบบ
              </p>
              {dialogError ? <Alert className="mt-3">{dialogError}</Alert> : null}
            </>
          ) : null
        }
        onClose={closePending}
        onConfirm={() => {
          if (pending?.kind !== "reset") return;
          const u = pending.user;
          void run(
            () => request<{ data: ResetLink }>(`users/${encodeURIComponent(u.id)}/reset-link`, { method: "POST" }),
            (r) => setResult({ kind: "reset", email: u.email, token: r.data.token, expires_at: r.data.expires_at, email_sent: r.data.email_sent }),
          );
        }}
      />

      <ConfirmDialog
        open={pending?.kind === "delete"}
        title="ลบผู้ใช้ถาวร?"
        danger
        busy={busy}
        confirmLabel="ลบผู้ใช้"
        confirmText={pending?.kind === "delete" ? pending.user.email : undefined}
        message={
          pending?.kind === "delete" ? (
            <>
              <p>
                บัญชี <strong className="text-fg">{pending.user.email}</strong> จะถูกลบและออกจากระบบทุกอุปกรณ์ การกระทำนี้ย้อนกลับไม่ได้
                ถ้าต้องการหยุดการเข้าถึงชั่วคราว ให้ใช้ “ระงับการใช้งาน” แทน
              </p>
              {dialogError ? <Alert className="mt-3">{dialogError}</Alert> : null}
            </>
          ) : null
        }
        onClose={closePending}
        onConfirm={() => {
          if (pending?.kind !== "delete") return;
          const u = pending.user;
          void run(
            () => request<void>(`users/${encodeURIComponent(u.id)}`, { method: "DELETE" }),
            () => {
              setUsers((l) => (l ? l.filter((x) => x.id !== u.id) : l));
              toast.success(`ลบผู้ใช้ ${u.email} แล้ว`);
            },
          );
        }}
      />

      <ConfirmDialog
        open={pending?.kind === "revoke"}
        title="ยกเลิกคำเชิญ?"
        danger
        busy={busy}
        confirmLabel="ยกเลิกคำเชิญ"
        cancelLabel="ไม่ยกเลิก"
        message={
          pending?.kind === "revoke" ? (
            <>
              <p>
                ลิงก์คำเชิญของ <strong className="text-fg">{pending.invite.email}</strong> จะใช้ไม่ได้ทันที
              </p>
              {dialogError ? <Alert className="mt-3">{dialogError}</Alert> : null}
            </>
          ) : null
        }
        onClose={closePending}
        onConfirm={() => {
          if (pending?.kind !== "revoke") return;
          const inv = pending.invite;
          void run(
            () => request<void>(`invites/${encodeURIComponent(inv.id)}`, { method: "DELETE" }),
            () => {
              setInvites((l) => (l ? l.filter((x) => x.id !== inv.id) : l));
              toast.success("ยกเลิกคำเชิญแล้ว");
            },
          );
        }}
      />
    </>
  );
}

function RolePicker({ value, onChange, name }: { value: Role; onChange: (r: Role) => void; name: string }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="adm-label">บทบาท</legend>
      {ROLES.map((r) => (
        <label
          key={r}
          className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors"
          style={{
            borderColor: value === r ? "var(--adm-accent-border)" : "var(--line)",
            background: value === r ? "var(--adm-accent-bg)" : "transparent",
          }}
        >
          <input type="radio" name={name} value={r} checked={value === r} onChange={() => onChange(r)} className="mt-1 accent-[var(--accent)]" />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium text-fg">{ROLE_LABEL[r]}</span>
            <span className="text-xs text-muted">{ROLE_DESCRIPTION[r]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function InviteDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: InviteCreated) => void }) {
  const { request } = useAdmin();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEmail("");
      setRole("editor");
      setError(null);
      setFieldErr({});
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setFieldErr({ email: "กรุณากรอกอีเมลให้ถูกต้อง" });
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErr({});
    try {
      const r = await request<{ data: InviteCreated }>("invites", { method: "POST", json: { email: v, role } });
      onCreated(r.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setFieldErr(err.fields);
      if (!alreadyNotified(err)) setError(apiMsg(err, "ส่งคำเชิญไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title="เชิญผู้ใช้ใหม่"
      description="ระบบจะสร้างลิงก์ตั้งค่าบัญชี (ใช้ได้ครั้งเดียว) ให้คุณส่งต่อ"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" form="invite-form" variant="primary" loading={busy} icon={<UserPlus size={16} aria-hidden="true" />}>
            สร้างคำเชิญ
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} noValidate className="grid gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Field label="อีเมล" required error={fieldErr.email}>
          {(p) => (
            <Input {...p} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="name@company.com" />
          )}
        </Field>
        <RolePicker value={role} onChange={setRole} name="invite-role" />
        {fieldErr.role ? <p className="adm-field-error">{fieldErr.role}</p> : null}
      </form>
    </Dialog>
  );
}

function RoleDialog({
  user,
  self,
  busy,
  error,
  onClose,
  onSave,
}: {
  user: AdminUser;
  self: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (r: Role) => void;
}) {
  const [role, setRole] = useState<Role>(user.role);
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title="เปลี่ยนบทบาท"
      description={user.name ? `${user.name} · ${user.email}` : user.email}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button variant="primary" loading={busy} disabled={role === user.role} onClick={() => onSave(role)}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {self ? (
          <Alert tone="warning">คุณกำลังเปลี่ยนบทบาทของตัวเอง หากลดสิทธิ์ลง คุณจะไม่สามารถเปลี่ยนกลับได้เอง</Alert>
        ) : null}
        {error ? <Alert>{error}</Alert> : null}
        <RolePicker value={role} onChange={setRole} name="edit-role" />
      </div>
    </Dialog>
  );
}

function LinkResultDialog({ result, onClose }: { result: LinkResult | null; onClose: () => void }) {
  const title =
    result?.kind === "reset" ? "ลิงก์ตั้งรหัสผ่านใหม่พร้อมแล้ว" : result?.kind === "resend" ? "สร้างลิงก์คำเชิญใหม่แล้ว" : "สร้างคำเชิญแล้ว";
  return (
    <Dialog
      open={result !== null}
      onClose={onClose}
      title={title}
      description={result ? `สำหรับ ${result.email}` : undefined}
      footer={
        <Button variant="primary" onClick={onClose}>
          เสร็จสิ้น
        </Button>
      }
    >
      {result ? (
        <div className="grid gap-4">
          {result.email_sent ? (
            <Alert tone="success" title="ส่งอีเมลแล้ว">
              ระบบส่งลิงก์ไปที่ {result.email} แล้ว คุณยังคัดลอกลิงก์ด้านล่างไปส่งทางอื่นได้
            </Alert>
          ) : (
            <Alert tone="warning" title="ยังไม่ได้ส่งอีเมล">
              ระบบอีเมลยังไม่ได้ตั้งค่า (หรือส่งไม่สำเร็จ) — กรุณาคัดลอกลิงก์ด้านล่างแล้วส่งให้ผู้ใช้เอง เช่น ทาง LINE
            </Alert>
          )}
          <CopyField label="ลิงก์" value={inviteUrl(result.token)} hint="ลิงก์นี้แสดงเพียงครั้งเดียว ใช้ได้ครั้งเดียว อย่าโพสต์ในที่สาธารณะ" />
          <p className="flex items-center gap-1.5 text-xs text-muted">
            {result.email_sent ? <MailCheck size={14} aria-hidden="true" /> : <MailX size={14} aria-hidden="true" />}
            หมดอายุ {formatDateTime(result.expires_at)} ({formatRelative(result.expires_at)})
          </p>
        </div>
      ) : null}
    </Dialog>
  );
}

