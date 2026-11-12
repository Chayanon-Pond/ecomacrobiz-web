/**
 * /purpose copy (Wix /blank — "OUR STORY").
 * Faithful to the live page as of 2026-11-12. Note: the live page does not
 * list the "22 principles / 12 ethics" mentioned in the homepage numbers —
 * it is organised as Story, Who we are, What we believe, Values, Vision,
 * Mission, How we think and How we work, which is what this file mirrors.
 */

export type PurposeValue = {
  id: string;
  title: string;
  paragraphs: string[];
};

export type Lens = {
  title: string;
  description: string;
};

export const purposePage = {
  path: "/purpose",
  title: "Purpose",
  titleTh: "เป้าหมายและหลักการของเรา",
  seoTitle: "Purpose — ที่ปรึกษา Business Transformation",
  seoDescription:
    "ECOMACROBIZ คือ Business Transformation Consulting Partner เริ่มงานจากการเข้าใจปัญหาธุรกิจก่อน แล้วเชื่อม Brand, Communication, Digital และ Process ให้ตรงโจทย์",
} as const;

export const purposeHero = {
  eyebrow: "ABOUT US",
  title: "Our Story",
  tagline: "Business changes. The way we solve it should change too.",
  image: {
    src: "/images/purpose/team-collaboration.webp",
    alt: "ทีมงานนั่งทำงานร่วมกันรอบโต๊ะพร้อมแล็ปท็อปและโน้ต สะท้อนการทำงานแบบให้คำปรึกษาและเข้าใจปัญหาร่วมกัน",
    width: 2000,
    height: 1333,
  },
};

export const story = {
  eyebrow: "OUR STORY",
  paragraphs: [
    "ECOMACROBIZ เกิดขึ้นจากการมองเห็นว่าปัญหาทางธุรกิจในปัจจุบันมักไม่ได้เกิดจากเรื่องใดเรื่องหนึ่งเพียงลำพัง ธุรกิจอาจมีสินค้าที่ดี แต่ยังขาดความชัดเจนว่าแตกต่างจากตลาดอย่างไร บางองค์กรมีแบรนด์และภาพลักษณ์ที่ดี แต่สิ่งที่ลูกค้ารับรู้ สิ่งที่ทีมสื่อสาร และทิศทางของธุรกิจอาจยังไม่สอดคล้องกัน บางองค์กรมีข้อมูล เครื่องมือ และเทคโนโลยีจำนวนมาก แต่แต่ละส่วนยังทำงานแยกจากกัน",
    "และในหลายกรณี ปัญหาที่ดูเหมือนเป็นเรื่อง Marketing, Branding, Design หรือ Technology อาจมีสาเหตุจาก Business Direction, Process, Information หรือวิธีการทำงานที่อยู่เบื้องหลัง",
  ],
  /** Scroll-scrubbed manifesto line */
  manifesto:
    "เราเริ่มต้นการทำงานจากการทำความเข้าใจปัญหาและบริบทของธุรกิจ ก่อนพิจารณาว่าองค์ความรู้ ความสามารถ หรือเครื่องมือใดควรถูกนำมาใช้",
  connect:
    "จากแนวคิดนี้ เราพัฒนาวิธีทำงานที่สามารถเชื่อม Business, Brand, Communication, Creative, Digital Systems, Technology, Data, AI และ Knowledge เข้าด้วยกันตามความเหมาะสมของแต่ละโจทย์",
  disciplines: [
    "Business",
    "Brand",
    "Communication",
    "Creative",
    "Digital Systems",
    "Technology",
    "Data",
    "AI",
    "Knowledge",
  ],
  closing:
    "ไม่ใช่เพราะทุกโครงการต้องใช้ทุกอย่าง แต่เพราะปัญหาที่แตกต่างกันต้องการองค์ประกอบและวิธีแก้ที่แตกต่างกัน",
};

export const whoWeAre = {
  eyebrow: "WHO WE ARE",
  title: "Business Transformation Consulting Partner",
  paragraphs: [
    "บทบาทของเราคือ Business Transformation Consulting Partner ที่ทำงานร่วมกับธุรกิจและองค์กรในการทำความเข้าใจปัญหา กำหนดทิศทาง และพัฒนา Solution ที่สามารถนำไปใช้งานได้จริง",
    "เราไม่ได้กำหนด Solution จากความสามารถด้านใดด้านหนึ่งเพียงอย่างเดียว โจทย์ด้าน Business Development อาจเกี่ยวข้องกับ Positioning โจทย์ด้าน Branding อาจเชื่อมต่อไปถึง Communication โจทย์ด้าน Website อาจมีสาเหตุมาจาก Information Architecture, Customer Journey หรือโครงสร้างข้อมูลขององค์กร ขณะที่ปัญหาด้าน Workflow อาจต้องพิจารณา Process, Data, Automation หรือ Technology ร่วมกัน",
  ],
  closing:
    "บทบาทของเราจึงเริ่มจากการทำความเข้าใจโจทย์ ก่อนเลือกและเชื่อมความสามารถที่เหมาะสมเข้าด้วยกัน",
};

