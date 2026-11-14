# ECOMACROBIZ — Deploy runbook (Railway + Cloudflare)

> **สรุปสำหรับบอส (ภาษาไทย)**
>
> 1. **Push โค้ด** ขึ้น GitHub repo private `Chayanon-Pond/ecomacrobiz-web` (remote `origin` ตั้งไว้แล้ว — แค่ `git push -u origin main`)
> 2. **Railway** (region Singapore): สร้าง project → เพิ่ม Postgres → เพิ่ม service `api` (root `/api`) และ `web` (root `/web`) → ใส่ env ตามตารางข้อ 2.6 → ใส่ volume ให้ api ที่ `/data/media` + `RAILWAY_RUN_UID=0` → เปิด domain `*.up.railway.app` ทดสอบ
> 3. **Seed บทความ 9 โพสต์** จากเครื่องเรา (ข้อ 3) แล้วยิง revalidate
> 4. **QA บน staging** ตาม checklist ข้อ 4 (หน้าเว็บ, ฟอร์ม → lead + อีเมล, admin, redirect, PageSpeed)
> 5. **⚠️ DNSSEC เปิดอยู่ที่ Wix** — ต้อง **ปิด DNSSEC ที่ Wix ก่อน แล้วรอ ≥ 48 ชม.** ค่อยเปลี่ยน nameserver ไม่งั้นเว็บ **และอีเมล Microsoft 365** จะล่มทั้งโดเมน
> 6. **Cloudflare**: เพิ่มโดเมน → สร้าง DNS record ให้ครบตาม `docs/dns-snapshot-2026-11-12.txt` (MX/TXT/CNAME/SRV ของ Microsoft 365 เป็น **DNS only สีเทา**) → ชี้ `@`, `www`, `api` ไป Railway → SSL **Full** → เปลี่ยน nameserver ที่ Wix → ทดสอบส่ง/รับอีเมล
> 7. **ห้ามยกเลิก** Wix plan / โดเมน จนกว่าระบบใหม่เสถียร ≥ 30 วัน (โดเมนยังจดทะเบียนกับ Wix ต้องต่ออายุที่ Wix)
> 8. Railway **Hobby บล็อก SMTP** → ใช้ `RESEND_API_KEY` (Resend) หรืออัปเกรดเป็น Pro ถ้าจะใช้ SMTP ของ Microsoft 365

Facts this runbook is based on (verified 2026-11-12):

| Item | Value |
| --- | --- |
| Domain registrar | **Wix.com Ltd.** (renewal stays at Wix unless transferred) |
| Current DNS host | Wix (`ns0.wixdns.net`, `ns1.wixdns.net`) |
| **DNSSEC** | **ON** — DS `48517 8 2 b745…35c2` at the registry, TTL 86400 |
| Business e-mail | **Microsoft 365** (MX `ecomacrobiz-com.mail.protection.outlook.com`) |
| Exact current records | `docs/dns-snapshot-2026-11-12.txt` (re-run `bash scripts/dns-snapshot.sh` right before cutover) |
| GitHub repo | `https://github.com/Chayanon-Pond/ecomacrobiz-web.git` (private, remote `origin` already set) |
| Hosting | Railway, region **Southeast Asia (Singapore)** = `asia-southeast1-eqsg3a` |
| Railway layout | project `ecomacrobiz` → `Postgres` (plugin) + `api` (`/api`, Dockerfile) + `web` (`/web`, Dockerfile) |
| Public hostnames (final) | `www.ecomacrobiz.com` (canonical) and `ecomacrobiz.com` (301 → www) → web; `api.ecomacrobiz.com` → api (media + API) |

```
Browser ──HTTPS──> Cloudflare (proxy) ──> Railway edge ──> web  (Next.js, :3000)
                                                    │        │  API_URL = http://api.railway.internal:8080   (private)
                                                    │        └─ /_next/image fetches https://api.ecomacrobiz.com/media/**
                                                    └──────> api  (Go, :8080) ──> Postgres (private)
                                                               │  volume /data/media (uploads)
                                                               └─ WEB_REVALIDATE_URL = http://web.railway.internal:3000/api/revalidate
```

---

## 1. GitHub (private repo)

The local repo already has one commit on `main` and the remote `origin`.

