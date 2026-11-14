/**
 * Client-side normalization/validation of redirect paths, mirroring
 * CONTRACT-SEO: from = site path ('/'-prefixed, no query/fragment, no
 * trailing slash except '/', percent-DECODED + NFC, no '//'); to = site path
 * or absolute https URL. The API re-validates (and checks chains/loops).
 */

const CORE_PAGES = ["/", "/purpose", "/solutions", "/gallery", "/how-we-work", "/contact", "/privacy", "/knowledge"];
const SITE_HOSTS = ["ecomacrobiz.com", "www.ecomacrobiz.com"];

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Pasted full URL of our own site -> path; trims, decodes, NFC, drops trailing slash. */
export function normalizeSitePath(raw: string): string {
  let v = raw.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      if (SITE_HOSTS.includes(u.hostname) || u.hostname === "localhost") v = u.pathname + u.search + u.hash;
      else return v;
    } catch {
      return v;
    }
  }
  if (!v.startsWith("/")) v = `/${v}`;
  v = safeDecode(v).normalize("NFC");
  if (v.length > 1) v = v.replace(/\/+$/, "");
  return v || "/";
}

export function fromPathError(path: string): string | null {
  if (!path) return "กรุณากรอก URL ต้นทาง";
  if (!path.startsWith("/")) return "ต้องขึ้นต้นด้วย / เช่น /knowledge/old-article";
  if (/[?#]/.test(path)) return "ไม่ต้องใส่ ? หรือ # — ใช้เฉพาะ path";
  if (path.includes("//")) return "ห้ามมี // ติดกัน";
  if (/\s/.test(path)) return "ห้ามมีช่องว่าง";
  if (CORE_PAGES.includes(path)) return "เป็นหน้าหลักของเว็บไซต์ ไม่สามารถตั้ง redirect ทับได้";
  if (path.length > 500) return "URL ยาวเกินไป";
  return null;
}

export function toTargetError(to: string, from: string): string | null {
  if (!to) return "กรุณากรอกปลายทาง";
  if (/^https?:\/\//i.test(to)) {
    let u: URL;
    try {
      u = new URL(to);
    } catch {
      return "รูปแบบ URL ไม่ถูกต้อง";
    }
    if (u.protocol !== "https:") return "URL ภายนอกต้องขึ้นต้นด้วย https://";
    return null;
  }
  if (!to.startsWith("/")) return "ใส่ path ของเว็บไซต์ (ขึ้นต้นด้วย /) หรือ URL เต็มที่ขึ้นต้นด้วย https://";
  if (to.includes("//")) return "ห้ามมี // ติดกัน";
  if (/\s/.test(to)) return "ห้ามมีช่องว่าง";
  if (to === from) return "ปลายทางต้องไม่ใช่ URL เดียวกับต้นทาง";
  return null;
}
