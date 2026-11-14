// Package fake provides in-memory implementations of the repository
// interfaces for service and handler unit tests.
package fake

import (
	"context"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

type postRow struct {
	domain.Post
	deleted bool
}

// Store holds all fake tables behind one mutex.
type Store struct {
	mu         sync.Mutex
	categories []domain.Category
	posts      []*postRow
	leads      []domain.Lead
	users      []domain.AdminUser
	sessions   []domain.Session
	media      []domain.Media
	activities []domain.LeadActivity
	tokens     []domain.UserToken
	audit      []domain.AuditEntry
	touches    int
	Now        func() time.Time
}

func New() *Store {
	return &Store{Now: time.Now, categories: []domain.Category{
		{ID: uuid.NewString(), Slug: "business-growth", Name: "Business Growth", NameTH: "การเติบโตทางธุรกิจ", SortOrder: 10},
		{ID: uuid.NewString(), Slug: "brand-insight", Name: "Brand Insight", NameTH: "อินไซต์แบรนด์", SortOrder: 20},
		{ID: uuid.NewString(), Slug: "ecomacrobiz-insights", Name: "ECOMACROBIZ Insights", SortOrder: 30},
		{ID: uuid.NewString(), Slug: "learning-hub", Name: "Learning Hub", SortOrder: 40},
	}}
}

type categories struct{ *Store }
type posts struct{ *Store }
type leads struct{ *Store }
type users struct{ *Store }
type sessions struct{ *Store }
type media struct{ *Store }

func (s *Store) CategoriesRepo() repository.Categories { return categories{s} }
func (s *Store) PostsRepo() repository.Posts           { return posts{s} }
func (s *Store) LeadsRepo() repository.Leads           { return leads{s} }
func (s *Store) AdminUsersRepo() repository.AdminUsers { return users{s} }
func (s *Store) SessionsRepo() repository.Sessions     { return sessions{s} }
func (s *Store) MediaRepo() repository.Media           { return media{s} }

func page[T any](items []T, p domain.Page) []T {
	start := p.Offset()
	if start >= len(items) {
		return nil
	}
	end := min(start+p.PerPage, len(items))
	return items[start:end]
}

// ---- categories ----

func (r categories) List(context.Context) ([]domain.Category, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.Now()
	out := make([]domain.Category, len(r.categories))
	copy(out, r.categories)
	for i := range out {
		for _, p := range r.posts {
			if visible(p, now) && slices.Contains(p.CategorySlugs(), out[i].Slug) {
				out[i].PostCount++
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].SortOrder < out[j].SortOrder })
	return out, nil
}

func (r categories) ExistingSlugs(_ context.Context, slugs []string) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for _, c := range r.categories {
		if slices.Contains(slugs, c.Slug) {
			out = append(out, c.Slug)
		}
	}
	return out, nil
}

func (r categories) Upsert(_ context.Context, c domain.Category) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.categories {
		if r.categories[i].Slug == c.Slug {
			c.ID = r.categories[i].ID
			r.categories[i] = c
			return nil
		}
	}
	c.ID = uuid.NewString()
	r.categories = append(r.categories, c)
	return nil
}

func (s *Store) categoryRef(slug string) domain.CategoryRef {
	for _, c := range s.categories {
		if c.Slug == slug {
			return domain.CategoryRef{Slug: c.Slug, Name: c.Name, NameTH: c.NameTH}
		}
	}
	return domain.CategoryRef{Slug: slug}
}

// ---- posts ----

func visible(p *postRow, now time.Time) bool {
	return !p.deleted && p.Status == domain.PostPublished && p.PublishedAt != nil && !p.PublishedAt.After(now)
}

func clonePost(p domain.Post) domain.Post {
	p.LegacySlugs = slices.Clone(p.LegacySlugs)
	p.Categories = slices.Clone(p.Categories)
	if p.Categories == nil {
		p.Categories = []domain.CategoryRef{}
	}
	if p.Cover != nil {
		c := *p.Cover
		p.Cover = &c
	}
	return p
}

func (r posts) ListPublished(_ context.Context, f repository.PostFilter, now time.Time) ([]domain.Post, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.Post
	for _, p := range r.posts {
		if !visible(p, now) {
			continue
		}
		if f.CategorySlug != "" && !slices.Contains(p.CategorySlugs(), f.CategorySlug) {
			continue
		}
		c := clonePost(p.Post)
		c.BodyMarkdown = ""
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].PublishedAt.After(*out[j].PublishedAt) })
	return page(out, f.Page), len(out), nil
}

