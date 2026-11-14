package fake

import (
	"context"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

type redirects struct{ *Store }

func (s *Store) RedirectsRepo() repository.Redirects { return redirects{s} }

func cloneRedirect(d domain.Redirect) domain.Redirect {
	if d.To != nil {
		t := *d.To
		d.To = &t
	}
	if d.CreatedBy != nil {
		c := *d.CreatedBy
		d.CreatedBy = &c
	}
	return d
}

// applyPlan mirrors repository.applyRedirectPlan (caller holds mu).
func (s *Store) applyPlan(plan *repository.RedirectPlan) {
	if plan.Empty() {
		return
	}
	s.redirects = slices.DeleteFunc(s.redirects, func(d domain.Redirect) bool {
		return slices.Contains(plan.Remove, d.From)
	})
	now := s.Now().UTC()
	for _, set := range plan.Set {
		d := cloneRedirect(set.Redirect)
		d.CreatedBy = s.userRef(set.CreatedBy)
		d.UpdatedAt = now
		if i := s.redirectByFrom(d.From); i >= 0 {
			d.ID, d.CreatedAt = s.redirects[i].ID, s.redirects[i].CreatedAt
			s.redirects[i] = d
		} else {
			d.ID, d.CreatedAt = uuid.NewString(), now
			s.redirects = append(s.redirects, d)
		}
		if d.Status == 301 && d.To != nil {
			s.repoint(d.From, *d.To)
		}
	}
	for _, m := range plan.Repoint {
		s.repoint(m.Old, m.New)
	}
}

func (s *Store) redirectByFrom(from string) int {
	for i, d := range s.redirects {
		if d.From == from {
			return i
		}
	}
	return -1
}

func (s *Store) repoint(oldTo, newTo string) int {
	if oldTo == newTo {
		return 0
	}
	s.redirects = slices.DeleteFunc(s.redirects, func(d domain.Redirect) bool {
		return d.Status == 301 && d.To != nil && *d.To == oldTo && d.From == newTo
	})
	n := 0
	for i := range s.redirects {
		if d := &s.redirects[i]; d.Status == 301 && d.To != nil && *d.To == oldTo {
			t := newTo
			d.To = &t
			n++
		}
	}
	return n
}

func (r redirects) List(_ context.Context, f repository.RedirectFilter) ([]domain.Redirect, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	q := strings.ToLower(strings.TrimSpace(f.Query))
	var out []domain.Redirect
	for _, d := range r.redirects {
		to := ""
		if d.To != nil {
			to = *d.To
		}
		if q != "" && !strings.Contains(strings.ToLower(d.From), q) && !strings.Contains(strings.ToLower(to), q) &&
			!strings.Contains(strings.ToLower(d.Note), q) {
			continue
		}
		if (f.Kind != "" && d.Kind != f.Kind) || (f.Status != 0 && d.Status != f.Status) {
			continue
		}
		out = append(out, cloneRedirect(d))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].From < out[j].From })
	return page(out, f.Page), len(out), nil
}

func (r redirects) All(context.Context) ([]domain.Redirect, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.Redirect, 0, len(r.redirects))
	for _, d := range r.redirects {
		out = append(out, cloneRedirect(d))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].From < out[j].From })
	return out, nil
}

func (r redirects) Get(_ context.Context, id string) (domain.Redirect, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, d := range r.redirects {
		if d.ID == id {
			return cloneRedirect(d), nil
		}
	}
	return domain.Redirect{}, domain.ErrNotFound
}

func (r redirects) GetByFrom(_ context.Context, from string) (domain.Redirect, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if i := r.redirectByFrom(from); i >= 0 {
		return cloneRedirect(r.redirects[i]), nil
	}
	return domain.Redirect{}, domain.ErrNotFound
}

func (r redirects) Create(_ context.Context, d *domain.Redirect, createdBy *string) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.redirectByFrom(d.From) >= 0 {
		return 0, domain.ErrConflict
	}
	now := r.Now().UTC()
	d.ID, d.CreatedAt, d.UpdatedAt = uuid.NewString(), now, now
	d.CreatedBy = r.userRef(createdBy)
	r.redirects = append(r.redirects, cloneRedirect(*d))
	n := 0
	if d.Status == 301 && d.To != nil {
		n = r.repoint(d.From, *d.To)
	}
	return n, nil
}

func (r redirects) Update(_ context.Context, d *domain.Redirect) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if i := r.redirectByFrom(d.From); i >= 0 && r.redirects[i].ID != d.ID {
		return 0, domain.ErrConflict
	}
	for i := range r.redirects {
		cur := &r.redirects[i]
		if cur.ID != d.ID {
			continue
		}
		cur.From, cur.To, cur.Status, cur.Kind, cur.Note = d.From, d.To, d.Status, d.Kind, d.Note
		cur.UpdatedAt = r.Now().UTC()
		*d = cloneRedirect(*cur)
		n := 0
		if d.Status == 301 && d.To != nil {
			n = r.repoint(d.From, *d.To)
		}
		return n, nil
	}
	return 0, domain.ErrNotFound
}

func (r redirects) Delete(_ context.Context, id string) (domain.Redirect, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, d := range r.redirects {
		if d.ID == id {
			r.redirects = slices.Delete(r.redirects, i, i+1)
			return d, nil
		}
	}
	return domain.Redirect{}, domain.ErrNotFound
}

// ---- posts: SEO helpers ----

func (r posts) LiveSlugs(_ context.Context, now time.Time) ([]domain.PostRef, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.PostRef
	for _, p := range r.posts {
		if visible(p, now) {
			out = append(out, domain.PostRef{ID: p.ID, Slug: p.Slug, LegacySlugs: slices.Clone(p.LegacySlugs)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out, nil
}

func (r posts) LinkSuggestions(_ context.Context, excludeID, query string, limit int, now time.Time) ([]domain.LinkSuggestion, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var cats []string
	if src := r.find(excludeID); src != nil {
		cats = src.CategorySlugs()
	}
	q := strings.ToLower(strings.TrimSpace(query))
	type cand struct {
		p      *postRow
		shared int
		kw     bool
	}
	var cs []cand
	for _, p := range r.posts {
		if !visible(p, now) || p.ID == excludeID {
			continue
		}
		c := cand{p: p}
		for _, s := range p.CategorySlugs() {
			if slices.Contains(cats, s) {
				c.shared++
			}
		}
		c.kw = q != "" && (strings.Contains(strings.ToLower(p.Title), q) || strings.Contains(strings.ToLower(p.Excerpt), q))
		if c.shared > 0 || c.kw {
			cs = append(cs, c)
		}
	}
	sort.SliceStable(cs, func(i, j int) bool {
		a, b := cs[i], cs[j]
		if a.shared != b.shared {
			return a.shared > b.shared
		}
		if a.kw != b.kw {
			return a.kw
		}
		return a.p.PublishedAt.After(*b.p.PublishedAt)
	})
	out := []domain.LinkSuggestion{}
	for _, c := range cs {
		if len(out) == limit {
			break
		}
		out = append(out, domain.LinkSuggestion{ID: c.p.ID, Title: c.p.Title, Slug: c.p.Slug})
	}
	return out, nil
}
