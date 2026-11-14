# ECOMACROBIZ API (Go)

Backend for the ECOMACROBIZ website: blog posts, contact leads, admin auth and
media uploads. Go 1.25, Gin, pgx/v5 + Postgres 17, goose migrations embedded in
the binary, `log/slog` JSON logs. The binding contract is the "Go API contract"
section of the Phase 2 `CONTRACTS.md`.

## Architecture

```
cmd/server/main.go        subcommands: serve | migrate up|down|status | seed-posts --file | create-admin
migrations/               goose SQL (embedded via embed.FS) + migrations.Run()
internal/config           env parsing + validation (documented in .env.example)
internal/domain           core types, ValidationError (Thai field messages), sentinel errors
internal/repository       interfaces + hand-written pgx implementations
internal/repository/fake  in-memory implementations for unit/handler tests
internal/service          business rules: contact, posts, auth, leads (CSV), media
internal/seed             posts.json bundle importer (idempotent upsert)
internal/http/handlers    Gin router + endpoints + DTOs
internal/http/middleware  request id, access log, recover, security headers, CORS,
                          body limit, rate limit, session auth, CSRF/Origin check
internal/http/respond     JSON + error envelope helpers
internal/ratelimit        keyed token bucket (x/time/rate) with idle cleanup
internal/notify           Notifier interface, SMTP email, LINE push, async fan-out,
                          web revalidation webhook
internal/storage          MediaStore interface, LocalDisk (os.Root-confined)
```

Request flow: `handler -> service (validation, rules) -> repository (SQL)`.
Services depend on repository interfaces only, so they are tested with fakes.

Key decisions

- **Cover images** are denormalised onto `posts` (`cover_url`, `cover_alt`,
  `cover_width`, `cover_height`) so public reads need no join. `cover_url` may
  be relative (`/images/knowledge/...`, served by the web app) or absolute (API
  media URL). An admin can instead send `cover_media_id`; the API copies that
  media row's URL/size into the cover columns and keeps the id in
  `cover_media_id` (FK, `ON DELETE SET NULL`). `cover.alt` may accompany it.
- **Sessions**: opaque 32-byte random token in the `escoma_admin` cookie; only
  its SHA-256 is stored. Each session has its own CSRF token, returned by login
  and `/auth/me`, compared in constant time. Fixed expiry (`SESSION_TTL`),
  expired rows purged hourly.
- **CSRF**: every non-GET admin request needs `X-CSRF-Token` and, if an
  `Origin` header is present, it must be in `CORS_ALLOWED_ORIGINS`. Login also
  checks Origin. The cookie is `SameSite=Strict` as a second layer.
- **Client IP**: `X-Forwarded-For` is honoured only when the TCP peer is in
  `TRUSTED_PROXIES` (Gin's trusted-proxy walk; Gin's trust-all default is
  disabled).
- **Notifications** never block or fail a request: each notifier runs in its own
  goroutine with a 15 s timeout; failures are logged. Shutdown waits for
  in-flight notifications (bounded by `SHUTDOWN_TIMEOUT`).
- **Soft delete** for posts, media and leads (`deleted_at`). A deleted post's
  slug can be reused (partial unique index).
- **Rate limits** are in-process token buckets. With more than one replica,
  each enforces its own budget.
