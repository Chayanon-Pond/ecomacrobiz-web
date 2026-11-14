"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button";

/** Clipboard write with a select+execCommand fallback (http / old Safari). */
export async function copyText(text: string, fallbackInput?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    if (fallbackInput) {
      fallbackInput.focus();
      fallbackInput.select();
      return document.execCommand("copy");
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Read-only value + copy button. Announces "คัดลอกแล้ว" politely. */
export function CopyField({
  value,
  label,
  hint,
  autoSelect,
}: {
  value: string;
  label: string;
  hint?: string;
  autoSelect?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2200);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (autoSelect) input.current?.select();
  }, [autoSelect]);

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="adm-label mb-0">
        {label}
      </label>
      <div className="adm-copy">
        <input
          ref={input}
          id={id}
          className="adm-input"
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
        />
        <Button
          variant={state === "copied" ? "secondary" : "primary"}
          icon={state === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          onClick={async () => setState((await copyText(value, input.current)) ? "copied" : "failed")}
        >
          {state === "copied" ? "คัดลอกแล้ว" : "คัดลอก"}
        </Button>
      </div>
      <p className="adm-hint" aria-live="polite">
        {state === "failed" ? "คัดลอกอัตโนมัติไม่ได้ — กรุณาเลือกข้อความแล้วกด Ctrl/⌘ + C" : state === "copied" ? "คัดลอกลิงก์ไปยังคลิปบอร์ดแล้ว" : hint}
      </p>
    </div>
  );
}
