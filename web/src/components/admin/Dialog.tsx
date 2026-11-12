"use client";

/**
 * Native <dialog> + showModal(): focus is trapped and restored by the
 * browser, Esc closes, the rest of the page is inert.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="adm-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="p-5">
          <h2 id={titleId} className="text-lg font-semibold thai-heading">
            {title}
          </h2>
          <div className="mt-3 text-sm text-muted">{children}</div>
          {footer ? <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "ยืนยัน",
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        <>
          <button type="button" className="adm-btn" onClick={onClose} disabled={busy} autoFocus>
            ยกเลิก
          </button>
          <button
            type="button"
            className={`adm-btn ${danger ? "adm-btn-danger" : "adm-btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "กำลังดำเนินการ…" : confirmLabel}
          </button>
        </>
      }
    >
      {message}
    </Dialog>
  );
}
