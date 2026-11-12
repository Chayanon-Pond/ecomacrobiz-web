"use client";

import { Component, useId, useRef, useState, type ReactNode } from "react";
import { Markdown } from "@/components/content/Markdown";
import type { Media } from "@/lib/admin/types";
import { Dialog } from "./Dialog";
import { errorMessage } from "./SessionProvider";

type Mode = "write" | "preview" | "split";

/** Preview must never take the editor down (e.g. next/image rejecting a host). */
class PreviewBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <p className="adm-alert" role="alert">
          แสดงตัวอย่างไม่ได้: {this.state.error}
        </p>
      );
    }
    return this.props.children;
  }
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  onUploadImage,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onUploadImage: (file: File) => Promise<Media>;
  invalid?: boolean;
  describedBy?: string;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<Mode>("split");
  const [imgOpen, setImgOpen] = useState(false);
  const tabsId = useId();

  /** Replace the current selection and restore a sensible caret/selection. */
  function apply(fn: (sel: string, before: string, after: string) => { text: string; selStart: number; selEnd: number }) {
    const el = ta.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const before = value.slice(0, s);
    const after = value.slice(e);
    const r = fn(value.slice(s, e), before, after);
    onChange(before + r.text + after);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + r.selStart, s + r.selEnd);
    });
  }

  const wrap = (left: string, right: string, placeholder: string) =>
    apply((sel) => {
      const inner = sel || placeholder;
      return { text: left + inner + right, selStart: left.length, selEnd: left.length + inner.length };
    });

  const prefixLines = (prefix: string, placeholder: string) =>
    apply((sel, before) => {
      const needsBreak = before.length > 0 && !before.endsWith("\n");
      const body = (sel || placeholder)
        .split("\n")
        .map((l) => prefix + l.replace(/^(#{1,6}\s+|>\s+|-\s+)/, ""))
        .join("\n");
      const lead = needsBreak ? "\n" : "";
      return { text: lead + body, selStart: lead.length + prefix.length, selEnd: lead.length + body.length };
    });

  const insertBlock = (block: string) =>
    apply((_sel, before, after) => {
      const lead = before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      const trail = after.startsWith("\n") ? "\n" : "\n\n";
      const text = lead + block + trail;
      return { text, selStart: text.length, selEnd: text.length };
    });

  const insertLink = () =>
    apply((sel) => {
      const text = sel || "ข้อความลิงก์";
      const urlStart = text.length + 3;
      return { text: `[${text}](https://)`, selStart: urlStart, selEnd: urlStart + "https://".length };
    });

  type Tool = "h2" | "h3" | "bold" | "italic" | "link" | "list" | "quote" | "image";
  const TOOLS: { key: Tool; label: string; title: string }[] = [
    { key: "h2", label: "H2", title: "หัวข้อใหญ่ (H2)" },
    { key: "h3", label: "H3", title: "หัวข้อย่อย (H3)" },
    { key: "bold", label: "B", title: "ตัวหนา (Ctrl+B)" },
    { key: "italic", label: "I", title: "ตัวเอียง (Ctrl+I)" },
    { key: "link", label: "ลิงก์", title: "แทรกลิงก์ (Ctrl+K)" },
    { key: "list", label: "• รายการ", title: "รายการแบบจุด" },
    { key: "quote", label: "❝ อ้างอิง", title: "ข้อความอ้างอิง" },
    { key: "image", label: "รูปภาพ", title: "อัปโหลดและแทรกรูปภาพ" },
  ];
  function run(tool: Tool) {
    switch (tool) {
      case "h2":
        return prefixLines("## ", "หัวข้อ");
      case "h3":
        return prefixLines("### ", "หัวข้อย่อย");
      case "bold":
        return wrap("**", "**", "ข้อความตัวหนา");
      case "italic":
        return wrap("*", "*", "ข้อความตัวเอียง");
      case "link":
        return insertLink();
      case "list":
        return prefixLines("- ", "รายการ");
      case "quote":
        return prefixLines("> ", "ข้อความอ้างอิง");
      case "image":
        return setImgOpen(true);
    }
  }

  const editor = (
    <div className={mode === "preview" ? "hidden" : ""}>
      <div className="adm-toolbar" role="toolbar" aria-label="เครื่องมือจัดรูปแบบ" aria-controls={id}>
        {TOOLS.map((t) => (
          <button key={t.key} type="button" title={t.title} aria-label={t.title} onClick={() => run(t.key)}>
            {t.key === "bold" ? <strong>B</strong> : t.key === "italic" ? <em>I</em> : t.label}
          </button>
        ))}
      </div>
      <textarea
        ref={ta}
        id={id}
        className="adm-input adm-editor"
        value={value}
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          const k = e.key.toLowerCase();
          if (k === "b") {
            e.preventDefault();
            run("bold");
          } else if (k === "i") {
            e.preventDefault();
            run("italic");
          } else if (k === "k") {
            e.preventDefault();
            run("link");
          }
        }}
      />
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="โหมดแก้ไข" className="adm-tabs" id={tabsId}>
          {(
            [
              ["write", "เขียน"],
              ["split", "แยกจอ"],
              ["preview", "ตัวอย่าง"],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <p className="adm-hint">Markdown · รูปภาพใช้รูปแบบ ![alt](url &quot;กว้างxสูง&quot;)</p>
      </div>
      <div className={mode === "split" ? "grid gap-3 2xl:grid-cols-2" : ""}>
        {editor}
        {mode !== "write" ? (
          <div className="adm-preview" aria-label="ตัวอย่างบทความ" role="region" tabIndex={0}>
            {value.trim() ? (
              <PreviewBoundary resetKey={value}>
                <Markdown markdown={value} />
              </PreviewBoundary>
            ) : (
              <p className="text-muted">ยังไม่มีเนื้อหา</p>
            )}
          </div>
        ) : null}
      </div>
      <ImageDialog
        open={imgOpen}
        onClose={() => setImgOpen(false)}
        onUpload={onUploadImage}
        onInsert={(md) => {
          setImgOpen(false);
          insertBlock(md);
        }}
      />
    </div>
  );
}

function ImageDialog({
  open,
  onClose,
  onUpload,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<Media>;
  onInsert: (markdown: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileId = useId();
  const altId = useId();
  const capId = useId();

  function reset() {
    setFile(null);
    setAlt("");
    setCaption("");
    setError(null);
    setBusy(false);
  }

  async function submit() {
    setError(null);
    if (!file) return setError("กรุณาเลือกไฟล์รูปภาพ");
    if (!alt.trim()) return setError("กรุณากรอกคำอธิบายรูป (alt) เพื่อการเข้าถึงและ SEO");
    setBusy(true);
    try {
      const m = await onUpload(file);
      const safeAlt = alt.trim().replace(/[[\]\n\r]/g, " ");
      const safeCap = caption.trim().replace(/["\n\r]/g, " ");
      const title = m.width && m.height ? ` "${m.width}x${m.height}${safeCap ? ` ${safeCap}` : ""}"` : "";
      onInsert(`![${safeAlt}](${m.url}${title})`);
      reset();
    } catch (err) {
      setError(errorMessage(err) || "อัปโหลดไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      title="แทรกรูปภาพ"
      footer={
        <>
          <button
            type="button"
            className="adm-btn"
            disabled={busy}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            ยกเลิก
          </button>
          <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={submit}>
            {busy ? "กำลังอัปโหลด…" : "อัปโหลดและแทรก"}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-fg">
        {error ? (
          <p className="adm-alert" role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <label htmlFor={fileId} className="adm-label">
            ไฟล์รูป (JPEG/PNG/WebP/AVIF/GIF, สูงสุด 8 MB)
          </label>
          <input
            id={fileId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            className="adm-input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label htmlFor={altId} className="adm-label">
            คำอธิบายรูป (Alt text) *
          </label>
          <input id={altId} className="adm-input" value={alt} onChange={(e) => setAlt(e.target.value)} />
        </div>
        <div>
          <label htmlFor={capId} className="adm-label">
            คำบรรยายใต้ภาพ (ไม่บังคับ)
          </label>
          <input id={capId} className="adm-input" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}
