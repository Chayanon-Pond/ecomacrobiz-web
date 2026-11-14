"use client";

/**
 * "What happens to the old URL" chooser for unpublishing / deleting a
 * PUBLISHED post (CONTRACT-SEO: redirect_to '' => auto 410, path => 301).
 */
import { Check, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { ListResponse, PostSummary } from "@/lib/admin/types";
import { errorMessage, useAdmin } from "../SessionProvider";
import { Button, Dialog, Input, Skeleton } from "../ui";
import "./posts.css";

export type RedirectChoiceValue =
  | { mode: "gone" }
  | { mode: "knowledge" }
  | { mode: "post"; post: Pick<PostSummary, "id" | "title" | "slug"> | null };

export const GONE: RedirectChoiceValue = { mode: "gone" };

/** Value for PostInput.redirect_to / DELETE body; null = not chosen yet (post mode without a post). */
export function redirectTarget(v: RedirectChoiceValue): string | null {
  if (v.mode === "gone") return "";
  if (v.mode === "knowledge") return "/knowledge";
  return v.post ? `/knowledge/${v.post.slug}` : null;
}

export function RedirectChoice({
  value,
  excludeId,
  disabled,
  onChange,
}: {
  value: RedirectChoiceValue;
  excludeId: string | null;
  disabled?: boolean;
  onChange: (v: RedirectChoiceValue) => void;
}) {
  const name = useId();
  const opts: [RedirectChoiceValue["mode"], string, string][] = [
    ["gone", "แจ้งว่าหน้านี้ถูกลบถาวร (410)", "Google จะนำหน้านี้ออกจากผลการค้นหาเร็วที่สุด เหมาะเมื่อไม่มีเนื้อหาที่ใกล้เคียง"],
    ["post", "ส่งผู้เข้าชมไปยังบทความอื่น (301)", "เลือกบทความที่ตอบเรื่องเดียวกัน — ลิงก์และอันดับใน Google จะส่งต่อไปที่บทความนั้น"],
    ["knowledge", "ส่งผู้เข้าชมไปยังหน้ารวมบทความ /knowledge (301)", "ใช้เมื่อไม่มีบทความใดแทนได้ แต่ไม่อยากให้ผู้เข้าชมเจอหน้าว่าง"],
  ];
  return (
    <fieldset className="grid grid-cols-[minmax(0,1fr)] gap-2" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium text-fg">URL เดิมของบทความนี้ควร…</legend>
      {opts.map(([mode, label, hint]) => (
        <label key={mode} className="pe-status-opt" data-on={value.mode === mode || undefined}>
          <input
            type="radio"
            name={name}
            checked={value.mode === mode}
            onChange={() =>
              onChange(mode === "post" ? { mode, post: value.mode === "post" ? value.post : null } : ({ mode } as RedirectChoiceValue))
            }
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-fg">{label}</span>
            <span className="block text-xs text-muted">{hint}</span>
          </span>
        </label>
      ))}
      {value.mode === "post" ? (
        <PostSearch excludeId={excludeId} selected={value.post} onPick={(post) => onChange({ mode: "post", post })} />
      ) : null}
    </fieldset>
  );
}

type Found = { key: string; rows: PostSummary[] } | { key: string; error: string };

/** Search published posts (live targets only: a 301 to a draft would 404). */
export function PostSearch({
  excludeId,
  selected,
  onPick,
}: {
  excludeId: string | null;
  selected: Pick<PostSummary, "id" | "title" | "slug"> | null;
  onPick: (p: Pick<PostSummary, "id" | "title" | "slug">) => void;
}) {
  const { request } = useAdmin();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const inputId = useId();
  const key = q.trim();

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      request<ListResponse<PostSummary>>("posts", {
        query: { status: "published", q: key, per_page: 8, sort: "published_desc" },
        signal: ctrl.signal,
      })
        .then((r) => setFound({ key, rows: (r.data ?? []).filter((p) => p.id !== excludeId) }))
        .catch((err) => {
          const m = errorMessage(err);
          if (m) setFound({ key, error: m });
        });
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [request, key, excludeId]);

  const current = found?.key === key ? found : null;
  return (
    <div className="rd-search grid grid-cols-[minmax(0,1fr)] gap-2">
      <label htmlFor={inputId} className="adm-sr-only">
        ค้นหาบทความที่เผยแพร่อยู่
      </label>
      <Input
        id={inputId}
        type="search"
        inputSize="sm"
        icon={<Search size={14} aria-hidden="true" />}
        placeholder="ค้นหาบทความที่เผยแพร่อยู่…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      {!current ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5" aria-hidden="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-4/5" />
        </div>
      ) : "error" in current ? (
        <p className="adm-field-error">{current.error}</p>
      ) : current.rows.length === 0 ? (
        <p className="adm-hint">ไม่พบบทความที่เผยแพร่อยู่{key ? `สำหรับ “${key}”` : ""}</p>
      ) : (
        <ul className="rd-results" role="listbox" aria-label="ผลการค้นหาบทความ">
          {current.rows.map((p) => {
            const on = selected?.id === p.id;
            return (
              <li key={p.id} role="option" aria-selected={on}>
                <button type="button" className="rd-result" data-on={on || undefined} onClick={() => onPick(p)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{p.title}</span>
                    <span className="block truncate font-mono text-[0.6875rem] text-subtle">/knowledge/{p.slug}</span>
                  </span>
                  {on ? <Check size={15} aria-hidden="true" className="shrink-0 text-[var(--adm-accent-text)]" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected ? (
        <p className="text-xs text-muted">
          ปลายทาง: <span className="font-mono text-fg">/knowledge/{selected.slug}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Confirm dialog for unpublishing / deleting a published post with the
 * redirect choice. `onConfirm` receives the redirect_to value.
 */
export function RetireDialog({
  open,
  action,
  slug,
  postId,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  action: "unpublish" | "delete";
  slug: string;
  postId: string | null;
  busy?: boolean;
  onConfirm: (redirectTo: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState<RedirectChoiceValue>(GONE);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(GONE);
  }
  const target = redirectTarget(value);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="md"
      title={action === "delete" ? "ลบบทความนี้?" : "เปลี่ยนเป็นฉบับร่าง?"}
      description={
        action === "delete"
          ? "บทความจะถูกลบและนำออกจากเว็บไซต์ทันที"
          : "บทความจะถูกนำออกจากเว็บไซต์ทันที และกลับมาบันทึกอัตโนมัติแบบฉบับร่าง"
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            variant={action === "delete" ? "danger-solid" : "primary"}
            disabled={target === null}
            loading={busy}
            loadingText="กำลังดำเนินการ…"
            onClick={() => {
              if (target !== null && !busy) onConfirm(target);
            }}
          >
            {action === "delete" ? "ลบบทความ" : "เปลี่ยนเป็นฉบับร่าง"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <p className="text-sm text-muted">
          ผู้ที่เปิด <span className="font-mono text-fg">/knowledge/{slug}</span> จาก Google หรือลิงก์เดิมจะ
          {value.mode === "gone" ? "ได้รับแจ้งว่าหน้านี้ถูกลบถาวร (410)" : "ถูกส่งต่อ (301) ไปยังปลายทางที่เลือก"}
        </p>
        <RedirectChoice value={value} excludeId={postId} disabled={busy} onChange={setValue} />
        {target === null ? <p className="adm-hint" data-warn="true">เลือกบทความปลายทางก่อน</p> : null}
        <p className="adm-hint">แก้ไขหรือยกเลิกภายหลังได้ที่เมนู “เปลี่ยนเส้นทาง URL” · หากเผยแพร่บทความนี้อีกครั้ง redirect จะถูกลบอัตโนมัติ</p>
      </div>
    </Dialog>
  );
}
