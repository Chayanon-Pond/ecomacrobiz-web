/**
 * Homepage copy, migrated from the Wix site (www.ecomacrobiz.com) with typo
 * fixes applied. See docs in the repo README / memory note for the fix log.
 * Removed on purpose: the leftover Wix template block
 * ("Ashape is Emergine / This is a space to welcome visitors...") and the
 * placeholder "This is the space to introduce the Product section" texts.
 */

export type Stat = {
  value: number;
  label: string;
  description: string;
};

export type Pillar = {
  title: string;
  subtitle: string;
  description: string;
};

export type Solution = {
  id: string;
  index: string;
  title: string;
  description: string;
  tags: string[];
  href: string;
  image?: { src: string; alt: string; width: number; height: number };
};

export type Post = {
  title: string;
  category: string;
  readTime: string;
  /** /knowledge/<slug> */
  slug: string;
};

export const hero = {
  eyebrow: "Creative With Direction",
  taglineLines: ["TURNING DIRECTION", "INTO GROWTH"],
  /** Visually hidden h1 suffix so the single h1 is descriptive for SEO. */
  srTitle: "ที่ปรึกษาแบรนด์ กลยุทธ์ และระบบดิจิทัล B2B",
  intro:
    "ที่ปรึกษาและผู้พัฒนาโซลูชันทางธุรกิจ ตั้งแต่กลยุทธ์แบรนด์ การสื่อสาร ไปจนถึงแพลตฟอร์มดิจิทัลและระบบคุณภาพ",
  secondaryCta: { label: "Our solution", href: "#solutions" },
};

export const whoWeAre = {
  eyebrow: "WHO WE ARE",
  statement:
    "ที่ปรึกษาและผู้พัฒนาโซลูชันทางธุรกิจ ที่ผสานความเข้าใจในธุรกิจ ความสามารถเชิงวิชาชีพ และความรับผิดชอบเข้ากับการคิดวิเคราะห์ ออกแบบกลยุทธ์ และพัฒนาระบบที่ตอบโจทย์การดำเนินธุรกิจจริง",
  body: "เราเชื่อว่าการให้คำปรึกษาที่มีคุณค่าเริ่มต้นจากการรับฟังและทำความเข้าใจ ไม่ใช่เพียงการนำเสนอสินค้าหรือบริการ แต่รวมถึงการพิจารณาปัญหา โอกาส ข้อจำกัด และความพร้อมของลูกค้าอย่างรอบด้าน ก่อนเสนอแนวทางที่เหมาะสมและมีเหตุผลรองรับ",
};

export const designing = {
  kicker: ["CREATIVITY DESIGN", "CONNECTED FUTURE"],
  lead: "Designing",
  lines: ["Freedom", "Imagination", "Connections", "with Responsibility"],
};

export const numbers = {
  eyebrow: "ABOUT US",
  title: "Our Numbers",
  intro:
    "ECOMACROBIZ สร้างธุรกิจโดยยึดหลักปรัชญาในการตัดสินใจ พัฒนาบริการและสินทรัพย์ที่จับต้องได้ ส่งมอบมูลค่าแบบห่วงโซ่อุปทาน จรรยาบรรณ กฎหมาย และสิทธิในทรัพย์สินทางปัญญา คือสิ่งที่เรายึดมั่นด้วยความรับผิดชอบต่อลูกค้าและสังคม",
  stats: [
    {
      value: 22,
      label: "GUIDING PRINCIPLES",
      description:
        "ปรัชญา 22 หลัก ที่ใช้เป็นแนวทางในการตัดสินใจอย่างรับผิดชอบ สร้างคุณค่าที่มีความหมาย และคำนึงถึงความยั่งยืนในระยะยาว",
    },
    {
      value: 12,
      label: "BUSINESS ETHICS PRINCIPLES",
      description:
        "จรรยาบรรณ 12 ประการที่มุ่งเน้นความซื่อตรง ความรับผิดชอบ การปฏิบัติงานอย่างมืออาชีพ และการดำเนินธุรกิจอย่างมีจริยธรรม",
    },
    {
      value: 4,
      label: "CORE SOLUTIONS",
      description:
        "บริการหลัก 4 กลุ่มที่เชื่อมโยงการสร้างแบรนด์ การสื่อสาร เทคโนโลยีดิจิทัล และระบบบริหารคุณภาพเข้าด้วยกัน",
    },
    {
      value: 8,
      label: "CORE CAPABILITIES",
      description:
        "ขีดความสามารถ 8 ด้านที่สนับสนุนการคิดเชิงกลยุทธ์ การพัฒนางานสร้างสรรค์ และการสร้างโซลูชันที่ตอบโจทย์ธุรกิจจริง",
    },
  ] satisfies Stat[],
};