func (r posts) GetPublishedBySlug(_ context.Context, slug string, now time.Time) (domain.Post, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, p := range r.posts {
		if visible(p, now) && p.Slug == slug {
			return clonePost(p.Post), nil
		}
	}
	for _, p := range r.posts {
		if visible(p, now) && slices.Contains(p.LegacySlugs, slug) {
			return clonePost(p.Post), nil
		}
	}
	return domain.Post{}, domain.ErrNotFound
}

func (r posts) AdminList(_ context.Context, f repository.AdminPostFilter) ([]domain.Post, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.Post
	q := strings.ToLower(strings.TrimSpace(f.Query))
	for _, p := range r.posts {
		if p.deleted {
			continue
		}
		if domain.PostStatus(f.Status).Valid() && string(p.Status) != f.Status {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(p.Title), q) && !strings.Contains(p.Slug, q) {
			continue
		}
		if f.CategorySlug != "" && !slices.Contains(p.CategorySlugs(), f.CategorySlug) {
			continue
		}
		c := clonePost(p.Post)
		c.BodyMarkdown = ""
		out = append(out, c)
	}
	sortPosts(out, f.Sort)
	return page(out, f.Page), len(out), nil
}

func (r posts) find(id string) *postRow {
	for _, p := range r.posts {
		if p.ID == id && !p.deleted {
			return p
		}
	}
	return nil
}

func (r posts) GetByID(_ context.Context, id string) (domain.Post, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p := r.find(id); p != nil {
		return clonePost(p.Post), nil
	}
	return domain.Post{}, domain.ErrNotFound
}

func (r posts) slugTaken(slug, exceptID string) bool {
	for _, p := range r.posts {
		if !p.deleted && p.Slug == slug && p.ID != exceptID {
			return true
		}
	}
	return false
}

func (r posts) resolve(p *domain.Post) {
	refs := make([]domain.CategoryRef, 0, len(p.Categories))
	for _, c := range p.Categories {
		refs = append(refs, r.categoryRef(c.Slug))
	}
	p.Categories = refs
}

func (r posts) Create(_ context.Context, p *domain.Post, createdBy *string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.slugTaken(p.Slug, "") {
		return domain.ErrConflict
	}
	now := r.Now().UTC()
	p.CreatedBy = r.userRef(createdBy)
	p.ID = uuid.NewString()
	p.CreatedAt, p.UpdatedAt = now, now
	r.resolve(p)
	r.posts = append(r.posts, &postRow{Post: clonePost(*p)})
	return nil
}

func (r posts) Update(_ context.Context, p *domain.Post) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	row := r.find(p.ID)
	if row == nil {
		return domain.ErrNotFound
	}
	if r.slugTaken(p.Slug, p.ID) {
		return domain.ErrConflict
	}
	p.CreatedAt = row.CreatedAt
	p.CreatedBy = row.CreatedBy
	p.UpdatedAt = r.Now().UTC()
	r.resolve(p)
	row.Post = clonePost(*p)
	return nil
}

func (r posts) SoftDelete(_ context.Context, id string) (domain.Post, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	row := r.find(id)
	if row == nil {
		return domain.Post{}, domain.ErrNotFound
	}
	row.deleted = true
	return clonePost(row.Post), nil
}

func (r posts) UpsertBySlug(_ context.Context, p *domain.Post) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.resolve(p)
	for _, row := range r.posts {
		if !row.deleted && row.Slug == p.Slug {
			p.ID = row.ID
			p.CreatedAt = row.CreatedAt
			row.Post = clonePost(*p)
			return true, nil
		}
	}
	p.ID = uuid.NewString()
	p.CreatedAt = r.Now().UTC()
	r.posts = append(r.posts, &postRow{Post: clonePost(*p)})
	return true, nil
}

// ---- leads ----

func (r leads) Create(_ context.Context, l *domain.Lead) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.Now().UTC()
	l.ID = uuid.NewString()
	l.CreatedAt, l.UpdatedAt = now, now
	if l.Status == "" {
		l.Status = domain.LeadNew
	}
	r.leads = append(r.leads, *l)
	return nil
}

func (r leads) List(_ context.Context, f repository.LeadFilter) ([]domain.Lead, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.Lead
	q := strings.ToLower(strings.TrimSpace(f.Query))
	for i := len(r.leads) - 1; i >= 0; i-- {
		l := r.leads[i]
		if f.Status != "" && string(l.Status) != f.Status {
			continue
		}
		if !leadMatches(l, f) {
			continue
		}
		hay := strings.ToLower(strings.Join([]string{l.FirstName, l.LastName, l.Email, l.Phone, l.Company, l.LineID}, " "))
		if q != "" && !strings.Contains(hay, q) {
			continue
		}
		out = append(out, l)
	}
	return page(out, f.Page), len(out), nil
}