```bash
cd D:\escoma
git remote -v                      # origin  https://github.com/Chayanon-Pond/ecomacrobiz-web.git
git log --oneline -1
git push -u origin main            # sign in with the GitHub account that owns the repo
```

Check on github.com that the repo is **Private** and that no `.env` files are
in it (`api/.env`, `web/.env.local` are gitignored; only `*.env.example` are
committed).

## 2. Railway project

### 2.1 Create project + Postgres

1. railway.com → sign in with GitHub → **New Project** → **Deploy PostgreSQL**.
   Name the project `ecomacrobiz`.
2. Postgres service → **Settings → Region**: *Southeast Asia (Singapore)*.
3. Postgres → **Backups** tab: enable **Daily** (kept 6 days) + **Weekly** backups.
4. (Only for seeding from your PC, step 3) Postgres → **Settings → Networking →
   Public Access** creates a TCP proxy and the variable `DATABASE_PUBLIC_URL`.
   You can remove the public access again after seeding.

### 2.2 Install the Railway GitHub app

**New → GitHub Repo** → *Configure GitHub App* → give it access to
**only** `Chayanon-Pond/ecomacrobiz-web`.

### 2.3 Service `api`

**New → GitHub Repo → ecomacrobiz-web**, then in the new service:

| Setting (service → Settings) | Value |
| --- | --- |
| Service name | `api` (the private hostname becomes `api.railway.internal`) |
| Source → Root Directory | `/api` |
| Source → Branch | `main` |
| Config-as-code file path | `/api/railway.json` (must be the absolute path; it is not picked up from the root dir automatically) |
| Region | Southeast Asia (Singapore) |
| Builder | Dockerfile (`api/Dockerfile`) — from railway.json |
| Watch paths | `/api/**` — from railway.json (a web-only change does not redeploy api) |
| Healthcheck path | `/healthz` (timeout 120 s) — from railway.json |
| Restart policy | On failure, max 10 retries — from railway.json |
| Replicas | 1 (a volume cannot be used with replicas; rate limits are in-memory) |

