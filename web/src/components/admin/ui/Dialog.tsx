"use client";

/**
 * Native <dialog> + showModal(): the browser traps and restores focus, Esc
 * closes, the page behind is inert and the dialog sits in the top layer
 * (still inside .adm-root in the DOM, so theme tokens apply).
 */
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { Input } from "./Field";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** false while a request is in flight: Esc / backdrop / X do nothing. */
  dismissible?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx("adm-dialog", className)}
      data-size={size}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={() => {
        if (open) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && dismissible) onClose();
      }}
    >
      {open ? (
        <>
          <div className="adm-dialog-head">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold thai-heading">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-0.5 text-sm text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="adm-icon-btn -mr-2 -mt-1"
              data-size="sm"
              aria-label="ปิด"
              onClick={onClose}
              disabled={!dismissible}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {children ? <div className="adm-dialog-body">{children}</div> : <div className="h-3" />}
          {footer ? <div className="adm-dialog-foot">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}

/**
 * Confirmation dialog. `confirmText` adds a typed confirmation: the confirm
 * button stays disabled until the user types exactly that string.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "ยืนยัน",
  cancelLabel = "ยกเลิก",
  danger,
  busy,
  confirmText,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped("");
  }
  const inputId = useId();
  const blocked = confirmText !== undefined && typed.trim() !== confirmText;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!blocked && !busy) onConfirm();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy} autoFocus={confirmText === undefined}>
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            form={`${inputId}-form`}
            variant={danger ? "danger-solid" : "primary"}
            disabled={blocked}
            loading={busy}
            loadingText="กำลังดำเนินการ…"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={`${inputId}-form`} onSubmit={submit} className="grid gap-3">
        <div className="text-muted">{message}</div>
        {confirmText !== undefined ? (
          <div className="grid gap-1.5">
            <label htmlFor={inputId} className="text-sm">
              พิมพ์ <strong className="font-mono text-fg">{confirmText}</strong> เพื่อยืนยัน
            </label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
