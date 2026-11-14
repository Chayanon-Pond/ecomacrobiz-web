/**
 * Browser-side fetch for the admin area. Always same-origin through the
 * Next proxy (/api/admin/*); never talks to API_URL directly.
 */

export const ADMIN_API = "/api/admin";

/** domain.MsgNoPermission: a 403 for a missing permission (other 403s are CSRF/origin). */
export const MSG_NO_PERMISSION = "บัญชีของคุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาติดต่อผู้ดูแลระบบ (Owner)";

export class ApiError extends Error {
  /** Set when the session layer already showed a toast for this error. */
  notified = false;

  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
    public retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const FALLBACK_MESSAGES: Record<number, string> = {
  401: "กรุณาเข้าสู่ระบบอีกครั้ง",
  403: "ไม่มีสิทธิ์ทำรายการนี้",
  404: "ไม่พบข้อมูล",
  413: "ไฟล์มีขนาดใหญ่เกินกำหนด (สูงสุด 8 MB)",
  422: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบ",
  429: "ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่",
};

export async function toApiError(res: Response): Promise<ApiError> {
  let code = "internal";
  let message = FALLBACK_MESSAGES[res.status] ?? "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ กรุณาลองใหม่";
  let fields: Record<string, string> = {};
  try {
    const json = (await res.json()) as {
      error?: { code?: string; message?: string; fields?: Record<string, string> };
    };
    if (json.error) {
      code = json.error.code ?? code;
      message = json.error.message || message;
      fields = json.error.fields ?? {};
    }
  } catch {
    /* non-JSON error body */
  }
  const ra = Number(res.headers.get("retry-after"));
  return new ApiError(res.status, code, message, fields, Number.isFinite(ra) && ra > 0 ? ra : null);
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
};

export function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${ADMIN_API}/${path.replace(/^\/+/, "")}${s ? `?${s}` : ""}`;
}

/** Low-level request; returns the raw Response (caller handles status). */
export function rawRequest(path: string, opts: RequestOptions, csrf: string | null): Promise<Response> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  return fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body,
    credentials: "same-origin",
    cache: "no-store",
    signal: opts.signal,
  });
}

/** Saves a Response body (e.g. CSV) as a file download. */
export async function downloadResponse(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  const name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
