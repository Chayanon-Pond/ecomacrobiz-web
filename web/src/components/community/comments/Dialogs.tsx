"use client";

/**
 * Small modal dialogs on the native <dialog> element (focus trap, Esc,
 * inert background and focus return come from the browser).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ReportReason } from "@/lib/community/types";
import { REPORT_REASONS } from "./messages";

function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="cm-dialog cm-in m-auto w-[min(26rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line-strong bg-surface p-0 text-fg shadow-2xl"
    >
      <div className="p-6">
        <h2 id={`${id}-t`} className="thai-heading text-lg font-semibold">
          {title}
        </h2>
        {description && (
          <p id={`${id}-d`} className="mt-2 text-sm leading-6 text-muted">
            {description}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}

const btn = "inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold transition-colors";

export function ConfirmDeleteDialog({ onConfirm, onClose }: { onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="ลบความคิดเห็นนี้?"
      description="ความคิดเห็นจะถูกลบและไม่สามารถกู้คืนได้"
      onClose={onClose}
    >
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" autoFocus onClick={onClose} className={`${btn} border border-line-strong text-fg hover:bg-surface-2`}>
          ยกเลิก
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
          className={`${btn} bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-60`}
        >
          {busy ? "กำลังลบ…" : "ลบ"}
        </button>
      </div>
    </Dialog>
  );
}

export function ReportDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (reason: ReportReason, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const id = useId();

  return (
    <Dialog
      title={done ? "ขอบคุณที่ช่วยดูแลชุมชน" : "รายงานความคิดเห็น"}
      description={done ? "ทีมงานจะตรวจสอบความคิดเห็นนี้โดยเร็ว" : "เลือกเหตุผลที่ความคิดเห็นนี้ไม่เหมาะสม"}
      onClose={onClose}
    >
      {done ? (
        <div className="mt-6 flex justify-end">
          <button type="button" autoFocus onClick={onClose} className={`${btn} bg-accent text-white hover:brightness-110`}>
            ปิด
          </button>
        </div>
      ) : (
      <form
        className="mt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason) {
            setError("กรุณาเลือกเหตุผล");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await onSubmit(reason, note.trim());
            setDone(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : "ส่งรายงานไม่สำเร็จ");
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset>
          <legend className="sr-only">เหตุผล</legend>
          <div className="flex flex-col gap-1">
            {REPORT_REASONS.map((r) => (
              <label
                key={r.value}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm hover:bg-surface-2"
              >
                <input
                  type="radio"
                  name={`${id}-reason`}
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="size-4 accent-[var(--accent)]"
                />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor={`${id}-note`} className="mt-4 block text-sm font-semibold">
          รายละเอียดเพิ่มเติม <span className="font-normal text-subtle">(ไม่บังคับ)</span>
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          maxLength={500}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1.5 w-full resize-none rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg focus:border-accent-soft focus:outline-none"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-rose-300">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${btn} border border-line-strong text-fg hover:bg-surface-2`}>
            ยกเลิก
          </button>
          <button type="submit" disabled={busy} className={`${btn} bg-accent text-white hover:brightness-110 disabled:opacity-60`}>
            {busy ? "กำลังส่ง…" : "ส่งรายงาน"}
          </button>
        </div>
      </form>
      )}
    </Dialog>
  );
}
