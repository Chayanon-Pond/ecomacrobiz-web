/**
 * /solutions copy (Wix /blank-4).
 * The live Wix page only has a hero and three short product cards (Branding
 * System, Communication Design, Digital full stack). The four chapters here
 * reuse the homepage solution copy (content/home.ts — single source for
 * titles, descriptions, tags and the anchor ids the homepage bento links to)
 * plus the Wix card pitch for each, and deliverables taken from those texts.
 */
import { solutions as homeSolutions } from "@/content/home";

export type SolutionChapter = {
  /** Anchor id — must equal the homepage bento href hash. */
  id: string;
  index: string;
  title: string;
  /** Short display name used in the sticky chapter index */
  shortTitle: string;
  titleTh: string;
  pitch: string;
  description: string;
  tags: string[];
  deliverables: { title: string; description: string }[];
  image: { src: string; alt: string; width: number; height: number; plate: "light" | "dark" };
  /** Related FAQ category on /how-we-work */
  faqCategory: string;
};

export const solutionsPage = {
  path: "/solutions",
  title: "Solutions",
  titleTh: "โซลูชันของเรา",
  seoTitle: "Solutions — Branding สื่อสารการตลาด และ Digital Full Stack",
  seoDescription:
    "บริการของ ECOMACROBIZ: Branding System อัตลักษณ์แบรนด์, Communication Design ระบบสื่อสารการตลาด, Digital Full Stack เว็บไซต์ Web App API และระบบคุณภาพ ISO 9001",
} as const;

export const solutionsHero = {
  eyebrow: "OUR SOLUTIONS",
  title: "Products Designed For You",
  subtitle:
    "บริการด้านการออกแบบแบรนด์ดิ้ง วางระบบการสื่อสาร พร้อมออกแบบแพลตฟอร์มดิจิทัล Full Stack",
  cta: { label: "Start your Project", href: "/contact" },
  image: {
    src: "/images/solutions/create-more.webp",
    alt: "สติกเกอร์ข้อความ Consume Less Create More บนผนังสีน้ำเงิน สื่อถึงงานออกแบบแบรนด์ที่สร้างคุณค่า",
    width: 2000,
    height: 1333,
  },
};

export const solutionsIntro = {
  eyebrow: homeSolutions.eyebrow,
  title: homeSolutions.title,
  body: homeSolutions.intro,
};

const byId = (id: string) => {
  const item = homeSolutions.items.find((s) => s.id === id);
  if (!item) throw new Error(`Unknown solution id: ${id}`);
  return item;
};

const branding = byId("branding-system");
const comms = byId("communications-tools-system");
const digital = byId("digital-platform");
const quality = byId("quality-system");