**Volume**: right-click the service (or **+ New → Volume**) → attach to `api`
→ mount path **`/data/media`**. Uploaded images live here (back it up in the
volume's **Backups** tab too). The image runs as uid 65532 and Railway volumes
are root-owned, so **`RAILWAY_RUN_UID=0` is required** — without it the API
refuses to start with `media dir "/data/media" is not writable`.

Railway notes: Railway marks *Config as Code* as deprecated in favour of
*Infrastructure as Code* (existing files keep working). If the dashboard no
longer offers a config file path, type the same values from the tables above
into the service settings by hand — nothing else depends on the file.

### 2.4 Service `web`

Same repo again (**New → GitHub Repo**):

| Setting | Value |
| --- | --- |
| Service name | `web` (private hostname `web.railway.internal`) |
| Root Directory | `/web` |
| Config-as-code file path | `/web/railway.json` |
| Region | Southeast Asia (Singapore) |
| Builder / watch paths | Dockerfile (`web/Dockerfile`), `/web/**` |
| Healthcheck path | `/api/healthz` (does not depend on the API) |
| Restart policy | On failure, max 10 |

### 2.5 Shared variable

Project → **Settings → Shared Variables** → add
`REVALIDATE_SECRET` = output of `openssl rand -hex 32` (Git Bash has openssl).
Both services reference it as `${{shared.REVALIDATE_SECRET}}`.

### 2.6 Environment variables

Paste with the service's **Variables → RAW Editor**. `${{...}}` are Railway
reference variables. "Staging" = the value while testing on `*.up.railway.app`;
"Prod" = the value after the Cloudflare cutover (step 5.6).

**api**

| Name | Staging value | Prod value | Secret? | How to get it |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | same | yes | reference (private network) |
| `APP_ENV` | `production` | same | no | enforces COOKIE_SECURE + CORS |
| `PORT` | `8080` | same | no | pinned so `API_URL` is predictable |
| `LOG_LEVEL` | `info` | same | no | |
| `MIGRATE_ON_START` | `true` | same | no | goose migrations on every boot (single replica) |
| `MEDIA_DIR` | `/data/media` | same | no | = volume mount path |
| `RAILWAY_RUN_UID` | `0` | same | no | volume write permission (see 2.3) |
| `PUBLIC_BASE_URL` | `https://<api>.up.railway.app` | `https://api.ecomacrobiz.com` | no | stored into each uploaded media URL **at upload time** |
| `CORS_ALLOWED_ORIGINS` | `https://www.ecomacrobiz.com,https://<web>.up.railway.app` | `https://www.ecomacrobiz.com` | no | admin Origin check; exact origins, no `/` |
| `TRUSTED_PROXIES` | `fd00::/8,10.0.0.0/8,100.64.0.0/10` | same | no | Railway private network (web → api) |
| `HSTS_ENABLED` | `true` | same | no | |
| `COOKIE_SECURE` | `true` | same | no | |
| `WEB_REVALIDATE_URL` | `http://${{web.RAILWAY_PRIVATE_DOMAIN}}:${{web.PORT}}/api/revalidate` | same | no | private network |
| `REVALIDATE_SECRET` | `${{shared.REVALIDATE_SECRET}}` | same | yes | `openssl rand -hex 32` |
| `ADMIN_EMAIL` | e.g. `admin@ecomacrobiz.com` | same | no | real mailbox you control |
| `ADMIN_PASSWORD` | 12–72 chars | same | **yes** | `openssl rand -base64 24` (store in your password manager) |
| `ADMIN_NAME` | `Admin` | same | no | |
| `SMTP_FROM` | `ECOMACROBIZ Website <no-reply@ecomacrobiz.com>` | same | no | sender (Resend or SMTP) |
| `SMTP_TO` | `sales@ecomacrobiz.com` (comma-separated) | same | no | who receives new leads |
| `RESEND_API_KEY` | `re_...` | same | **yes** | resend.com → API Keys (see 2.7) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` | empty | (only on Railway **Pro**) | password yes | e.g. `smtp.office365.com` / `587` |
| `LINE_CHANNEL_ACCESS_TOKEN` | optional | | **yes** | LINE Developers → Messaging API channel → long-lived token |
| `LINE_TO` | optional | | no | user/group id to push to |

Optional tuning (defaults are fine): `SESSION_TTL=24h`, `CONTACT_RATE_LIMIT=5/10m`,
`LOGIN_RATE_LIMIT=10/15m`, `MAX_UPLOAD_MB=8`, `SHUTDOWN_TIMEOUT=20s`, `COOKIE_DOMAIN` (leave empty).

Admin v2 (all optional; defaults are safe):

| Name | Value | Notes |
| --- | --- | --- |
| `WEB_BASE_URL` | `https://<web>.up.railway.app`, later `https://www.ecomacrobiz.com` | origin used in invite/reset e-mails and IndexNow. Unset ⇒ no invite e-mails (the admin UI always shows a copyable link anyway) |
| `INVITE_TTL` | `72h` | invite + password-reset link lifetime |
| `SCHEDULER_INTERVAL` | `60s` | how often scheduled posts are published (min 5s) |
| `MEDIA_MAX_DIMENSION` | `2560` | uploads are downscaled to this longest side |
| `INDEXNOW_KEY` | empty (off) | 8–128 `[A-Za-z0-9-]`; set the **same** value on the web service so `/<key>.txt` is served. Enable only after the Cloudflare cutover (step 5.6) |

**Migration note (Admin v2).** The api applies `00003_admin_v2` and `00004_seo` on boot (`MIGRATE_ON_START`).
Both are additive: existing admin users become role `owner`, posts/leads/media keep every value, new columns get
defaults. Verified on a copy of a prod-like DB (old binary → seed → new binary up → down×2 → up, checksums equal;
the old binary still serves the DB after `down`). Rollback = redeploy the previous commit; only run
`server migrate down` (twice) if you must also roll the schema back — that drops audit logs, lead timelines,
invites and redirects created since. Take a Railway Postgres backup before deploying.

After the admin exists and you have logged in once, you may delete
`ADMIN_EMAIL` + `ADMIN_PASSWORD` (both together) — an existing password is
never overwritten anyway unless `ADMIN_RESET_PASSWORD=true`.

**web**

| Name | Staging value | Prod value | Build/Run | Secret? | Notes |
| --- | --- | --- | --- | --- | --- |
| `PORT` | `3000` | same | run | no | pinned for `WEB_REVALIDATE_URL` |
| `API_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` | same | run | no | private; never exposed to browsers |
| `REVALIDATE_SECRET` | `${{shared.REVALIDATE_SECRET}}` | same | run | yes | must equal the api value |
| `NEXT_PUBLIC_SITE_URL` | `https://www.ecomacrobiz.com` | same | **build** | no | canonical/sitemap/JSON-LD + apex→www redirect + HSTS. Set it to www from day one (staging pages then canonicalise to the real site, so staging is not indexed as a duplicate). |
| `NEXT_PUBLIC_MEDIA_ORIGIN` | `https://<api>.up.railway.app` | `https://api.ecomacrobiz.com` | **build** | no | `images.remotePatterns` for `/media/**` — must equal api `PUBLIC_BASE_URL` |
| `CLIENT_IP_HEADER` | `x-real-ip` | `cf-connecting-ip` | run | no | real visitor IP for the contact rate limit |
| `INDEXNOW_KEY` | empty | same as api (after cutover) | run | no | serves `/<key>.txt` for IndexNow; empty = off |

`NEXT_PUBLIC_*` are inlined by `next build` (they are `ARG`s in `web/Dockerfile`),
so changing them needs a **redeploy** (Railway rebuilds automatically when you
save variables, otherwise *Deployments → Redeploy*). `API_URL` is deliberately
not a build arg: the private network does not exist during builds, so the build
prerenders the bundled posts with a 5-minute lifetime and the running server
refreshes them from the API.

### 2.7 E-mail transport for lead notifications (important)

Railway **Free/Trial/Hobby block outbound SMTP** ("SMTP is only available on
the Pro plan and above"). Choose one:

- **A. Resend (recommended on Hobby)** — resend.com → add domain
  `ecomacrobiz.com` (it gives DKIM/SPF/MX records for a `send.` subdomain; add
  them in Cloudflare **after** the cutover, or in Wix DNS before it). Do **not**
  create a second SPF record on the apex — there must be exactly one
  `v=spf1` TXT on `ecomacrobiz.com`. Then set `RESEND_API_KEY`, `SMTP_FROM`
  (an address on the verified domain), `SMTP_TO`.
- **B. Microsoft 365 SMTP** (needs Railway **Pro**): `SMTP_HOST=smtp.office365.com`,
  `SMTP_PORT=587`, a licensed mailbox with *Authenticated SMTP* enabled in the
  M365 admin centre. Microsoft disables SMTP AUTH basic auth **by default for
  existing tenants at the end of December 2026** (admins can re-enable it; final
  removal to be announced in 2027) — so A is the safer long-term choice.

Until one is configured, leads are still stored (see /admin → Leads) and the
API logs `email notifier disabled`.

### 2.8 Railway domains (staging)

`api` → Settings → Networking → **Generate Domain** → note `https://<api>.up.railway.app`.
`web` → same → `https://<web>.up.railway.app`. Put both into the variables
above (`PUBLIC_BASE_URL`, `NEXT_PUBLIC_MEDIA_ORIGIN`, `CORS_ALLOWED_ORIGINS`) and
redeploy both services.

Deploy order the first time: Postgres → api (wait for green; logs show
`goose: successfully migrated` and `admin bootstrap ... created`) → web.

Verify:

```bash
curl -s https://<api>.up.railway.app/healthz        # {"db":"ok","status":"ok"}
curl -s https://<web>.up.railway.app/api/healthz    # {"status":"ok"}
```

## 3. Seed the 9 blog posts + bootstrap admin

The admin is created automatically on the api's first boot from
`ADMIN_EMAIL`/`ADMIN_PASSWORD` (log line `admin bootstrap ... outcome=created`).
The api image is distroless (no shell), so one-off commands run from your PC
against the database's public URL — seeding and, if ever needed, `create-admin`.

Seed from your PC (Go installed). Copy `DATABASE_PUBLIC_URL` from
Postgres → Variables (step 2.1/4):

```powershell
# PowerShell, from D:\escoma\api
$env:DATABASE_URL = "<paste DATABASE_PUBLIC_URL>"
go run ./cmd/server seed-posts --file ../web/src/content/posts/posts.json
#   -> log shows posts_changed=9 (re-running later is a no-op: posts_unchanged=9)
# optional, only if the admin was not bootstrapped:
# $env:ADMIN_EMAIL="admin@ecomacrobiz.com"; $env:ADMIN_PASSWORD="<from password manager>"
# go run ./cmd/server create-admin
Remove-Item Env:DATABASE_URL
```

```bash
# Git Bash equivalent
cd /d/escoma/api
DATABASE_URL='<paste DATABASE_PUBLIC_URL>' go run ./cmd/server seed-posts --file ../web/src/content/posts/posts.json
```

The seeder does not call the web webhook, so refresh the web cache once:

```bash
curl -s -X POST https://<web>.up.railway.app/api/revalidate \
  -H "x-revalidate-secret: <REVALIDATE_SECRET>" -H "Content-Type: application/json" \
  -d '{"tags":["posts"]}'                      # {"revalidated":true,"tags":["posts"]}
```

Then remove the Postgres public access (Settings → Networking) unless you need it.

## 4. Staging QA checklist (`https://<web>.up.railway.app`)

- [ ] Pages load, no console errors: `/`, `/purpose`, `/solutions`, `/gallery`,
      `/how-we-work`, `/contact`, `/privacy`, `/knowledge`, one article, one category, `/knowledge/feed.xml`.
- [ ] `/sitemap.xml` + `/robots.txt` use `https://www.ecomacrobiz.com` URLs.
- [ ] `/knowledge` lists 9 posts from the API (API logs show `GET /api/v1/posts`).
- [ ] Contact form: submit a real test → row in **/admin → Leads** → e-mail
      (and LINE, if set) arrives at `SMTP_TO`. Reply-To = the visitor's address.
- [ ] Contact validation: empty submit shows Thai field errors.
- [ ] Admin: `/admin` → login → create a draft post with a cover upload →
      publish → visible on `/knowledge` immediately → delete it. Logout.
- [ ] Uploaded image URL starts with `PUBLIC_BASE_URL/media/` and the article
      cover is served via `/_next/image?url=...` (optimized).
- [ ] Response headers (`curl -sI https://<web>.up.railway.app/`): `strict-transport-security`,
      `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`; `/admin` has `x-robots-tag: noindex`.
- [ ] Legacy redirects (every line must say `301` and the new path):

```bash
W=https://<web>.up.railway.app
for p in /blank /blank-4 /blank-2 /blank-3 /blank-5 /blog /blog-feed.xml \
         /blog/categories/brand-insight /blog/page/2 /post/branding-vs-marketing \
         /post/some-unknown-slug /blog/hashtags/x; do
  curl -s -o /dev/null -w "%{http_code} $p -> %{redirect_url}\n" "$W$p"; done
# Thai legacy slug (percent-encoded):
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" \
  "$W/post/%E0%B8%AA%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%87%E0%B8%84%E0%B8%A7%E0%B8%B2%E0%B8%A1%E0%B8%88%E0%B8%94%E0%B8%88%E0%B8%B3%E0%B9%81%E0%B8%9A%E0%B8%A3%E0%B8%99%E0%B8%94%E0%B9%8C"
# Apex -> www (simulated with a Host header):
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" -H "Host: ecomacrobiz.com" "$W/purpose"
```

- [ ] **PageSpeed Insights** (pagespeed.web.dev), **Mobile**, for `/`,
      `/knowledge`, one article, `/contact`. Targets: Performance ≥ 90, SEO/BP/A11y ≥ 95.
      Run twice (first run warms the cache). Record the numbers.
- [ ] Unknown URL `/does-not-exist` → 404 page with status 404.

### 4.1 Admin v2 checks after deploying `Develop` → `main`

1. api logs: `goose: successfully migrated database to version: 4`, `admin bootstrap … outcome=exists`, scheduler started.
2. Log in at `/admin` with the existing admin → user menu shows **เจ้าของระบบ (owner)**; `/admin/users` lists you as owner.
3. `/admin/audit` shows your `auth.login`.
4. Open a seeded post in the editor → change nothing → no "unsaved changes"; the public article is unchanged.
5. Create a test draft, schedule it 2 minutes ahead → it appears on `/knowledge` within ~1 minute after the time;
   then unpublish it (choose 410) → its URL answers **410**; delete it.
6. `curl -sI https://<web>/knowledge/<legacy-thai-slug-percent-encoded>` → **301** to the new slug.
7. Invite yourself a second address as `viewer` (copy link) → accept in a private window → confirm you can't see
   Users/Audit and the API answers 403 → deactivate it from `/admin/users`.

## 5. Cloudflare cutover

### 5.0 Before you start (do these 2–3 days ahead)

1. **Disable DNSSEC at Wix** (critical). Wix dashboard → **Domains** →
   `ecomacrobiz.com` → **⋯ Domain Actions** → **Manage DNS Records** /
   *Advanced* → **DNSSEC** → turn **off**. Then wait at least **48 hours** (DS TTL
   is 86400 s plus registry delay). Check it is gone:
   `curl -s -H 'accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=ecomacrobiz.com&type=DS"`
   must return no `Answer`. **Changing nameservers while the old DS is still
   published makes the whole domain — website AND Microsoft 365 e-mail —
   unresolvable for validating resolvers.** (If the Wix UI has no DNSSEC switch,
   contact Wix support and ask them to remove the DS record.)
2. Re-run the snapshot and compare with `docs/dns-snapshot-2026-11-12.txt`:
   `bash scripts/dns-snapshot.sh`. Also open **Wix → Manage DNS Records** and
   compare line by line — Wix may hold records the script cannot guess.
3. Staging QA (step 4) is fully green.

### 5.1 Add the site to Cloudflare

dash.cloudflare.com → **Add a domain** → `ecomacrobiz.com` → Free plan →
*Quick scan for DNS records*. Cloudflare imports what it finds — **do not trust
the scan**; make the zone match the table below exactly before changing
nameservers.

### 5.2 DNS records to (re)create

Microsoft 365 / Google (keep exactly, **DNS only = grey cloud**; MX/TXT/SRV cannot be proxied anyway):

| Type | Name | Value | Priority / notes | Proxy |
| --- | --- | --- | --- | --- |
| MX | `@` | `ecomacrobiz-com.mail.protection.outlook.com` | priority **10** | DNS only |
| TXT | `@` | `v=spf1 include:spf.protection.outlook.com -all` | the ONLY SPF record (merge Resend/others into it if ever needed) | — |
| TXT | `@` | `MS=ms43360591` | Microsoft 365 domain verification | — |
| TXT | `@` | `google-site-verification=GEJrcDxp5Bo6sfBe0O86RU6_pbwJMkzFptiXRjDN7Xs` | Google (Search Console / Workspace) | — |
| TXT | `@` | `google-site-verification=k32oOSx6rZ3piMQxZZSsfduKFeEKesKL8J9xQ7U7X_0` | Google | — |
| CNAME | `autodiscover` | `autodiscover.outlook.com` | Outlook auto-configuration | **DNS only** |
| CNAME | `lyncdiscover` | `webdir.online.lync.com` | Teams/Skype legacy | **DNS only** |
| CNAME | `sip` | `sipdir.online.lync.com` | Teams/Skype legacy | **DNS only** |
| CNAME | `enterpriseregistration` | `enterpriseregistration.windows.net` | Entra device registration | **DNS only** |
| CNAME | `enterpriseenrollment` | `enterpriseenrollment.manage.microsoft.com` | Intune enrollment | **DNS only** |
| SRV | `_sip._tls` | priority 100, weight 1, port **443**, target `sipdir.online.lync.com` | | — |
| SRV | `_sipfederationtls._tcp` | priority 100, weight 1, port **5061**, target `sipfed.online.lync.com` | | — |

Not present today (nothing to copy): DKIM `selector1/selector2._domainkey`,
`_dmarc`, `msoid`, `_autodiscover._tcp` SRV, CAA. (No CAA = any CA may issue,
so Railway's Let's Encrypt and Cloudflare certificates work.) Recommended
*after* launch, as a separate change: enable DKIM in Microsoft Defender
(Email & collaboration → Policies → DKIM → `ecomacrobiz.com`: it shows the two
`selector1-…/selector2-…._domainkey` CNAME values to add, DNS only), then add
`_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<you>@ecomacrobiz.com`.

Website (replace the Wix ones — **do not** import the Wix `A @ 185.230.63.107/171/186` or `CNAME www cdn3.wixdns.net`):

1. Railway `web` → Settings → Networking → **Custom Domain** → add
   `www.ecomacrobiz.com`, then `ecomacrobiz.com`. Railway `api` → add
   `api.ecomacrobiz.com`. For each, Railway shows a **CNAME target**
   (`xxxx.up.railway.app`) and a **TXT verification record** — both are required
   (without the TXT the domain answers 404).
2. In Cloudflare:

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| CNAME | `www` | `<target Railway gave for www>` | **Proxied** (orange) |
| CNAME | `@` | `<target Railway gave for the apex>` (Cloudflare flattens a CNAME at the apex automatically) | **Proxied** |
| CNAME | `api` | `<target Railway gave for api>` | **Proxied** |
| TXT | as shown by Railway (one per custom domain) | as shown | — |

Hobby plan allows 2 custom domains per service (web uses exactly 2).

### 5.3 Cloudflare settings

- **SSL/TLS → Overview → Full.** Railway's docs say *Full (strict) will not
  work as intended* behind the proxy and *Flexible* causes redirect loops. Use
  **Full**. (Once Railway shows the certificates as issued you may *try*
  Full (strict) and roll back to Full at the first 525/526 error.)
- SSL/TLS → Edge Certificates: **Always Use HTTPS = on**, Minimum TLS 1.2,
  Automatic HTTPS Rewrites = on. Leave Cloudflare HSTS off (the app already
  sends `max-age=31536000`).
- **Speed → Rocket Loader = OFF**; **Scrape Shield → Email Address Obfuscation
  = OFF** (both rewrite HTML and break React hydration). Auto Minify off if shown.
- **Security → Bots → Bot Fight Mode = OFF** (it can challenge the server-side
  image fetches from Railway to `api.ecomacrobiz.com/media/*` and the healthchecks).
- **Caching → Cache Rules** (in this order):
  1. *Bypass admin + API*: `(http.request.uri.path wildcard "/admin*") or (http.request.uri.path wildcard "/api/*")`
     → **Bypass cache**. Also add `http.host eq "api.ecomacrobiz.com" and not starts_with(http.request.uri.path, "/media/")` → Bypass.
  2. *Static*: `starts_with(http.request.uri.path, "/_next/static/")` → Eligible for cache, Edge TTL: respect origin (immutable, 1 year).
  3. *Media*: host `api.ecomacrobiz.com` and path starts with `/media/` → Eligible for cache, respect origin.
  Do **not** "cache everything" for HTML: Next.js revalidation (publishing a
  post) does not purge Cloudflare.
- Optional *Rules → Redirect Rules*: `ecomacrobiz.com/*` → `https://www.ecomacrobiz.com/${1}` 301
  (the app already does this; the edge rule just saves a round trip).

### 5.4 Lower TTLs, then switch nameservers at Wix

1. In Wix DNS (still live) lower TTLs of `www` and `@` to the minimum (e.g. 1 h → 300 s if allowed) a day before.
2. Cloudflare shows two nameservers, e.g. `xxx.ns.cloudflare.com`, `yyy.ns.cloudflare.com`.
3. Wix dashboard → **Domains** → `ecomacrobiz.com` → **⋯ Domain Actions** →
   **Manage DNS Records** → **Name Servers (NS)** → **Edit** → replace
   `ns0.wixdns.net` / `ns1.wixdns.net` with the two Cloudflare nameservers → save.
   (Wix may say the domain is "pointed to an external site"; the Wix site stops
   serving on this domain — expected. Do not disconnect/cancel anything else.)
4. Pick a quiet time (Thai evening / weekend).

### 5.5 Propagation checks

```bash
nslookup -type=NS ecomacrobiz.com 1.1.1.1        # Cloudflare nameservers
nslookup -type=NS ecomacrobiz.com 7.8.7.8
nslookup -type=MX ecomacrobiz.com 1.1.1.1        # still ...mail.protection.outlook.com
nslookup -type=TXT ecomacrobiz.com 7.8.7.8       # SPF + MS= + 2x google-site-verification
bash scripts/dns-snapshot.sh /d/escoma/docs/dns-after-cutover.txt   # diff with the original
curl -sI https://www.ecomacrobiz.com/ | grep -i "server\|cf-ray\|strict"
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://ecomacrobiz.com/purpose   # 301 -> www
```

Cloudflare marks the zone **Active** when it sees its nameservers (minutes to 24 h).
Also check https://dnschecker.org for NS/MX worldwide.

### 5.6 Switch the app to the final hostnames

1. api: `PUBLIC_BASE_URL=https://api.ecomacrobiz.com`, `CORS_ALLOWED_ORIGINS=https://www.ecomacrobiz.com`.
2. web: `NEXT_PUBLIC_MEDIA_ORIGIN=https://api.ecomacrobiz.com`, `CLIENT_IP_HEADER=cf-connecting-ip` → redeploy.
3. Remove the web service's `*.up.railway.app` domain (Settings → Networking) so
   nobody can bypass Cloudflare and spoof `cf-connecting-ip`. Keep the api
   railway domain only if media uploaded during staging still points to it.
4. Re-run the redirect loop from step 4 against `https://www.ecomacrobiz.com`.

### 5.7 Verify e-mail BEFORE cancelling or changing anything else

- [ ] From an outside account (Gmail) send to `<someone>@ecomacrobiz.com` → arrives.
- [ ] Reply from Outlook to Gmail → arrives, not in spam; in Gmail *Show original* says `SPF: PASS`.
- [ ] Outlook desktop/mobile still connect (autodiscover), Teams sign-in works.
- [ ] https://mxtoolbox.com/SuperTool.aspx → `mx:ecomacrobiz.com` and `spf:ecomacrobiz.com` green.
- [ ] Website contact form → lead e-mail arrives.

### 5.8 Re-enable DNSSEC (after 7 stable days)

Cloudflare → DNS → Settings → **Enable DNSSEC** → it shows a DS record → add it
at Wix (Domains → DNSSEC / or Wix support). Verify with the DS query in 5.0.

## 6. Rollback

- **Website broken, e-mail fine**: in Cloudflare change `www` and `@` back to
  Wix — `CNAME www cdn3.wixdns.net` (DNS only) and `A @ 185.230.63.107`,
  `185.230.63.171`, `185.230.63.186` (DNS only). Takes effect in minutes (proxied
  records have a 300 s TTL). The Wix site must still be published.
- **Anything wrong with DNS/e-mail**: Wix → Name Servers → set back to
  `ns0.wixdns.net` and `ns1.wixdns.net`. The Wix zone still has all old records
  (do not delete them in Wix). NS changes take up to 24–48 h (NS TTL 86400).
- Never re-enable DNSSEC at Wix while nameservers point to Cloudflare (or vice versa).

**Do not cancel the Wix premium plan, the Wix site, or touch the domain until
the new site has been stable for at least 30 days** (all redirects verified,
Search Console shows no coverage drop, e-mail healthy). The **domain
registration stays at Wix** — keep auto-renew on and the payment method valid.
Optional later: transfer the registration to Cloudflare Registrar (at-cost
pricing): unlock the domain + get the auth/EPP code in Wix, initiate the
transfer in Cloudflare → Domain Registration → Transfer; it adds 1 year,
requires the domain to be > 60 days since registration/last transfer, and
DNSSEC must be handled as in 5.0/5.8.

## 7. Post-launch

1. **Google Search Console**: the apex already has two `google-site-verification`
   TXT records, so a property probably exists — check with the Google account
   that owns it. Otherwise add a **Domain property** `ecomacrobiz.com` → copy the
   TXT → add it in Cloudflare (`@`, TXT) → Verify.
2. Sitemaps → submit `https://www.ecomacrobiz.com/sitemap.xml`. RSS: `/knowledge/feed.xml`.
3. Weekly for 4 weeks: *Pages* (Not found 404, Redirect, Crawled-not-indexed),
   fix any old Wix URL that 404s by adding it to `legacyRedirects` in `web/next.config.ts`.
4. Railway: Project → **Settings → Usage alerts / spend limit**; service →
   *Observability* for logs; Postgres **Backups** (daily + weekly) and the api
   **volume backups**. Test one restore into a new environment once.
5. Uptime monitor (e.g. UptimeRobot / Better Stack free) on
   `https://www.ecomacrobiz.com/api/healthz` and `https://api.ecomacrobiz.com/healthz`
   (Railway only uses healthchecks during deploys).
6. Legal sign-off on `/privacy`, then remove its `noindex` and add it to the sitemap.
7. Check direct-API spoofing once: `curl -s -X POST https://api.ecomacrobiz.com/api/v1/contact -H "X-Forwarded-For: 1.2.3.4" ...`
   should not store `1.2.3.4` as the lead IP (if it does, tighten `TRUSTED_PROXIES`).

## Appendix — local production test (Docker)

```bash
# Postgres + api + web prod image (web on http://localhost:3300)
REVALIDATE_SECRET=local-test-secret WEB_REVALIDATE_URL=http://web:3000/api/revalidate \
  docker compose --profile web up -d --build
# If Windows reserved port 55432: add DB_HOST_PORT=15432
docker compose --profile web down          # never add -v (it deletes the dev database)
```
