"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { communityJson, CommunityError } from "@/lib/community/client";
import { setMe } from "@/lib/community/session";
import type { CommunityConfig, Me } from "@/lib/community/types";
import { cleanDisplayName, displayNameProblem } from "@/lib/community/validation";
import { Alert, SubmitButton, TextField } from "../auth/fields";
import { MemberAvatar, Section } from "./ui";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
type Msg = { tone: "error" | "success"; text: string } | null;

function errText(err: unknown): string {
  return err instanceof CommunityError ? err.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่";
}

export function ProfileSection({ me, config }: { me: Me; config: CommunityConfig | null | undefined }) {
  return (
    <div className="flex flex-col gap-6">
      <AvatarForm me={me} maxMb={config?.avatar_max_mb ?? 5} />
      <NameForm me={me} />
    </div>
  );
}

function NameForm({ me }: { me: Me }) {
  const [name, setName] = useState(me.display_name);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const unchanged = cleanDisplayName(name) === me.display_name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = displayNameProblem(name);
    setError(p);
    setMsg(null);
    if (p) return ref.current?.focus();
    setLoading(true);
    try {
      const updated = await communityJson<Me>("account/profile", { method: "PUT", json: { display_name: cleanDisplayName(name) } });
      setMe(updated);
      setName(updated.display_name);
      setMsg({ tone: "success", text: "บันทึกชื่อที่แสดงแล้ว" });
    } catch (err) {
      if (err instanceof CommunityError && err.fields.display_name) setError(err.fields.display_name);
      else setMsg({ tone: "error", text: errText(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="ชื่อที่แสดง" description="ชื่อนี้แสดงต่อสาธารณะในความคิดเห็นของคุณ">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={loading}>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <TextField
          ref={ref}
          id="acc-name"
          label="ชื่อที่แสดง"
          autoComplete="nickname"
          maxLength={60}
          required
          value={name}
          onValue={(v) => {
            setName(v);
            if (error) setError(displayNameProblem(v));
          }}
          onBlur={() => setError(displayNameProblem(name))}
          error={error}
          hint="2–40 ตัวอักษร ห้ามมีอีเมลหรือลิงก์"
        />
        <SubmitButton loading={loading} disabled={unchanged} className="self-start" loadingText="กำลังบันทึก…">
          บันทึกชื่อ
        </SubmitButton>
      </form>
    </Section>
  );
}

function AvatarForm({ me, maxMb }: { me: Me; maxMb: number }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = (f: File | undefined) => {
    setMsg(null);
    if (!f) return;
    if (!TYPES.includes(f.type)) return setMsg({ tone: "error", text: "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP" });
    if (f.size > maxMb * 1024 * 1024) return setMsg({ tone: "error", text: `ไฟล์ต้องมีขนาดไม่เกิน ${maxMb} MB` });
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const cancel = () => {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const upload = async () => {
    if (!file) return;
    setBusy("upload");
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const updated = await communityJson<Me>("account/avatar", { method: "POST", form });
      setMe(updated);
      cancel();
      setMsg({ tone: "success", text: "อัปเดตรูปโปรไฟล์แล้ว" });
    } catch (err) {
      setMsg({ tone: "error", text: errText(err) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setMsg(null);
    try {
      const updated = await communityJson<Me>("account/avatar", { method: "DELETE" });
      setMe(updated);
      setMsg({ tone: "success", text: "ลบรูปโปรไฟล์แล้ว ระบบจะแสดงอักษรย่อของชื่อแทน" });
    } catch (err) {
      setMsg({ tone: "error", text: errText(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="รูปโปรไฟล์" description={`JPG, PNG หรือ WebP ไม่เกิน ${maxMb} MB ระบบจะครอปกึ่งกลางภาพเป็นสี่เหลี่ยมจัตุรัสและลบข้อมูลแฝง (เช่น ตำแหน่งที่ถ่าย) ออกให้`}>
      {msg && (
        <Alert tone={msg.tone} className="mb-4">
          {msg.text}
        </Alert>
      )}
      {preview ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end gap-5">
            <figure className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="ตัวอย่างรูปที่ครอปเป็นสี่เหลี่ยมจัตุรัส" className="size-36 rounded-2xl border border-line-strong object-cover" />
              <figcaption className="text-xs text-subtle">ภาพที่ครอปแล้ว</figcaption>
            </figure>
            <figure className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="" className="size-12 rounded-full object-cover" />
              <figcaption className="text-xs text-subtle">ในความคิดเห็น</figcaption>
            </figure>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={upload} disabled={busy !== null} className="ca-btn ca-btn-primary">
              {busy === "upload" ? "กำลังอัปโหลด…" : "บันทึกรูปนี้"}
            </button>
            <button type="button" onClick={cancel} disabled={busy !== null} className="ca-btn ca-btn-ghost">
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <MemberAvatar id={me.id} name={me.display_name} url={me.avatar_url} size={80} />
          <div className="flex flex-wrap gap-3">
            <input
              ref={inputRef}
              id="acc-avatar-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="ca-file sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <label htmlFor="acc-avatar-file" className="ca-btn ca-btn-ghost cursor-pointer">
              {me.avatar_url ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
            </label>
            {me.avatar_url && (
              <button type="button" onClick={remove} disabled={busy !== null} className="ca-btn ca-btn-ghost">
                {busy === "remove" ? "กำลังลบ…" : "ลบรูป"}
              </button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