export const beliefs = {
  eyebrow: "WHAT WE BELIEVE",
  title: "Better solutions begin with better understanding.",
  intro:
    "เราเชื่อว่า Solution ที่เหมาะสมควรเริ่มจากความเข้าใจในปัญหา ไม่ใช่เริ่มจากเครื่องมือหรือบริการที่ต้องการนำเสนอ",
  statements: [
    "ธุรกิจไม่จำเป็นต้อง Rebrand เพียงเพราะ Brand Identity มีอายุหลายปี",
    "องค์กรไม่จำเป็นต้องใช้ AI เพียงเพราะ AI กำลังได้รับความสนใจ",
    "Website ใหม่อาจไม่สามารถแก้ปัญหาการสื่อสารได้ หาก Value Proposition และข้อมูลของธุรกิจยังไม่ชัดเจน",
    "และการเพิ่ม Process อาจไม่ได้เพิ่มประสิทธิภาพ หาก Process นั้นไม่ได้ช่วยให้การทำงานดีขึ้น",
  ],
  /** Shown as small tags after the statements */
  factors: ["Context", "Objective", "Constraint", "Existing Capability", "Opportunity"],
  closing: [
    "ก่อนพัฒนา Solution เราจึงให้ความสำคัญกับ Context, Objective, Constraint, Existing Capability และ Opportunity ของแต่ละองค์กร",
    "สิ่งเหล่านี้ช่วยให้สามารถพิจารณาได้ว่าอะไรควรทำ อะไรยังไม่จำเป็น และองค์ประกอบใดควรถูกนำมาเชื่อมเข้าด้วยกัน",
  ],
};

export const values = {
  eyebrow: "OUR VALUES",
  title: "What guides every decision",
  items: [
    {
      id: "meaning",
      title: "Meaning",
      paragraphs: [
        "Strategy, Brand, Design, Communication และ Technology ควรมีเหตุผลรองรับว่าแต่ละสิ่งมีหน้าที่อะไร และเกี่ยวข้องกับบริบทของธุรกิจอย่างไร",
        "เราให้ความสำคัญกับเหตุผลเบื้องหลังการตัดสินใจ ไม่ใช่เลือกสิ่งใดเพียงเพราะเป็นกระแสหรือเป็นสิ่งที่องค์กรอื่นกำลังทำ",
      ],
    },
    {
      id: "knowledge",
      title: "Knowledge",
      paragraphs: [
        "เราให้ความสำคัญกับการศึกษา การค้นคว้า การตรวจสอบ และการประยุกต์องค์ความรู้จากแหล่งที่เหมาะสม รวมถึงการให้เครดิตและเคารพต้นทางของความรู้",
        "ข้อเท็จจริง หลักฐาน การตีความ และความคิดเห็นควรถูกแยกออกจากกันอย่างเหมาะสม",
      ],
    },
    {
      id: "sustainability",
      title: "Sustainability",
      paragraphs: [
        "เรามองความยั่งยืนในหลายมิติ ทั้ง Business, People, Knowledge, Resources และ Environment",
        "ในปัจจุบัน Sustainability เป็นหลักคิดและพื้นที่ของการศึกษาและพัฒนาในระยะยาว ไม่ใช่ข้อกล่าวอ้างว่าองค์กรได้สร้างผลลัพธ์ด้านความยั่งยืนแล้ว",
      ],
    },
  ] satisfies PurposeValue[],
};

