"use client";

/** Account tabs: อุปกรณ์ที่เข้าสู่ระบบ, ข้อมูลของฉัน, ลบบัญชี. */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { communityJson, CommunityError } from "@/lib/community/client";
import { setSession } from "@/lib/community/session";
import type { Me, MemberSessionInfo } from "@/lib/community/types";
import { DELETED_AUTHOR_NAME } from "@/lib/community/types";
import { formatWait } from "../auth/auth-urls";
import { Alert, PasswordField, SubmitButton, TextField } from "../auth/fields";
import { describeUserAgent } from "./ua";
import { formatDateTime, PageSpinner, Section } from "./ui";

type Msg = { tone: "error" | "success"; text: string } | null;

function errText(err: unknown): string {
  if (err instanceof CommunityError && err.status === 429 && err.retryAfter) {
    return `ทำรายการถี่เกินไป กรุณารอ ${formatWait(err.retryAfter)} แล้วลองใหม่`;
  }
  return err instanceof CommunityError ? err.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่";
}

/* --------------------------------------------------------------- sessions */

/** Current device first, then most recent activity. */
async function fetchSessions(): Promise<MemberSessionInfo[]> {
  const rows = await communityJson<MemberSessionInfo[]>("account/sessions");
  return rows.sort((a, b) => Number(b.current) - Number(a.current) || (b.last_seen_at ?? b.created_at).localeCompare(a.last_seen_at ?? a.created_at));
}

