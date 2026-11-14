package domain

import (
	"errors"
	"time"
)

// ConsentVersion is the community terms/consent version new members accept.
// The web reads it from GET /api/v1/community/config.
const ConsentVersion = "community-2026-11-14"

// MemberRole is a community member's role (unrelated to admin Role).
type MemberRole string

const (
	MemberRoleMember    MemberRole = "member"
	MemberRoleTrusted   MemberRole = "trusted"
	MemberRoleModerator MemberRole = "moderator"
	MemberRoleBanned    MemberRole = "banned"
)

func (r MemberRole) Valid() bool {
	switch r {
	case MemberRoleMember, MemberRoleTrusted, MemberRoleModerator, MemberRoleBanned:
		return true
	}
	return false
}

// PublishesDirectly: trusted members and moderators skip the first-comment hold.
func (r MemberRole) PublishesDirectly() bool {
	return r == MemberRoleTrusted || r == MemberRoleModerator
}

// Member is a community account. Email is the decrypted address and is only
// filled by the service layer (the repository stores ciphertext + index).
type Member struct {
	ID                string
	DisplayName       string
	Email             string
	EmailCiphertext   []byte
	EmailKeyID        int16
	EmailIndex        []byte
	EmailVerifiedAt   *time.Time
	PasswordHash      string // "" = no password (Google-only)
	PasswordChangedAt *time.Time
	Role              MemberRole
	AvatarKey         string // "" = none
	TermsVersion      string
	ConsentedAt       time.Time
	LastLoginAt       *time.Time
	BannedAt          *time.Time
	BannedReason      string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func (m Member) HasPassword() bool   { return m.PasswordHash != "" }
func (m Member) EmailVerified() bool { return m.EmailVerifiedAt != nil }
func (m Member) Banned() bool        { return m.Role == MemberRoleBanned }

const ProviderGoogle = "google"

// MemberIdentity is an external login (Google now, LINE later).
type MemberIdentity struct {
	ID          string
	MemberID    string
	Provider    string
	SubjectHash []byte
	CreatedAt   time.Time
	LastUsedAt  *time.Time
}

type MemberSession struct {
	ID         string
	MemberID   string
	TokenHash  []byte
	CSRFToken  string
	IP         string
	UserAgent  string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	LastSeenAt *time.Time
}

type MemberTokenPurpose string

const (
	TokenVerifyEmail   MemberTokenPurpose = "verify_email"
	TokenResetPassword MemberTokenPurpose = "reset_password"
	TokenChangeEmail   MemberTokenPurpose = "change_email"
	TokenLinkGoogle    MemberTokenPurpose = "link_google"
)

// MemberToken is a single-use token; only its SHA-256 is stored.
type MemberToken struct {
	ID                string
	MemberID          *string
	Purpose           MemberTokenPurpose
	TokenHash         []byte
	PayloadCiphertext []byte
	PayloadKeyID      *int16
	CreatedAt         time.Time
	ExpiresAt         time.Time
	UsedAt            *time.Time
}

// OAuthState carries a Google sign-in from /start to /callback.
type OAuthState struct {
	StateHash          []byte
	BindingHash        []byte
	Nonce              string
	VerifierCiphertext []byte
	KeyID              int16
	NextPath           string
	ConsentVersion     string
	CreatedAt          time.Time
	ExpiresAt          time.Time
}

type CommentStatus string

const (
	CommentPending   CommentStatus = "pending"
	CommentPublished CommentStatus = "published"
	CommentHidden    CommentStatus = "hidden"
	CommentDeleted   CommentStatus = "deleted"
)

func (s CommentStatus) Valid() bool {
	switch s {
	case CommentPending, CommentPublished, CommentHidden, CommentDeleted:
		return true
	}
	return false
}

// MemberRef is the author/mention form embedded in comments.
type MemberRef struct {
	ID          string
	DisplayName string
	AvatarKey   string
	Role        MemberRole
}

type CommentImage struct {
	ID         string
	MemberID   string
	CommentID  *string
	StorageKey string
	Width      int
	Height     int
	SizeBytes  int64
	CreatedAt  time.Time
}

// Comment is a top-level comment or a reply (ParentID set).
type Comment struct {
	ID          string
	PostID      string
	PostSlug    string
	PostTitle   string
	ParentID    *string
	ReplyToID   *string
	ReplyTo     *MemberRef // author of ReplyToID; nil when none, ID "" when that account was deleted
	MemberID    *string
	Author      *MemberRef // nil = deleted account
	Body        string
	Status      CommentStatus
	ContentHash []byte
	LikeCount   int
	ReportCount int
	ReplyCount  int // visible replies (top-level only)
	LikedByMe   bool
	Image       *CommentImage
	Replies     []Comment
	CreatedAt   time.Time
	UpdatedAt   time.Time
	EditedAt    *time.Time
	DeletedAt   *time.Time
	ModeratedAt *time.Time
	// ModeratedBy: "admin" or "member" plus the moderator's name.
	ModeratedByKind string
	ModeratedByName string
	Reports         []CommentReport // admin view only (<= 10, newest first)
}

func (c Comment) IsTopLevel() bool { return c.ParentID == nil }

type CommentReport struct {
	CommentID string
	MemberID  string
	Reason    string
	Note      string
	CreatedAt time.Time
}

var ReportReasons = []string{"spam", "harassment", "inappropriate", "other"}

type CommentEdit struct {
	Body     string
	EditedAt time.Time
}

// CommunityStats are a post's public counters.
type CommunityStats struct {
	Views    int64
	Likes    int
	Comments int
}

// Community error sentinels (mapped to codes in the HTTP layer).
var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrMemberBanned       = errors.New("member banned")
	ErrEmailUnverified    = errors.New("email unverified")
	ErrDuplicateComment   = errors.New("duplicate comment")
	ErrLastLoginMethod    = errors.New("last login method")
)

const (
	MsgEmailTaken          = "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ"
	MsgMemberBanned        = "บัญชีของคุณถูกระงับการแสดงความคิดเห็น"
	MsgEmailUnverified     = "กรุณายืนยันอีเมลก่อนแสดงความคิดเห็น"
	MsgDuplicateComment    = "คุณเคยส่งความคิดเห็นนี้แล้ว"
	MsgLastLoginMethod     = "ต้องตั้งรหัสผ่านก่อนยกเลิกการเชื่อมต่อ Google"
	MsgDeletedAuthor       = "ผู้ใช้ที่ลบบัญชี"
	MsgSetPasswordFirst    = "กรุณาตั้งรหัสผ่านก่อน"
	MsgTurnstileFailed     = "กรุณายืนยันว่าคุณไม่ใช่บอท แล้วลองใหม่อีกครั้ง"
	DeleteAccountConfirm   = "ลบบัญชี"
	DefaultMemberName      = "สมาชิก"
	CommentMaxRunes        = 2000
	CommentReportThreshold = 3
)
