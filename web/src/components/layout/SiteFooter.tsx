import Link from "next/link";
import { nav, site, socials } from "@/content/site";
import { LogoMark } from "@/components/ui/Logo";
import { SocialIcon } from "@/components/ui/SocialIcon";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-line bg-ink">
      <div className="container-page grid gap-12 pb-10 pt-16 md:grid-cols-2 md:pt-20 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex flex-col gap-5">
          <LogoMark className="h-6 w-auto self-start" />
          <p className="max-w-sm text-muted">
            ที่ปรึกษาและผู้พัฒนาโซลูชันทางธุรกิจ ด้านแบรนด์ การสื่อสาร
            แพลตฟอร์มดิจิทัล และระบบคุณภาพ
          </p>
          <p className="font-display text-sm font-semibold tracking-[0.08em] text-fg">
            {site.legalName}
          </p>
        </div>

        <nav aria-label="เมนูส่วนท้าย">
          <p className="eyebrow mb-4">Explore</p>
          <ul className="grid grid-cols-2 gap-x-6 md:grid-cols-1">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center text-muted transition-colors hover:text-fg"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <p className="eyebrow mb-4">Contact</p>
          <a
            href={`tel:${site.contact.phoneE164}`}
            className="inline-flex min-h-11 items-center font-display text-xl font-semibold text-fg transition-colors hover:text-accent-soft"
          >
            {site.contact.phoneDisplay}
          </a>
          <ul className="mt-4 flex flex-wrap gap-2">
            {socials.map((s) => (
              <li key={s.id}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${site.name} บน ${s.label}`}
                  className="inline-flex size-12 items-center justify-center rounded-full border border-line-strong text-muted transition-all duration-300 hover:-translate-y-0.5 hover:border-accent hover:bg-accent hover:text-white"
                >
                  <SocialIcon id={s.id} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="container-page" aria-hidden="true">
        <p className="display-tight select-none whitespace-nowrap text-center text-[clamp(2.5rem,13.2vw,15rem)] font-bold text-transparent [-webkit-text-stroke:1px_rgb(255_255_255/0.14)]">
          {site.wordmark}
        </p>
      </div>

      <div className="container-page flex flex-col gap-2 border-t border-line py-6 text-sm text-subtle sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {site.copyrightYear} {site.legalName} All rights reserved.
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/privacy" className="inline-flex min-h-11 items-center transition-colors hover:text-fg">
            นโยบายความเป็นส่วนตัว
          </Link>
          <p className="font-display tracking-[0.12em]">TURNING DIRECTION INTO GROWTH</p>
        </div>
      </div>
    </footer>
  );
}