export const chapters: SolutionChapter[] = [
  {
    id: branding.id,
    index: branding.index,
    title: branding.title,
    shortTitle: "Branding System",
    titleTh: "ระบบแบรนด์",
    pitch:
      "บริการออกแบบ Branding สร้างเอกลักษณ์ที่โดดเด่น สื่อสารคุณค่าของแบรนด์ของคุณอย่างมีประสิทธิภาพ เพื่อให้แบรนด์ของคุณเป็นที่จดจำในตลาดเป้าหมาย",
    description: branding.description,
    tags: branding.tags,
    deliverables: [
      { title: "Marketing & Brand Strategy", description: "คิดกลยุทธ์การตลาดและวางรากฐานของแบรนด์" },
      { title: "Brand Identity / CI", description: "อัตลักษณ์แบรนด์และ Corporate Identity ที่ใช้งานได้จริง" },
      { title: "Logo", description: "ออกแบบโลโก้ที่สะท้อนตัวตนและจดจำได้" },
      { title: "Brand Book", description: "คู่มือแบรนด์และแนวทางการสื่อสารสำหรับทีม" },
      {
        title: "Key Brand Messages",
        description: "ข้อความสื่อสารสำคัญที่ต่อยอดเป็นสื่อการตลาดและการขาย",
      },
    ],
    image: {
      src: "/images/solutions/branding-system.webp",
      alt: "ตัวอย่าง Brand Book, Brand Strategic Blueprint และระบบโลโก้ของ ecomacrobiz บนหน้าจอและเอกสาร",
      width: 1280,
      height: 1600,
      plate: "light",
    },
    faqCategory: "brand-strategy-identity",
  },
  {
    id: comms.id,
    index: comms.index,
    title: comms.title,
    shortTitle: "Communications Tools",
    titleTh: "ระบบเครื่องมือสื่อสาร",
    pitch:
      "ออกแบบระบบสื่อสารการตลาดที่มีประสิทธิภาพและสร้างสรรค์ ช่วยให้คุณเข้าถึงลูกค้าได้อย่างตรงจุดและมีผลลัพธ์ที่ชัดเจน",
    description: comms.description,
    tags: comms.tags,
    deliverables: [
      {
        title: "Sales Tools",
        description: "Catalog, Sales Deck, Company Profile และ Proposal",
      },
      { title: "Content Pillars", description: "เขียนคอนเทนต์พร้อมวางแกนเนื้อหาของแบรนด์" },
      { title: "Design Standards", description: "กำหนดมาตรฐานงานออกแบบให้สื่อทุกชิ้นไปในทิศทางเดียวกัน" },
      { title: "SEO / GEO Articles", description: "บทความเว็บไซต์เชิงคุณภาพสำหรับ SEO / GEO" },
      { title: "Wireframe & Sitemap", description: "ร่างโครงสร้างเว็บไซต์ก่อนออกแบบและพัฒนา" },
    ],
    image: {
      src: "/images/solutions/communications-tools.webp",
      alt: "ตัวอย่าง Sales Deck, Website Wireframe, Sitemap และ Marketing Communication Plan บนอุปกรณ์หลายขนาด",
      width: 1280,
      height: 1600,
      plate: "light",
    },
    faqCategory: "content-seo-collaboration",
  },
  {
    id: digital.id,
    index: digital.index,
    title: digital.title,
    shortTitle: "Digital Platform",
    titleTh: "แพลตฟอร์มดิจิทัลและ Full Stack",
    pitch:
      "บริการสร้างและพัฒนาโซลูชันดิจิทัลที่ครบวงจร ตั้งแต่การออกแบบเว็บไซต์ ไปจนถึงการพัฒนาเว็บแอปพลิเคชันและ API ที่มีประสิทธิภาพ",
    description: digital.description,
    tags: digital.tags,
    deliverables: [
      { title: "Website", description: "ออกแบบและพัฒนาเว็บไซต์ตามบริบทองค์กร" },
      { title: "Web App & API", description: "Web Application และการเชื่อมระบบด้วย API" },
      { title: "Workflow", description: "ออกแบบ Workflow และเทคโนโลยีที่ช่วยลดขั้นตอน" },
      { title: "Data System & Dashboard", description: "ระบบข้อมูลและ Dashboard สำหรับการตัดสินใจ" },
      { title: "CRM / ERP Integration", description: "พัฒนาระบบ CRM, ERP ให้ใช้งานร่วมกันได้อย่างเป็นระบบ" },
    ],
    image: {
      src: "/images/solutions/digital-platform.webp",
      alt: "Dashboard และเว็บไซต์ธีมสีเข้มแสดงบนคอมพิวเตอร์ แล็ปท็อป แท็บเล็ต และมือถือ",
      width: 1600,
      height: 1600,
      plate: "light",
    },
    faqCategory: "digital-design-development",
  },
  {
    id: quality.id,
    index: quality.index,
    title: quality.title,
    shortTitle: "Quality System",
    titleTh: "ระบบคุณภาพ",
    pitch:
      "วางมาตรฐานวิธีการปฏิบัติงานให้สอดคล้องกับ ISO 9001:2026 และนำเอกสารคุณภาพเข้าสู่ระบบดิจิทัล",
    description: quality.description,
    tags: quality.tags,
    deliverables: [
      { title: "ISO 9001:2026", description: "ระบบบริหารคุณภาพที่สอดคล้องกับมาตรฐาน" },
      { title: "SOP", description: "มาตรฐานวิธีการปฏิบัติงานที่ชัดเจนและตรวจสอบได้" },
      { title: "Digital Documents", description: "พัฒนาเอกสารคุณภาพสู่ระบบดิจิทัล" },
      { title: "Process Control", description: "ระบบควบคุมและติดตามกระบวนการทำงาน" },
    ],
    image: {
      src: quality.image?.src ?? "/images/quality-system.webp",
      alt: quality.image?.alt ?? "",
      width: quality.image?.width ?? 1024,
      height: quality.image?.height ?? 768,
      plate: "dark",
    },
    faqCategory: "iso-9001",
  },
];

export const solutionsCta = {
  eyebrow: "START YOUR PROJECT",
  title: ["Let's build", "what fits."],
  body: "ไม่ต้องเลือกบริการให้ครบทุกอย่าง เล่าโจทย์ของคุณให้เราฟัง แล้วเราจะช่วยพิจารณาว่าองค์ประกอบใดควรเริ่มก่อน",
};
