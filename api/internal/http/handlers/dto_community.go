package handlers

import (
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

// Community wire shapes (CONTRACT-COMMUNITY §4/§8). The TypeScript mirror is
// web/src/lib/community/types.ts.

type memberPublicDTO struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
	Role        string  `json:"role"`
}

type identityDTO struct {
	Provider  string    `json:"provider"`
	CreatedAt time.Time `json:"created_at"`
}

type memberMeDTO struct {
	ID            string        `json:"id"`
	DisplayName   string        `json:"display_name"`
	Email         string        `json:"email"`
	EmailVerified bool          `json:"email_verified"`
	Role          string        `json:"role"`
	AvatarURL     *string       `json:"avatar_url"`
	HasPassword   bool          `json:"has_password"`
	Identities    []identityDTO `json:"identities"`
	CreatedAt     time.Time     `json:"created_at"`
}

type memberSessionDTO struct {
	Member    memberMeDTO `json:"member"`
	CSRFToken string      `json:"csrf_token"`
}

type communityConfigDTO struct {
	GoogleEnabled        bool   `json:"google_enabled"`
	RequireVerifiedEmail bool   `json:"require_verified_email"`
	EmailTransport       bool   `json:"email_transport"`
	ConsentVersion       string `json:"consent_version"`
	CommentMaxChars      int    `json:"comment_max_chars"`
	CommentImageMaxMB    int64  `json:"comment_image_max_mb"`
	AvatarMaxMB          int64  `json:"avatar_max_mb"`
	Turnstile            bool   `json:"turnstile"`
}

type statsDTO struct {
	Views    int64 `json:"views"`
	Likes    int   `json:"likes"`
	Comments int   `json:"comments"`
}

type postStatsDTO struct {
	statsDTO
	LikedByMe bool `json:"liked_by_me"`
}

func toStats(s domain.CommunityStats) statsDTO {
	return statsDTO{Views: s.Views, Likes: s.Likes, Comments: s.Comments}
}

type likeDTO struct {
	Liked bool `json:"liked"`
	Likes int  `json:"likes"`
}

type replyToDTO struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
}

type commentImageDTO struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type commentDTO struct {
	ID          string           `json:"id"`
	PostSlug    string           `json:"post_slug"`
	ParentID    *string          `json:"parent_id"`
	ReplyTo     *replyToDTO      `json:"reply_to"`
	Author      *memberPublicDTO `json:"author"`
	Body        string           `json:"body"`
	BodyHTML    string           `json:"body_html"`
	Image       *commentImageDTO `json:"image"`
	Status      string           `json:"status"`
	CreatedAt   time.Time        `json:"created_at"`
	EditedAt    *time.Time       `json:"edited_at"`
	LikeCount   int              `json:"like_count"`
	LikedByMe   bool             `json:"liked_by_me"`
	ReplyCount  int              `json:"reply_count"`
	Replies     []commentDTO     `json:"replies"`
	CanEdit     bool             `json:"can_edit"`
	CanDelete   bool             `json:"can_delete"`
	CanModerate bool             `json:"can_moderate"`
	CanReport   bool             `json:"can_report"`
}

type commentsMetaDTO struct {
	Page         int `json:"page"`
	PerPage      int `json:"per_page"`
	Total        int `json:"total"`
	TotalPages   int `json:"total_pages"`
	CommentCount int `json:"comment_count"`
}

