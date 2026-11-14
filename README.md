# ECOMACROBIZ — website monorepo

Migration of www.ecomacrobiz.com from Wix Studio to a custom stack.

| Folder | What | Status |
| --- | --- | --- |
| `web/` | Next.js 16 (App Router, Cache Components) + React 19 + TypeScript + Tailwind CSS v4 | Phase 2 — all public pages, Knowledge (blog), Contact, Privacy (draft), /admin |
| `api/` | Go 1.25 + Gin + Postgres (pgx, goose) — contact leads, posts, media, admin auth | Phase 2 — done (see `api/README.md`) |
| `docker-compose.yml` | Local Postgres 17 (host 55432, `DB_HOST_PORT`) + API (18080) + optional `web` profile (prod image, 3300) | — |
| `docs/DEPLOY.md` | Step-by-step Railway + Cloudflare runbook (Thai summary on top) | Phase 3 |
| `docs/dns-snapshot-2026-11-12.txt` | Public DNS records before the move (Wix DNS, Microsoft 365 mail, DNSSEC ON) | Phase 3 |
| `scripts/dns-snapshot.sh` | Re-takes that snapshot (`bash scripts/dns-snapshot.sh`) | Phase 3 |

Local-only (gitignored): `.claude/` (preview configs `escoma-web` :3000 dev,
`escoma-web-prod` :3001, `escoma-api` :18080), `api/.env`, `web/.env.local`.

## Hosting (Phase 3 — prepared, not deployed yet)

- **Railway**, region Singapore (`asia-southeast1-eqsg3a`): `Postgres` plugin +
  `api` (root `/api`, `api/Dockerfile`, `api/railway.json`: healthcheck `/healthz`,
  watch `/api/**`, volume `/data/media`, `RAILWAY_RUN_UID=0`) + `web` (root `/web`,
  `web/Dockerfile` = Next.js `output: "standalone"`, `web/railway.json`: healthcheck
  `/api/healthz`, watch `/web/**`). web → api over the private network
  (`http://api.railway.internal:8080`); api → web revalidation webhook likewise.
- **Cloudflare** in front (proxied `www`, apex → 301 www, `api` for media). SSL
  mode Full. Domain stays **registered at Wix**; business mail is **Microsoft 365**
  (records listed in the snapshot). **DNSSEC is ON at Wix — disable it before the
  nameserver change** (see DEPLOY.md 5.0).
- Railway Hobby blocks SMTP: lead e-mails go through Resend (`RESEND_API_KEY`) or
  SMTP on Railway Pro.

## Quick start (everything local)

```bash
# 1. Database + API (Docker). Creates/migrates the DB and bootstraps the admin
#    from api/.env (copy api/.env.example -> api/.env and set ADMIN_EMAIL /
#    ADMIN_PASSWORD (>= 12 chars) first).
docker compose up -d --build              # API: http://localhost:18080/healthz

# 2. Import the migrated Wix blog posts (idempotent; re-run any time)
cd api
DATABASE_URL=postgres://escoma:escoma-dev-only@localhost:55432/escoma?sslmode=disable \
  go run ./cmd/server seed-posts --file ../web/src/content/posts/posts.json

# 3. Website
cd ../web
cp .env.example .env.local                # API_URL=http://localhost:18080, REVALIDATE_SECRET=...
npm install
npm run dev                               # http://localhost:3000  (admin: /admin)
```

Production images locally (same Dockerfiles Railway builds):

```bash
REVALIDATE_SECRET=local-secret WEB_REVALIDATE_URL=http://web:3000/api/revalidate   docker compose --profile web up -d --build      # web: http://localhost:3300
docker compose --profile web down                 # never -v (deletes the dev DB volume)
```

Windows note: Hyper-V sometimes reserves the port range containing 55432
(`netsh int ipv4 show excludedportrange protocol=tcp`) — set `DB_HOST_PORT=15432`.