export function SessionsSection() {
  const [list, setList] = useState<MemberSessionInfo[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await fetchSessions());
    } catch (err) {
      setList([]);
      setMsg({ tone: "error", text: errText(err) });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetchSessions()
      .then((rows) => alive && setList(rows))
      .catch((err) => {
        if (!alive) return;
        setList([]);
        setMsg({ tone: "error", text: errText(err) });
      });
    return () => {
      alive = false;
    };
  }, []);

  const signOutOthers = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await communityJson<{ revoked: number }>("account/sessions/others", { method: "DELETE" });
      setMsg({
        tone: "success",
        text: res.revoked > 0 ? `ออกจากระบบอุปกรณ์อื่นแล้ว ${res.revoked.toLocaleString("th-TH")} เครื่อง` : "ไม่มีอุปกรณ์อื่นที่เข้าสู่ระบบอยู่",
      });
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const others = list?.filter((s) => !s.current).length ?? 0;

  return (
    <Section title="อุปกรณ์ที่เข้าสู่ระบบ" description="หากพบอุปกรณ์ที่คุณไม่รู้จัก ให้ออกจากระบบอุปกรณ์อื่นทั้งหมดและเปลี่ยนรหัสผ่าน">
      {msg && (
        <Alert tone={msg.tone} className="mb-4">
          {msg.text}
        </Alert>
      )}
      {list === null ? (
        <PageSpinner />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-ink-2">
          {list.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{describeUserAgent(s.user_agent)}</span>
                {s.current && (
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-white">อุปกรณ์นี้</span>
                )}
              </div>
              <p className="text-sm text-muted">
                IP {s.ip || "-"} · ใช้งานล่าสุด {formatDateTime(s.last_seen_at ?? s.created_at)}
              </p>
              <p className="text-xs text-subtle">เข้าสู่ระบบเมื่อ {formatDateTime(s.created_at)} · หมดอายุ {formatDateTime(s.expires_at)}</p>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={signOutOthers} disabled={busy || list === null || others === 0} className="ca-btn ca-btn-ghost mt-5">
        {busy ? "กำลังดำเนินการ…" : "ออกจากระบบอุปกรณ์อื่นทั้งหมด"}
      </button>
    </Section>
  );
}

/* ------------------------------------------------------------------- data */

export function DataSection() {
  return (
    <Section
      title="ดาวน์โหลดข้อมูลของฉัน"
      description="ไฟล์ JSON ที่มีข้อมูลบัญชี บัญชีที่เชื่อมต่อ ความคิดเห็น การกดถูกใจ และอุปกรณ์ที่เข้าสู่ระบบของคุณ"
    >
      <a href="/api/community/account/export" download="ecomacrobiz-account.json" className="ca-btn ca-btn-ghost">
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" />
        </svg>
        ดาวน์โหลดข้อมูล (JSON)
      </a>
    </Section>
  );
}

/* ----------------------------------------------------------------- delete */

const CONFIRM_WORD = "ลบบัญชี";

export function DeleteSection({ me }: { me: Me }) {
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null }>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [loading, setLoading] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const ready = typed.trim() === CONFIRM_WORD && (!me.has_password || password !== "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = {
      password: me.has_password && !password ? "กรุณากรอกรหัสผ่าน" : null,
      confirm: typed.trim() !== CONFIRM_WORD ? `กรุณาพิมพ์คำว่า "${CONFIRM_WORD}"` : null,
    };
    setErrors(errs);
    setMsg(null);
    if (errs.password) return pwRef.current?.focus();
    if (errs.confirm) return confirmRef.current?.focus();
    setLoading(true);
    try {
      await communityJson<null>("account", {
        method: "DELETE",
        json: me.has_password ? { current_password: password, confirm: CONFIRM_WORD } : { confirm: CONFIRM_WORD },
      });
      setSession(null);
      // Full reload: every island on the site drops its member state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch (err) {
      setLoading(false);
      if (err instanceof CommunityError) {
        if (err.code === "invalid_credentials") return setErrors({ password: "รหัสผ่านไม่ถูกต้อง" });
        if (err.fields.current_password || err.fields.confirm) {
          return setErrors({ password: err.fields.current_password, confirm: err.fields.confirm });
        }
      }
      setMsg({ tone: "error", text: errText(err) });
    }
  };

  return (
    <Section
      tone="danger"
      title="ลบบัญชีถาวร"
      description={
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>ระบบจะลบอีเมล รูปโปรไฟล์ การกดถูกใจ อุปกรณ์ที่เข้าสู่ระบบ และการเชื่อมต่อ Google ของคุณ</li>
          <li>
            ความคิดเห็นที่คุณเคยโพสต์จะยังคงแสดง แต่จะแสดงชื่อเป็น &ldquo;{DELETED_AUTHOR_NAME}&rdquo; แทน หากต้องการลบความคิดเห็นด้วย
            กรุณาลบที่บทความก่อนลบบัญชี
          </li>
          <li>การลบบัญชีย้อนกลับไม่ได้ แนะนำให้ดาวน์โหลดข้อมูลของคุณเก็บไว้ก่อน</li>
        </ul>
      }
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={loading}>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <input type="email" name="username" autoComplete="username" value={me.email} readOnly hidden />
        {me.has_password && (
          <PasswordField
            ref={pwRef}
            id="acc-del-password"
            label="รหัสผ่าน"
            autoComplete="current-password"
            required
            value={password}
            onValue={(v) => {
              setPassword(v);
              if (errors.password && v) setErrors((x) => ({ ...x, password: null }));
            }}
            error={errors.password}
          />
        )}
        <TextField
          ref={confirmRef}
          id="acc-del-confirm"
          label={
            <>
              พิมพ์คำว่า <strong className="text-[#ffb4b4]">{CONFIRM_WORD}</strong> เพื่อยืนยัน
            </>
          }
          autoComplete="off"
          spellCheck={false}
          required
          value={typed}
          onValue={(v) => {
            setTyped(v);
            if (errors.confirm && v.trim() === CONFIRM_WORD) setErrors((x) => ({ ...x, confirm: null }));
          }}
          error={errors.confirm}
        />
        <SubmitButton variant="danger" loading={loading} disabled={!ready} className="self-start" loadingText="กำลังลบบัญชี…">
          ลบบัญชีของฉัน
        </SubmitButton>
      </form>
    </Section>
  );
}