export const sustainability = {
  title: { lead: "Our", accent: "sustainability" },
  paragraphs: [
    "เราให้ความสำคัญกับความยั่งยืนในความหมายที่ครอบคลุมมากกว่าการอนุรักษ์สิ่งแวดล้อม เพราะความยั่งยืนยังเกี่ยวข้องกับคุณภาพชีวิตและศักดิ์ศรีของมนุษย์ โอกาสในการเข้าถึงและรักษาองค์ความรู้ ความไว้วางใจระหว่างผู้คน คุณภาพของระบบ ตลอดจนการใช้ทรัพยากรอย่างมีเหตุผล",
    "เราเชื่อว่าความรับผิดชอบต่อสิ่งเหล่านี้ไม่จำเป็นต้องรอจนกว่าองค์กรจะเติบโตหรือสร้างผลกำไร แต่สามารถเริ่มต้นได้จากการตัดสินใจและการดำเนินงานในปัจจุบัน",
  ],
  image: {
    src: "/images/earth.webp",
    alt: "โลกยามค่ำคืนจากอวกาศ สะท้อนแนวคิดความยั่งยืนของ ECOMACROBIZ",
    width: 2000,
    height: 1000,
  },
};

export const foundation = {
  eyebrow: "CORPORATE IDENTITY & FOUNDATION",
  title: "The Foundation of Our Professional Practice",
  cta: { label: "LEARN MORE", href: "/purpose" },
  pillars: [
    {
      title: "CAPABILITY",
      subtitle: "The Ability to Develop and Deliver",
      description:
        "ความสามารถในการออกแบบ พัฒนา และส่งมอบโซลูชันที่เหมาะสมกับความต้องการของธุรกิจ โดยคำนึงถึงความพร้อม ทรัพยากร และคุณภาพของผลงานที่นำไปใช้งานได้จริง",
    },
    {
      title: "CONSULTING COMPETENCE",
      subtitle: "The Ability to Understand, Analyze, and Advise",
      description:
        "ความสามารถในการเข้าใจบริบทธุรกิจ วิเคราะห์ปัญหาและโอกาส ประเมินทางเลือกด้วยเหตุผลและหลักฐาน พร้อมให้คำปรึกษาที่ตรงไปตรงมา เพื่อสนับสนุนการตัดสินใจของลูกค้า",
    },
    {
      title: "RESPONSIBILITY",
      subtitle: "Accountability in Advice and Delivery",
      description:
        "ความรับผิดชอบต่อคำแนะนำ ข้อตกลง คุณภาพของงาน สิทธิในทรัพย์สินทางปัญญา การใช้ทรัพยากร และผลกระทบที่เกี่ยวข้องกับการดำเนินงาน",
    },
  ] satisfies Pillar[],
};

export const capabilities: string[] = [
  "Branding",
  "CI",
  "Packaging",
  "Website",
  "Web App",
  "API",
  "Dashboard",
  "Workflow Automation",
  "AI",
  "ISO 9001",
];

