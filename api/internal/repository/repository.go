// Package repository defines persistence interfaces (consumed by services and
// faked in tests) and their pgx/Postgres implementations.
package repository

import (
	"context"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type PostFilter struct {
	domain.Page
	CategorySlug string
}

type AdminPostFilter struct {
	domain.Page
	Status       string // "", "all", "draft", "published", "scheduled"
	Query        string
	CategorySlug string
	Sort         string // see PostSorts; "" = updated_desc
}

// PostSorts are the admin list orders (first = default).
var PostSorts = []string{"updated_desc", "updated_asc", "published_desc", "published_asc", "title_asc"}

type LeadFilter struct {
	domain.Page
	Status string
	Query  string
	// Assigned: "" = anyone, "none" = unassigned, otherwise an admin user id.
	Assigned string
	// CreatedFrom (inclusive) / CreatedTo (exclusive); nil = unbounded.
	CreatedFrom, CreatedTo *time.Time
}

// LeadChange is a partial lead update; nil / AssignSet=false = unchanged.
type LeadChange struct {
	Status     *domain.LeadStatus
	AssignSet  bool
	AssignedTo *string // nil with AssignSet = unassign
	Note       *string // legacy single note
}

type MediaFilter struct {
	domain.Page
	Query string // original_name or alt
	Mime  string // "" = all
}

type Categories interface {
	List(ctx context.Context) ([]domain.Category, error)
	// ExistingSlugs returns the subset of slugs that exist.
	ExistingSlugs(ctx context.Context, slugs []string) ([]string, error)
	Upsert(ctx context.Context, c domain.Category) error
}

type Posts interface {
	ListPublished(ctx context.Context, f PostFilter, now time.Time) ([]domain.Post, int, error)
	// GetPublishedBySlug matches the canonical slug first, then legacy slugs.
	GetPublishedBySlug(ctx context.Context, slug string, now time.Time) (domain.Post, error)
	AdminList(ctx context.Context, f AdminPostFilter) ([]domain.Post, int, error)
	GetByID(ctx context.Context, id string) (domain.Post, error)
	// Create/Update persist the post and replace its categories by slug.
	// ErrConflict on a duplicate live slug.
	// plan (may be nil) is applied to the redirects table in the same
	// transaction as the post change.
	Create(ctx context.Context, p *domain.Post, createdBy *string, plan *RedirectPlan) error
	Update(ctx context.Context, p *domain.Post, plan *RedirectPlan) error
	SoftDelete(ctx context.Context, id string, plan *RedirectPlan) (domain.Post, error)
	// UpsertBySlug is used by the seeder; it reports whether a row changed.
	UpsertBySlug(ctx context.Context, p *domain.Post) (changed bool, err error)
	// SlugsTaken returns the candidates already used as the slug or a legacy
	// slug of a live post other than excludeID.
	SlugsTaken(ctx context.Context, candidates []string, excludeID string) ([]string, error)
	// SetStatus changes only status and published_at (bulk actions).
	SetStatus(ctx context.Context, id string, status domain.PostStatus, publishedAt *time.Time, plan *RedirectPlan) (domain.Post, error)
	// PublishDue atomically flips due scheduled posts to published and, in the
	// same transaction, deletes redirect rows for their URLs (slug + legacy
	// slugs). Safe to run concurrently: each post is returned by exactly one caller.
	PublishDue(ctx context.Context, now time.Time) ([]domain.PostRef, error)
	// LiveSlugs returns slug + legacy slugs of every live published post.
	LiveSlugs(ctx context.Context, now time.Time) ([]domain.PostRef, error)
	// LinkSuggestions: up to limit live posts (excluding excludeID) sharing a
	// category with excludeID or whose title/excerpt contains query.
	LinkSuggestions(ctx context.Context, excludeID, query string, limit int, now time.Time) ([]domain.LinkSuggestion, error)
	Stats(ctx context.Context) (domain.PostStats, error)
}

type Leads interface {
	Create(ctx context.Context, l *domain.Lead) error
	List(ctx context.Context, f LeadFilter) ([]domain.Lead, int, error)
	Get(ctx context.Context, id string) (domain.Lead, error)
	UpdateStatus(ctx context.Context, id string, status domain.LeadStatus, note *string) (domain.Lead, error)
	// Apply updates status/assignee/note and writes the matching
	// lead_activities rows (status, assign) in one transaction.
	Apply(ctx context.Context, id string, ch LeadChange, actor domain.Actor) (before, after domain.Lead, err error)
	AddNote(ctx context.Context, leadID string, actor domain.Actor, body string) (domain.LeadActivity, error)
	// Activities: newest first.
	Activities(ctx context.Context, leadID string) ([]domain.LeadActivity, error)
	// Board returns up to perColumn newest leads per status plus full counts.
	Board(ctx context.Context, f LeadFilter, perColumn int) (map[domain.LeadStatus][]domain.Lead, map[domain.LeadStatus]int, error)
	// Assignees: active users whose role is one of roles, by name.
	Assignees(ctx context.Context, roles []domain.Role) ([]domain.UserRef, error)
	Stats(ctx context.Context, now time.Time) (domain.LeadStats, error)
}

type AdminUsers interface {
	GetByEmail(ctx context.Context, email string) (domain.AdminUser, error)
	GetByID(ctx context.Context, id string) (domain.AdminUser, error)
	Create(ctx context.Context, u *domain.AdminUser) error
	UpdatePassword(ctx context.Context, id, hash string) error
	UpdateName(ctx context.Context, id, name string) error
	TouchLogin(ctx context.Context, id string, at time.Time) error

	// List returns all users (incl. inactive): owners first, then by name.
	List(ctx context.Context) ([]domain.AdminUser, error)
	// SetPassword stores a new hash and password_changed_at.
	SetPassword(ctx context.Context, id, hash string, at time.Time) error
	// UpdateAccess changes role and/or is_active in one transaction that
	// locks the active owners (SELECT ... FOR UPDATE) and returns
	// domain.ErrLastOwner if no active owner would remain. Deactivation
	// deletes all of the user's sessions in the same transaction.
	UpdateAccess(ctx context.Context, id string, role *domain.Role, active *bool) (before, after domain.AdminUser, err error)
	// Delete removes the user (sessions cascade) under the same last-owner
	// rule as UpdateAccess.
	Delete(ctx context.Context, id string) (domain.AdminUser, error)
	// RestoreOwner is the ADMIN_RESET_PASSWORD break-glass: role=owner,
	// is_active=true.
	RestoreOwner(ctx context.Context, id string) error
	CountActiveOwners(ctx context.Context) (int, error)
}

type Sessions interface {
	Create(ctx context.Context, s *domain.Session) error
	// GetValid returns an unexpired session and its active user.
	GetValid(ctx context.Context, tokenHash []byte, now time.Time) (domain.Session, domain.AdminUser, error)
	DeleteByTokenHash(ctx context.Context, tokenHash []byte) error
	DeleteByUser(ctx context.Context, userID string) error
	DeleteExpired(ctx context.Context, now time.Time) (int64, error)

	// ListByUser returns the user's unexpired sessions, newest first.
	ListByUser(ctx context.Context, userID string, now time.Time) ([]domain.Session, error)
	// DeleteByUserExcept deletes all of the user's sessions but keepID.
	DeleteByUserExcept(ctx context.Context, userID, keepID string) (int64, error)
	// Touch sets last_seen_at = now unless it was set less than a minute ago.
	Touch(ctx context.Context, id string, now time.Time) error
}

// UserTokens stores invitation and password-reset tokens (hash only).
type UserTokens interface {
	// Create inserts an open token; ErrConflict when an open invite for the
	// email already exists.
	Create(ctx context.Context, t *domain.UserToken) error
	Get(ctx context.Context, id string) (domain.UserToken, error)
	GetByHash(ctx context.Context, hash []byte) (domain.UserToken, error)
	// ListOpenInvites: invites not used and not revoked (incl. expired),
	// newest first, with CreatedBy resolved.
	ListOpenInvites(ctx context.Context) ([]domain.UserToken, error)
	// RevokeInvite revokes an open invite; ErrNotFound if none.
	RevokeInvite(ctx context.Context, id string, now time.Time) (domain.UserToken, error)
	RevokeOpenInvitesFor(ctx context.Context, email string, now time.Time) error
	RevokeOpenResetsFor(ctx context.Context, userID string, now time.Time) error
	// RotateInvite replaces the hash and expiry of an open invite.
	RotateInvite(ctx context.Context, id string, hash []byte, expiresAt time.Time) (domain.UserToken, error)
	// AcceptInvite, in one transaction, consumes the invite (UPDATE ... WHERE
	// used_at IS NULL AND revoked_at IS NULL AND expires_at > now RETURNING)
	// and creates the user with the invite's role and invited_by.
	// ErrTokenInvalid if not consumable, ErrConflict if the email exists.
	AcceptInvite(ctx context.Context, hash []byte, now time.Time, u *domain.AdminUser) (domain.UserToken, error)
	// ConsumeReset, in one transaction, consumes the reset token, sets the
	// (active) user's password + password_changed_at and deletes all of the
	// user's sessions. ErrTokenInvalid if not consumable.
	ConsumeReset(ctx context.Context, hash []byte, now time.Time, passwordHash string) (domain.AdminUser, error)
}

type AuditFilter struct {
	domain.Page
	ActorID    string
	Action     string
	TargetType string
	TargetID   string
	From, To   *time.Time // [From, To)
}

// AuditLogs is the append-only audit trail.
type AuditLogs interface {
	Insert(ctx context.Context, ev domain.AuditEvent) error
	// List returns entries newest first with ActorName joined.
	List(ctx context.Context, f AuditFilter) ([]domain.AuditEntry, int, error)
}

type Media interface {
	Create(ctx context.Context, m *domain.Media) error
	Get(ctx context.Context, id string) (domain.Media, error)
	// List: newest first, UsageCount filled.
	List(ctx context.Context, f MediaFilter) ([]domain.Media, int, error)
	Usage(ctx context.Context, id string) ([]domain.MediaUsage, error)
	UpdateAlt(ctx context.Context, id, alt string) (domain.Media, error)
	// SoftDeleteUnused deletes the row unless live posts use it
	// (*domain.InUseError). Returns the deleted row.
	SoftDeleteUnused(ctx context.Context, id string) (domain.Media, error)
}

// RedirectPlan is a set of redirect-table changes applied inside the
// transaction of a post change. Order: Remove, Set, Repoint.
type RedirectPlan struct {
	// Remove deletes the rows with these from_paths.
	Remove []string
	// Set inserts or replaces rows by from_path (CreatedBy may be nil). A 301
	// row also flattens: other 301s whose to_path == From are re-pointed to To.
	Set []RedirectSet
	// Repoint re-points 301 rows whose to_path == Old to New.
	Repoint []PathMove
}

type RedirectSet struct {
	Redirect  domain.Redirect
	CreatedBy *string
}

type PathMove struct{ Old, New string }

func (p *RedirectPlan) Empty() bool {
	return p == nil || (len(p.Remove) == 0 && len(p.Set) == 0 && len(p.Repoint) == 0)
}

type RedirectFilter struct {
	domain.Page
	Query  string // from/to/note contains
	Kind   string // "" | manual | auto
	Status int    // 0 | 301 | 410
}

type Redirects interface {
	// List: ordered by from_path, CreatedBy resolved.
	List(ctx context.Context, f RedirectFilter) ([]domain.Redirect, int, error)
	// All returns every row ordered by from_path (public map).
	All(ctx context.Context) ([]domain.Redirect, error)
	Get(ctx context.Context, id string) (domain.Redirect, error)
	GetByFrom(ctx context.Context, from string) (domain.Redirect, error)
	// Create/Update store r and, when r is a 301, re-point other 301s whose
	// to_path == r.From to r.To in the same transaction (returns how many).
	// ErrConflict on a duplicate from_path.
	Create(ctx context.Context, r *domain.Redirect, createdBy *string) (flattened int, err error)
	Update(ctx context.Context, r *domain.Redirect) (flattened int, err error)
	Delete(ctx context.Context, id string) (domain.Redirect, error)
}
