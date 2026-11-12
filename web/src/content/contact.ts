/**
 * /contact copy (Wix /blank-5).
 * From Wix: page title "Contact Us", SEO title/description, the form fields and
 * channel options (Email / Line / Tel), the phone + LINE links, and the FAQ
 * widget (same Wix FAQ app and 4 categories as /how-we-work — reused from
 * src/content/how-we-work.ts, not duplicated here).
 * New copy (no Wix source): hero intro, channel descriptions, "what happens
 * next", the optional message field, PDPA consent + privacy notice, form
 * states. The Wix page has no address, map or email.
 */
import type { ContactChannel } from "@/lib/contact/validation";

export const contactPage = {
  path: "/contact",
  title: "Contact Us",
  titleTh: "ติดต่อเรา",
  seoTitle: "ติดต่อ ECOMACROBIZ — นัดปรึกษาธุรกิจ ออนไลน์หรือพบที่ออฟฟิศ",
  seoDescription:
    "ติดต่อ ECOMACROBIZ เพื่อนัดปรึกษาก่อนเริ่มโครงการ ทั้งแบบออนไลน์และนัดพบ พร้อมคำถามที่พบบ่อยเรื่อง Brand Strategy, SEO, Digital Development และ ISO 9001",
  eyebrow: "CONTACT US",
  lead: "นัดปรึกษาธุรกิจ ออนไลน์หรือพบที่ออฟฟิศ",
  intro:
    "เล่าโจทย์ธุรกิจของคุณให้เราฟัง ทีม ECOMACROBIZ จะติดต่อกลับเพื่อนัดปรึกษาก่อนเริ่มโครงการ ตามช่องทางและเวลาที่คุณสะดวก",
} as const;

export const contactChannelsCopy = {
  heading: "ช่องทางติดต่อ",
  phone: { label: "โทรศัพท์", note: "คุยกับทีมงานโดยตรง" },
  line: { label: "LINE Official", note: "แชตสอบถามหรือส่งรายละเอียดเบื้องต้น" },
  socialsHeading: "ติดตามเรา",
} as const;

export const contactSteps = {
  heading: "หลังจากส่งข้อมูล",
  steps: [
    "ทีมงานตรวจสอบรายละเอียดและโจทย์ที่คุณแจ้งไว้",
    "ติดต่อกลับตามช่องทางและช่วงเวลาที่คุณสะดวก เพื่อนัดหมายปรึกษา",
    "พูดคุยทำความเข้าใจธุรกิจ ทั้งแบบออนไลน์หรือนัดพบที่ออฟฟิศ ก่อนเสนอแนวทางและขอบเขตงาน",
  ],
} as const;

export const contactForm = {
  heading: "ส่งข้อมูลให้เราติดต่อกลับ",
  requiredNote: "ช่องที่มีเครื่องหมาย * จำเป็นต้องกรอก",
  labels: {
    first_name: "ชื่อ",
    last_name: "นามสกุล",
    company: "ชื่อบริษัท (กรณีเป็นองค์กร)",
    line_id: "ID Line",
    phone: "โทรศัพท์",
    email: "อีเมล",
    preferred_channel: "ช่องทางที่สะดวกให้ติดต่อ",
    preferred_date: "วันที่สะดวกให้ติดต่อกลับ",
    preferred_time: "ช่วงเวลาที่สะดวก",
    message: "รายละเอียดเพิ่มเติม",
  },
  hints: {
    phone: "เช่น 081-234-5678",
    message: "เล่าโจทย์ เป้าหมาย หรือบริการที่สนใจโดยย่อ (ไม่บังคับ)",
  },
  channels: [
    { value: "email", label: "อีเมล" },
    { value: "line", label: "LINE" },
    { value: "phone", label: "โทรศัพท์" },
  ] satisfies { value: ContactChannel; label: string }[],
  consent: {
    before: "ข้าพเจ้ายินยอมให้ ECOMACROBIZ เก็บรวบรวมและใช้ข้อมูลส่วนบุคคลข้างต้น เพื่อติดต่อกลับและให้คำปรึกษาตามที่ร้องขอ ตาม",
    link: "นโยบายความเป็นส่วนตัว",
    after: "",
  },
  privacyNote:
    "เราใช้ข้อมูลนี้เพื่อติดต่อกลับเรื่องที่คุณสอบถามเท่านั้น ไม่ขายหรือส่งต่อให้บุคคลอื่นเพื่อการตลาด และคุณถอนความยินยอมได้ทุกเมื่อ",
  submit: "ส่งข้อมูล",
  submitting: "กำลังส่ง…",
  errorSummary: "กรุณาตรวจสอบข้อมูล",
  success: {
    heading: "ขอบคุณที่ติดต่อ ECOMACROBIZ",
    body: "เราได้รับข้อมูลของคุณแล้ว ทีมงานจะติดต่อกลับตามช่องทางและเวลาที่คุณสะดวก",
    again: "ส่งข้อมูลอีกครั้ง",
  },
  failure: {
    heading: "ส่งข้อมูลไม่สำเร็จ",
    retry: "ลองส่งอีกครั้ง",
    fallback: "หรือติดต่อเราโดยตรงได้ที่",
    network: "ไม่สามารถเชื่อมต่อได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง",
  },
  rateLimited: (wait: string) =>
    `คุณส่งข้อมูลบ่อยเกินไป กรุณารอ${wait}แล้วลองใหม่อีกครั้ง หรือติดต่อเราทางโทรศัพท์หรือ LINE`,
} as const;

export const contactFaqCopy = {
  eyebrow: "FAQ",
  heading: "คำถามที่พบบ่อย",
  more: "ดูขั้นตอนการทำงานและคำถามทั้งหมด",
  moreHref: "/how-we-work",
} as const;
