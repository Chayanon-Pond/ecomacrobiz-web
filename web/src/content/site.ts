/**
 * Site-wide content: brand, navigation, contact and social links.
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
