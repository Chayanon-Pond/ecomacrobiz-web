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

// userRef resolves a user id to a ref (caller holds mu).
func (s *Store) userRef(id *string) *domain.UserRef {
	if id == nil || *id == "" {
		return nil
	}
	for _, u := range s.users {
		if u.ID == *id {
			return &domain.UserRef{ID: u.ID, Name: u.Name, Email: u.Email}
		}
	}
	return nil
}

func sortPosts(ps []domain.Post, by string) {
	pub := func(p domain.Post) time.Time {
		if p.PublishedAt == nil {
			return time.Time{}
		}
		return *p.PublishedAt
	}
	sort.SliceStable(ps, func(i, j int) bool {
		a, b := ps[i], ps[j]
		switch by {
		case "updated_asc":
			return a.UpdatedAt.Before(b.UpdatedAt)
		case "published_desc":
			return pub(a).After(pub(b))
		case "published_asc":
			return pub(a).Before(pub(b))
		case "title_asc":
			return a.Title < b.Title
		default:
			return a.UpdatedAt.After(b.UpdatedAt)
		}
	})
}

// ---- posts ----

func (r posts) SlugsTaken(_ context.Context, candidates []string, excludeID string) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for _, c := range candidates {
		for _, p := range r.posts {
			if !p.deleted && p.ID != excludeID && (p.Slug == c || slices.Contains(p.LegacySlugs, c)) {
				out = append(out, c)
				break
			}
		}
	}
	return out, nil
}

func (r posts) SetStatus(_ context.Context, id string, st domain.PostStatus, at *time.Time) (domain.Post, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	row := r.find(id)
	if row == nil {
		return domain.Post{}, domain.ErrNotFound
	}
	row.Status, row.PublishedAt, row.UpdatedAt = st, at, r.Now().UTC()
	return clonePost(row.Post), nil
}

func (r posts) PublishDue(_ context.Context, now time.Time) ([]domain.PostRef, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.PostRef
	for _, p := range r.posts {
		if !p.deleted && p.Status == domain.PostScheduled && p.PublishedAt != nil && !p.PublishedAt.After(now) {
			p.Status = domain.PostPublished
			out = append(out, domain.PostRef{ID: p.ID, Slug: p.Slug})
		}
	}
	return out, nil
}

func (r posts) Stats(context.Context) (domain.PostStats, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var s domain.PostStats
	for _, p := range r.posts {
		if p.deleted {
			continue
		}
		switch p.Status {
		case domain.PostPublished:
			s.Published++
		case domain.PostDraft:
			s.Drafts++
		case domain.PostScheduled:
			s.Scheduled++
			if s.NextScheduledAt == nil || p.PublishedAt.Before(*s.NextScheduledAt) {
				t := *p.PublishedAt
				s.NextScheduledAt = &t
			}
		}
	}
	return s, nil
}

// ---- leads ----

func leadMatches(l domain.Lead, f repository.LeadFilter) bool {
	switch f.Assigned {
	case "":
	case "none":
		if l.AssignedTo != nil {
			return false
		}
	default:
		if l.AssignedTo == nil || l.AssignedTo.ID != f.Assigned {
			return false
		}
	}
	if f.CreatedFrom != nil && l.CreatedAt.Before(*f.CreatedFrom) {
		return false
	}
	if f.CreatedTo != nil && !l.CreatedAt.Before(*f.CreatedTo) {
		return false
	}
	return true
}

func (r leads) Board(ctx context.Context, f repository.LeadFilter, per int) (map[domain.LeadStatus][]domain.Lead, map[domain.LeadStatus]int, error) {
	f.Status = ""
	f.Page = domain.Page{Page: 1, PerPage: 1 << 30}
	all, _, err := r.List(ctx, f)
	if err != nil {
		return nil, nil, err
	}
	cols := map[domain.LeadStatus][]domain.Lead{}
	counts := map[domain.LeadStatus]int{}
	for _, l := range all {
		counts[l.Status]++
		if len(cols[l.Status]) < per {
			cols[l.Status] = append(cols[l.Status], l)
		}
	}
	return cols, counts, nil
}

func actorLabel(a domain.Actor) string {
	if a.Name != "" {
		return a.Name
	}
	return a.Email
}

func refLabel(r *domain.UserRef) string {
	if r == nil {
		return ""
	}
	if r.Name != "" {
		return r.Name
	}
	return r.Email
}

func (s *Store) addActivity(leadID string, a domain.Actor, kind, body, from, to string) domain.LeadActivity {
	act := domain.LeadActivity{ID: uuid.NewString(), LeadID: leadID, Kind: kind, Body: body, From: from, To: to,
		CreatedAt: s.Now().UTC()}
	if !a.IsSystem() {
		id := a.ID
		act.ActorID = &id
		act.ActorName = actorLabel(a)
		act.Actor = &domain.UserRef{ID: a.ID, Name: a.Name, Email: a.Email}
	}
	s.activities = append(s.activities, act)
	return act
}

func (r leads) Apply(_ context.Context, id string, ch repository.LeadChange, a domain.Actor) (domain.Lead, domain.Lead, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.leads {
		l := &r.leads[i]
		if l.ID != id {
			continue
		}
		before := *l
		if ch.Status != nil {
			l.Status = *ch.Status
		}
		if ch.AssignSet {
			l.AssignedTo = r.userRef(ch.AssignedTo)
		}
		if ch.Note != nil {
			l.Note = *ch.Note
		}
		l.UpdatedAt = r.Now().UTC()
		if l.Status != before.Status {
			r.addActivity(id, a, domain.LeadActivityStatus, "", string(before.Status), string(l.Status))
		}
		bID, aID := "", ""
		if before.AssignedTo != nil {
			bID = before.AssignedTo.ID
		}
		if l.AssignedTo != nil {
			aID = l.AssignedTo.ID
		}
		if bID != aID {
			r.addActivity(id, a, domain.LeadActivityAssign, "", refLabel(before.AssignedTo), refLabel(l.AssignedTo))
		}
		return before, *l, nil
	}
	return domain.Lead{}, domain.Lead{}, domain.ErrNotFound
}

