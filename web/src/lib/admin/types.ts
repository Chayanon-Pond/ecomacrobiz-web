/**
 * Shapes of the Go admin API (api/README.md, "Admin API v2"). Snake_case on
 * the wire. Keep in sync with api/internal/http/handlers/dto*.go.
 */
import type { Permission, Role } from "./permissions";

export type { Permission, Role };

export type UserRef = { id: string; name: string; email: string };

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

/** GET /auth/me, POST /auth/login, POST /auth/tokens/accept */
export type SessionPayload = { user: AdminUser; permissions: Permission[]; csrf_token: string };

export type PageMeta = { page: number; per_page: number; total: number; total_pages: number };
export type ListResponse<T> = { data: T[]; meta: PageMeta };
export type DataResponse<T> = { data: T };

/* ---------------- posts ---------------- */

export type Cover = { url: string; alt: string; width: number; height: number };
export type CategoryRef = { slug: string; name: string; name_th: string };
export type Category = CategoryRef & { description: string; post_count: number };

export type PostStatus = "draft" | "published" | "scheduled";
export type PostSort = "updated_desc" | "updated_asc" | "published_desc" | "published_asc" | "title_asc";

export type PostSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover: Cover | null;
  categories: CategoryRef[];
  author: string;
  /** For scheduled posts: the time the scheduler will publish it. */
  published_at: string | null;
  updated_at: string;
  reading_minutes: number;
  featured: boolean;
  seo_title: string;
  seo_description: string;
  status: PostStatus;
  created_by: UserRef | null;
  canonical_url: string;
  noindex: boolean;
  og_image: Cover | null;
};

export type Post = PostSummary & {
  body_markdown: string;
  legacy_slugs: string[];
  cover_media_id?: string | null;
  focus_keyword: string;
  og_media_id?: string | null;
};

export type PostInput = {
  slug: string;
  title: string;
  excerpt: string;
  body_markdown: string;
  cover_media_id?: string | null;
  cover: Cover | null;
  categories: string[];
  author: string;
  status: PostStatus;
  published_at?: string | null;
  featured: boolean;
  reading_minutes?: number | null;
  seo_title: string;
  seo_description: string;
  focus_keyword: string;
  canonical_url: string;
  noindex: boolean;
  og_media_id?: string | null;
  og_image: Cover | null;
  /** Only used when this update unpublishes a published post: null/"" => 410 Gone, path/URL => 301. */
  redirect_to?: string | null;
};

export type SlugCheck = { slug: string; valid: boolean; available: boolean; suggestion: string };

export type BulkPostAction = "publish" | "unpublish" | "delete";
export type BulkResult = { succeeded: string[]; failed: { id: string; message: string }[] };

/* ---------------- media ---------------- */

export type Media = {
  id: string;
  url: string;
  original_name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  alt: string;
  created_at: string;
  uploaded_by: UserRef | null;
  usage_count: number;
};

export type MediaUsage = {
  post_id: string;
  title: string;
  slug: string;
  status: PostStatus;
  kind: "cover" | "body" | "og";
};

export type MediaDetail = Media & { usage: MediaUsage[] };

/* ---------------- leads ---------------- */

export type LeadStatus = "new" | "contacted" | "qualified" | "closed" | "spam";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "closed", "spam"];
export type Channel = "email" | "line" | "phone";

export type Lead = {
  id: string;
  first_name: string;
  last_name: string;
  company: string;
  line_id: string;
  phone: string;
  email: string;
  preferred_channel: Channel;
  preferred_date: string | null;
  preferred_time: string | null;
  message: string;
  consent_at: string | null;
  status: LeadStatus;
  note: string;
  source_page: string;
  ip: string;
  user_agent: string;
  created_at: string;
  updated_at: string;
  assigned_to: UserRef | null;
};

export type LeadPatch = { status?: LeadStatus; assigned_to?: string | null; note?: string };

export type LeadBoard = {
  columns: Record<LeadStatus, Lead[]>;
  counts: Record<LeadStatus, number>;
};

export type LeadActivity = {
  id: string;
  kind: "note" | "status" | "assign";
  actor: UserRef | null;
  body: string;
  from: string;
  to: string;
  created_at: string;
};

/* ---------------- dashboard ---------------- */

export type DashboardLeads = {
  today: number;
  yesterday: number;
  last7: number;
  prev7: number;
  last30: number;
  prev30: number;
  by_status: Record<LeadStatus, number>;
  daily: { date: string; count: number }[];
  recent: Lead[];
};

export type DashboardPosts = {
  published: number;
  drafts: number;
  scheduled: number;
  next_scheduled_at: string | null;
  recent: PostSummary[];
};

export type Dashboard = { leads: DashboardLeads | null; posts: DashboardPosts | null };

/* ---------------- users, invites, tokens ---------------- */

export type Invite = {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  expires_at: string;
  expired: boolean;
  invited_by: UserRef | null;
};

/** POST /invites, POST /invites/:id/resend */
export type InviteCreated = { invite: Invite; token: string; email_sent: boolean };
/** POST /users/:id/reset-link */
export type ResetLink = { token: string; expires_at: string; email_sent: boolean };

/** POST /auth/tokens/inspect */
export type TokenInfo = {
  purpose: "invite" | "reset";
  email: string;
  role: Role | null;
  name: string;
  expires_at: string;
};

export type AccountSession = {
  id: string;
  ip: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
  current: boolean;
};

/* ---------------- audit & settings ---------------- */

export type AuditEntry = {
  id: number;
  created_at: string;
  actor: { id: string | null; email: string; name: string };
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  ip: string;
  user_agent: string;
};

export type SettingsOverview = {
  app_env: string;
  public_base_url: string;
  web_base_url: string;
  revalidate_webhook: boolean;
  email: { configured: boolean; provider: "resend" | "smtp" | null; recipients: number };
  line: { configured: boolean };
  session_ttl_hours: number;
  invite_ttl_hours: number;
  max_upload_mb: number;
  scheduler_interval_seconds: number;
  migrate_on_start: boolean;
};

/* ---------------- SEO: redirects ---------------- */

export type RedirectStatus = 301 | 410;
export type Redirect = {
  id: string;
  from: string;
  to: string | null;
  status: RedirectStatus;
  kind: "manual" | "auto";
  note: string;
  created_by: UserRef | null;
  created_at: string;
  updated_at: string;
};
export type RedirectInput = { from: string; to: string | null; status: RedirectStatus; note: string };
export type LinkSuggestion = { id: string; title: string; slug: string; url: string };
