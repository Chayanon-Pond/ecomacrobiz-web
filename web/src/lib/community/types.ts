/**
 * Wire shapes of the Go community API (/api/v1/community, proxied same-origin
 * at /api/community). Snake_case on the wire. Keep in sync with
 * api/internal/http/handlers/dto_community.go.
 */

export type MemberRole = "member" | "trusted" | "moderator" | "banned";
export type PublicRole = Exclude<MemberRole, "banned">;

export type MemberPublic = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: PublicRole;
};

export type Identity = { provider: "google"; created_at: string };

export type Me = {
  id: string;
  display_name: string;
  email: string;
  email_verified: boolean;
  role: MemberRole;
  avatar_url: string | null;
  has_password: boolean;
  identities: Identity[];
  created_at: string;
};

export type Session = { member: Me; csrf_token: string };

export type CommunityConfig = {
  google_enabled: boolean;
  require_verified_email: boolean;
  email_transport: boolean;
  consent_version: string;
  comment_max_chars: number;
  comment_image_max_mb: number;
  avatar_max_mb: number;
  turnstile: boolean;
};

export type Stats = { views: number; likes: number; comments: number };
export type PostStats = Stats & { liked_by_me: boolean };

export type CommentStatus = "published" | "pending" | "hidden" | "deleted";
export type CommentImage = { url: string; width: number; height: number };

export type Comment = {
  id: string;
  post_slug: string;
  parent_id: string | null;
  reply_to: { id: string; display_name: string } | null;
  /** null = deleted account ("ผู้ใช้ที่ลบบัญชี"). */
  author: MemberPublic | null;
  body: string;
  /** Server-sanitized HTML (strong/em/a/br only). Safe for dangerouslySetInnerHTML. */
  body_html: string;
  image: CommentImage | null;
  status: CommentStatus;
  created_at: string;
  edited_at: string | null;
  like_count: number;
  liked_by_me: boolean;
  reply_count: number;
  replies: Comment[];
  can_edit: boolean;
  can_delete: boolean;
  can_moderate: boolean;
  can_report: boolean;
};

export type CommentSort = "newest" | "top";

export type PageMeta = { page: number; per_page: number; total: number; total_pages: number };
export type CommentsMeta = PageMeta & { comment_count: number };

export type CommentsPage = { data: Comment[]; meta: CommentsMeta };
export type RepliesPage = { data: Comment[]; meta: PageMeta };

export type LikeState = { liked: boolean; likes: number };

export type MemberSessionInfo = {
  id: string;
  ip: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
  current: boolean;
};

export type ReportReason = "spam" | "harassment" | "inappropriate" | "other";

/** What a logged-out visitor clicked; replayed after sign-in (incl. the Google redirect). */
export type PendingAction =
  | { kind: "like-post"; slug: string }
  | { kind: "like-comment"; slug: string; commentId: string }
  | { kind: "comment"; slug: string; draft: string }
  | { kind: "reply"; slug: string; parentId: string; replyToId: string | null; draft: string }
  | { kind: "none" };

/** Outcomes in the `#community=<outcome>` fragment after the Google callback. */
export type OAuthOutcome = "signed-in" | "link-required" | `error-${string}`;

export const DELETED_AUTHOR_NAME = "ผู้ใช้ที่ลบบัญชี";
export const DELETED_COMMENT_TEXT = "ความคิดเห็นนี้ถูกลบแล้ว";
export const COMMENT_MAX_CHARS = 2000;