The website also runs **without** the API: leave `API_URL` empty and the
Knowledge pages fall back to the bundled `web/src/content/posts/posts.json`
(the contact form then answers 503 with a Thai message, and /admin shows
"API not configured"). `next build` never fails because the API is down.

Port note: the API listens on 8080 inside the container but is published on
host port **18080** (8080 is commonly taken, e.g. by Jenkins). Override with
`API_HOST_PORT`.

## Checks

```bash
cd web && npm run build && npm run lint && npx tsc --noEmit
cd api && gofmt -l . && go build ./... && go vet ./... && go test ./...
# DB integration tests (use a separate database — they migrate down/up):
docker compose exec -T db psql -U escoma -d escoma -c "CREATE DATABASE escoma_test"
TEST_DATABASE_URL=postgres://escoma:escoma-dev-only@localhost:55432/escoma_test?sslmode=disable go test ./...
```

QA tip: append `?motion=reduced` to any URL to preview the reduced-motion
experience without changing OS settings.

## Environment variables

### web (`web/.env.example`)
| Var | Purpose |
| --- | --- |
| `API_URL` | Go API base URL, server-only (e.g. `http://localhost:18080`, on Railway the private URL). Empty = bundled-content fallback. |
| `REVALIDATE_SECRET` | Shared secret for `POST /api/revalidate` (must equal the API's `REVALIDATE_SECRET`). |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin, no trailing slash (metadataBase, canonical, JSON-LD, sitemap). |
| `NEXT_PUBLIC_MEDIA_ORIGIN` | Public origin of API media (build time) -> `images.remotePatterns` for `/media/**`. Empty locally (Next 16 refuses to optimize private-IP images). Must equal the API's `PUBLIC_BASE_URL`. |
| `CLIENT_IP_HEADER` | Optional header with the real visitor IP: `x-real-ip` on Railway without Cloudflare, `cf-connecting-ip` behind Cloudflare. Default = right-most X-Forwarded-For. |
| `PORT` / `HOSTNAME` | Standalone server listen address (image defaults `3000` / `::`). |

`NEXT_PUBLIC_*` are build-time (Dockerfile `ARG`s). `NEXT_PUBLIC_SITE_URL=https://www.<domain>`
also enables the apex → www 301 and the HSTS header. Health: `GET /api/healthz`.

### api (`api/.env.example`, full table in `api/README.md`)
`PORT`, `DATABASE_URL`, `APP_ENV`, `LOG_LEVEL`, `MIGRATE_ON_START`, `CORS_ALLOWED_ORIGINS`,
`TRUSTED_PROXIES`, `HSTS_ENABLED`, `COOKIE_SECURE`, `COOKIE_DOMAIN`, `SESSION_TTL`, `PUBLIC_BASE_URL`,
`MEDIA_DIR`, `MAX_UPLOAD_MB`, `CONTACT_RATE_LIMIT`, `LOGIN_RATE_LIMIT`, `SMTP_HOST/PORT/USERNAME/PASSWORD/FROM/TO`, `RESEND_API_KEY` (HTTPS e-mail, preferred when set),
`LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TO` (LINE Messaging API push — LINE Notify is discontinued),
`WEB_REVALIDATE_URL`, `REVALIDATE_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_RESET_PASSWORD`.
Notifiers with unset env are disabled and only log.

## Architecture

```
Browser ──> Next.js (web)
             ├─ public pages (static/PPR, 'use cache' + cacheTag('posts'|'post:<slug>'))
             │     └─ src/lib/posts.ts ──> Go API GET /api/v1/posts...  (fallback: posts.json)
             ├─ POST /api/contact        ──> POST /api/v1/contact (validated twice, single client IP forwarded)
             ├─ /api/admin/[...path]     ──> /api/v1/admin/*  (same-origin proxy: escoma_admin cookie + X-CSRF-Token,
             │                                 revalidateTag after post mutations)
             └─ POST /api/revalidate  <── Go API webhook after post create/update/delete
Go API ──> Postgres (posts, categories, post_categories, media, leads, admin_users, sessions)
       ──> MediaStore (local disk volume, /media/<uuid>.<ext>; S3/R2-ready interface)
       ──> Notifiers (SMTP email, LINE Messaging API push) — async, optional
```

## Web app layout

```
web/src/
  app/
    layout.tsx                 html/body/fonts, Organization JSON-LD (no chrome)
    (site)/layout.tsx          public chrome: SiteHeader, SiteFooter, MotionRuntime, CustomCursor
    (site)/page.tsx            homepage
    (site)/purpose|solutions|gallery|how-we-work|contact|privacy/page.tsx
    (site)/knowledge/          index, [slug] (article), category/[category], feed.xml (RSS)
    admin/                     login, dashboard, posts (list/new/[id]), leads (list/[id]) — noindex
    api/contact, api/revalidate, api/admin/[...path]   route handlers
    sitemap.ts, robots.ts, not-found.tsx
  components/
    layout/ sections/ motion/ ui/        Phase 1 (homepage + motion system)
    pages/{purpose,solutions,gallery,how-we-work,shared}/   page sections (+ page CSS, prefixed)
    knowledge/ contact/ admin/          feature components
    content/Markdown.tsx + prose.css     shared Markdown renderer (article + admin preview)
  content/   typed copy: site, home, purpose, solutions, gallery, how-we-work, knowledge, contact, privacy,
             posts/posts.json (migrated Wix blog bundle) + posts/index.ts
  lib/       api/client.ts, posts.ts (cached data layer), contact/validation.ts (shared rules),
             admin/*, seo/jsonld.tsx, media.ts, client-ip.ts, animations/*, text.ts
public/images/{gallery,purpose,solutions,knowledge/<slug>}/   WebP re-encoded from Wix originals
```

## Legacy URL redirects (301, `web/next.config.ts`)

| Old Wix URL | New route |
| --- | --- |
| `/blank` | `/purpose` |
| `/blank-4` | `/solutions` |
| `/blank-2` | `/gallery` |
| `/blank-3` | `/how-we-work` |
| `/blank-5` | `/contact` |
| `/blog` | `/knowledge` |
| `/blog-feed.xml` | `/knowledge/feed.xml` |
| `/blog/categories/:category` | `/knowledge/category/:category` |
| `/blog/page/:n` | `/knowledge?page=:n` |
| `/post/<each of the 9 Wix slugs, Thai ones percent-encoded>` | `/knowledge/<new ASCII slug>` (generated from `posts.json` `legacySlugs`) |
| `/post/:slug` (any other) | `/knowledge/:slug` |
| `/blog/:path*` (tags, hashtags, …) | `/knowledge` |

## Admin (v2)

`/admin` — noindex, disallowed in robots, excluded from the sitemap. Thai-first, dark by default (light toggle),
responsive (bottom-safe drawer sidebar on phones), Cmd/Ctrl+K command palette.

**Access control.** `web/src/proxy.ts` redirects `/admin/*` (except `/admin/login`, `/admin/invite`) to
`/admin/login?next=…` when the `escoma_admin` cookie is missing (optimistic only). The console layout
(`app/admin/(console)/layout.tsx`) verifies the session server-side with `GET /auth/me` before any console UI
renders. The **Go API is the real gate**: every admin route carries a permission (`middleware.RequirePerm`), proven by
`api/internal/http/handlers/rbac_matrix_test.go`. UI hiding is cosmetic.

| Role | Can |
| --- | --- |
| owner (เจ้าของระบบ) | everything incl. users, invites, audit log, settings |
| editor (บรรณาธิการ) | posts (write + publish/schedule), media, redirects |
| sales (ฝ่ายขาย) | leads: view, status/notes/assign, CSV export |
| viewer (ผู้ชม) | read-only posts, media, leads (no export) |

Full permission matrix + endpoints: `api/README.md`. At least one active owner always exists (last-owner
protection); the bootstrap admin (`ADMIN_EMAIL`) is an owner, and `ADMIN_RESET_PASSWORD=true` is the break-glass
(restores password, owner role and active state).

**Pages.** Dashboard (lead KPIs with period deltas, 30-day chart, posts counts, recent items) · Posts (search,
filters, bulk publish/unpublish/delete) · Editor (Tiptap block editor — **storage stays Markdown** in
`body_markdown`, round-trip verified on all seeded posts with `npm run verify:roundtrip`; slash menu, bubble toolbar,
image drag-drop/paste upload, live preview with the real public article components, draft autosave, scheduling,
SEO checklist/score with focus keyword, Google + Facebook/LINE/X previews, canonical/noindex/OG overrides) ·
Media library (EXIF-stripped, auto-oriented, ≤2560 px re-encoded uploads; alt text; usage; delete blocked when in
use) · Leads (table + Kanban with keyboard alternative, detail drawer with timeline, notes, assignee, quick
actions, CSV export) · Redirects (301/410 manager, no chains/loops) · Users & invites (invite link always shown
for copying because e-mail may not be configured) · Account (profile, password, sessions) · Audit log · Settings
overview (read-only, no secrets).

**Scheduled posts.** The API scheduler (every `SCHEDULER_INTERVAL`, default 60 s) publishes due posts with an
idempotent `UPDATE … WHERE status='scheduled' AND published_at <= now() RETURNING`, then revalidates the web.

**Knowledge fallback policy.** The Go API is the source of truth as soon as it reports ≥ 1 published post: lists,
categories, homepage teasers, sitemap and RSS show API data only, an API 404 is a real 404, and 301/410 come from
`/api/v1/redirects` (served by `proxy.ts`, cached in-process 60 s, invalidated by the `redirects` revalidate tag,
fails open). Only when the API is reachable with **zero** published posts does the web serve the bundled
`posts.json` (list, categories, articles). API unset/down ⇒ bundle with a short cache lifetime. Homepage teasers
are checked against live posts, so they never link to a 404. Tests: `cd web && npm run test`.

**SEO.** Slug changes on published posts keep the old URL as a 301; unpublish/delete offers a 301 target or 410
Gone; BlogPosting/BreadcrumbList/Organization/WebSite/ProfessionalService JSON-LD; auto OG image
(`/knowledge/<slug>/og`, bundled IBM Plex Sans Thai in `web/assets/fonts`); optional IndexNow (`INDEXNOW_KEY`).
Writer's guide (Thai): `docs/SEO-GUIDE.md`.

**Status.** Complete on `Develop` (commits `603edae..HEAD`, not pushed/deployed): migrations `00003_admin_v2` +
`00004_seo`, RBAC + users/invites/audit, scheduler, media processing, leads CRM, Tiptap editor, SEO/redirects/410,
public JSON-LD/OG/sitemap. Verified locally with `go test`, web `tsc`/`lint`/`test`/`build`, and one end-to-end
run on a throwaway DB against the production web build (logged-out `/admin*` → 307 from `proxy.ts`; owner login;
draft + drag-drop image + cover/alt + SEO fields; schedule → published by the scheduler → on `/knowledge`,
category, sitemap, RSS, article 200 with SEO title/canonical/BlogPosting JSON-LD; unpublish (410) → 410 and gone
from listings; delete) and a crawl of all sitemap + nav/footer URLs (no broken links, no duplicate titles or
descriptions, exactly one `<h1>` per page).

**Known gaps.**
- Mobile Lighthouse Performance measured 85–87 locally vs the 90 target — re-measure with PageSpeed Insights after
  deploy (DEPLOY.md step 4). Public JS bundle is +0.4 KB gz after the Admin v2 / SEO work.
- `/knowledge/category/<unknown>` answers 200 + `noindex` (soft 404) instead of 404.
- JPEG re-encode drops the embedded ICC colour profile (wide-gamut photos may shift slightly); GIF and AVIF uploads
  are stored as-is (not resized or metadata-stripped).
- Audit logs are kept forever (no retention job).
- Invite/reset e-mail (Resend/SMTP) and IndexNow submission are implemented but untested against the live services.
