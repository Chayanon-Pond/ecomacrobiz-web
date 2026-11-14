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
internal/service          business rules: contact, posts, auth, leads (CSV), media,
                          community (members, Google sign-in, comments, likes, views)
internal/vault            member-data crypto: AES-256-GCM keyring, blind index, argon2id
internal/seed             posts.json bundle importer (idempotent upsert)
internal/http/handlers    Gin router + endpoints + DTOs
internal/http/middleware  request id, access log, recover, security headers, CORS,
                          body limit, rate limit, session auth, CSRF/Origin check
internal/http/respond     JSON + error envelope helpers
internal/ratelimit        keyed token bucket (x/time/rate) with idle cleanup
internal/notify           Notifier interface, SMTP email, LINE push, async fan-out,
                          web revalidation webhook
internal/storage          MediaStore interface, LocalDisk (os.Root-confined)
cmd/oidcstub              DEV-ONLY OpenID Connect provider standing in for Google (never wired into serve)
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
down/up), test repository CRUD, and drop the schema. Point `TEST_DATABASE_URL`
at a throwaway database (`CREATE DATABASE escoma_it` on the compose Postgres)
rather than the dev `escoma` database.

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
matrix: `internal/domain/rbac.go` (owner = everything; editor = posts+media+comment moderation;
sales = leads incl. export; viewer = read-only posts/media/leads). A missing
permission is `403 forbidden` with a Thai message.

`UserDTO {id, email, name, role, is_active, last_login_at|null, created_at}`;
`MeDTO {user: UserDTO, permissions: [..], csrf_token}` is returned by login,
`/auth/me` and token accept.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | `/auth/login` | public (Origin + login limits) | → MeDTO. Audited `auth.login` / `auth.login_failed` (`{email}` only when it is a valid address, else `{email_valid:false}`, so a password typed into the email field is never stored) |
| POST | `/auth/logout` | any signed-in | 204, `auth.logout` |
| GET | `/auth/me` | any signed-in | MeDTO |
| POST | `/auth/tokens/inspect` | public (Origin, 20/10m per IP) | `{token}` → `{purpose:"invite"\|"reset", email, role\|null, name, expires_at}`; bad/used/revoked/expired → 404 `token_invalid` |
| POST | `/auth/tokens/accept` | public (same limiter) | `{token, name, password}` (password 12–72 bytes; name 1–100, required for invites only) → sets the session cookie → MeDTO |
| PUT | `/account/profile` | any signed-in | `{name}` → UserDTO |
| PUT | `/account/password` | any signed-in | `{current_password, new_password}` → 204; wrong current → 422 `fields.current_password`; signs out every OTHER session and revokes the user's open reset links (same transaction as the new hash); 5 attempts per user per 15 min, then 429 `rate_limited` + `Retry-After` |
| GET | `/account/sessions` | any signed-in | `[{id, ip, user_agent, created_at, last_seen_at\|null, expires_at, current}]` newest first |
| DELETE | `/account/sessions/others` | any signed-in | → `{revoked: n}` |
| GET | `/users` | `users:read` | all users incl. inactive, owners first, then name |
| PATCH | `/users/:id` | `users:manage` | `{role?, is_active?}` → UserDTO. 409 `last_owner` if no active owner would remain; deactivation deletes the user's sessions and revokes their open reset links in the same transaction; demotion/deactivation also revokes the open invites the user can no longer grant; nobody can raise their own role (403) |
| DELETE | `/users/:id` | `users:manage` | 204; self → 422; last active owner → 409 `last_owner`; the user's open invites are revoked in the same transaction |
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
   An invite carries its inviter's authority: accept locks the inviter row
   (`FOR SHARE`, before the token row) and re-checks in the same transaction
   that the inviter still exists, is active and may grant the role
   (`domain.CanGrant`); otherwise 404 `token_invalid` and nothing changes.

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
`{app_env, public_base_url, web_base_url, revalidate_webhook, email:{configured, provider:"resend"|"smtp"|null, recipients}, line:{configured}, session_ttl_hours, invite_ttl_hours, max_upload_mb, scheduler_interval_seconds, migrate_on_start, members:{google_enabled, require_verified_email, hold_first_comment, turnstile_enabled, data_key_ids}}`
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
has it as `cover_media_id` or `og_media_id` **or** its `body_markdown` contains
the file's storage key (e.g. `9f…c1.jpg`, which appears in its URL).
`usage_count` and `usage[]` count posts (one entry per post; `kind` is `cover`
when it is the cover, `og` when it is the OG image, otherwise `body`). Deleting an unused file soft-deletes the row and
removes the file from storage; the check and the delete are one statement.
Absolute URLs pasted elsewhere (other sites, old revisions) are not tracked.

