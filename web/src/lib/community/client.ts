/**
 * Browser-side fetch for the community API. Always same-origin through the
 * Next proxy (/api/community/*); never talks to API_URL directly. The CSRF
 * token comes from the session store (./session.ts).
 */
import { getCsrf } from "./session";

export const COMMUNITY_API = "/api/community";

export class CommunityError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
    public retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "CommunityError";
  }
}

const FALLBACK: Record<number, string> = {
  401: "กรุณาเข้าสู่ระบบ",
  403: "ไม่สามารถทำรายการนี้ได้",
  404: "ไม่พบข้อมูล",
  409: "ข้อมูลซ้ำกับที่มีอยู่แล้ว",
  413: "ไฟล์มีขนาดใหญ่เกินกำหนด",
  422: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบ",
  429: "ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่",
};

export async function toCommunityError(res: Response): Promise<CommunityError> {
  let code = "internal";
  let message = FALLBACK[res.status] ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
  let fields: Record<string, string> = {};
  try {
    const json = (await res.json()) as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
    if (json.error) {
      code = json.error.code ?? code;
      message = json.error.message || message;
      fields = json.error.fields ?? {};
    }
  } catch {
    /* non-JSON body */
  }
  const ra = Number(res.headers.get("retry-after"));
  return new CommunityError(res.status, code, message, fields, Number.isFinite(ra) && ra > 0 ? ra : null);
}

export type CommunityRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  keepalive?: boolean;
};

export function communityUrl(path: string, query?: CommunityRequest["query"]): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${COMMUNITY_API}/${path.replace(/^\/+/, "")}${s ? `?${s}` : ""}`;
}

export async function communityFetch(path: string, opts: CommunityRequest = {}): Promise<Response> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  const csrf = getCsrf();
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  return fetch(communityUrl(path, opts.query), {
    method,
    headers,
    body,
    credentials: "same-origin",
    cache: "no-store",
    signal: opts.signal,
    keepalive: opts.keepalive,
  });
}

/** JSON request: resolves `data` (or null for 204), throws CommunityError otherwise. */
export async function communityJson<T>(path: string, opts: CommunityRequest = {}): Promise<T> {
  const res = await communityFetch(path, opts);
  if (!res.ok) throw await toCommunityError(res);
  if (res.status === 204) return null as T;
  const json = (await res.json()) as { data: T };
  return json.data;
}

/** Full JSON envelope (lists with meta). */
export async function communityEnvelope<T>(path: string, opts: CommunityRequest = {}): Promise<T> {
  const res = await communityFetch(path, opts);
  if (!res.ok) throw await toCommunityError(res);
  return (await res.json()) as T;
}