export const solutions = {
  eyebrow: "4 SOLUTIONS",
  title: "Business, Brand & Digital Solutions for Growing Organizations",
  intro:
    "โซลูชันของเราครอบคลุมตั้งแต่การพัฒนากลยุทธ์และโมเดลธุรกิจ การวางระบบแบรนด์และการสื่อสาร การออกแบบ Corporate Communication, Packaging & Label Design, Website และ Digital Experience ไปจนถึงการพัฒนา Web Application, API, Database, Data Dashboard, Workflow Automation และ AI-enabled Solutions เพื่อเชื่อมข้อมูล กระบวนการ และการทำงานขององค์กรให้มีประสิทธิภาพมากขึ้น",
  items: [
    {
      id: "branding-system",
      index: "01",
      title: "BRANDING SYSTEM",
      description:
        "บริการสร้างแบรนด์และวางรากฐาน ตั้งแต่คิดกลยุทธ์การตลาด แบรนด์ดิ้ง Brand Identity, CI, Logo, Brand Book และแนวทางการสื่อสาร ไปจนถึงข้อความสื่อสารสำคัญของแบรนด์ที่สามารถนำไปต่อยอดเป็นสื่อทางการตลาดและการขาย",
      tags: ["Brand Strategy", "Brand Identity", "CI / Logo", "Brand Book"],
      href: "/solutions#branding-system",
      image: {
        src: "/images/branding-system.webp",
        alt: "ตัวอย่างงาน Brand Book และ Brand Identity ของ ecomacrobiz",
        width: 1400,
        height: 1750,
      },
    },
    {
      id: "communications-tools-system",
      index: "02",
      title: "COMMUNICATIONS TOOLS SYSTEM",
      description:
        "วางระบบด้านสื่อสารการตลาด ทั้ง Media และ Tools ออกแบบสื่อการขาย Catalog, Sales Deck, Company Profile, Proposal เขียนคอนเทนต์พร้อมวาง Content Pillars กำหนดมาตรฐานงานออกแบบ และเครื่องมือสื่อสารดิจิทัล Website เขียนบทความเว็บไซต์เชิงคุณภาพ SEO / GEO ร่าง Wireframe และ Sitemap",
      tags: ["Company Profile", "Catalog", "Content Pillars", "SEO / GEO"],
      href: "/solutions#communications-tools-system",
    },
    {
      id: "digital-platform",
      index: "03",
      title: "DIGITAL PLATFORM AND FULL STACK",
      description:
        "ออกแบบและพัฒนาระบบแพลตฟอร์ม Website, Web App เชื่อมเว็บไซต์ด้วย API, Workflow และเทคโนโลยี Data System, Dashboard พัฒนาระบบ CRM, ERP ให้สามารถใช้งานร่วมกันได้อย่างเป็นระบบตามบริบทองค์กร",
      tags: ["Website Design", "Web App / API", "Data Dashboard", "AI Automation"],
      href: "/solutions#digital-platform",
      image: {
        src: "/images/digital-platform.webp",
        alt: "เว็บไซต์ที่ออกแบบโดย ecomacrobiz แสดงบนคอมพิวเตอร์ แท็บเล็ต และมือถือ",
        width: 1448,
        height: 1086,
      },
    },
    {
      id: "quality-system",
      index: "04",
      title: "QUALITY SYSTEM",
      description:
        "ออกแบบและพัฒนาระบบควบคุมมาตรฐานวิธีการปฏิบัติงานให้สอดคล้องกับ ISO 9001:2026 พร้อมพัฒนาเอกสารสู่ระบบดิจิทัล",
      tags: ["ISO 9001", "SOP", "Digital Documents", "Process Control"],
      href: "/solutions#quality-system",
      image: {
        src: "/images/quality-system.webp",
        alt: "ทีมงานในออฟฟิศพร้อมแผนที่โลกดิจิทัล สื่อถึงระบบคุณภาพและการทำงานที่เชื่อมโยงกัน",
        width: 1024,
        height: 768,
      },
    },
  ] satisfies Solution[],
};

export const knowledge = {
  eyebrow: "TRENDS, INSIGHTS & KNOWLEDGE",
  title: "Knowledge",
  cta: { label: "อ่านบทความทั้งหมด", href: "/knowledge" },
  posts: [
    {
      title:
        "Branding กับ Marketing มองต่างกันยังไง? ผ่านเคสศึกษา IBM, Google และ Microsoft",
      category: "BUSINESS & GROWTH",
      readTime: "อ่าน 13 นาที",
      slug: "branding-vs-marketing",
    },
    {
      title: "Coca-Cola Branding จากรุ่นแรกถึงปัจจุบัน สร้างความจดจำแบรนด์ได้อย่างไร",
      category: "BUSINESS & GROWTH",
      readTime: "อ่าน 8 นาที",
      slug: "coca-cola-brand-recognition",
    },
    {
      title: "Huda Beauty × Cardi B: Ultra Snatched",
      category: "BRAND INSIGHT GLOBAL 2026",
      readTime: "อ่าน 5 นาที",
      slug: "huda-beauty-cardi-b-ultra-snatched-2026",
    },
    {
      title: "เศรษฐกิจไทย 2026",
      category: "INVESTMENT INSIGHT",
      readTime: "อ่าน 3 นาที",
      slug: "thailand-economy-2026",
    },
  ] satisfies Post[],
};

export const closingCta = {
  eyebrow: "LET'S TALK",
  title: ["Turning direction", "into growth."],
  body: "เล่าโจทย์ธุรกิจของคุณให้เราฟัง แล้วเราจะช่วยวางแนวทางที่เหมาะสมและมีเหตุผลรองรับ ตั้งแต่แบรนด์ การสื่อสาร ไปจนถึงระบบดิจิทัล",
};
