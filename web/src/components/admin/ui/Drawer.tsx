"use client";

/** Side sheet built on native <dialog> (focus trap, Esc, inert background). */
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";

export function Drawer({
  open,
  onClose,
  title,
  description,
  actions,
  children,
  footer,
  side = "right",
  className,
  width,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra header buttons (left of the close button). */
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left";
  className?: string;
  /** CSS width, e.g. "40rem" (capped at 100vw). */
  width?: string;
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
      className={cx("adm-drawer", className)}
      data-side={side}
      aria-labelledby={titleId}
      style={width ? { width: `min(${width}, 100vw)` } : undefined}
      onClose={() => {
        if (open) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <>
          <div className="adm-drawer-head">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold thai-heading">
                {title}
              </h2>
              {description ? <div className="mt-0.5 text-sm text-muted">{description}</div> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {actions}
              <button type="button" className="adm-icon-btn" aria-label="ปิด" onClick={onClose}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="adm-drawer-body">{children}</div>
          {footer ? <div className="adm-drawer-foot">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}
