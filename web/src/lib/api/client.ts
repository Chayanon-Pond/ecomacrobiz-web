/**
 * Server-side client for the Go API (CONTRACTS.md, base path /api/v1).
 * API_URL is a server env var and must never reach the browser.
 */
import "server-only";

export const API_TIMEOUT_MS = 4000;

/** Error envelope: { error: { code, message, fields? } } */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

/** The API answered with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly retryAfter: string | null;

  constructor(status: number, body: Partial<ApiErrorBody> | null, retryAfter: string | null) {
    super(body?.error?.message ?? `API responded ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error?.code ?? "internal";
    this.fields = body?.error?.fields;
    this.retryAfter = retryAfter;
  }
}

/** API_URL unset, network failure, timeout or an unparseable response. */
export class ApiUnavailableError extends Error {
  readonly reason: "unconfigured" | "network" | "timeout" | "bad_response";

  constructor(reason: ApiUnavailableError["reason"], cause?: unknown) {
    super(`API unavailable (${reason})`, { cause });
    this.name = "ApiUnavailableError";
    this.reason = reason;
  }
}

export function apiBaseUrl(): string | null {
  const url = process.env.API_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export type ApiResponse<T> = { status: number; data: T; headers: Headers };

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  query?: Record<string, string | number | undefined>;
};

/**
 * Low-level request. Resolves for ANY HTTP status (callers that proxy
 * responses need 4xx bodies); rejects only with ApiUnavailableError.
 */
export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<ApiResponse<T | null>> {
  const base = apiBaseUrl();
  if (!base) throw new ApiUnavailableError("unconfigured");

  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? API_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ApiUnavailableError(timedOut ? "timeout" : "network", err);
  }

  let data: T | null = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch (err) {
      // Proxies (Cloudflare/Railway) answer 502/503 with HTML.
      throw new ApiUnavailableError("bad_response", err);
    }
  }
  return { status: res.status, data, headers: res.headers };
}

/** GET that returns the parsed body on 2xx and throws ApiError otherwise. */
export async function apiGet<T>(path: string, opts: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
  const res = await apiRequest<T>(path, { ...opts, method: "GET" });
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(res.status, res.data as Partial<ApiErrorBody> | null, res.headers.get("retry-after"));
  }
  if (res.data === null) throw new ApiUnavailableError("bad_response");
  return res.data as T;
}
