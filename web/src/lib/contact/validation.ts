/**
 * Contact form validation shared by the browser form and the
 * /api/contact route handler. Rules and Thai messages mirror the Go API
 * contract (CONTRACTS.md, POST /api/v1/contact) — keep them in sync.
 * No server-only imports: this module ships to the client.
 */

export const CONTACT_CHANNELS = ["email", "line", "phone"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_LIMITS = {
  first_name: 100,
  last_name: 100,
  company: 200,
  line_id: 100,
  message: 2000,
  source_page: 200,
  email: 254,
} as const;

/** Raw form values (everything a string except the checkbox). */
export type ContactFormValues = {
  first_name: string;
  last_name: string;
  company: string;
  line_id: string;
  phone: string;
  email: string;
  preferred_channel: string;
  preferred_date: string;
  preferred_time: string;
  message: string;
  consent: boolean;
  /** honeypot — real users never see or fill it */
  website: string;
  source_page: string;
};

export type ContactField = keyof ContactFormValues;

/** Normalised payload sent to the API. */
export type ContactPayload = {
  first_name: string;
  last_name: string;
  company: string;
  line_id: string;
  phone: string;
  email: string;
  preferred_channel: ContactChannel;
  preferred_date: string;
  preferred_time: string;
  message: string;
  consent: true;
  website: string;
  source_page: string;
};

export type ContactErrors = Partial<Record<ContactField, string>>;

export const EMPTY_CONTACT: ContactFormValues = {
  first_name: "",
  last_name: "",
  company: "",
  line_id: "",
  phone: "",
  email: "",
  preferred_channel: "",
  preferred_date: "",
  preferred_time: "",
  message: "",
  consent: false,
  website: "",
  source_page: "",
};

export const MESSAGES = {
  firstNameRequired: "กรุณากรอกชื่อ",
  phoneRequired: "กรุณากรอกเบอร์โทรศัพท์",
  phoneInvalid: "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง",
  emailRequired: "กรุณากรอกอีเมล",
  emailInvalid: "รูปแบบอีเมลไม่ถูกต้อง",
  channelRequired: "กรุณาเลือกช่องทางที่สะดวกให้ติดต่อ",
  dateInvalid: "รูปแบบวันที่ไม่ถูกต้อง",
  datePast: "กรุณาเลือกวันที่ตั้งแต่วันนี้เป็นต้นไป",
  timeInvalid: "รูปแบบเวลาไม่ถูกต้อง",
  consentRequired: "กรุณายินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล",
  tooLong: (label: string, max: number) => `${label}ต้องไม่เกิน ${max.toLocaleString("en-US")} ตัวอักษร`,
} as const;

/**
 * Thai phone normalisation: drops spaces, dashes, dots and brackets and fixes
 * "+66 0…" -> "+66…". Returns the cleaned number or null when the result is
 * not 0 + 8–9 digits (9–10 digits total) or +66 + 8–9 digits.
 */
export function normalizeThaiPhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s\-.()]/g, "");
  if (s.startsWith("+660")) s = `+66${s.slice(4)}`;
  if (/^0\d{8,9}$/.test(s)) return s;
  if (/^\+66[1-9]\d{7,8}$/.test(s)) return s;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Today's date in Asia/Bangkok as YYYY-MM-DD. */
export function bangkokToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Validate a single field (used on blur). `today` = bangkokToday(). */
export function validateField(field: ContactField, values: ContactFormValues, today: string): string | undefined {
  const v = values[field];
  const s = typeof v === "string" ? v.trim() : "";
  switch (field) {
    case "first_name":
      if (!s) return MESSAGES.firstNameRequired;
      if (s.length > CONTACT_LIMITS.first_name) return MESSAGES.tooLong("ชื่อ", CONTACT_LIMITS.first_name);
      return;
    case "last_name":
      if (s.length > CONTACT_LIMITS.last_name) return MESSAGES.tooLong("นามสกุล", CONTACT_LIMITS.last_name);
      return;
    case "company":
      if (s.length > CONTACT_LIMITS.company) return MESSAGES.tooLong("ชื่อบริษัท", CONTACT_LIMITS.company);
      return;
    case "line_id":
      if (s.length > CONTACT_LIMITS.line_id) return MESSAGES.tooLong("ID Line ", CONTACT_LIMITS.line_id);
      return;
    case "phone":
      if (!s) return MESSAGES.phoneRequired;
      if (!normalizeThaiPhone(s)) return MESSAGES.phoneInvalid;
      return;
    case "email":
      if (!s) return MESSAGES.emailRequired;
      if (s.length > CONTACT_LIMITS.email || !EMAIL_RE.test(s)) return MESSAGES.emailInvalid;
      return;
    case "preferred_channel":
      if (!(CONTACT_CHANNELS as readonly string[]).includes(s)) return MESSAGES.channelRequired;
      return;
    case "preferred_date":
      if (!s) return;
      if (!isRealDate(s)) return MESSAGES.dateInvalid;
      if (s < today) return MESSAGES.datePast;
      return;
    case "preferred_time":
      if (!s) return;
      if (!TIME_RE.test(s)) return MESSAGES.timeInvalid;
      return;
    case "message":
      if (s.length > CONTACT_LIMITS.message) return MESSAGES.tooLong("รายละเอียดเพิ่มเติม", CONTACT_LIMITS.message);
      return;
    case "consent":
      if (values.consent !== true) return MESSAGES.consentRequired;
      return;
    case "source_page":
    case "website":
      return; // honeypot is judged by the API (fake success), never shown as an error
  }
}

/** Fields in on-screen order (error summary + focus-first-invalid). */
export const CONTACT_FIELD_ORDER: ContactField[] = [
  "first_name",
  "last_name",
  "company",
  "line_id",
  "phone",
  "email",
  "preferred_channel",
  "preferred_date",
  "preferred_time",
  "message",
  "consent",
];

/** Coerce unknown JSON into form values (missing/wrong types -> empty). */
export function toContactValues(input: unknown): ContactFormValues {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    first_name: str(o.first_name),
    last_name: str(o.last_name),
    company: str(o.company),
    line_id: str(o.line_id),
    phone: str(o.phone),
    email: str(o.email),
    preferred_channel: str(o.preferred_channel),
    preferred_date: str(o.preferred_date),
    preferred_time: str(o.preferred_time),
    message: typeof o.message === "string" ? o.message.trim() : "",
    consent: o.consent === true,
    website: typeof o.website === "string" ? o.website : "",
    source_page: str(o.source_page).slice(0, CONTACT_LIMITS.source_page),
  };
}

export type ContactValidation =
  | { ok: true; data: ContactPayload }
  | { ok: false; errors: ContactErrors };

export function validateContact(input: unknown, today: string = bangkokToday()): ContactValidation {
  const values = toContactValues(input);
  const errors: ContactErrors = {};
  for (const f of CONTACT_FIELD_ORDER) {
    const e = validateField(f, values, today);
    if (e) errors[f] = e;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      ...values,
      phone: normalizeThaiPhone(values.phone) as string,
      preferred_channel: values.preferred_channel as ContactChannel,
      consent: true,
    },
  };
}
