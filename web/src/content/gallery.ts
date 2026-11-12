/**
 * /gallery copy + images (Wix /blank-2 "Creative Branding Design").
 * The Wix page is a single hand-laid project (no Pro Gallery, no albums or
 * categories): a three-image mood board labelled Texture / Iconic / Packaging,
 * then five brand applications for the ORÉNPURE skincare concept.
 * Images: Wix originals re-encoded to WebP (q80, long edge <= 2400 — all
 * originals are smaller, so native size is kept). Width/height are the real
 * file dimensions (no CLS).
 */

export type GalleryGroup = "moodboard" | "application";

export type GalleryImage = {
  id: string;
  src: string;
  width: number;
  height: number;
  /** Thai alt text */
  alt: string;
  /** Short title shown on the tile and in the lightbox */
  title: string;
  /** Caption shown in the lightbox */
  caption: string;
  group: GalleryGroup;
};

export const galleryPage = {
  path: "/gallery",
  title: "Design Gallery",
  titleTh: "ผลงานออกแบบ",
  seoTitle: "Design Gallery — ผลงานออกแบบแบรนด์และแพ็กเกจจิ้ง",
  seoDescription:
    "ตัวอย่างผลงานออกแบบของ ECOMACROBIZ ทั้งงาน Branding System อัตลักษณ์สินค้า Texture Iconic และ Packaging Design สำหรับธุรกิจที่ต้องการสร้างแบรนด์ให้จดจำได้",
} as const;

export const galleryHero = {
  eyebrow: "DESIGN GALLERY",
  title: "Creative Branding Design",
  subtitle: "Branding System",
  subtitleTh: "ออกแบบอัตลักษณ์สินค้า",
  project: "ORÉNPURE — Botanical Ritual Skincare",
};

export const galleryGroups: Record<GalleryGroup, { eyebrow: string; title: string; titleTh: string }> = {
  moodboard: { eyebrow: "01 — MOOD BOARD", title: "Brand Concept", titleTh: "แนวคิดและอารมณ์ของแบรนด์" },
  application: {
    eyebrow: "02 — BRAND APPLICATION",
    title: "Branding Design",
    titleTh: "การนำอัตลักษณ์ไปใช้กับสื่อและจุดสัมผัสของแบรนด์",
  },
};

export const galleryImages: GalleryImage[] = [
  {
    id: "texture",
    src: "/images/gallery/orenpure-texture.webp",
    width: 1022,
    height: 1536,
    alt: "ออยล์สีเหลืองอ่อนไหลจากหัวปั๊มลงบนพื้นสีขาว แสดงเท็กซ์เจอร์ของผลิตภัณฑ์",
    title: "Texture",
    caption: "Mood Board — เท็กซ์เจอร์ของผลิตภัณฑ์",
    group: "moodboard",
  },
  {
    id: "iconic",
    src: "/images/gallery/orenpure-iconic.webp",
    width: 1022,
    height: 1536,
    alt: "นางแบบผิวโกลว์สวมชุดผ้าพลีทสีครีม ภาพบุคลิกของแบรนด์",
    title: "Iconic",
    caption: "Mood Board — บุคลิกและภาพลักษณ์ของแบรนด์",
    group: "moodboard",
  },
  {
    id: "packaging-mood",
    src: "/images/gallery/orenpure-packaging-mood.webp",
    width: 1122,
    height: 1402,
    alt: "ดอกดาวเรืองสีเหลืองอ่อนบนหินสีขาวและเงาใบไม้ โทนสีสำหรับแพ็กเกจจิ้ง",
    title: "Packaging",
    caption: "Brand Concept — โทนสีและวัตถุดิบสำหรับแพ็กเกจจิ้ง",
    group: "moodboard",
  },
  {
    id: "store-front",
    src: "/images/gallery/orenpure-store-front.webp",
    width: 1122,
    height: 1402,
    alt: "หน้าร้าน ORÉNPURE Botanical Ritual Skincare ในห้างสรรพสินค้า โทนขาวและเหลือง",
    title: "Store Front",
    caption: "Branding Design — ป้ายและหน้าร้าน",
    group: "application",
  },
  {
    id: "billboard",
    src: "/images/gallery/orenpure-billboard.webp",
    width: 1448,
    height: 1086,
    alt: "บิลบอร์ดขนาดใหญ่ของ ORÉNPURE บนอาคาร แสดงนางแบบและขวดคลีนซิ่งออยล์",
    title: "Billboard",
    caption: "Brand Communication — สื่อโฆษณานอกบ้าน",
    group: "application",
  },
  {
    id: "retail-counter",
    src: "/images/gallery/orenpure-retail-counter.webp",
    width: 1122,
    height: 1402,
    alt: "เคาน์เตอร์และชั้นวางสินค้า ORÉNPURE ตกแต่งด้วยดอกไม้สีเหลือง",
    title: "Retail Counter",
    caption: "แบรนด์ดิ้ง — พื้นที่ขายและการจัดแสดงสินค้า",
    group: "application",
  },
  {
    id: "digital-touchpoints",
    src: "/images/gallery/orenpure-digital-touchpoints.webp",
    width: 1086,
    height: 1448,
    alt: "เว็บไซต์ อินสตาแกรม LINE OA อีเมลนิวส์เลตเตอร์ และหน้า E-commerce ของ ORÉNPURE บนอุปกรณ์ต่าง ๆ",
    title: "Digital Touchpoints",
    caption: "ออกแบบเว็บไซต์สินค้า — เว็บไซต์ โซเชียลมีเดีย และ E-commerce",
    group: "application",
  },
  {
    id: "cleansing-oil",
    src: "/images/gallery/orenpure-cleansing-oil.webp",
    width: 1122,
    height: 1402,
    alt: "ขวด ORÉNPURE Calendula Gentle Cleansing Oil วางบนหินพร้อมดอกดาวเรือง",
    title: "Logo & Label",
    caption: "ออกแบบโลโก้และฉลากสินค้า",
    group: "application",
  },
];

export const galleryCta = {
  eyebrow: "LET'S CREATE",
  title: ["Your brand,", "designed to be remembered."],
  body: "ต้องการอัตลักษณ์แบรนด์ แพ็กเกจจิ้ง หรือสื่อที่ทำให้แบรนด์ของคุณเป็นที่จดจำ เล่าโจทย์ให้เราฟังได้เลย",
  secondary: { label: "See Solutions", href: "/solutions" },
};
