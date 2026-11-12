/** Shapes from the Go API contract (CONTRACTS.md, "Go API contract"). */

export type AdminUser = { id: string; email: string; name: string };
export type SessionPayload = { user: AdminUser; csrf_token: string };

export type PageMeta = { page: number; per_page: number; total: number; total_pages: number };
export type ListResponse<T> = { data: T[]; meta: PageMeta };

export type Cover = { url: string; alt: string; width: number; height: number };
export type CategoryRef = { slug: string; name: string; name_th: string };
export type Category = CategoryRef & { description: string; post_count: number };

export type PostStatus = "draft" | "published";

export type PostSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover: Cover | null;
  categories: CategoryRef[];
  author: string;
  published_at: string | null;
  updated_at: string;
  reading_minutes: number;
  featured: boolean;
  seo_title: string;
  seo_description: string;
  status: PostStatus;
};

export type Post = PostSummary & { body_markdown: string; legacy_slugs: string[] };

export type PostInput = {
  slug: string;
  title: string;
  excerpt: string;
  body_markdown: string;
  cover_media_id?: string;
  cover: Cover | null;
  categories: string[];
  author: string;
  status: PostStatus;
  published_at?: string | null;
  featured: boolean;
  seo_title: string;
  seo_description: string;
};

export type Media = { id: string; url: string; width: number; height: number; mime: string; size: number };

export type LeadStatus = "new" | "contacted" | "qualified" | "closed" | "spam";
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
};