func (r leads) Get(_ context.Context, id string) (domain.Lead, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, l := range r.leads {
		if l.ID == id {
			return l, nil
		}
	}
	return domain.Lead{}, domain.ErrNotFound
}

func (r leads) UpdateStatus(_ context.Context, id string, st domain.LeadStatus, note *string) (domain.Lead, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.leads {
		if r.leads[i].ID == id {
			r.leads[i].Status = st
			if note != nil {
				r.leads[i].Note = *note
			}
			r.leads[i].UpdatedAt = r.Now().UTC()
			return r.leads[i], nil
		}
	}
	return domain.Lead{}, domain.ErrNotFound
}

// Leads returns a snapshot of stored leads (test helper).
func (s *Store) Leads() []domain.Lead {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.leads)
}

// ---- admin users ----

func (r users) GetByEmail(_ context.Context, email string) (domain.AdminUser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, u := range r.users {
		if strings.EqualFold(u.Email, email) {
			return u, nil
		}
	}
	return domain.AdminUser{}, domain.ErrNotFound
}

func (r users) GetByID(_ context.Context, id string) (domain.AdminUser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, u := range r.users {
		if u.ID == id {
			return u, nil
		}
	}
	return domain.AdminUser{}, domain.ErrNotFound
}

func (r users) Create(_ context.Context, u *domain.AdminUser) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, x := range r.users {
		if strings.EqualFold(x.Email, u.Email) {
			return domain.ErrConflict
		}
	}
	u.ID = uuid.NewString()
	u.Email = strings.ToLower(u.Email)
	u.IsActive = true
	if u.Role == "" {
		u.Role = domain.RoleViewer
	}
	u.CreatedAt = r.Now().UTC()
	r.users = append(r.users, *u)
	return nil
}

func (r users) update(id string, fn func(*domain.AdminUser)) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.users {
		if r.users[i].ID == id {
			fn(&r.users[i])
			return nil
		}
	}
	return domain.ErrNotFound
}

func (r users) UpdatePassword(_ context.Context, id, hash string) error {
	now := r.Now().UTC()
	return r.update(id, func(u *domain.AdminUser) { u.PasswordHash, u.PasswordChangedAt = hash, &now })
}

func (r users) UpdateName(_ context.Context, id, name string) error {
	return r.update(id, func(u *domain.AdminUser) { u.Name = name })
}

func (r users) TouchLogin(_ context.Context, id string, at time.Time) error {
	return r.update(id, func(u *domain.AdminUser) { u.LastLoginAt = &at })
}

// SetActive toggles a user (test helper).
func (s *Store) SetActive(id string, active bool) {
	_ = users{s}.update(id, func(u *domain.AdminUser) { u.IsActive = active })
}

// ---- sessions ----

func (r sessions) Create(_ context.Context, s *domain.Session) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	s.ID = uuid.NewString()
	r.sessions = append(r.sessions, *s)
	return nil
}

func (r sessions) GetValid(_ context.Context, hash []byte, now time.Time) (domain.Session, domain.AdminUser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.sessions {
		if string(s.TokenHash) == string(hash) && s.ExpiresAt.After(now) {
			for _, u := range r.users {
				if u.ID == s.AdminUserID && u.IsActive {
					return s, u, nil
				}
			}
		}
	}
	return domain.Session{}, domain.AdminUser{}, domain.ErrNotFound
}

func (r sessions) deleteWhere(fn func(domain.Session) bool) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	before := len(r.sessions)
	r.sessions = slices.DeleteFunc(r.sessions, fn)
	return int64(before - len(r.sessions))
}

func (r sessions) DeleteByTokenHash(_ context.Context, hash []byte) error {
	r.deleteWhere(func(s domain.Session) bool { return string(s.TokenHash) == string(hash) })
	return nil
}

func (r sessions) DeleteByUser(_ context.Context, userID string) error {
	r.deleteWhere(func(s domain.Session) bool { return s.AdminUserID == userID })
	return nil
}

func (r sessions) DeleteExpired(_ context.Context, now time.Time) (int64, error) {
	return r.deleteWhere(func(s domain.Session) bool { return !s.ExpiresAt.After(now) }), nil
}

// SessionCount returns the number of stored sessions (test helper).
func (s *Store) SessionCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sessions)
}

// ---- media ----

func (r media) Create(_ context.Context, m *domain.Media) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	m.ID = uuid.NewString()
	m.CreatedAt = r.Now().UTC()
	r.media = append(r.media, *m)
	*m = r.fillMedia(*m)
	return nil
}

func (r media) Get(_ context.Context, id string) (domain.Media, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.media {
		if m.ID == id {
			return r.fillMedia(m), nil
		}
	}
	return domain.Media{}, domain.ErrNotFound
}