## Admin API v2 — SEO & redirects

Migration `00004_seo.sql` (additive): SEO columns on `posts` and a
`redirects` table. Routes: `routes_content.go` (admin) and `router.go`
(public); logic in `service/redirects.go` and `service/posts.go`.

### Post SEO fields

| field | DTO | input rules |
| --- | --- | --- |
| `focus_keyword` | admin only | ≤ 100 characters |
| `canonical_url` | admin + public | `""` or an absolute `https://` URL (≤ 2000) |
| `noindex` | admin + public | boolean; noindex posts stay in the public list (the web sitemap excludes them) |
| `og_image` | admin + public, `{url, alt, width, height}` or `null` | from `og_media_id` (URL + size from the media row, `alt` from `og_image.alt` else the media alt) **or** `og_image.url` (`https://…` or `/…`) with `width` and `height` > 0; alt ≤ 300 |
| `og_media_id` | admin only | media uuid (unknown → 422). An OG image counts as media usage (`kind: "og"`) |
| `redirect_to` | input only | used only when the PUT unpublishes a published post (see below) |

PUT replaces the post, so the editor must echo every SEO field back.
`DELETE /posts/:id` accepts an optional JSON body `{"redirect_to": "…"}`.

### Endpoints

| method path | gate | notes |
| --- | --- | --- |
| `GET /api/v1/redirects` | public (`publicCache`) | `{data:[{from, to\|null, status}]}` sorted by `from`: every table row plus `/knowledge/<legacy> → /knowledge/<slug>` (301) for each legacy slug of a live published post. A live post URL always wins over a row. The web decides 301/410 from this map; `GET /api/v1/posts/:slug` is unchanged |
| `GET /admin/redirects` | posts:read | `?q` (from/to/note contains) `&kind=manual\|auto` `&status=301\|410` `&page&per_page≤100` → `[{id, from, to, status, kind, note, created_by, created_at, updated_at}]` ordered by `from` |
| `POST /admin/redirects` | posts:publish | `{from, to\|null, status: 301\|410, note}` → 201 row + `flattened` (rows re-pointed). Audit `redirect.create` |
| `PUT /admin/redirects/:id` | posts:publish | same body → row + `flattened`; an edited `auto` row becomes `manual`. Audit `redirect.update` |
| `DELETE /admin/redirects/:id` | posts:publish | 204. Audit `redirect.delete` |
| `GET /admin/posts/link-suggestions?post_id=&q=` | posts:read | up to 8 live published posts (not `post_id`) that share a category with `post_id` or whose title/excerpt contains `q`; ranked by shared categories, keyword match, newest. `[{id, title, slug, url:"/knowledge/<slug>"}]`; `[]` when neither is given |

Every redirect change (manual or automatic) revalidates the web tag
`redirects` (the web `/api/revalidate` must allowlist it).

### Path rules

Stored paths start with `/`, are percent-**decoded** and NFC-normalized (Thai
allowed: `/post/%E0%B8%AA…/` and `/post/ส…` are the same row), have repeated
`/` collapsed and no trailing `/` (except `/`). Rejected (422): query `?` or
fragment `#`, `.`/`..` segments, whitespace, control characters, `\`, bad
percent-encoding, > 2000 bytes. `to` is a site path (same rules) or an
absolute `https://` URL on any host; an `https://` URL on the `WEB_BASE_URL`
host is stored as a path. `410` rows have `to = null` (a `to` sent with 410 is
ignored); the DB enforces `(status = 301) = (to IS NOT NULL)`.

