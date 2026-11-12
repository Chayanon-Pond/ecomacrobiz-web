/**
 * GET /api/healthz — liveness probe for Railway (and uptime monitors).
 * Deliberately does NOT call the Go API: the website keeps serving (bundled
 * posts fallback) when the API is down, so the web deploy must not fail or
 * restart because of it. `connection()` makes it render per request, so a
 * 200 proves the Node server is actually answering.
 */
import { connection } from "next/server";

export async function GET() {
  await connection();
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } },
  );
}
