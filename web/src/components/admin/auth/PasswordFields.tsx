"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { PASSWORD_MIN, passwordStrength } from "@/lib/admin/password";
import { Field, Input } from "../ui/Field";

/** Password input with show/hide toggle. */
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  ...p
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <Input
        {...p}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-10"
        spellCheck={false}
      />
      <button
        type="button"
        className="adm-icon-btn absolute right-0.5 top-1/2 -translate-y-1/2"
        data-size="sm"
        aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        aria-pressed={show}
        onClick={() => setShow((s) => !s)}
      >
        {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </span>
  );
}

function StrengthMeter({ password }: { password: string }) {
  const s = passwordStrength(password);
  if (!password) return <>ใช้อย่างน้อย {PASSWORD_MIN} ตัวอักษร ผสมตัวพิมพ์เล็ก/ใหญ่ ตัวเลข และสัญลักษณ์ หรือใช้วลียาว ๆ</>;
  const color = `var(--adm-${s.tone})`;
  return (
    <span className="grid gap-1.5">
      <span className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-full"
            style={{ background: i <= s.score ? color : "var(--line-strong)" }}
          />
        ))}
      </span>
      <span>
        ความแข็งแรง: <strong style={{ color }}>{s.label}</strong>
        {password.length < PASSWORD_MIN ? ` · อีก ${PASSWORD_MIN - password.length} ตัวอักษร` : null}
      </span>
    </span>
  );
}

/** New password + confirmation with a strength hint. */
export function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  errors,
  label = "รหัสผ่านใหม่",
  autoFocus,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  errors: { password?: string; confirm?: string };
  label?: string;
  autoFocus?: boolean;
}) {
  return (
    <>
      <Field label={label} required error={errors.password} hint={<StrengthMeter password={password} />}>
        {(p) => <PasswordInput {...p} value={password} onChange={onPassword} autoComplete="new-password" autoFocus={autoFocus} />}
      </Field>
      <Field label="ยืนยันรหัสผ่านใหม่" required error={errors.confirm}>
        {(p) => <PasswordInput {...p} value={confirm} onChange={onConfirm} autoComplete="new-password" />}
      </Field>
    </>
  );
}