Rules on every create/update (422 with a Thai field message):

- `from != to`.
- **No chains:** `to` must not be the `from` of another 301 ("ปลายทางเป็น URL
  ที่ถูก redirect อยู่แล้ว (ห้ามทำ redirect ต่อกันเป็นทอด)"); this also rules out
  loops. A `to` that is a live post's legacy URL is replaced by the post's
  canonical URL.
- **Flatten:** existing 301s whose `to` equals the new `from` are re-pointed to
  the new `to` in the same transaction (count returned as `flattened`). A 410
  does not flatten: a 301 into a now-gone URL stays (one extra hop, ends in 410).
- **No shadowing:** `from` must not be a live published post URL
  (`/knowledge/<slug or legacy slug>`), a core page (`/`, `/purpose`,
  `/solutions`, `/gallery`, `/how-we-work`, `/contact`, `/privacy`,
  `/knowledge`) or under `/admin`, `/api`, `/_next`.
- Duplicate `from` → 422 on `from`.

### Automatic redirects (same transaction as the post change)

- **Slug change of a published post:** the old slug is appended to
  `legacy_slugs` (deduped, newest last, the new slug removed, capped at 20 —
  oldest dropped); rows for the post's live URLs are deleted; 301s that pointed
  at the old URL are re-pointed to the new one.
- **Publish** (create/PUT/bulk/scheduler): rows for `/knowledge/<slug>` and
  every legacy slug are deleted (a live post wins).
- **Unpublish** (published → draft by PUT) or **delete** of a published post:
  `/knowledge/<slug>` and every legacy URL become `auto` rows — 301 to
  `redirect_to` when given (validated as above, plus it must not be one of the
  post's own URLs; error field `redirect_to`), else 410. Existing 301s to those
  URLs are flattened to the target.
- **Bulk** unpublish/delete → 410 (no per-item target).
- Not handled: published → scheduled (URL 404s until the scheduler publishes
  it); legacy slugs removed by hand from a live post (they 404).

### IndexNow

Optional. With `INDEXNOW_KEY` (8–128 of `a-zA-Z0-9-`) **and**
`WEB_BASE_URL` set, the API POSTs
`{host, key, keyLocation: <WEB_BASE_URL>/<key>.txt, urlList}` to
`https://api.indexnow.org/indexnow` asynchronously (10 s timeout, logged only,
never fails a request) after: publish, update of a published post (old and new
URL on a slug change), unpublish and delete (old URL + the redirect target when
it is on the site), bulk actions and scheduler publishes. `/knowledge` is
always included. URLs on other hosts are dropped. The web serves
`/<INDEXNOW_KEY>.txt` when its own `INDEXNOW_KEY` is set.

### Media file names

New uploads are stored as `<slug>-<8 hex>.<ext>`: an ASCII slug (≤ 60) of the
alt text, else of the original file name without extension, else `image`
(e.g. Thai-only text). Existing `<uuid>.<ext>` keys are untouched. Storage
never overwrites a key (`ErrKeyExists` → a new random suffix is drawn).

## Community API (members, Google sign-in, comments, likes, views)

Binding spec: `CONTRACT-COMMUNITY` (handed to api + web). The TypeScript
mirror of every shape below is `web/src/lib/community/types.ts`; the Go DTOs
are in `internal/http/handlers/dto_community.go`.

### Identity separation

Members are **not** admin users: own tables, own cookie `escoma_member`
(HttpOnly, `Secure` when `COOKIE_SECURE`, **SameSite=Lax** so the Google
redirect back to the site carries it, `Path=/`, `Max-Age=MEMBER_SESSION_TTL`),
own CSRF token and own middleware (`middleware/member.go`). The admin
middleware never reads `escoma_member`; the member middleware never reads
`escoma_admin`. Both directions are tested (`TestMemberCSRFMatrix`,
`TestMemberCookieNeverAuthenticatesAdmin`).

Every community route runs `LoadMemberSession` (optional session). `[auth]`
routes add `RequireMember` (401) and `RequireMemberCSRF`: unsafe methods need
`X-CSRF-Token` equal (constant time) to the member session's token and an
allowlisted `Origin` when one is present. Pre-session unsafe routes (register,
login, verify, forgot, reset, google/link, views) use `RequireOrigin` + rate
limits. Banned members still resolve their session (so the UI can explain),
but community writes return 403 `member_banned`; banning revokes all sessions.

### Endpoints — base `/api/v1/community` (`Cache-Control: no-store` unless noted)

Errors use the usual envelope. Community codes: `email_taken` 409,
`invalid_credentials` 401, `member_banned` 403, `email_unverified` 403,
`token_invalid` 404, `duplicate_comment` 422, `last_login_method` 409,
`conflict` 409, `rate_limited` 429 (+ `Retry-After`).

| Method | Path | Gate | Notes |
| --- | --- | --- | --- |
| GET | `/config` | public, `public, max-age=60` | → `{google_enabled, require_verified_email, email_transport, consent_version, comment_max_chars, comment_image_max_mb, avatar_max_mb, turnstile}` |
| GET | `/auth/me` | public | → `{data: Session\|null}` (`Session = {member: Me, csrf_token}`) |
| POST | `/auth/register` | Origin, `MEMBER_REGISTER_RATE_LIMIT`/IP, honeypot `website`, Turnstile when on | `{display_name, email, password, accept_terms, consent_version, website, turnstile_token?}` → 201 Session + cookie; mails a verification link when e-mail is on |
| POST | `/auth/login` | Origin, `MEMBER_LOGIN_RATE_LIMIT` per IP and per e-mail; Turnstile after 3 failures/IP when on | `{email, password, turnstile_token?}` → Session. Unknown e-mail, Google-only account and wrong password are the same 401 |
| POST | `/auth/logout` | [auth] | 204, clears the cookie |
| POST | `/auth/verify-email` | Origin, 20/10m per IP | `{token}` → `{verified:true, kind:"verify"\|"change_email"}` |
| POST | `/auth/verify-email/resend` | [auth], 3/h per member | 204 (no-op when verified or e-mail off) |
| POST | `/auth/password/forgot` | Origin, 5/h per IP and per address | `{email}` → 204 always |
| POST | `/auth/password/reset` | Origin, 20/10m per IP | `{token, password}` → 204; revokes ALL sessions, marks the e-mail verified |
| GET | `/auth/google/start?next=&consent=1` | 20/10m per IP | 302 to Google; sets `escoma_oauth` (`Path=/api/community/auth/google`, 600 s). 404 when Google is off |
| GET | `/auth/google/callback?code&state` | public | 302 to `${WEB_BASE_URL}${next}#community=<outcome>` or `${WEB_BASE_URL}/account/link-google#token=<t>`; always deletes the state row and clears `escoma_oauth` |
| POST | `/auth/google/link` | Origin, 10/15m per IP (a wrong password also counts toward the login limit) | `{token, password}` → Session |
| PUT | `/account/profile` | [auth] | `{display_name}` → Me |
| POST / DELETE | `/account/avatar` | [auth], POST 10/h | multipart `file` → Me |
| PUT | `/account/email` | [auth], 5/15m | `{new_email, current_password}` → `{member: Me, verification_sent}` |
| PUT | `/account/password` | [auth], 5/15m | `{current_password?, new_password}` → 204; revokes other sessions + open reset links |
| GET | `/account/sessions` | signed-in | `[{id, ip, user_agent, created_at, last_seen_at, expires_at, current}]` |
| DELETE | `/account/sessions/others` | [auth] | → `{revoked}` |
| DELETE | `/account/identities/google` | [auth] | 204 (idempotent); 409 `last_login_method` without a password |
| GET | `/account/export` | signed-in | attachment `ecomacrobiz-account.json`: the raw object `{member, identities, comments, likes:{posts, comments}, sessions}` (not wrapped in `data`) |
| DELETE | `/account` | [auth], 5/15m | `{current_password?, confirm:"ลบบัญชี"}` → 204 + cookie cleared |
| GET | `/stats?slugs=a,b` | public, `public, max-age=60` | ≤ 50 slugs → `{"<slug>": {views, likes, comments}}` (unknown slugs omitted) |
| GET | `/posts/:slug/stats` | public | → `{views, likes, comments, liked_by_me}` |
| POST | `/posts/:slug/views` | Origin, 60/10m per IP | 204 always (bots, duplicates and unknown slugs too) |
| PUT / DELETE | `/posts/:slug/like` | [auth], 60/1m | → `{liked, likes}` (idempotent) |
| GET | `/posts/:slug/comments?sort=newest\|top&page&per_page≤50&replies_preview=0..10` | public | → `{data: Comment[], meta:{page, per_page, total, total_pages, comment_count}}` (`replies_preview` default 2) |
| POST | `/posts/:slug/comments` | [auth], `COMMENT_RATE_LIMIT`/member + `COMMENT_IP_RATE_LIMIT`/IP | `{body, parent_id?, reply_to_id?, image_id?, website, elapsed_ms}` → 201 Comment |
| GET | `/comments/:id/replies?page&per_page≤50` | public | oldest first |
| PATCH | `/comments/:id` | [auth], author | `{body}` → Comment (the previous body is kept in `comment_edits`) |
| DELETE | `/comments/:id` | [auth], author or member moderator | 204 (soft delete; the image row + file are removed) |
| PUT / DELETE | `/comments/:id/like` | [auth], 60/1m | → `{liked, likes}`; 404 unless published |
| POST | `/comments/:id/report` | [auth], 20/h | `{reason: spam\|harassment\|inappropriate\|other, note?}` → 204 (upsert) |
| POST | `/comments/:id/moderate` | [auth], member role `moderator` | `{action: approve\|hide}` → Comment |
| POST | `/uploads/comment-image` | [auth], 10/h | multipart `file` → 201 `{id, url, width, height}` |

Verified-e-mail gate: with `MEMBER_REQUIRE_VERIFIED_EMAIL=true`, comments,
likes, reports and uploads by an unverified member → 403 `email_unverified`.

E-mailed links (need an e-mail transport + `WEB_BASE_URL`):
`/account/verify-email#token=` (verify 48 h, change e-mail 24 h) and
`/account/reset-password#token=` (1 h). Google link-required:
`/account/link-google#token=` (15 min). Tokens only ever travel in fragments.

Google callback outcomes (`#community=`): `signed-in`; `error-state`
(unknown, expired or replayed state, or the browser-binding cookie does not
match); `error-denied` (user cancelled); `error-provider` (discovery, code
exchange or ID-token verification failed); `error-token` (nonce mismatch);
`error-unverified` (Google `email_verified` is false); `error-banned`;
`error-consent` (new account without `consent=1`); `error-conflict`;
`error-internal`. `link-required` goes to the link page instead.

Resolution: (1) known Google identity → sign in; (2) a member with the same
e-mail: verified → link automatically and sign in, unverified → link token +
the account password; (3) otherwise create the member (display name from the
Google name, e-mail verified, `terms_version` = the consent version recorded
at `/start`). A Google picture on `https://*.googleusercontent.com` is
downloaded in the background (5 s, ≤ 2 MB) through the avatar pipeline when the
member has no avatar (never hotlinked).

### Comment rules

Body: NFC, CRLF→LF, control characters removed, > 2 blank lines collapsed,
1..2000 characters (empty allowed with an image). More than 2 links (http(s)
or bare domains) → 422 `fields.body`. The same normalized body by the same
member within 24 h → 422 `duplicate_comment`. `elapsed_ms < 2500` → 422. A
filled honeypot gets a fake pending comment and nothing is stored. Status on
create: trusted/moderator → published; otherwise, with
`MEMBER_HOLD_FIRST_COMMENT`, a member without a published comment whose
e-mail is unverified or whose account is younger than 24 h → pending; else
published. Three distinct reporters on a published comment by a non-trusted
author move it back to pending. `parent_id` is always stored as the top-level
comment (depth 2); `reply_to_id` must be in the same thread. Every change that
affects public output sends `comments:<slug>` to the revalidation webhook
(likes and views never do).

`body_html` is rendered in Go without a library (`service/community_text.go`):
every character of user input passes `html.EscapeString`; the only tags ever
produced are `strong`, `em`, `br` and `a href="http(s)://…" rel="ugc nofollow
noopener" target="_blank"` (link text ≤ 200). XSS vectors are table-tested.

Visibility: anonymous/others see published comments plus deleted placeholders
that still have visible replies; authors also see their own pending comments;
member moderators also see pending and hidden ones.

### Images (avatars, comment images)

Stored with the existing `MediaStore` and served by `/media/*`, but **not**
inserted into the `media` table (they never appear in the admin library).
Keys: `a-<16 hex>.jpg` (avatar), `c-<16 hex>.jpg|png` (comment). Pipeline
(`service/community_image.go`): JPEG/PNG/WebP sniffed from content, ≤ 40 MP,
fully decoded and re-encoded (all metadata dropped), JPEG auto-oriented.
Avatar: centre square crop, ≤ 512 px, JPEG q85, alpha flattened onto
`#111318`. Comment image: longest side ≤ 1600 px, JPEG q82 (PNG kept when it
has transparency). Unattached comment images are purged after 24 h.

### Views

`POST /posts/:slug/views` ignores bot user agents (regex in
`service/community_text.go`; an empty UA is a bot) and counts at most one view
per (UTC day, post, `HMAC-SHA256(daily salt, ip + "\n" + ua)`). Raw IPs are
never stored for views; salts and dedupe rows older than yesterday are deleted
hourly, after which old hashes cannot be linked to anyone.

### Hourly purge

`CommunityJanitor` (started by `serve`, stopped with the shutdown context)
deletes expired member sessions, member tokens and OAuth states; view
salts/dedupe rows of days before yesterday; unattached comment images older
than 24 h (row and file).

### Admin API (`comments:moderate` — owner and editor)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/comments?status=pending\|published\|hidden\|deleted\|reported\|all&q&post&member_id&page&per_page≤100` | newest first → `{data: AdminComment[], meta, counts:{pending, reported}}` |
| PATCH | `/admin/comments/:id` | `{status: published\|hidden}` → AdminComment; audit `comment.approve` / `comment.hide` |
| DELETE | `/admin/comments/:id` | 204; audit `comment.delete` |
| POST | `/admin/comments/bulk` | `{action: approve\|hide\|delete, ids[1..100]}` → `{succeeded:[id], failed:[{id, message}]}` |
| GET | `/admin/comments/:id/history` | `[{body, edited_at}]` newest first |
| GET | `/admin/members?q&role&page&per_page≤100` | `q` containing `@` = exact e-mail (blind index), else display name contains → AdminMember[] |
| PATCH | `/admin/members/:id` | `{role?, banned_reason?, hide_comments?}` → AdminMember; audit `member.role_change {from,to}`, `member.ban`, `member.unban`, `member.hide_comments` |

`AdminComment {id, post:{slug,title}, parent_id, author:{id,display_name,role}|null, body, body_html, image, status, like_count, report_count, reports[≤10], created_at, edited_at, moderated_at, moderated_by:{kind,name}|null}`;
`AdminMember {id, display_name, email_masked, email? , email_verified, role, avatar_url, providers, comment_count, created_at, last_login_at, banned_at, banned_reason}`.
`email` is only present for actors with `users:manage` (owner); everyone
else gets `email_masked` (`s***@g***.com`). Audit metadata carries the member
id + display name, never member e-mails. The settings overview gains
`members: {google_enabled, require_verified_email, hold_first_comment,
turnstile_enabled, data_key_ids}`.

### Member data protection (threat model notes)

- **E-mails** are stored only as AES-256-GCM ciphertext (`nonce||ct`, AAD
  `member-email:<member id>`, so a ciphertext copied into another row does not
  decrypt) plus an HMAC-SHA256 blind index for lookups (normalized: trim, NFC,
  lower-case). A database dump alone does not reveal member e-mails; the keys
  live only in the api service variables (lose them = lose the e-mails).
- **Key rotation**: `MEMBER_DATA_KEY="2:<new>,1:<old>"` — new rows use the
  first key, every listed key still decrypts; rows keep their key id.
  `MEMBER_INDEX_KEY` cannot change without recomputing every index.
- **Passwords**: argon2id (m=19456 KiB, t=2, p=1) PHC strings; parameters are
  read from the hash and bounded; at most 4 hashes run at once; unknown e-mails
  spend a dummy verification; 10–128 characters, not in the embedded common
  password list (`internal/vault/common_passwords.txt`), not equal to the
  e-mail / its local part / the display name.
- **Tokens** (sessions, verify/reset/change/link, OAuth state + browser
  binding) are 32 random bytes; only SHA-256 is stored. Token payloads (new
  e-mail, Google link data) and the PKCE verifier are encrypted with an AAD
  bound to the row.
- **Google**: authorization code + PKCE S256 + state (single use, 10 min,
  bound to the `escoma_oauth` cookie) + nonce; the ID token is verified by
  go-oidc (JWKS signature, `iss`, `aud`, `exp`) and `email_verified` must be
  true. Google subjects are stored only as HMAC.
- **Logs** never contain member e-mails, tokens, passwords, Google subjects or
  ID tokens (member ids only). The access log keeps its usual client IP line.
- **Abuse controls**: per-IP / per-member / per-e-mail rate limits
  (in-process), honeypots, minimum compose time, link limit, duplicate check,
  first-comment hold, report threshold, optional Cloudflare Turnstile.

### Local Google sign-in with the stub provider (development only)

`cmd/oidcstub` is a tiny OpenID Connect provider for local testing and E2E.
It generates an RSA key at start and serves discovery + JWKS, an `/authorize`
form (any e-mail/name, choose `email_verified`, optional picture claim) and a
`/token` endpoint that checks the client secret and the PKCE verifier and
signs an RS256 ID token (`sub` = stable hash of the e-mail). It is a separate
binary and is never wired into `serve`.

```bash
go run ./cmd/oidcstub        # http://127.0.0.1:18090  (flags: -addr, -issuer, -client-id, -client-secret)
# api in another shell (APP_ENV must NOT be production; non-https issuers are rejected there):
OIDC_ISSUER_URL=http://127.0.0.1:18090 GOOGLE_CLIENT_ID=stub-client GOOGLE_CLIENT_SECRET=stub-secret \
WEB_BASE_URL=http://localhost:3000 go run ./cmd/server
```

Then click "Sign in with Google" on the web (it goes through the web proxy at
`/api/community/auth/google/start`). For automated E2E, append
`&auto_email=user@example.com&auto_name=Test%20User` (optional
`&auto_verified=false`, `&auto_picture=1`) to the stub `/authorize` URL the API
redirects to; the stub then redirects straight back with a code. With the
issuer overridden outside production, avatar downloads from the stub's own
host are allowed as well.

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
| `INDEXNOW_KEY` | empty | IndexNow key (8–128 `a-zA-Z0-9-`); with `WEB_BASE_URL`, changed post URLs are submitted to IndexNow |
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
| `MEMBER_DATA_KEY` | — (**required in production**) | AES-256-GCM key(s) for member e-mails / token payloads: one base64 32-byte key (id 1) or `id:base64[,id:base64…]` (first = primary). Unset outside production = random per boot (WARN; data unreadable after a restart) |
| `MEMBER_INDEX_KEY` | — (**required in production**) | base64 32-byte HMAC key for blind indexes (e-mail lookup, Google subject). Keep it stable |
| `MEMBER_SESSION_TTL` | `720h` | member session lifetime (1h–2160h) |
| `MEMBER_REQUIRE_VERIFIED_EMAIL` | `true` when an e-mail transport **and** `WEB_BASE_URL` are set, else `false` | gate comments/likes/reports/uploads on a verified e-mail; `true` without a transport is a config error |
| `MEMBER_HOLD_FIRST_COMMENT` | `true` | hold a new member's first comment for review (see comment rules) |
| `MEMBER_REGISTER_RATE_LIMIT` | `5/1h` | registrations per IP |
| `MEMBER_LOGIN_RATE_LIMIT` | `10/15m` | member logins per IP and per e-mail |
| `COMMENT_RATE_LIMIT` / `COMMENT_IP_RATE_LIMIT` | `6/1m` / `30/10m` | new comments per member / per IP |
| `COMMENT_IMAGE_MAX_MB` / `AVATAR_MAX_MB` | `5` / `5` | upload limits (1–20) |
| `TURNSTILE_SECRET` | empty (off) | Cloudflare Turnstile secret: token required on register, and on login after 3 failures per IP |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | empty (Google sign-in off) | both or neither; needs `WEB_BASE_URL` (redirect URI `${WEB_BASE_URL}/api/community/auth/google/callback`) |
| `OIDC_ISSUER_URL` | `https://accounts.google.com` | override **only** for the local stub (`cmd/oidcstub`); any override, and any non-https value, is rejected in production |

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
  + 00004: focus_keyword, canonical_url, noindex, og_media_id FK set null,
  og_image_url/alt/width/height
- `redirects` (00004: id, from_path **unique** (normalized), to_path NULL for 410,
  status_code CHECK `301|410` with `(status_code = 301) = (to_path IS NOT NULL)`,
  kind `manual|auto`, note, created_by FK set null, timestamps; index on to_path)
- `post_categories` (PK `(post_id, category_id)`, both FK cascade; index on category_id)
- `leads` (id, first_name, last_name, company, line_id, phone, email,
  preferred_channel CHECK, preferred_date date, preferred_time CHECK HH:MM,
  message, consent_at, status CHECK `new|contacted|qualified|closed|spam`, note,
  source_page, ip inet, user_agent, timestamps, deleted_at; indexes
  `(created_at DESC)` and `(status)` partial on `deleted_at IS NULL`)
- `goose_db_version` (goose)
- 00005 (community, additive; Down drops exactly these tables):
  - `members` (id, display_name 2–40, email_ciphertext + email_key_id,
    email_index **unique** (blind index), email_verified_at, password_hash
    argon2id or NULL = Google-only, password_changed_at, role CHECK
    `member|trusted|moderator|banned`, avatar_key, terms_version, consented_at,
    last_login_at, banned_at, banned_reason, timestamps)
  - `member_identities` (provider `google|line`, subject_hash; unique
    `(provider, subject_hash)` and `(member_id, provider)`)
  - `member_sessions` (token_hash unique, csrf_token, ip, user_agent,
    expires_at indexed, last_seen_at), `member_tokens` (purpose
    `verify_email|reset_password|change_email|link_google`, token_hash unique,
    encrypted payload, expires_at, used_at), `oauth_states` (state_hash PK,
    binding_hash, nonce, encrypted PKCE verifier, next_path, consent_version,
    expires_at)
  - `comments` (post_id FK cascade, parent_id → top-level comment, reply_to_id
    SET NULL, member_id SET NULL (= deleted account), body ≤ 2000, status
    `pending|published|hidden|deleted`, content_hash, like_count,
    report_count, edited_at, deleted_at, moderated_at / by_admin / by_member),
    `comment_edits`, `comment_images` (member_id cascade, comment_id unique SET
    NULL, storage_key unique), `comment_reports` / `comment_likes` (PK
    `(comment_id, member_id)`), `post_likes` (PK `(post_id, member_id)`)
  - `post_stats` (post_id PK: view_count, like_count, comment_count —
    maintained in the same transaction as the change; `comment_count` =
    published comments incl. replies), `view_salts` (day PK),
    `post_view_dedupe` (PK `(day, post_id, visitor_hash)`)
- trigger `set_updated_at()` on every table with `updated_at`
