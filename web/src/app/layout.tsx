import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai, Inter_Tight } from "next/font/google";
import "./globals.css";
import { site, socials } from "@/content/site";
import { MOTION_BOOTSTRAP } from "@/lib/animations/motion";

const thai = IBM_Plex_Sans_Thai({
  // Thai glyphs only; Latin falls through to Inter Tight (see --font-sans).
  weight: ["400", "500", "600"],
  subsets: ["thai"],
  display: "swap",
  variable: "--ff-thai",
});

const display = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--ff-display",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.title,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  openGraph: {
    type: "website",
    locale: site.locale,
    url: "/",
    siteName: site.name,
    title: site.title,
    description: site.description,
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#050507",
  colorScheme: "dark",
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: site.name,
  legalName: site.legalName,
  url: site.url,
  logo: `${site.url}/images/logo.png`,
  description: site.description,
  telephone: site.contact.phoneE164,
  areaServed: "TH",
  sameAs: socials.map((s) => s.href),
  contactPoint: {
    "@type": "ContactPoint",
    telephone: site.contact.phoneE164,
    contactType: "customer service",
    availableLanguage: ["th", "en"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="th"
      data-motion="reduced"
      className={`${thai.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets data-motion before first paint: no animation flash, no CLS. */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOTSTRAP }} />
      </head>
      <body className="min-h-dvh">
        {/* Public chrome (header/footer/motion) lives in app/(site)/layout.tsx;
            /admin has its own minimal layout. */}
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd).replace(/</g, "\\u003c"),
          }}
        />
      </body>
    </html>
  );
}