type commentImageUploadDTO struct {
	ID     string `json:"id"`
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// ---- admin ----

type adminCommentPostDTO struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

type adminCommentAuthorDTO struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

type adminReportDTO struct {
	Reason    string    `json:"reason"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type moderatedByDTO struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type adminCommentDTO struct {
	ID          string                 `json:"id"`
	Post        adminCommentPostDTO    `json:"post"`
	ParentID    *string                `json:"parent_id"`
	Author      *adminCommentAuthorDTO `json:"author"`
	Body        string                 `json:"body"`
	BodyHTML    string                 `json:"body_html"`
	Image       *commentImageDTO       `json:"image"`
	Status      string                 `json:"status"`
	LikeCount   int                    `json:"like_count"`
	ReportCount int                    `json:"report_count"`
	Reports     []adminReportDTO       `json:"reports"`
	CreatedAt   time.Time              `json:"created_at"`
	EditedAt    *time.Time             `json:"edited_at"`
	ModeratedAt *time.Time             `json:"moderated_at"`
	ModeratedBy *moderatedByDTO        `json:"moderated_by"`
}

type adminCommentCountsDTO struct {
	Pending  int `json:"pending"`
	Reported int `json:"reported"`
}

type commentEditDTO struct {
	Body     string    `json:"body"`
	EditedAt time.Time `json:"edited_at"`
}

type adminMemberDTO struct {
	ID            string     `json:"id"`
	DisplayName   string     `json:"display_name"`
	EmailMasked   string     `json:"email_masked"`
	Email         *string    `json:"email,omitempty"`
	EmailVerified bool       `json:"email_verified"`
	Role          string     `json:"role"`
	AvatarURL     *string    `json:"avatar_url"`
	Providers     []string   `json:"providers"`
	CommentCount  int        `json:"comment_count"`
	CreatedAt     time.Time  `json:"created_at"`
	LastLoginAt   *time.Time `json:"last_login_at"`
	BannedAt      *time.Time `json:"banned_at"`
	BannedReason  string     `json:"banned_reason"`
}

type membersOverviewDTO struct {
	GoogleEnabled        bool    `json:"google_enabled"`
	RequireVerifiedEmail bool    `json:"require_verified_email"`
	HoldFirstComment     bool    `json:"hold_first_comment"`
	TurnstileEnabled     bool    `json:"turnstile_enabled"`
	DataKeyIDs           []int16 `json:"data_key_ids"`
}

// ---- export ----

type exportCommentDTO struct {
	PostSlug  string     `json:"post_slug"`
	Body      string     `json:"body"`
	Status    string     `json:"status"`
	CreatedAt time.Time  `json:"created_at"`
	EditedAt  *time.Time `json:"edited_at"`
}

type exportLikesDTO struct {
	Posts    []string `json:"posts"`
	Comments []string `json:"comments"`
}

type accountExportDTO struct {
	Member     memberMeDTO        `json:"member"`
	Identities []identityDTO      `json:"identities"`
	Comments   []exportCommentDTO `json:"comments"`
	Likes      exportLikesDTO     `json:"likes"`
	Sessions   []sessionDTO       `json:"sessions"`
}

// ---- converters ----

func (h *handler) urlPtr(key string) *string {
	if key == "" {
		return nil
	}
	u := h.Comments.ImageURL(key)
	return &u
}

func publicRole(r domain.MemberRole) string {
	if r == domain.MemberRoleBanned || !r.Valid() {
		return string(domain.MemberRoleMember)
	}
	return string(r)
}

func toIdentities(ids []domain.MemberIdentity) []identityDTO {
	out := make([]identityDTO, 0, len(ids))
	for _, i := range ids {
		out = append(out, identityDTO{Provider: i.Provider, CreatedAt: i.CreatedAt.UTC()})
	}
	return out
}

func (h *handler) toMemberMe(m domain.Member, ids []domain.MemberIdentity) memberMeDTO {
	return memberMeDTO{ID: m.ID, DisplayName: m.DisplayName, Email: m.Email, EmailVerified: m.EmailVerified(),
		Role: string(m.Role), AvatarURL: h.urlPtr(m.AvatarKey), HasPassword: m.HasPassword(),
		Identities: toIdentities(ids), CreatedAt: m.CreatedAt.UTC()}
}

func (h *handler) toCommentImage(img *domain.CommentImage) *commentImageDTO {
	if img == nil {
		return nil
	}
	return &commentImageDTO{URL: h.Comments.ImageURL(img.StorageKey), Width: img.Width, Height: img.Height}
}

// toComment renders a comment for viewer (nil = anonymous).
func (h *handler) toComment(c domain.Comment, viewer *domain.Member) commentDTO {
	d := commentDTO{ID: c.ID, PostSlug: c.PostSlug, ParentID: c.ParentID, Body: c.Body,
		Status: string(c.Status), CreatedAt: c.CreatedAt.UTC(), EditedAt: utcPtr(c.EditedAt), LikeCount: c.LikeCount,
		LikedByMe: c.LikedByMe, Replies: []commentDTO{}}
	if c.Status != domain.CommentDeleted {
		d.BodyHTML = service.RenderCommentHTML(c.Body)
		d.Image = h.toCommentImage(c.Image)
	} else {
		d.Body = ""
	}
	if c.Author != nil {
		d.Author = &memberPublicDTO{ID: c.Author.ID, DisplayName: c.Author.DisplayName,
			AvatarURL: h.urlPtr(c.Author.AvatarKey), Role: publicRole(c.Author.Role)}
	}
	if c.ReplyToID != nil && c.ReplyTo != nil {
		name := c.ReplyTo.DisplayName
		if c.ReplyTo.ID == "" {
			name = domain.MsgDeletedAuthor
		}
		d.ReplyTo = &replyToDTO{ID: *c.ReplyToID, DisplayName: name}
	}
	if c.IsTopLevel() {
		d.ReplyCount = c.ReplyCount
		for _, r := range c.Replies {
			d.Replies = append(d.Replies, h.toComment(r, viewer))
		}
	}
	if viewer != nil && !viewer.Banned() {
		author := c.MemberID != nil && *c.MemberID == viewer.ID
		mod := viewer.Role == domain.MemberRoleModerator
		live := c.Status != domain.CommentDeleted
		d.CanEdit = author && (c.Status == domain.CommentPublished || c.Status == domain.CommentPending)
		d.CanDelete = live && (author || mod)
		d.CanModerate = live && mod
		d.CanReport = !author && c.Status == domain.CommentPublished
	}
	return d
}

func (h *handler) toComments(cs []domain.Comment, viewer *domain.Member) []commentDTO {
	out := make([]commentDTO, 0, len(cs))
	for _, c := range cs {
		out = append(out, h.toComment(c, viewer))
	}
	return out
}

func (h *handler) toAdminComment(c domain.Comment) adminCommentDTO {
	d := adminCommentDTO{ID: c.ID, Post: adminCommentPostDTO{Slug: c.PostSlug, Title: c.PostTitle}, ParentID: c.ParentID,
		Body: c.Body, BodyHTML: service.RenderCommentHTML(c.Body), Image: h.toCommentImage(c.Image),
		Status: string(c.Status), LikeCount: c.LikeCount, ReportCount: c.ReportCount, Reports: []adminReportDTO{},
		CreatedAt: c.CreatedAt.UTC(), EditedAt: utcPtr(c.EditedAt), ModeratedAt: utcPtr(c.ModeratedAt)}
	if c.Author != nil {
		d.Author = &adminCommentAuthorDTO{ID: c.Author.ID, DisplayName: c.Author.DisplayName, Role: string(c.Author.Role)}
	}
	for _, r := range c.Reports {
		d.Reports = append(d.Reports, adminReportDTO{Reason: r.Reason, Note: r.Note, CreatedAt: r.CreatedAt.UTC()})
	}
	if c.ModeratedByKind != "" {
		d.ModeratedBy = &moderatedByDTO{Kind: c.ModeratedByKind, Name: c.ModeratedByName}
	}
	return d
}

func (h *handler) toAdminMember(r repository.MemberAdminRow, withEmail bool) adminMemberDTO {
	m := r.Member
	d := adminMemberDTO{ID: m.ID, DisplayName: m.DisplayName, EmailMasked: service.MaskEmail(m.Email),
		EmailVerified: m.EmailVerified(), Role: string(m.Role), AvatarURL: h.urlPtr(m.AvatarKey), Providers: []string{},
		CommentCount: r.CommentCount, CreatedAt: m.CreatedAt.UTC(), LastLoginAt: utcPtr(m.LastLoginAt),
		BannedAt: utcPtr(m.BannedAt), BannedReason: m.BannedReason}
	if withEmail {
		e := m.Email
		d.Email = &e
	}
	if m.HasPassword() {
		d.Providers = append(d.Providers, "password")
	}
	if r.HasGoogle {
		d.Providers = append(d.Providers, domain.ProviderGoogle)
	}
	return d
}

func toMemberSessions(ss []domain.MemberSession, currentID string) []sessionDTO {
	out := make([]sessionDTO, 0, len(ss))
	for _, s := range ss {
		out = append(out, sessionDTO{ID: s.ID, IP: s.IP, UserAgent: s.UserAgent, CreatedAt: s.CreatedAt.UTC(),
			LastSeenAt: utcPtr(s.LastSeenAt), ExpiresAt: s.ExpiresAt.UTC(), Current: s.ID == currentID})
	}
	return out
}