export const vision = {
  eyebrow: "VISION",
  title: "Connecting knowledge, business and technology for meaningful progress.",
  paragraphs: [
    "เรามุ่งมั่นพัฒนาองค์กรที่สามารถเชื่อมองค์ความรู้จากหลายสาขาเข้ากับปัญหาและบริบทของธุรกิจ",
    "Business, Brand, Communication, Design, Knowledge, Data และ Technology สามารถมีบทบาทแตกต่างกันในแต่ละโครงการได้อย่างมีประสิทธิภาพและเหมาะกับลูกค้า",
    "เราพัฒนา Solution, System, Framework และ Knowledge Resources ที่สามารถนำไปใช้ เรียนรู้ และพัฒนาต่อยอดสู่ทิศทางการพัฒนาขององค์กร",
    "พัฒนาตามความสามารถ ทรัพยากร และหลักฐานจากการดำเนินงานที่จับต้องได้ โดยเน้นสร้างผลลัพธ์เชิงคุณภาพ",
  ],
};

export const mission = {
  eyebrow: "OUR MISSION",
  title: "Turning understanding into practical transformation.",
  paragraphs: [
    "ภารกิจของเรา คือการเปลี่ยนความเข้าใจในปัญหาและบริบทของธุรกิจของลูกค้าให้กลายเป็น Direction, Solution, System หรือ Asset ที่สามารถนำไปใช้งานได้จริง",
    "ทำความเข้าใจบริบทและข้อมูลที่เกี่ยวข้อง วิเคราะห์ปัญหา แยกแยะ กำหนดทิศทาง และพัฒนาสิ่งที่เหมาะสมกับโจทย์ เมื่อ Solution ถูกนำไปใช้ ผลลัพธ์และข้อมูลที่เกิดขึ้นสามารถนำกลับมาใช้ในการเรียนรู้ ตรวจสอบ และนำไปพัฒนาต่อเนื่อง",
  ],
};

export const howWeThink = {
  eyebrow: "HOW WE THINK",
  title: "One problem, many lenses",
  intro: "ปัญหาทางธุรกิจหนึ่งเรื่องสามารถมองได้จากหลายมิติ",
  lenses: [
    { title: "Branding", description: "ช่วยพิจารณาเรื่อง Positioning, Identity และการรับรู้" },
    { title: "Communication", description: "เกี่ยวข้องกับการถ่ายทอดข้อมูลและคุณค่า" },
    {
      title: "Design",
      description: "ช่วยจัดโครงสร้างและทำให้สิ่งต่าง ๆ สามารถถูกมองเห็น เข้าใจ และใช้งานได้",
    },
    { title: "Data", description: "ช่วยให้เห็นข้อมูลและรูปแบบที่เกิดขึ้น" },
    {
      title: "Technology & AI",
      description: "สามารถช่วยเชื่อมข้อมูล ลดขั้นตอน หรือเพิ่มความสามารถของระบบเมื่อมีความเหมาะสม",
    },
  ] satisfies Lens[],
  closing:
    "เราจึงไม่ได้กำหนดว่าทุก Project ต้องใช้ศาสตร์หรือ Technology ชุดเดียวกัน แต่พิจารณาว่ามุมมองและความสามารถใดมีความเกี่ยวข้องกับปัญหาที่กำลังแก้",
};

export const purposeHowWeWork = {
  eyebrow: "HOW WE WORK",
  title: "Understanding the problem before defining the solution.",
  paragraphs: [
    "เริ่มต้นการทำงานจากการทำความเข้าใจบริบทของธุรกิจ ปัญหา วัตถุประสงค์ ข้อจำกัด และสิ่งที่องค์กรมีอยู่แล้ว ก่อนกำหนด Solution และขอบเขตของโครงการ",
    "เมื่อโครงการต้องการความเชี่ยวชาญเพิ่มเติม สามารถเชื่อม Specialist หรือ Project-based Partner เข้ามาตามขอบเขตที่เหมาะสม ในงานที่มีการส่งมอบระบบ เครื่องมือ หรือองค์ความรู้ การส่งมอบควรช่วยให้ทีมของลูกค้าสามารถนำสิ่งที่พัฒนาไปใช้งาน ดูแล หรือพัฒนาต่อได้ตามขอบเขตที่ตกลงกัน",
  ],
  phases: ["Discovery", "Diagnosis", "Definition", "Development", "Activation", "Review & Improvement"],
  cta: { label: "ดูขั้นตอนการทำงาน", href: "/how-we-work" },
};

/** Wix buttons: "Start Your Project" -> contact, "See Solutions" -> solutions. */
export const purposeCta = {
  eyebrow: "START YOUR PROJECT",
  title: ["Start your", "project."],
  body: "เล่าโจทย์และบริบทธุรกิจของคุณให้เราฟัง เราจะเริ่มจากการทำความเข้าใจปัญหา ก่อนเสนอแนวทางที่เหมาะสม",
  secondary: { label: "See Solutions", href: "/solutions" },
};