func (r leads) AddNote(_ context.Context, leadID string, a domain.Actor, body string) (domain.LeadActivity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, l := range r.leads {
		if l.ID == leadID {
			return r.addActivity(leadID, a, domain.LeadActivityNote, body, "", ""), nil
		}
	}
	return domain.LeadActivity{}, domain.ErrNotFound
}

func (r leads) Activities(_ context.Context, leadID string) ([]domain.LeadActivity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.LeadActivity
	for i := len(r.activities) - 1; i >= 0; i-- {
		if r.activities[i].LeadID == leadID {
			out = append(out, r.activities[i])
		}
	}
	return out, nil
}

func (r leads) Assignees(_ context.Context, roles []domain.Role) ([]domain.UserRef, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.UserRef
	for _, u := range r.users {
		if u.IsActive && slices.Contains(roles, u.Role) {
			out = append(out, domain.UserRef{ID: u.ID, Name: u.Name, Email: u.Email})
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

// Stats mirrors the Postgres query: Asia/Bangkok calendar days.
func (r leads) Stats(_ context.Context, now time.Time) (domain.LeadStats, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	loc, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		loc = time.FixedZone("ICT", 7*3600)
	}
	day := func(t time.Time) time.Time {
		y, m, d := t.In(loc).Date()
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	}
	today := day(now)
	s := domain.LeadStats{ByStatus: map[domain.LeadStatus]int{}}
	for _, st := range []domain.LeadStatus{domain.LeadNew, domain.LeadContacted, domain.LeadQualified,
		domain.LeadClosed, domain.LeadSpam} {
		s.ByStatus[st] = 0
	}
	daily := map[time.Time]int{}
	for _, l := range r.leads {
		d := day(l.CreatedAt)
		ago := int(today.Sub(d).Hours() / 24)
		s.ByStatus[l.Status]++
		daily[d]++
		switch {
		case ago == 0:
			s.Today++
		case ago == 1:
			s.Yesterday++
		}
		if ago >= 0 && ago <= 6 {
			s.Last7++
		} else if ago >= 7 && ago <= 13 {
			s.Prev7++
		}
		if ago >= 0 && ago <= 29 {
			s.Last30++
		} else if ago >= 30 && ago <= 59 {
			s.Prev30++
		}
	}
	for i := 29; i >= 0; i-- {
		d := today.AddDate(0, 0, -i)
		s.Daily = append(s.Daily, domain.DayCount{Date: d.Format("2006-01-02"), Count: daily[d]})
	}
	return s, nil
}

// SetLeadCreatedAt overrides a lead's created_at (test helper).
func (s *Store) SetLeadCreatedAt(id string, t time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.leads {
		if s.leads[i].ID == id {
			s.leads[i].CreatedAt = t
		}
	}
}

// ---- media ----

// usage lists live posts referencing m (caller holds mu).
func (s *Store) usage(m domain.Media) []domain.MediaUsage {
	var out []domain.MediaUsage
	for _, p := range s.posts {
		if p.deleted {
			continue
		}
		cover := p.CoverMediaID != nil && *p.CoverMediaID == m.ID
		if cover || strings.Contains(p.BodyMarkdown, m.StorageKey) {
			kind := "body"
			if cover {
				kind = "cover"
			}
			out = append(out, domain.MediaUsage{PostID: p.ID, Title: p.Title, Slug: p.Slug, Status: p.Status, Kind: kind})
		}
	}
	return out
}

func (s *Store) fillMedia(m domain.Media) domain.Media {
	m.Uploader = s.userRef(m.UploadedBy)
	m.UsageCount = len(s.usage(m))
	return m
}

func (r media) List(_ context.Context, f repository.MediaFilter) ([]domain.Media, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	q := strings.ToLower(strings.TrimSpace(f.Query))
	var out []domain.Media
	for i := len(r.media) - 1; i >= 0; i-- {
		m := r.media[i]
		if f.Mime != "" && m.Mime != f.Mime {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(m.OriginalName), q) && !strings.Contains(strings.ToLower(m.Alt), q) {
			continue
		}
		out = append(out, r.fillMedia(m))
	}
	return page(out, f.Page), len(out), nil
}

func (r media) Usage(_ context.Context, id string) ([]domain.MediaUsage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.media {
		if m.ID == id {
			return r.usage(m), nil
		}
	}
	return nil, nil
}

func (r media) UpdateAlt(_ context.Context, id, alt string) (domain.Media, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.media {
		if r.media[i].ID == id {
			r.media[i].Alt = alt
			return r.fillMedia(r.media[i]), nil
		}
	}
	return domain.Media{}, domain.ErrNotFound
}

func (r media) SoftDeleteUnused(_ context.Context, id string) (domain.Media, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, m := range r.media {
		if m.ID != id {
			continue
		}
		if n := len(r.usage(m)); n > 0 {
			return r.fillMedia(m), &domain.InUseError{Count: n}
		}
		r.media = slices.Delete(r.media, i, i+1)
		return m, nil
	}
	return domain.Media{}, domain.ErrNotFound
}
