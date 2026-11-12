import type { ReactNode } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { CustomCursor } from "@/components/ui/CustomCursor";

/** Public-site chrome: skip link, glass header, footer, motion runtime, cursor. */
export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-[60] rounded-full bg-accent px-5 py-3 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
      <MotionRuntime />
      <CustomCursor />
    </>
  );
}
