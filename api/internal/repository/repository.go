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
	Status string // "", "all", "draft", "published"
	Query  string
}

type LeadFilter struct {
	domain.Page
	Status string
	Query  string
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
	Create(ctx context.Context, p *domain.Post, createdBy *string) error
	Update(ctx context.Context, p *domain.Post) error
	SoftDelete(ctx context.Context, id string) (domain.Post, error)
	// UpsertBySlug is used by the seeder; it reports whether a row changed.
	UpsertBySlug(ctx context.Context, p *domain.Post) (changed bool, err error)
}

type Leads interface {
	Create(ctx context.Context, l *domain.Lead) error
	List(ctx context.Context, f LeadFilter) ([]domain.Lead, int, error)
	Get(ctx context.Context, id string) (domain.Lead, error)
	UpdateStatus(ctx context.Context, id string, status domain.LeadStatus, note *string) (domain.Lead, error)
}

type AdminUsers interface {
	GetByEmail(ctx context.Context, email string) (domain.AdminUser, error)
	GetByID(ctx context.Context, id string) (domain.AdminUser, error)
	Create(ctx context.Context, u *domain.AdminUser) error
	UpdatePassword(ctx context.Context, id, hash string) error
	UpdateName(ctx context.Context, id, name string) error
	TouchLogin(ctx context.Context, id string, at time.Time) error
}

type Sessions interface {
	Create(ctx context.Context, s *domain.Session) error
	// GetValid returns an unexpired session and its active user.
	GetValid(ctx context.Context, tokenHash []byte, now time.Time) (domain.Session, domain.AdminUser, error)
	DeleteByTokenHash(ctx context.Context, tokenHash []byte) error
	DeleteByUser(ctx context.Context, userID string) error
	DeleteExpired(ctx context.Context, now time.Time) (int64, error)
}

type Media interface {
	Create(ctx context.Context, m *domain.Media) error
	Get(ctx context.Context, id string) (domain.Media, error)
}
