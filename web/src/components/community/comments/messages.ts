/** Thai UI messages for community errors (pure, unit-tested). */
import { CommunityError } from "@/lib/community/client";

/** Inline message after the Google round-trip (`#community=error-<code>`). */
export function oauthMessage(outcome: string): string | null {
  if (!outcome.startsWith("error-")) return null;
  switch (outcome.slice("error-".length)) {
    case "denied":
      return "ยกเลิกการเข้าสู่ระบบด้วย Google แล้ว คุณยังอ่านความคิดเห็นได้ตามปกติ";
    case "consent":
      return "กรุณายอมรับเงื่อนไขการใช้งานชุมชนก่อนสมัครด้วย Google แล้วลองอีกครั้ง";
    case "banned":
      return "บัญชีนี้ถูกระงับการแสดงความคิดเห็น";
    case "unverified":
      return "อีเมลของบัญชี Google นี้ยังไม่ได้รับการยืนยัน กรุณาใช้บัญชีอื่นหรือสมัครด้วยอีเมล";
    case "conflict":
      return "บัญชี Google นี้เชื่อมต่อกับสมาชิกคนอื่นอยู่แล้ว";
    case "state":
      return "หมดเวลาการเข้าสู่ระบบ กรุณาลองใหม่อีกครั้ง";
    default:
      return "เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }
}

/** Message for a failed comment create/edit (field message first). */
export function commentErrorMessage(err: unknown): string {
  if (err instanceof CommunityError) {
    if (err.status === 429) {
      return err.retryAfter
        ? `ส่งความคิดเห็นถี่เกินไป กรุณารอ ${err.retryAfter} วินาทีแล้วลองใหม่`
        : "ส่งความคิดเห็นถี่เกินไป กรุณารอสักครู่แล้วลองใหม่";
    }
    if (err.status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง";
    if (err.code === "email_unverified") return "กรุณายืนยันอีเมลก่อนแสดงความคิดเห็น (ดูได้ที่หน้าบัญชีของฉัน)";
    if (err.code === "member_banned") return "บัญชีของคุณถูกระงับการแสดงความคิดเห็น";
    if (err.code === "duplicate_comment") return err.message || "คุณเพิ่งส่งข้อความนี้ไปแล้ว";
    const field = err.fields.body ?? err.fields.image_id ?? err.fields.parent_id ?? err.fields.reply_to_id;
    return field || err.message;
  }
  return "ส่งไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่";
}

/** Generic message for likes / reports / moderation / delete. */
export function actionErrorMessage(err: unknown): string {
  if (err instanceof CommunityError) {
    if (err.status === 429) {
      return err.retryAfter
        ? `ทำรายการถี่เกินไป กรุณารอ ${err.retryAfter} วินาทีแล้วลองใหม่`
        : "ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่";
    }
    if (err.status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง";
    return err.message;
  }
  return "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}

export const REPORT_REASONS = [
  { value: "spam", label: "สแปมหรือโฆษณา" },
  { value: "harassment", label: "คุกคามหรือกลั่นแกล้ง" },
  { value: "inappropriate", label: "เนื้อหาไม่เหมาะสม" },
  { value: "other", label: "อื่น ๆ" },
] as const;
