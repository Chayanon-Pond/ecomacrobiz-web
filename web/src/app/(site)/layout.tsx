import type { ReactNode } from "react";
import { socials } from "@/content/site";
import { SiteChrome } from "@/components/layout/SiteChrome";
import { JsonLd, organizationJsonLd, websiteJsonLd } from "@/lib/seo/jsonld";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteChrome>{children}</SiteChrome>
      <JsonLd data={[organizationJsonLd(socials.map((s) => s.href)), websiteJsonLd()]} />
    </>
  );
}