- **updated_at** is maintained by a trigger, which leaves it alone when a
  statement sets it explicitly (the seeder keeps the bundle's `updatedAt`).

## Run locally

Prereqs: Go 1.25, Docker. From the repo root (`D:\escoma`):

```bash
# Option A: everything in Docker (API at http://localhost:18080)
docker compose up -d --build
# Host port defaults to 18080 (override with API_HOST_PORT).

# Option B: DB in Docker, API with go run
docker compose up -d db                      # Postgres on localhost:55432
cd api
cp .env.example .env                         # then set ADMIN_EMAIL / ADMIN_PASSWORD
set -a; . ./.env; set +a                     # (PowerShell: set the variables yourself)
go run ./cmd/server migrate up
go run ./cmd/server seed-posts --file ../web/src/content/posts/posts.json
go run ./cmd/server                          # serve; MIGRATE_ON_START=true also migrates
```

Other commands:

```bash
go run ./cmd/server migrate status
go run ./cmd/server migrate down             # one step
go run ./cmd/server create-admin             # upsert admin from ADMIN_* env, then exit
```

The admin is also bootstrapped on every boot from `ADMIN_EMAIL` /
`ADMIN_PASSWORD` / `ADMIN_NAME`. It is created (as role `owner`) when missing. An
existing password is **never** overwritten unless `ADMIN_RESET_PASSWORD=true`, which also
restores `role=owner` + `is_active=true` (break-glass recovery) and revokes that admin's sessions. Passwords must be 12–72 characters and are never
logged.

## Seeding blog posts

`seed-posts --file <posts.json>` reads the bundle produced by the web app
(`web/src/content/posts/posts.json`, format in CONTRACTS.md, "Blog post
bundle"):

- categories are upserted by slug (`name`, `nameTh`, `description`; file order
  sets `sort_order`);
- posts are upserted by slug with `status=published`. `publishedAt`/`updatedAt`
  are kept from the file, `cover.src` goes to `cover_url`. A legacy slug equal
  to the canonical slug is dropped (the canonical slug already resolves);
- rows whose content is unchanged are not touched, so re-running is a no-op
  (the log reports `posts_changed` / `posts_unchanged`);
- a post that references a category missing from both the file and the DB
  aborts the run.

## Tests

```bash
go test ./...                                     # unit + handler tests (no DB needed)
TEST_DATABASE_URL='postgres://escoma:escoma-dev-only@localhost:55432/escoma?sslmode=disable' \
  go test ./internal/repository/                  # Postgres integration tests
```

Integration tests create a random schema, run all migrations (including
down/up), test repository CRUD, and drop the schema.

## Docker image

```bash
docker build -t escoma-api ./api
```

Multi-stage: `golang:1.25-alpine` build (`CGO_ENABLED=0 -trimpath -ldflags "-s -w"`),
final `gcr.io/distroless/static-debian12:nonroot` (uid 65532). Migrations and
tzdata are embedded. Mount a persistent volume at `MEDIA_DIR` (`/data/media`).
The server refuses to start when `MEDIA_DIR` is not writable; Railway volumes
are root-owned, so set `RAILWAY_RUN_UID=0` on the Railway api service.
Railway config: `api/railway.json` (see `docs/DEPLOY.md`).

## Endpoints

Base path `/api/v1`. JSON/UTF-8. Every non-2xx response uses the envelope:

```json
{ "error": { "code": "validation_failed", "message": "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
             "fields": { "phone": "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง" } } }
```

Codes: `validation_failed` (422, or 400 for malformed JSON), `not_found` (404),
`rate_limited` (429 + `Retry-After`), `unauthorized` (401), `forbidden` (403),
`payload_too_large` (413), `internal` (500).

### Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/healthz` | `{"status":"ok","db":"ok"}`, 503 when the DB ping fails |
| GET | `/api/v1/categories` | all categories with `post_count` (published, visible) |
| GET | `/api/v1/posts?page&per_page&category` | published, `published_at <= now`, newest first; `per_page` ≤ 50 (default 12) |
| GET | `/api/v1/posts/:slug` | canonical slug or legacy (Thai) slug; 404 otherwise |
| POST | `/api/v1/contact` | lead form; 16 KB body limit; `CONTACT_RATE_LIMIT` per IP |
| GET | `/media/<file>` | uploaded media; `Cache-Control: public, max-age=31536000, immutable` |

```bash
curl -s localhost:18080/healthz
curl -s localhost:18080/api/v1/categories
curl -s 'localhost:18080/api/v1/posts?page=1&per_page=12&category=brand-insight'
curl -s localhost:18080/api/v1/posts/branding-vs-marketing
curl -s localhost:18080/api/v1/posts/%E0%B8%AA%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%87%E0%B8%84%E0%B8%A7%E0%B8%B2%E0%B8%A1%E0%B8%88%E0%B8%94%E0%B8%88%E0%B8%B3%E0%B9%81%E0%B8%9A%E0%B8%A3%E0%B8%99%E0%B8%94%E0%B9%8C

curl -s -X POST localhost:18080/api/v1/contact -H 'Content-Type: application/json' -d '{
  "first_name":"สมชาย","last_name":"ใจดี","company":"","line_id":"somchai",
  "phone":"081-234-5678","email":"somchai@example.com","preferred_channel":"line",
  "preferred_date":"2026-12-01","preferred_time":"10:30","message":"สนใจบริการ",
  "consent":true,"website":"","source_page":"/contact"}'
# -> 201 {"data":{"id":"<uuid>"}}
```

Contact rules: `first_name` required (≤100), `last_name` ≤100, `company` ≤200,
`line_id` ≤100, `phone` Thai (`0` + 8–9 digits or `+66` + 8–9 digits after
removing spaces/dashes; stored normalised), `email` valid, `preferred_channel`
∈ `email|line|phone`, `preferred_date` `YYYY-MM-DD`, not before today in
Asia/Bangkok and at most 2 years ahead, `preferred_time` `HH:MM` 24 h, `message`
≤2000, `consent` must be `true`, `source_page` ≤200. Lengths count characters,
not bytes. A filled `website` honeypot gets a 201 with a fake id. Nothing is
stored or notified.

### Admin (`/api/v1/admin`, cookie session)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | `{email,password}` → `{data:{user,csrf_token}}` + `Set-Cookie: escoma_admin=…; HttpOnly; SameSite=Strict; Path=/; Max-Age=SESSION_TTL` (+`Secure`). Rate-limited per IP and per email |
| POST | `/auth/logout` | 204, clears cookie |
| GET | `/auth/me` | `{data:{user,csrf_token}}` |
| GET | `/categories` | same as public |
| GET | `/posts?page&per_page&status=draft\|published\|all&q=` | includes drafts and `status` |
| GET | `/posts/:id` | full post + `status`, `cover_media_id` |
| POST | `/posts` | create, 201 |
| PUT | `/posts/:id` | replace, 200 (`published_at`/`legacy_slugs` kept when omitted) |
| DELETE | `/posts/:id` | soft delete, 204 |
| POST | `/media` | multipart field `file`; jpeg/png/webp/avif/gif sniffed from content; ≤ `MAX_UPLOAD_MB` → 201 `{id,url,width,height,mime,size}` |
| GET | `/leads?page&per_page&status&q=` | newest first |
| GET | `/leads/:id` | |
| PATCH | `/leads/:id` | `{status, note?}` (`note` omitted = unchanged) |
| GET | `/leads/export.csv?status=` | UTF-8 CSV with BOM, `Content-Disposition: attachment`, Bangkok times, formula-injection safe |

Every non-GET admin call needs `X-CSRF-Token`. After a post create, update or
delete the API POSTs `{"tags":["posts","post:<slug>"]}` to `WEB_REVALIDATE_URL`
with `x-revalidate-secret`. A slug change also sends the old slug's tag.

```bash
J=cookies.txt
curl -s -c $J -X POST localhost:18080/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"<password>"}'
CSRF=<csrf_token from the response>
curl -s -b $J localhost:18080/api/v1/admin/auth/me
curl -s -b $J -X POST localhost:18080/api/v1/admin/posts -H "X-CSRF-Token: $CSRF" \
  -H 'Content-Type: application/json' -d '{"slug":"new-post","title":"บทความใหม่","excerpt":"",
  "body_markdown":"## หัวข้อ","categories":["learning-hub"],"author":"ทีมงาน","status":"draft",
  "cover":{"url":"/images/x.webp","alt":"ภาพปก","width":1200,"height":630}}'
curl -s -b $J -X PUT    localhost:18080/api/v1/admin/posts/<id> -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -d @post.json
curl -s -b $J -X DELETE localhost:18080/api/v1/admin/posts/<id> -H "X-CSRF-Token: $CSRF"
curl -s -b $J -X POST   localhost:18080/api/v1/admin/media -H "X-CSRF-Token: $CSRF" -F file=@photo.webp
curl -s -b $J 'localhost:18080/api/v1/admin/leads?status=new'
curl -s -b $J -X PATCH  localhost:18080/api/v1/admin/leads/<id> -H "X-CSRF-Token: $CSRF" \
  -H 'Content-Type: application/json' -d '{"status":"contacted","note":"โทรกลับแล้ว"}'
curl -s -b $J -o leads.csv localhost:18080/api/v1/admin/leads/export.csv
curl -s -b $J -X POST   localhost:18080/api/v1/admin/auth/logout -H "X-CSRF-Token: $CSRF"
```

## Admin API v2 — identity

Roles, users, invitations, password resets, self-service account, audit log
and the settings overview. Base `/api/v1/admin`; every non-GET call needs
`X-CSRF-Token` (except the two public token endpoints). Role → permission
matrix: `internal/domain/rbac.go` (owner = everything; editor = posts+media;
sales = leads incl. export; viewer = read-only posts/media/leads). A missing
permission is `403 forbidden` with a Thai message.

`UserDTO {id, email, name, role, is_active, last_login_at|null, created_at}`;
`MeDTO {user: UserDTO, permissions: [..], csrf_token}` is returned by login,
`/auth/me` and token accept.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | `/auth/login` | public (Origin + login limits) | → MeDTO. Audited `auth.login` / `auth.login_failed` (`{email}` only) |
| POST | `/auth/logout` | any signed-in | 204, `auth.logout` |
| GET | `/auth/me` | any signed-in | MeDTO |
| POST | `/auth/tokens/inspect` | public (Origin, 20/10m per IP) | `{token}` → `{purpose:"invite"\|"reset", email, role\|null, name, expires_at}`; bad/used/revoked/expired → 404 `token_invalid` |
| POST | `/auth/tokens/accept` | public (same limiter) | `{token, name, password}` (password 12–72 bytes; name 1–100, required for invites only) → sets the session cookie → MeDTO |
| PUT | `/account/profile` | any signed-in | `{name}` → UserDTO |
| PUT | `/account/password` | any signed-in | `{current_password, new_password}` → 204; wrong current → 422 `fields.current_password`; signs out every OTHER session |
| GET | `/account/sessions` | any signed-in | `[{id, ip, user_agent, created_at, last_seen_at\|null, expires_at, current}]` newest first |
| DELETE | `/account/sessions/others` | any signed-in | → `{revoked: n}` |
| GET | `/users` | `users:read` | all users incl. inactive, owners first, then name |
| PATCH | `/users/:id` | `users:manage` | `{role?, is_active?}` → UserDTO. 409 `last_owner` if no active owner would remain; deactivation deletes the user's sessions at once; nobody can raise their own role (403) |
| DELETE | `/users/:id` | `users:manage` | 204; self → 422; last active owner → 409 `last_owner` |
| POST | `/users/:id/reset-link` | `users:manage` | → `{token, expires_at, email_sent}`; revokes the user's previous open reset links; inactive user → 422 |
| GET | `/invites` | `users:read` | open invites (not used/revoked, incl. expired with `expired:true`), `invited_by: UserRef\|null` |
| POST | `/invites` | `users:manage` | `{email, role}` → 201 `{invite, token, email_sent}`; existing account → 409 `conflict`; an open invite for the same email is revoked first |
| POST | `/invites/:id/resend` | `users:manage` | rotates the token (old link dies) + new expiry → `{invite, token, email_sent}` |
| DELETE | `/invites/:id` | `users:manage` | 204 (revoked) |
| GET | `/audit` | `audit:read` | `actor_id, action, target_type, target_id, from, to` (YYYY-MM-DD, Asia/Bangkok, inclusive), `page, per_page≤100` (default 50) → `{id, created_at, actor:{id\|null, email, name}, action, target_type, target_id, metadata, ip, user_agent}` newest first |
| GET | `/settings/overview` | `settings:manage` | environment summary; never secrets or recipient addresses |

### Invitation / reset token flow

1. The owner creates an invite (`POST /invites`) or a reset link
   (`POST /users/:id/reset-link`). The API generates 32 random bytes
   (base64url) and stores **only the SHA-256** in `user_tokens`. The raw token
   is returned once, in that response only.
2. The link is `${origin}/admin/invite#token=<token>`: the token is in the
   URL fragment, so it never reaches servers, logs or `Referer`. The UI builds
   it from `window.location.origin`; the API e-mails the same link when
   `WEB_BASE_URL` **and** an e-mail transport (Resend or SMTP, same settings as
   lead e-mails) are configured.
3. `email_sent: true` means the e-mail was **queued** to the background
   sender (both settings present). Delivery runs asynchronously (15 s
   timeout) and a failure is only logged: the request never fails because of
   e-mail, so the owner can still copy the link. `false` = e-mail not
   configured; copy the link manually.
4. The web page calls `POST /auth/tokens/inspect`, then `/auth/tokens/accept`.
   Accept consumes the token atomically
   (`UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING`)
   in the same transaction that creates the user (invite: role from the
   invite, `invited_by` = inviter) or sets the password (reset: also deletes
   **all** sessions of that user; a fresh session is then created). Tokens
   are single-use; lifetime `INVITE_TTL` (default 72 h). Resend rotates the
   hash, so older links stop working. Unknown, used, revoked and expired
   tokens all return the same 404 `token_invalid`. Accepting an invite whose
   email already has an account (active or not) returns 409 `conflict` and
   leaves the invite unused.

**Last-owner rule.** Role/active changes and deletes run in one transaction
that locks every active owner row (`SELECT … FOR UPDATE`, id order) and
refuses (409 `last_owner`) to leave zero active owners, also under
concurrent requests.

**Break-glass recovery.** If every owner is locked out, set
`ADMIN_EMAIL`/`ADMIN_PASSWORD` to an existing account plus
`ADMIN_RESET_PASSWORD=true` and restart (or run `server create-admin`): that
user gets the new password, `role=owner` and `is_active=true`, and all of its
sessions are revoked. Set `ADMIN_RESET_PASSWORD` back to `false` afterwards.
The bootstrap admin is created as `owner`.

**Sessions.** `last_seen_at` is written at most once per minute per session
(skipped in Go when fresh, and guarded in SQL). A deactivated user is locked
out immediately: their sessions are deleted and session lookup also requires
`is_active`.

### Audit log

Append-only `audit_logs` (actor id + email snapshot, action, target, JSON
metadata, IP, user agent). Writes never fail a request (errors are logged)
and survive a cancelled request. Metadata never contains passwords, tokens,
hashes or note text; keys named like `password`/`token`/`hash`/`secret`/
`cookie`/`csrf` are dropped defensively.

Actions (`internal/domain/audit.go`): `auth.login`, `auth.login_failed`,
`auth.logout`, `auth.password_change`, `auth.password_reset`,
`auth.sessions_revoke`, `auth.profile_update`, `user.invite`,
`user.invite_resend`, `user.invite_revoke`, `user.invite_accept`,
`user.role_change` (`{email, from, to}`), `user.deactivate`,
`user.reactivate`, `user.reset_issue`, `user.delete` (`{email, role}`),
`post.create`, `post.update`, `post.publish`, `post.unpublish`,
`post.schedule`, `post.delete`, `media.upload`, `media.update`,
`media.delete`, `lead.status_change`, `lead.note`, `lead.assign`,
`lead.export`.

Retention: entries are kept indefinitely for now. Recommended policy: 365
days, purged manually (e.g. yearly) with

```sql
DELETE FROM audit_logs WHERE created_at < now() - interval '365 days';
```

### Settings overview

`GET /settings/overview` →
`{app_env, public_base_url, web_base_url, revalidate_webhook, email:{configured, provider:"resend"|"smtp"|null, recipients}, line:{configured}, session_ttl_hours, invite_ttl_hours, max_upload_mb, scheduler_interval_seconds, migrate_on_start}`
(no secrets, no recipient addresses).

## Admin API v2 — content

Dashboard, posts (incl. scheduling and bulk actions), media library and the
leads CRM. Base `/api/v1/admin`, cookie session, `X-CSRF-Token` on every
non-GET. Routes: `internal/http/handlers/routes_content.go`. Permission checks
that depend on the data (publishing, touching non-draft posts) are enforced in
the services from the request's `domain.Actor`, not only by the route gate.
A missing permission is `403 forbidden` with `domain.MsgNoPermission`.

`UserRef {id, name, email}` (name may be ""). Admin post DTOs add
`status: draft|published|scheduled` and `created_by: UserRef|null`; for a
scheduled post `published_at` is the time it will go live. Leads add
`assigned_to: UserRef|null`.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/dashboard` | `posts:read` or `leads:read` | `{leads, posts}`; a section is `null` without its read permission (below) |
| GET | `/categories` | `posts:read` | as public |
| GET | `/posts` | `posts:read` | `status=all\|draft\|published\|scheduled`, `q` (title/slug), `category` (slug), `sort=updated_desc`(default)`\|updated_asc\|published_desc\|published_asc\|title_asc`, `page`, `per_page≤100` |
| GET | `/posts/slug-check?slug=&exclude_id=` | `posts:read` | `{slug, valid, available, suggestion}`; taken = slug **or legacy slug** of another live post; `suggestion` = first free of `slug`, `slug-2`, `slug-3`… (for an invalid slug it is derived from a slugified form; `""` when nothing usable, e.g. Thai only) |
| GET | `/posts/:id` | `posts:read` | |
| POST | `/posts` | `posts:write` | status `published`/`scheduled` also needs `posts:publish` (403). `scheduled` needs `published_at` in the future (422 `fields.published_at` "เวลาเผยแพร่ต้องอยู่ในอนาคต") and a body. `published` without `published_at` = now. Audit `post.create` |
| PUT | `/posts/:id` | `posts:write` | without `posts:publish` only draft → draft (403 otherwise). Audit: → published `post.publish`, published → draft `post.unpublish`, → scheduled (or new time) `post.schedule`, otherwise `post.update` (metadata `{slug, from, to}`) |
| DELETE | `/posts/:id` | `posts:write` | published/scheduled also needs `posts:publish`. Soft delete, `post.delete` |
| POST | `/posts/bulk` | `posts:publish` | `{action: publish\|unpublish\|delete, ids: [1..100]}` → `{succeeded:[id], failed:[{id, message}]}`; each item audited (`bulk:true`); ONE revalidate webhook with all tags. Publish of a post without body fails that item; publishing a scheduled post publishes it now |
| GET | `/media` | `media:read` | `q` (original name or alt, ILIKE), `type` (`image/jpeg`… or `all`), `page`, `per_page≤100`, newest first; `usage_count` computed in the same query |
| GET | `/media/:id` | `media:read` | + `usage: [{post_id, title, slug, status, kind: cover\|body}]` |
| POST | `/media` | `media:write` | multipart `file` + optional `alt` (any order, ≤300 chars) → 201 MediaDTO; processing below. Audit `media.upload` |
| PATCH | `/media/:id` | `media:write` | `{alt}` → MediaDTO. Audit `media.update` |
| DELETE | `/media/:id` | `media:write` | used by live posts → 409 `in_use` "ไฟล์นี้ถูกใช้งานอยู่ใน N บทความ"; else soft-delete row + delete file → 204. Audit `media.delete` |
| GET | `/leads` | `leads:read` | `status`, `q`, `assigned=me\|none\|<user id>`, `from`, `to` (YYYY-MM-DD, Asia/Bangkok, inclusive), `page`, `per_page≤100` |
| GET | `/leads/board` | `leads:read` | `q`, `assigned` → `{columns:{new,contacted,qualified,closed,spam: [Lead…]}, counts:{…}}`, newest first, ≤50 per column, counts are full totals |
| GET | `/leads/assignees` | `leads:read` | `[UserRef]` active users whose role has `leads:write` |
| GET | `/leads/export.csv` | `leads:export` | unchanged format; audit `lead.export {status, rows}` |
| GET | `/leads/:id` | `leads:read` | |
| PATCH | `/leads/:id` | `leads:write` | `{status?, assigned_to?: uuid\|null, note?}`; absent = unchanged, `assigned_to:null` unassigns, `note` is the legacy single note. Status/assignee changes write `lead_activities` rows in the same transaction (row locked `FOR UPDATE`) and audit `lead.status_change {from,to}` / `lead.assign {from,to}` (user ids). Assignee must be an active user with `leads:write` (422 `fields.assigned_to`) |
| GET | `/leads/:id/activity` | `leads:read` | `[{id, kind: note\|status\|assign, actor: UserRef\|null, body, from, to, created_at}]` newest first (max 500). For `assign`, from/to are display names; when the actor was deleted, `actor` is `{id:"", name:<snapshot>, email:""}` |
| POST | `/leads/:id/notes` | `leads:write` | `{body}` 1–4000 chars → 201 activity item. Audit `lead.note {length}` — never the text |

Static paths (`/posts/slug-check`, `/posts/bulk`, `/leads/board`,
`/leads/assignees`, `/leads/export.csv`) are matched before the `:id`
siblings (covered by `TestContentRouting`).

### Dashboard

```
{ leads: null | { today, yesterday, last7, prev7, last30, prev30,
                  by_status: {new, contacted, qualified, closed, spam},
                  daily: [{date:"YYYY-MM-DD", count}] x30 (oldest → newest, zero-filled, today last),
                  recent: [Lead x5] },
  posts: null | { published, drafts, scheduled, next_scheduled_at|null, recent: [PostSummary x5 by updated_at] } }
```

Days are Asia/Bangkok calendar days of `created_at`; `last7` = today and the
6 days before, `prev7` the 7 days before that (same for 30). Deleted rows are
excluded. Leads: one aggregate query (`count(*) FILTER (...)` +
`generate_series` for the zero-filled series) plus one query for the 5 most
recent; posts: one `count FILTER` query plus the 5 most recently updated.

### Scheduled posts

A post saved with `status:"scheduled"` and a future `published_at` stays
invisible publicly (public reads require `status='published' AND
published_at <= now`). A background scheduler started by `serve` runs once at
boot and then every `SCHEDULER_INTERVAL` (default `60s`, minimum `5s`):

```sql
UPDATE posts SET status = 'published'
 WHERE status = 'scheduled' AND published_at <= $now AND deleted_at IS NULL
RETURNING id, slug
```

The UPDATE is atomic, so several replicas can run it at the same time: a
concurrent run re-checks `status='scheduled'` after the first commits and
skips the row, so each post is published and audited exactly once
(`TestSchedulerIdempotentConcurrent`). Each published post is audited as
`post.publish` by the system actor (no user) with `{slug, scheduled:true}`,
and one revalidate webhook is sent with `posts` + `post:<slug>` for every
post. The scheduler stops with the server's shutdown context (an in-flight
UPDATE is cancelled and rolled back; bookkeeping after a committed UPDATE is
finished). A scheduled post whose time has passed but that the scheduler has
not yet flipped stays hidden until the next run (≤ one interval).

### Image processing on upload

Pure Go (no cgo). The type is sniffed from the bytes; SVG and anything else
is rejected. Images with a side over 20000 px are rejected.

| Type | What happens |
| --- | --- |
| JPEG | header read first; **> 40 megapixels → 422** (before decoding). Decoded, downscaled so the longest side ≤ `MEDIA_MAX_DIMENSION` (default 2560, `golang.org/x/image/draw` CatmullRom), rotated/flipped per the EXIF Orientation tag (all 8 values; small built-in EXIF reader), re-encoded at quality 85. Re-encoding drops **all** metadata: EXIF incl. GPS, XMP, comments, and also the ICC colour profile (wide-gamut photos, e.g. Display P3 from phones, may look slightly less saturated) |
| PNG | same 40 MP check and downscale; re-encoded (drops `tEXt`/`zTXt`/`iTXt`/`eXIf`/`tIME`). When no resize was needed, the original has none of those chunks and the re-encode is not smaller, the original bytes are kept |
| WebP | 40 MP check on the header; `EXIF` and `XMP ` RIFF chunks removed and the VP8X flags cleared; **not decoded, not resized** (no pure-Go WebP encoder) |
| GIF, AVIF | **stored as uploaded**: no resize, no metadata removal (AVIF can carry EXIF; strip it before uploading if that matters) |

`width`/`height` are stored after processing; `size` is the stored size.

### Media usage

A media file is "in use" when a live (not soft-deleted) post of any status
has it as `cover_media_id` **or** its `body_markdown` contains the file's
storage key (e.g. `9f…c1.jpg`, which appears in its URL). `usage_count` and
`usage[]` count posts (one entry per post; `kind` is `cover` when it is the
cover, otherwise `body`). Deleting an unused file soft-deletes the row and
removes the file from storage; the check and the delete are one statement.
Absolute URLs pasted elsewhere (other sites, old revisions) are not tracked.

## Notifications

On every stored lead the API notifies all configured channels asynchronously:

- **Email (Resend API)**: set `RESEND_API_KEY`, `SMTP_FROM`, `SMTP_TO`. Takes
  precedence over SMTP. Use on hosts that block SMTP (Railway Hobby).
- **Email (SMTP)**: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`,
  `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TO` (comma-separated). Port 587 uses
  STARTTLS, which is required except for localhost relays. Port 465 uses
  implicit TLS. Plain-text UTF-8 Thai body, `Reply-To` set to the lead's email,
  header values stripped of CR/LF.
- **LINE Messaging API**: set `LINE_CHANNEL_ACCESS_TOKEN` (a long-lived
  channel access token for a Messaging API channel, from the LINE Developers
  console) and `LINE_TO` (the user, group or room id that should receive the
  push; the bot must be a friend of the user or a member of the group). Uses
  `POST https://api.line.me/v2/bot/message/push` with an `X-Line-Retry-Key`.
  LINE Notify was shut down in 2025 and is not used.

A channel whose variables are unset is disabled (logged at boot). With no
channel configured, each lead logs `lead notification skipped`.

## Security headers

All responses: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy`
(`cross-origin` for `/media/`, `same-site` elsewhere), `X-Request-ID`, and
`Strict-Transport-Security: max-age=31536000` when `HSTS_ENABLED=true`. Admin
and contact responses are `Cache-Control: no-store`. Public reads are
`public, max-age=60, stale-while-revalidate=300`. Server timeouts:
ReadHeader 5 s, Read 60 s, Write 60 s, Idle 120 s, 64 KB max headers.

## Environment

See `.env.example` for the annotated file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | listen port |
| `DATABASE_URL` | — (required) | Postgres URL |
| `APP_ENV` | `development` | `development\|production\|test`; production enforces `COOKIE_SECURE=true` and CORS origins |
| `LOG_LEVEL` | `info` | `debug\|info\|warn\|error` |
| `SHUTDOWN_TIMEOUT` | `20s` | graceful shutdown budget |
| `MIGRATE_ON_START` | `false` | run `migrate up` on boot |
| `CORS_ALLOWED_ORIGINS` | empty | exact origins, comma-separated (also used for the admin Origin check) |
| `TRUSTED_PROXIES` | empty (none) | IPs/CIDRs allowed to set `X-Forwarded-For` |
| `HSTS_ENABLED` | `false` | send HSTS |
| `COOKIE_SECURE` | `true` | `Secure` on the session cookie |
| `COOKIE_DOMAIN` | empty | optional cookie Domain |
| `SESSION_TTL` | `24h` | session lifetime |
| `INVITE_TTL` | `72h` | invitation / password-reset link lifetime (10m-720h) |
| `WEB_BASE_URL` | empty | public web origin (e.g. `https://www.ecomacrobiz.com`); with an e-mail transport configured, invite/reset links are also e-mailed |
| `PUBLIC_BASE_URL` | `http://localhost:18080` | absolute base for media URLs |
| `MEDIA_DIR` | `./data/media` | upload directory (`/data/media` in the image) |
| `MAX_UPLOAD_MB` | `8` | per-file upload limit |
| `MEDIA_MAX_DIMENSION` | `2560` | longest side kept for uploaded JPEG/PNG (320–10000) |
| `SCHEDULER_INTERVAL` | `60s` | scheduled-post check interval (min `5s`) |
| `CONTACT_RATE_LIMIT` | `5/10m` | contact submissions per IP |
| `LOGIN_RATE_LIMIT` | `10/15m` | login attempts per IP and per email |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM` / `SMTP_TO` | empty / `587` | email notifier |
| `RESEND_API_KEY` | empty | email via Resend HTTPS API instead of SMTP (uses `SMTP_FROM`/`SMTP_TO`); needed on Railway Hobby, which blocks SMTP |
| `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_TO` | empty | LINE push notifier |
| `WEB_REVALIDATE_URL` / `REVALIDATE_SECRET` | empty | Next.js revalidation webhook |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` / `ADMIN_RESET_PASSWORD` | empty / empty / `Admin` / `false` | admin bootstrap |

## Database schema (migrations/)

- `admin_users` (id uuid PK, email lower-case + unique index on `lower(email)`,
  name, password_hash bcrypt, is_active, last_login_at, created_at, updated_at)
- `sessions` (id, admin_user_id FK cascade, token_hash bytea **unique**,
  csrf_token, ip, user_agent, created_at, expires_at **indexed**; index on admin_user_id)
- `categories` (id, slug unique, name, name_th, description, sort_order, timestamps); 4 seeded
- `media` (id, storage_key unique, url, original_name, mime, size_bytes, width,
  height, uploaded_by FK set null, timestamps, deleted_at)
- `posts` (id, slug kebab-case CHECK + **partial unique** `WHERE deleted_at IS NULL`,
  legacy_slugs text[] **GIN**, title, excerpt, body_markdown, cover_media_id FK,
  cover_url/alt/width/height, author, status CHECK `draft|published`, published_at
  (required when published), featured, reading_minutes, seo_title,
  seo_description, created_by, timestamps, deleted_at; index
  `(status, published_at DESC) WHERE deleted_at IS NULL`)
- `post_categories` (PK `(post_id, category_id)`, both FK cascade; index on category_id)
- `leads` (id, first_name, last_name, company, line_id, phone, email,
  preferred_channel CHECK, preferred_date date, preferred_time CHECK HH:MM,
  message, consent_at, status CHECK `new|contacted|qualified|closed|spam`, note,
  source_page, ip inet, user_agent, timestamps, deleted_at; indexes
  `(created_at DESC)` and `(status)` partial on `deleted_at IS NULL`)
- `goose_db_version` (goose)
- trigger `set_updated_at()` on every table with `updated_at`
