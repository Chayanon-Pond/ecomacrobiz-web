# Admin v2 — progress (working note, keep updated)

Branch `Develop` (never pushed). Commits: 603edae (checkpoint), ec6381c (editor/posts/media UI checkpoint).

## Done
- Migration 00003_admin_v2 (roles, user_tokens, audit_logs, lead_activities, leads.assigned_to, media.alt, scheduled posts).
- Go identity (JR-A): RBAC middleware on every route, users/invites/reset links, account, audit log + viewer API,
  settings overview, mailer for invite links. Tests green (unit + integration on escoma_test_a).
- Go content (JR-B): scheduled posts + scheduler, slug-check, bulk, media library + pure-Go image processing,
  leads CRM (board, assignees, activity, notes), dashboard. Tests green (escoma_test_b).
- Web: proxy.ts + server session gate in app/admin/(console)/layout.tsx, UI kit (components/admin/ui), shell
  (sidebar, command palette), components for dashboard/leads board/users/account/settings/audit (Nansy, run
  interrupted), Tiptap editor with remark bridge (round-trip 9/9 PASS), posts list, media library (Minny).

## In progress (wave 2)
- Nansy-2: missing console routes (users, audit, settings, account), wire UI to real API, cleanup of old components.
- JR-SEO: migration 00004_seo, post SEO fields, redirects/410 API, auto old-slug redirect, IndexNow.
- Minny-2: editor SEO checklist/score, focus keyword, SERP + social previews, unpublish/delete redirect choice,
  Redirects manager page.
- Pond (public SEO/perf): redirects + 410 served by Next proxy, JSON-LD, OG image route (bundled Thai font),
  sitemap/noindex/canonical, IndexNow key file, knowledge fallback policy + tests, Lighthouse/a11y fixes.

## Remaining
- QA (Sompong): RBAC matrix (independent), migration on prod-like DB, E2E, crawl, Lighthouse, responsive.
- Docs: README, api/README, DEPLOY.md, docs/SEO-GUIDE.md, memory note. Final logical commits.

## How to resume
- `docker compose up -d db` in D:\escoma (host port 55432). Test DBs: escoma_test_a, escoma_test_b.
- Go: `cd api && go test ./...`; integration: `TEST_DATABASE_URL=postgres://escoma:escoma-dev-only@localhost:55432/escoma_test_a?sslmode=disable`.
- Web: delete `web/.next/types` if tsc reports stale route paths; never use ports 3000/8080/9500.
- Contracts: scratchpad CONTRACT.md / CONTRACT-SEO.md were copied into api/README.md sections.
