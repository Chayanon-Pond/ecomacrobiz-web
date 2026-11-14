package repository

import (
	"context"
	"errors"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// ErrImageUnavailable: the comment image does not exist, belongs to another
// member or is already attached.
var ErrImageUnavailable = errors.New("comment image unavailable")

type MemberFilter struct {
	domain.Page
	Name       string // display name contains
	EmailIndex []byte // exact e-mail (blind index)
	Role       string
}

// MemberAdminRow is a member plus the admin list extras.
type MemberAdminRow struct {
	Member       domain.Member
	HasGoogle    bool
	CommentCount int // not deleted
}

// DeletedMember is what an account deletion leaves for the caller to clean
// up after the commit.
type DeletedMember struct {
	AvatarKey     string
	ImageKeys     []string
	AffectedSlugs []string // posts where the member had published comments
}

type ExportComment struct {
	PostSlug  string
	Body      string
	Status    domain.CommentStatus
	CreatedAt time.Time
	EditedAt  *time.Time
}

type MemberExport struct {
	Identities    []domain.MemberIdentity
	Comments      []ExportComment
	LikedPosts    []string
	LikedComments []string
}

type Members interface {
	// Create inserts m (m.ID preset by the caller, it is part of the e-mail
	// AAD) and, when ident is not nil, the identity in the same transaction.
	// ErrConflict on a duplicate e-mail index or identity.
	Create(ctx context.Context, m *domain.Member, ident *domain.MemberIdentity) error
	GetByID(ctx context.Context, id string) (domain.Member, error)
	GetByEmailIndex(ctx context.Context, idx []byte) (domain.Member, error)
	GetByIdentity(ctx context.Context, provider string, subjectHash []byte) (domain.Member, error)
	Identities(ctx context.Context, memberID string) ([]domain.MemberIdentity, error)
	// AddIdentity links an identity and (verifiedAt != nil) marks the e-mail
	// verified in one transaction. ErrConflict when already linked.
	AddIdentity(ctx context.Context, ident *domain.MemberIdentity, verifiedAt *time.Time) error
	TouchIdentity(ctx context.Context, provider string, subjectHash []byte, at time.Time) error
	DeleteIdentity(ctx context.Context, memberID, provider string) error
	UpdateDisplayName(ctx context.Context, id, name string) (domain.Member, error)
	// SetAvatar stores key ("" = none) and returns the previous key. With
	// onlyIfNone the update applies only when the member has no avatar.
	SetAvatar(ctx context.Context, id, key string, onlyIfNone bool) (previous string, applied bool, err error)
	// UpdateEmail swaps the encrypted e-mail; verifiedAt nil = unverified.
	// ErrConflict when the index is taken.
	UpdateEmail(ctx context.Context, id string, upd EmailUpdate, verifiedAt *time.Time) error
	// SetPassword stores the hash, deletes every session except keepSessionID
	// ("" = all) and burns open reset tokens, in one transaction.
	SetPassword(ctx context.Context, id, hash string, at time.Time, keepSessionID string) error
	MarkVerified(ctx context.Context, id string, at time.Time) error
	TouchLogin(ctx context.Context, id string, at time.Time) error
	HasPublishedComment(ctx context.Context, id string) (bool, error)
	// Delete removes the account in one transaction: likes and reports are
	// removed with their counters fixed, image rows deleted, comments kept
	// with member_id NULL, sessions/tokens/identities cascade.
	Delete(ctx context.Context, id string) (DeletedMember, error)
	Export(ctx context.Context, id string) (MemberExport, error)

	AdminList(ctx context.Context, f MemberFilter) ([]MemberAdminRow, int, error)
	AdminGet(ctx context.Context, id string) (MemberAdminRow, error)
	// SetRole changes the role; banning stamps banned_at/reason and deletes
	// all sessions, unbanning clears them (one transaction).
	SetRole(ctx context.Context, id string, role domain.MemberRole, reason string, now time.Time) (before, after domain.Member, err error)
}

// EmailUpdate is a new encrypted e-mail plus its blind index.
type EmailUpdate struct {
	Ciphertext []byte
	KeyID      int16
	Index      []byte
}

type MemberSessions interface {
	Create(ctx context.Context, s *domain.MemberSession) error
	// GetValid returns an unexpired session and its member (any role).
	GetValid(ctx context.Context, tokenHash []byte, now time.Time) (domain.MemberSession, domain.Member, error)
	Touch(ctx context.Context, id string, now time.Time) error
	DeleteByTokenHash(ctx context.Context, tokenHash []byte) error
	ListByMember(ctx context.Context, memberID string, now time.Time) ([]domain.MemberSession, error)
	// DeleteByMemberExcept deletes the member's sessions but keepID ("" = all).
	DeleteByMemberExcept(ctx context.Context, memberID, keepID string) (int64, error)
}

type MemberTokens interface {
	Create(ctx context.Context, t *domain.MemberToken) error
	// GetUsable returns an unused, unexpired token of one of purposes, else
	// domain.ErrTokenInvalid.
	GetUsable(ctx context.Context, hash []byte, purposes []domain.MemberTokenPurpose, now time.Time) (domain.MemberToken, error)
	// The Consume* methods burn the token (ErrTokenInvalid if it is no longer
	// usable) and apply its effect in one transaction.
	// ConsumeVerify marks the e-mail verified, swapping it first when email is
	// set (ErrConflict when taken).
	ConsumeVerify(ctx context.Context, tokenID, memberID string, email *EmailUpdate, now time.Time) error
	// ConsumeReset sets the password, marks the e-mail verified and deletes
	// all sessions and open reset tokens of the member.
	ConsumeReset(ctx context.Context, tokenID, memberID, passwordHash string, now time.Time) error
	// ConsumeLink links the identity and marks the e-mail verified.
	ConsumeLink(ctx context.Context, tokenID string, ident *domain.MemberIdentity, now time.Time) error
	// RevokeOpen burns the member's open tokens of purpose.
	RevokeOpen(ctx context.Context, memberID string, purpose domain.MemberTokenPurpose, now time.Time) error
}

type OAuthStates interface {
	Create(ctx context.Context, s *domain.OAuthState) error
	// Take deletes and returns the state (ErrNotFound when absent).
	Take(ctx context.Context, stateHash []byte) (domain.OAuthState, error)
}

// CommentViewer decides visibility: published for everyone, own pending
// for the author, pending + hidden for moderators.
type CommentViewer struct {
	MemberID  string
	Moderator bool
}

type CommentListFilter struct {
	domain.Page
	PostID         string
	Viewer         CommentViewer
	Sort           string // newest | top
	RepliesPreview int
}

// CommentModerator is who changed a status (both empty = the author).
type CommentModerator struct {
	AdminID  string
	MemberID string
}

type AdminCommentFilter struct {
	domain.Page
	Status   string // pending | published | hidden | deleted | reported | all
	Query    string
	PostSlug string
	MemberID string
}

type AdminCommentCounts struct {
	Pending  int
	Reported int
}

// StatusChange is the outcome of Comments.SetStatus.
type StatusChange struct {
	From     domain.CommentStatus
	To       domain.CommentStatus
	PostSlug string
	ImageKey string // deleted image file (status deleted)
}

type Comments interface {
	ListTop(ctx context.Context, f CommentListFilter) ([]domain.Comment, int, error)
	ListReplies(ctx context.Context, parentID string, v CommentViewer, p domain.Page) ([]domain.Comment, int, error)
	// Get returns the comment in any status (callers apply visibility).
	Get(ctx context.Context, id string, v CommentViewer) (domain.Comment, error)
	// Create inserts c (ID/CreatedAt filled), attaches imageID ("" = none;
	// ErrImageUnavailable) and counts it when published, in one transaction.
	Create(ctx context.Context, c *domain.Comment, imageID string) error
	// Edit appends the previous body to comment_edits and stores the new one.
	Edit(ctx context.Context, id, body string, hash []byte, now time.Time) error
	// SetStatus moves a comment to `to` and fixes post_stats.comment_count.
	// to = deleted also clears the body and deletes the image row.
	SetStatus(ctx context.Context, id string, to domain.CommentStatus, by CommentModerator, now time.Time) (StatusChange, error)
	// Like adds/removes a like on a published comment (ErrNotFound otherwise).
	Like(ctx context.Context, commentID, memberID string, like bool, now time.Time) (bool, int, error)
	// Report upserts the member's report on a published comment; a new
	// report that reaches threshold on a non-trusted author's comment moves
	// it to pending (held = true, slug returned).
	Report(ctx context.Context, r domain.CommentReport, threshold int) (held bool, slug string, err error)
	HasRecentDuplicate(ctx context.Context, memberID string, hash []byte, since time.Time, excludeID string) (bool, error)
	History(ctx context.Context, id string) ([]domain.CommentEdit, error)
	AdminList(ctx context.Context, f AdminCommentFilter) ([]domain.Comment, int, AdminCommentCounts, error)
	// HidePublishedBy hides all published comments of a member and returns
	// the affected post slugs.
	HidePublishedBy(ctx context.Context, memberID, adminID string, now time.Time) ([]string, error)
	CreateImage(ctx context.Context, img *domain.CommentImage) error
	// TakeStaleImages deletes up to limit unattached images created before
	// `before` and returns their storage keys.
	TakeStaleImages(ctx context.Context, before time.Time, limit int) ([]string, error)
}

type PurgeResult struct {
	Sessions, Tokens, States, Dedupe, Salts int64
}

// Engagement: post counters, post likes and view de-duplication.
type Engagement interface {
	// StatsBySlugs: live published posts by canonical slug (unknown omitted).
	StatsBySlugs(ctx context.Context, slugs []string, now time.Time) (map[string]domain.CommunityStats, error)
	PostStats(ctx context.Context, postID, memberID string) (domain.CommunityStats, bool, error)
	LikePost(ctx context.Context, postID, memberID string, like bool, now time.Time) (bool, int, error)
	// DaySalt returns the salt of day, storing candidate if none exists yet.
	DaySalt(ctx context.Context, day time.Time, candidate []byte) ([]byte, error)
	// RecordView counts a view unless (day, post, visitor) was seen already.
	RecordView(ctx context.Context, day time.Time, postID string, visitorHash []byte) (bool, error)
	// PurgeExpired deletes expired member sessions/tokens/OAuth states and
	// view salts/dedupe rows of days before keepFrom.
	PurgeExpired(ctx context.Context, now time.Time, keepFrom time.Time) (PurgeResult, error)
}
