"use client";

/**
 * Dropdown menu (menu button pattern): Enter/Space/ArrowDown opens and
 * focuses the first item, arrows/Home/End move, Esc closes and returns focus,
 * click outside / Tab closes.
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export type MenuItem =
  | {
      type?: "item";
      label: ReactNode;
      icon?: ReactNode;
      onSelect?: () => void;
      href?: string;
      external?: boolean;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      hidden?: boolean;
    }
  | { type: "separator"; hidden?: boolean }
  | { type: "label"; label: ReactNode; hidden?: boolean };

export function Menu({
  trigger,
  items,
  align = "end",
  side = "bottom",
  label,
  className,
  menuClassName,
}: {
  /** Render prop: spread `props` onto your <button>. */
  trigger: (props: {
    onClick: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string | undefined;
    id: string;
  }) => ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  side?: "bottom" | "top";
  /** Accessible name of the menu (defaults to the trigger via aria-labelledby). */
  label?: string;
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const menuId = `${id}-menu`;
  const btnId = `${id}-btn`;
  const visible = items.filter((i) => !i.hidden);

  const focusItem = useCallback((which: "first" | "last" | number) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
    if (!els.length) return;
    const idx = which === "first" ? 0 : which === "last" ? els.length - 1 : (which + els.length) % els.length;
    els[idx]?.focus();
  }, []);

  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) document.getElementById(btnId)?.focus();
  }, [btnId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    const raf = requestAnimationFrame(() => focusItem("first"));
    return () => {
      document.removeEventListener("pointerdown", onDown);
      cancelAnimationFrame(raf);
    };
  }, [open, focusItem]);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem("first");
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem("last");
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrap} className={cx("relative inline-flex", className)}>
      {trigger({
        onClick: () => setOpen((o) => !o),
        onKeyDown: (e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        },
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        id: btnId,
      })}
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          aria-labelledby={label ? undefined : btnId}
          className={cx("adm-menu", menuClassName)}
          data-align={align}
          data-side={side}
          onKeyDown={onMenuKey}
        >
          {visible.map((item, i) => {
            if (item.type === "separator") return <div key={i} role="separator" className="adm-menu-sep" />;
            if (item.type === "label")
              return (
                <div key={i} className="adm-menu-label" role="presentation">
                  {item.label}
                </div>
              );
            const role = item.checked !== undefined ? "menuitemradio" : "menuitem";
            const common = {
              role,
              tabIndex: -1,
              className: "adm-menu-item",
              "data-danger": item.danger ? "" : undefined,
              "aria-disabled": item.disabled || undefined,
              "aria-checked": item.checked,
            } as const;
            if (item.href && !item.disabled) {
              if (item.external) {
                return (
                  <a key={i} href={item.href} target="_blank" rel="noopener" {...common} onClick={() => close(false)}>
                    {item.icon}
                    {item.label}
                  </a>
                );
              }
              return (
                <Link key={i} href={item.href} {...common} onClick={() => close(false)}>
                  {item.icon}
                  {item.label}
                </Link>
              );
            }
            return (
              <button
                key={i}
                type="button"
                {...common}
                onClick={() => {
                  if (item.disabled) return;
                  close();
                  item.onSelect?.();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
