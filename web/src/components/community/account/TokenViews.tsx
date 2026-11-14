"use client";

/**
 * E-mailed / Google link pages: /account/verify-email, /account/reset-password,
 * /account/link-google. Each reads `#token=` once, strips it from the URL
 * (history.replaceState) and talks to the API.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { communityJson, CommunityError } from "@/lib/community/client";
import { loadSession, savePendingAction, setSession, takePendingAction } from "@/lib/community/session";
import type { Session } from "@/lib/community/types";
import { PASSWORD_MESSAGES, passwordProblem } from "@/lib/community/password";
import { formatWait, pendingActionHref, readFragmentToken } from "../auth/auth-urls";
import { Alert, PasswordField, SubmitButton } from "../auth/fields";
import { AccountPageFrame, PageSpinner } from "./ui";

/** Token from the fragment, read once on mount (StrictMode-safe), then removed from the URL. */
function useFragmentToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const t = readFragmentToken(window.location.hash);
    if (window.location.hash) history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}`);
    setToken(t);
  }, []);
  return token;
}

function errText(err: unknown): string {
  if (err instanceof CommunityError && err.status === 429) {
    return `ทำรายการถี่เกินไป กรุณารอ ${formatWait(err.retryAfter ?? 60)} แล้วลองใหม่`;
  }
  return err instanceof CommunityError ? err.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่";
}

const btn = "ca-btn ca-btn-primary w-full";
const ghost = "ca-btn ca-btn-ghost w-full";

function ResultIcon({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden="true" className={`ca-success-pop mb-4 grid size-14 place-items-center rounded-full ${ok ? "bg-accent" : "bg-[#5a1d1d]"} text-white`}>
      <svg viewBox="0 0 20 20" className="size-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {ok ? <path d="m4.5 10.5 3.5 3.5 7.5-8" /> : <path d="M10 5.5v5.5m0 3.2v.3" />}
      </svg>
    </span>
  );
}

function Result({ ok, title, children }: { ok: boolean; title: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div role={ok ? "status" : "alert"} className="flex flex-col items-start">
      <ResultIcon ok={ok} />
      <h2 ref={ref} tabIndex={-1} className="thai-heading text-xl font-semibold outline-none">
        {title}
      </h2>
      <div className="mt-2 flex w-full flex-col gap-4 leading-7 text-muted">{children}</div>
    </div>
  );
}

const INVALID_LINK = "ลิงก์นี้ไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว";

/* ----------------------------------------------------------- verify e-mail */

type VerifyState = { kind: "loading" } | { kind: "done"; change: boolean } | { kind: "error"; text: string; invalid: boolean };

export function VerifyEmailView() {
  const token = useFragmentToken();
  const [state, setState] = useState<VerifyState>({ kind: "loading" });
  const sent = useRef(false);

  useEffect(() => {
    if (token === undefined || sent.current) return;
    if (!token) return;
    sent.current = true;
    communityJson<{ verified: boolean; kind: "verify" | "change_email" }>("auth/verify-email", { method: "POST", json: { token } })
      .then((r) => {
        setState({ kind: "done", change: r.kind === "change_email" });
        void loadSession(true);
      })
      .catch((err) => {
        const invalid = err instanceof CommunityError && err.code === "token_invalid";
        setState({ kind: "error", text: invalid ? INVALID_LINK : errText(err), invalid });
      });
  }, [token]);

  return (
    <AccountPageFrame eyebrow="Member account" title="ยืนยันอีเมล">
      {token === null ? (
        <Result ok={false} title="ยืนยันอีเมลไม่สำเร็จ">
          <p>{INVALID_LINK}</p>
          <Link href="/account?tab=email" className={btn}>
            ไปที่บัญชีของฉัน
          </Link>
        </Result>
      ) : state.kind === "loading" ? (
        <PageSpinner label="กำลังยืนยันอีเมล…" />
      ) : state.kind === "done" ? (
        <Result ok title={state.change ? "เปลี่ยนอีเมลเรียบร้อย" : "ยืนยันอีเมลเรียบร้อย"}>
          <p>{state.change ? "ตั้งแต่นี้ใช้อีเมลใหม่ในการเข้าสู่ระบบ" : "ขอบคุณที่ยืนยันอีเมล คุณใช้งานชุมชนได้เต็มรูปแบบแล้ว"}</p>
          <Link href="/account" className={btn}>
            ไปที่บัญชีของฉัน
          </Link>
          <Link href="/knowledge" className={ghost}>
            อ่านบทความ
          </Link>
        </Result>
      ) : (
        <Result ok={false} title="ยืนยันอีเมลไม่สำเร็จ">
          <p>{state.text}</p>
          {state.invalid && <p className="text-sm">เข้าสู่ระบบแล้วไปที่แท็บ &ldquo;อีเมล&rdquo; เพื่อขอลิงก์ยืนยันใหม่</p>}
          <Link href="/account?tab=email" className={btn}>
            ไปที่บัญชีของฉัน
          </Link>
        </Result>
      )}
    </AccountPageFrame>
  );
}

/* --------------------------------------------------------- reset password */

export function ResetPasswordView() {
  const token = useFragmentToken();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [state, setState] = useState<"form" | "done" | "invalid">("form");
  const [loading, setLoading] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const errs = { password: passwordProblem(password), confirm: confirm !== password ? PASSWORD_MESSAGES.mismatch : null };
    setErrors(errs);
    setFormError(null);
    if (errs.password) return pwRef.current?.focus();
    if (errs.confirm) return confirmRef.current?.focus();
    setLoading(true);
    try {
      await communityJson<null>("auth/password/reset", { method: "POST", json: { token, password } });
      // Every session of the member was revoked, this browser's included.
      setSession(null);
      setState("done");
    } catch (err) {
      if (err instanceof CommunityError && err.code === "token_invalid") setState("invalid");
      else if (err instanceof CommunityError && err.fields.password) setErrors({ password: err.fields.password });
      else setFormError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  let body: ReactNode;
  if (token === undefined) body = <PageSpinner />;
  else if (!token || state === "invalid") {
    body = (
      <Result ok={false} title="ลิงก์ใช้ไม่ได้">
        <p>{INVALID_LINK} ลิงก์ตั้งรหัสผ่านใหม่มีอายุ 1 ชั่วโมงและใช้ได้ครั้งเดียว</p>
        <Link href="/account?view=forgot" className={btn}>
          ขอลิงก์ใหม่ (ลืมรหัสผ่าน)
        </Link>
      </Result>
    );
  } else if (state === "done") {
    body = (
      <Result ok title="ตั้งรหัสผ่านใหม่เรียบร้อย">
        <p>อุปกรณ์ทั้งหมดถูกออกจากระบบแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่</p>
        <Link href="/account" className={btn}>
          เข้าสู่ระบบ
        </Link>
      </Result>
    );
  } else {
    body = (
      <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={loading}>
        {formError && <Alert>{formError}</Alert>}
        <PasswordField
          ref={pwRef}
          id="reset-password"
          label="รหัสผ่านใหม่"
          autoComplete="new-password"
          maxLength={128}
          required
          meter
          value={password}
          onValue={(v) => {
            setPassword(v);
            if (errors.password) setErrors((x) => ({ ...x, password: passwordProblem(v) }));
          }}
          onBlur={() => password && setErrors((x) => ({ ...x, password: passwordProblem(password) }))}
          error={errors.password}
        />
        <PasswordField
          ref={confirmRef}
          id="reset-confirm"
          label="ยืนยันรหัสผ่านใหม่"
          autoComplete="new-password"
          maxLength={128}
          required
          value={confirm}
          onValue={(v) => {
            setConfirm(v);
            if (errors.confirm) setErrors((x) => ({ ...x, confirm: v !== password ? PASSWORD_MESSAGES.mismatch : null }));
          }}
          onBlur={() => confirm && setErrors((x) => ({ ...x, confirm: confirm !== password ? PASSWORD_MESSAGES.mismatch : null }))}
          error={errors.confirm}
        />
        <SubmitButton loading={loading} className="w-full" loadingText="กำลังบันทึก…">
          ตั้งรหัสผ่านใหม่
        </SubmitButton>
      </form>
    );
  }

  return (
    <AccountPageFrame eyebrow="Member account" title="ตั้งรหัสผ่านใหม่" intro={state === "form" && token ? "ตั้งรหัสผ่านใหม่สำหรับบัญชีสมาชิกของคุณ" : undefined}>
      {body}
    </AccountPageFrame>
  );
}

/* ------------------------------------------------------------ link Google */

export function LinkGoogleView() {
  const token = useFragmentToken();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [state, setState] = useState<"form" | "done" | "invalid">("form");
  const [loading, setLoading] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!password) {
      setError("กรุณากรอกรหัสผ่านของบัญชีเดิม");
      return pwRef.current?.focus();
    }
    setError(null);
    setFormError(null);
    setLoading(true);
    try {
      const s = await communityJson<Session>("auth/google/link", { method: "POST", json: { token, password } });
      setSession(s);
      setState("done");
      // Back to the article that started the sign-in (its pending action stays for it to replay).
      const pending = takePendingAction();
      const href = pendingActionHref(pending);
      if (pending && href) savePendingAction(pending);
      window.setTimeout(() => window.location.assign(href ? `${href}#community=signed-in` : "/account?tab=connections"), 900);
    } catch (err) {
      setLoading(false);
      if (err instanceof CommunityError && err.code === "token_invalid") return setState("invalid");
      if (err instanceof CommunityError && err.code === "invalid_credentials") {
        setPassword("");
        setError("รหัสผ่านไม่ถูกต้อง");
        return pwRef.current?.focus();
      }
      setFormError(errText(err));
    }
  };

  let body: ReactNode;
  if (token === undefined) body = <PageSpinner />;
  else if (!token || state === "invalid") {
    body = (
      <Result ok={false} title="ลิงก์หมดอายุ">
        <p>ลิงก์เชื่อมต่อมีอายุ 15 นาทีและใช้ได้ครั้งเดียว กรุณาเลือก &ldquo;ดำเนินการต่อด้วย Google&rdquo; อีกครั้ง หรือเข้าสู่ระบบด้วยอีเมลและรหัสผ่าน</p>
        <Link href="/account" className={btn}>
          ไปหน้าเข้าสู่ระบบ
        </Link>
      </Result>
    );
  } else if (state === "done") {
    body = (
      <Result ok title="เชื่อมต่อ Google เรียบร้อย">
        <p>ต่อไปคุณเข้าสู่ระบบด้วย Google ได้ทันที กำลังพากลับไป…</p>
      </Result>
    );
  } else {
    body = (
      <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={loading}>
        {formError && <Alert>{formError}</Alert>}
        <PasswordField
          ref={pwRef}
          id="link-password"
          label="รหัสผ่านของบัญชีเดิม"
          autoComplete="current-password"
          required
          value={password}
          onValue={(v) => {
            setPassword(v);
            if (error && v) setError(null);
          }}
          error={error}
        />
        <SubmitButton loading={loading} className="w-full" loadingText="กำลังเชื่อมต่อ…">
          ยืนยันและเชื่อมต่อ Google
        </SubmitButton>
        <p className="text-sm leading-6 text-subtle">
          จำรหัสผ่านไม่ได้?{" "}
          <Link href="/account?view=forgot" className="text-accent-soft underline underline-offset-4">
            ตั้งรหัสผ่านใหม่
          </Link>{" "}
          แล้วเลือก &ldquo;ดำเนินการต่อด้วย Google&rdquo; อีกครั้ง
        </p>
      </form>
    );
  }

  return (
    <AccountPageFrame
      eyebrow="Connect Google"
      title="เชื่อมต่อบัญชี Google"
      intro={state === "form" && token ? "อีเมลนี้มีบัญชีอยู่แล้ว ยืนยันด้วยรหัสผ่านของบัญชีเดิมเพื่อเชื่อมต่อ Google" : undefined}
    >
      {body}
    </AccountPageFrame>
  );
}
