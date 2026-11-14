"use client";

/**
 * /admin/invite#token=… — accept an invite or a password reset link.
 * The token lives in the URL fragment (never sent to servers/logs/Referer);
 * it is read once, kept in memory, and the hash is removed from the URL.
 */
import { CheckCircle2, KeyRound, LinkIcon, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, rawRequest, toApiError } from "@/lib/admin/client";
import { ROLE_DESCRIPTION } from "@/lib/admin/permissions";
import { validateNewPassword } from "@/lib/admin/password";
import type { TokenInfo } from "@/lib/admin/types";
import { formatDateTime } from "@/lib/admin/format";
import { errorMessage } from "../SessionProvider";
import { Alert } from "../ui/Alert";
import { RoleBadge } from "../ui/Badge";
import { Button, ButtonLink } from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { Skeleton } from "../ui/Skeleton";
import { AuthFrame } from "./AuthFrame";
import { NewPasswordFields } from "./PasswordFields";

type State =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; token: string; info: TokenInfo }
  | { kind: "done" };

// Module cache: StrictMode runs effects twice, and the hash is cleared on the first read.
let cachedToken: string | null | undefined;

function readToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  const hash = window.location.hash.replace(/^#/, "");
  const token = new URLSearchParams(hash).get("token");
  if (window.location.hash) {
    // Drop the secret from the address bar / history entry.
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }
  cachedToken = token && /^[A-Za-z0-9_-]{16,256}$/.test(token) ? token : null;
  return cachedToken;
}

export function InviteAccept() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const token = readToken();
    const ctrl = new AbortController();
    const fail = (message: string) => setState({ kind: "invalid", message });
    if (!token) {
      Promise.resolve().then(() => fail("ไม่พบโทเคนในลิงก์ กรุณาเปิดลิงก์จากอีเมลหรือข้อความที่ได้รับอีกครั้ง"));
      return () => ctrl.abort();
    }
    rawRequest("auth/tokens/inspect", { method: "POST", json: { token }, signal: ctrl.signal }, null)
      .then(async (res) => {
        if (!res.ok) throw await toApiError(res);
        const json = (await res.json()) as { data: TokenInfo };
        setState({ kind: "ready", token, info: json.data });
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        fail(
          err instanceof ApiError && err.status === 404
            ? err.message || "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว"
            : errorMessage(err) || "ตรวจสอบลิงก์ไม่สำเร็จ",
        );
      });
    return () => ctrl.abort();
  }, []);

  if (state.kind === "loading") {
    return (
      <AuthFrame>
        <div className="grid gap-3" role="status">
          <span className="adm-sr-only">กำลังตรวจสอบลิงก์…</span>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="mt-3 h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthFrame>
    );
  }

  if (state.kind === "invalid") {
    return (
      <AuthFrame>
        <div className="grid justify-items-center gap-2 text-center" role="alert">
          <span className="adm-empty-icon" style={{ background: "var(--adm-danger-bg)", color: "var(--adm-danger)", borderColor: "var(--adm-danger-border)" }}>
            <LinkIcon size={22} aria-hidden="true" />
          </span>
          <h1 className="text-lg font-semibold thai-heading">ใช้ลิงก์นี้ไม่ได้</h1>
          <p className="text-sm text-muted">{state.message}</p>
          <p className="text-sm text-muted">ลิงก์มีอายุจำกัดและใช้ได้ครั้งเดียว — ขอให้เจ้าของระบบส่งลิงก์ใหม่ให้</p>
          <ButtonLink href="/admin/login" className="mt-3">
            ไปหน้าเข้าสู่ระบบ
          </ButtonLink>
        </div>
      </AuthFrame>
    );
  }

  if (state.kind === "done") {
    return (
      <AuthFrame>
        <div className="grid justify-items-center gap-2 text-center" role="status">
          <span className="adm-empty-icon" style={{ background: "var(--adm-success-bg)", color: "var(--adm-success)", borderColor: "var(--adm-success-border)" }}>
            <CheckCircle2 size={22} aria-hidden="true" />
          </span>
          <h1 className="text-lg font-semibold thai-heading">เรียบร้อย กำลังพาเข้าสู่ระบบ…</h1>
        </div>
      </AuthFrame>
    );
  }

  return <AcceptForm token={state.token} info={state.info} onDone={() => setState({ kind: "done" })} />;
}

function AcceptForm({ token, info, onDone }: { token: string; info: TokenInfo; onDone: () => void }) {
  const isInvite = info.purpose === "invite";
  const [name, setName] = useState(info.name ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ name?: string; password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fe: typeof errors = validateNewPassword(password, confirm);
    const n = name.trim();
    if (isInvite && !n) fe.name = "กรุณากรอกชื่อที่จะแสดงในระบบ";
    else if (isInvite && n.length > 100) fe.name = "ชื่อยาวเกินไป (สูงสุด 100 ตัวอักษร)";
    setErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      const body: Record<string, string> = { token, password };
      if (isInvite || n) body.name = n;
      const res = await rawRequest("auth/tokens/accept", { method: "POST", json: body }, null);
      if (!res.ok) throw await toApiError(res);
      onDone();
      // The API set the session cookie; load the console with a fresh server check.
      window.location.replace("/admin");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setErrors({ name: err.fields.name, password: err.fields.password });
      }
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <div className="flex items-start gap-3">
          <span className="adm-empty-icon m-0 h-10 w-10 shrink-0" aria-hidden="true">
            {isInvite ? <UserPlus size={19} /> : <KeyRound size={19} />}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold thai-heading">{isInvite ? "ตั้งค่าบัญชีของคุณ" : "ตั้งรหัสผ่านใหม่"}</h1>
            <p className="text-sm text-muted">
              {isInvite ? "คุณได้รับคำเชิญให้เข้าร่วมระบบหลังบ้าน ECOMACROBIZ" : "ตั้งรหัสผ่านใหม่สำหรับบัญชีนี้ อุปกรณ์อื่นที่เคยเข้าสู่ระบบจะถูกออกจากระบบ"}
            </p>
          </div>
        </div>

        <dl className="grid gap-1.5 rounded-xl border border-line bg-surface-2 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted">อีเมล</dt>
            <dd className="min-w-0 break-all font-medium">{info.email}</dd>
          </div>
          {isInvite && info.role ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted">บทบาท</dt>
              <dd>
                <RoleBadge role={info.role} />
              </dd>
              <dd className="w-full text-xs text-muted">{ROLE_DESCRIPTION[info.role]}</dd>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted">ลิงก์หมดอายุ</dt>
            <dd className="text-xs">{formatDateTime(info.expires_at)}</dd>
          </div>
        </dl>

        {error ? <Alert>{error}</Alert> : null}

        {isInvite ? (
          <Field label="ชื่อที่แสดง" required error={errors.name}>
            {(p) => (
              <Input {...p} autoComplete="name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
            )}
          </Field>
        ) : null}
        {/* Hidden username helps password managers save the new credentials. */}
        <input type="email" autoComplete="username" value={info.email} readOnly hidden />
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          errors={errors}
          label={isInvite ? "ตั้งรหัสผ่าน" : "รหัสผ่านใหม่"}
          autoFocus={!isInvite}
        />
        <Button type="submit" variant="primary" size="lg" block loading={busy} loadingText="กำลังบันทึก…">
          {isInvite ? "สร้างบัญชีและเข้าสู่ระบบ" : "บันทึกรหัสผ่านและเข้าสู่ระบบ"}
        </Button>
      </form>
    </AuthFrame>
  );
}
