"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { nav, site, socials } from "@/content/site";
import { Logo } from "@/components/ui/Logo";
import { MagneticButton, ArrowIcon } from "@/components/ui/MagneticButton";
import { SocialIcon } from "@/components/ui/SocialIcon";
import { lockScroll } from "@/lib/animations/scroll-store";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll lock, Escape to close, focus management.
  useEffect(() => {
    lockScroll(open);
    if (!open) return;
    const firstLink = menuRef.current?.querySelector<HTMLElement>("a");
    firstLink?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      lockScroll(false);
    };
  }, [open]);

  // Close the menu if the viewport grows into desktop-nav range.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 73.75rem)");
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const close = () => setOpen(false);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-500 ${
        scrolled || open ? "glass border-b border-line" : "border-b border-transparent"
      }`}
    >
      <div className="container-page flex h-[var(--header-h)] items-center justify-between gap-4">
        <Logo onClick={close} />

        <nav aria-label="เมนูหลัก" className="hidden nav:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative inline-flex min-h-11 items-center rounded-full px-3 font-display text-[0.8rem] font-medium uppercase tracking-[0.08em] transition-colors duration-300 hover:text-fg ${
                      active ? "text-fg" : "text-muted"
                    }`}
                  >
                    {item.label}
                    {active && (
                      <span className="absolute inset-x-3 bottom-2 h-px bg-accent-soft" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <MagneticButton
            href={site.cta.href}
            size="sm"
            strength={8}
            onClick={close}
            className="sm:min-h-11 sm:px-5"
          >
            {site.cta.label}
            <ArrowIcon className="hidden size-3.5 sm:block" />
          </MagneticButton>

          <button
            ref={toggleRef}
            type="button"
            className="relative inline-flex size-11 items-center justify-center rounded-full border border-line-strong transition-colors hover:bg-white/5 nav:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "ปิดเมนู" : "เปิดเมนู"}
            onClick={() => setOpen((v) => !v)}
          >
            <span
              className={`absolute h-[1.5px] w-[18px] rounded bg-fg transition-transform duration-500 ease-out-expo ${
                open ? "rotate-45" : "-translate-y-[4px]"
              }`}
            />
            <span
              className={`absolute h-[1.5px] w-[18px] rounded bg-fg transition-transform duration-500 ease-out-expo ${
                open ? "-rotate-45" : "translate-y-[4px]"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Full-screen mobile / tablet menu */}
      <div
        id="mobile-menu"
        ref={menuRef}
        inert={!open}
        className={`fixed inset-x-0 bottom-0 top-[var(--header-h)] z-40 flex h-[calc(100dvh-var(--header-h))] flex-col overflow-y-auto bg-ink/95 backdrop-blur-xl transition-[opacity,clip-path] duration-700 ease-out-expo nav:hidden ${
          open
            ? "pointer-events-auto opacity-100 [clip-path:inset(0_0_0_0)]"
            : "pointer-events-none opacity-0 [clip-path:inset(0_0_100%_0)]"
        }`}
        data-lenis-prevent
      >
        <nav aria-label="เมนูมือถือ" className="container-page flex flex-1 flex-col py-6">
          <ul className="flex flex-col">
            {nav.map((item, i) => {
              const active = isActive(pathname, item.href);
              return (
                <li
                  key={item.href}
                  className={`border-b border-line transition-[opacity,transform] duration-700 ease-out-expo ${
                    open ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
                  }`}
                  style={{ transitionDelay: open ? `${120 + i * 50}ms` : "0ms" }}
                >
                  <Link
                    href={item.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className="group flex min-h-14 items-center justify-between gap-4 py-2"
                  >
                    <span className="flex flex-col">
                      <span
                        className={`font-display text-[clamp(1.5rem,5.6vw,2.6rem)] font-semibold leading-[1.1] tracking-[-0.03em] ${
                          active ? "text-accent-soft" : "text-fg"
                        }`}
                      >
                        {item.label}
                      </span>
                      <span className="text-sm leading-5 text-muted">{item.labelTh}</span>
                    </span>
                    <ArrowIcon className="size-5 text-muted transition-transform duration-300 group-hover:translate-x-1 group-hover:text-fg" />
                  </Link>
                </li>
              );
            })}
          </ul>

          <div
            className={`mt-auto flex flex-col gap-4 pt-6 transition-[opacity,transform] duration-700 ease-out-expo ${
              open ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
            }`}
            style={{ transitionDelay: open ? "500ms" : "0ms" }}
          >
            <MagneticButton href={site.cta.href} size="lg" onClick={close} className="w-full">
              {site.cta.label}
              <ArrowIcon />
            </MagneticButton>
            <div className="flex items-center justify-between gap-4">
              <a
                href={`tel:${site.contact.phoneE164}`}
                className="inline-flex min-h-11 items-center text-muted hover:text-fg"
              >
                โทร {site.contact.phoneDisplay}
              </a>
              <ul className="flex items-center gap-1">
                {socials.map((s) => (
                  <li key={s.id}>
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={s.label}
                      className="inline-flex size-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/5 hover:text-fg"
                    >
                      <SocialIcon id={s.id} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </nav>
      </div>
    </header>
  );
}
