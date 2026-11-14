"use client";

/**
 * "…" menu of a comment (menu button pattern): aria-haspopup/expanded,
 * focus moves into the menu, ArrowUp/Down/Home/End, Esc and Tab close,
 * click outside closes, focus returns to the button.
 */
import { useEffect, useRef, useState } from "react";
import { MenuButton } from "./CommentView";

export type MenuItem = { key: string; label: string; onSelect: () => void; danger?: boolean };

export function CommentMenu({
  commentId,
  label,
  items,
  defaultOpen = false,
}: {
  commentId: string;
  label: string;
  items: MenuItem[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusFirst = useRef<"first" | "last">("first");

  useEffect(() => {
    if (!open) return;
    const els = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    (focusFirst.current === "last" ? els?.[els.length - 1] : els?.[0])?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (items.length === 0) return null;

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (i + 1) % els.length;
    else if (e.key === "ArrowUp") next = (i - 1 + els.length) % els.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = els.length - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    } else if (e.key === "Tab") {
      close(false);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      els[next]?.focus();
    }
  };

  return (
    <div className="relative shrink-0">
      <MenuButton
        commentId={commentId}
        label={label}
        expanded={open}
        buttonRef={btn}
        onClick={() => {
          focusFirst.current = "first";
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            focusFirst.current = e.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
        }}
      />
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className="cm-in absolute right-0 top-full z-30 mt-1 min-w-[11rem] overflow-hidden rounded-2xl border border-line-strong bg-surface p-1.5 shadow-2xl shadow-black/60"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
              className={`flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-semibold transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 ${
                item.danger ? "text-rose-300" : "text-fg"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
