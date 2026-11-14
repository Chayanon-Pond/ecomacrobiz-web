/**
 * Site-wide content: brand, navigation, contact, office NAP and social links.
 * Single source of truth — components must not hardcode these values.
 */

export type NavItem = {
  label: string;
  /** Thai helper label shown in the mobile menu */
  labelTh: string;
  href: string;
};

export type SocialLink = {
  id: "line" | "linkedin" | "facebook" | "instagram";
  label: string;
  href: string;
};

export const site = {
  name: "ECOMACROBIZ",
  legalName: "ECOMACROBIZ CO., LTD.",
  wordmark: ".ecomacrobiz",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.ecomacrobiz.com",
  locale: "th_TH",
  title: "ECOMACROBIZ | ที่ปรึกษาแบรนด์ กลยุทธ์ และระบบดิจิทัล B2B",
  description:
    "ECOMACROBIZ ที่ปรึกษาและผู้พัฒนาโซลูชันธุรกิจครบวงจร ตั้งแต่กลยุทธ์แบรนด์ Brand Identity สื่อสารการตลาด เว็บไซต์ Web App API Dashboard และระบบคุณภาพ ISO 9001",
  copyrightYear: 2026,
  cta: {
    label: "นัดปรึกษา",
    href: "/contact",
  },
  contact: {
    phoneDisplay: "064-926-9968",
    phoneE164: "+66649269968",
  },
} as const;

const addressEn =
  "1 Empire Tower Building, 47th Floor, Unit 4703, South Sathorn Road, Yannawa Sub-District, Sathorn District, Bangkok 10120";

/**
 * Office NAP (name, address, phone) + opening hours, supplied by the boss
 * 2026-11-14. Single source for the footer, /contact, /privacy and JSON-LD:
 * never retype these values elsewhere.
 * TODO(geo): latitude/longitude not supplied — the boss can provide them for
 * JSON-LD `geo` (GeoCoordinates). No holiday hours either.
 */
export const office = {
  name: site.legalName,
  phoneDisplay: site.contact.phoneDisplay,
  phoneE164: site.contact.phoneE164,
  addressTh:
    "เลขที่ 1 อาคารเอ็มไพร์ ทาวเวอร์ ชั้นที่ 47 ยูนิต 4703 ถนนสาทรใต้ แขวงยานนาวา เขตสาทร กรุงเทพมหานคร 10120",
  addressEn,
  postal: {
    streetAddress: "1 Empire Tower Building, 47th Floor, Unit 4703, South Sathorn Road",
    /** Sub-locality (แขวงยานนาวา); schema.org PostalAddress has no field for it. */
    subLocality: "Yannawa",
    addressLocality: "Sathorn",
    addressRegion: "Bangkok",
    postalCode: "10120",
    addressCountry: "TH",
  },
  /** Maps search for the English address (no embed, no API key). */
  mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressEn)}`,
  hours: {
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    opens: "10:00",
    closes: "18:00",
    timeZone: "Asia/Bangkok",
    labelTh: "จันทร์–ศุกร์ 10:00–18:00 น.",
    labelEn: "Monday–Friday 10:00–18:00 (closed Saturday–Sunday)",
  },
} as const;

export const nav: NavItem[] = [
  { label: "Home", labelTh: "หน้าแรก", href: "/" },
  { label: "Purpose", labelTh: "เป้าหมายของเรา", href: "/purpose" },
  { label: "Solutions", labelTh: "โซลูชัน", href: "/solutions" },
  { label: "Design Gallery", labelTh: "ผลงานออกแบบ", href: "/gallery" },
  { label: "How We Work", labelTh: "วิธีการทำงาน", href: "/how-we-work" },
  { label: "Knowledge", labelTh: "บทความและความรู้", href: "/knowledge" },
  { label: "Contact Us", labelTh: "ติดต่อเรา", href: "/contact" },
];

export const socials: SocialLink[] = [
  { id: "line", label: "LINE", href: "https://lin.ee/sATHhgar" },
  {
    id: "linkedin",
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/ecomacrobiz/",
  },
  {
    id: "facebook",
    label: "Facebook",
    href: "https://www.facebook.com/ecomacrobiz/",
  },
  {
    id: "instagram",
    label: "Instagram",
    href: "https://www.instagram.com/ecomacrobiz",
  },
];
