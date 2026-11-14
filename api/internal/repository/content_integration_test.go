package repository_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

func mkContentUser(t *testing.T, store *repository.Store, pool *pgxpool.Pool, email, name string, role domain.Role, active bool) domain.AdminUser {
	t.Helper()
	ctx := context.Background()
	u := domain.AdminUser{Email: email, Name: name, PasswordHash: "h", Role: role}
	if err := store.AdminUsers.Create(ctx, &u); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE admin_users SET role = $2, is_active = $3, name = $4 WHERE id = $1`,
		u.ID, string(role), active, name); err != nil {
		t.Fatal(err)
	}
	u.Role, u.IsActive, u.Name = role, active, name
	return u
}

func pg(n int) domain.Page { return domain.Page{Page: 1, PerPage: n} }

func TestPostsAdminV2(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	u := mkContentUser(t, store, pool, "writer@example.com", "นักเขียน", domain.RoleEditor, true)
	now := time.Now().UTC().Truncate(time.Microsecond)
	past, soon, later := now.Add(-time.Hour), now.Add(time.Hour), now.Add(48*time.Hour)
	mk := func(slug, title string, st domain.PostStatus, at *time.Time, cats []string, legacy []string) domain.Post {
		p := domain.Post{Slug: slug, Title: title, Status: st, PublishedAt: at, BodyMarkdown: "x", LegacySlugs: legacy}
		for _, c := range cats {
			p.Categories = append(p.Categories, domain.CategoryRef{Slug: c})
		}
		if err := store.Posts.Create(ctx, &p, &u.ID); err != nil {
			t.Fatal(err)
		}
		return p
	}
	a := mk("a-slug", "Zeta", domain.PostPublished, &past, []string{"brand-insight"}, []string{"legacy-a"})
	mk("b-slug", "Alpha", domain.PostDraft, nil, nil, nil)
	mk("c-slug", "Mid", domain.PostScheduled, &later, nil, nil)
	mk("d-slug", "Beta", domain.PostScheduled, &soon, nil, nil)

	if a.CreatedBy == nil || a.CreatedBy.ID != u.ID || a.CreatedBy.Name != "นักเขียน" || a.CreatedBy.Email != u.Email {
		t.Fatalf("created_by: %+v", a.CreatedBy)
	}
	list, total, err := store.Posts.AdminList(ctx, repository.AdminPostFilter{Page: pg(10), Status: "scheduled",
		Sort: "published_asc"})
	if err != nil || total != 2 || list[0].Slug != "d-slug" {
		t.Fatalf("scheduled + published_asc: %d %v", total, err)
	}
	list, _, _ = store.Posts.AdminList(ctx, repository.AdminPostFilter{Page: pg(10), Sort: "title_asc"})
	if len(list) != 4 || list[0].Title != "Alpha" || list[3].Title != "Zeta" {
		t.Fatalf("title_asc: %v", titles(list))
	}
	list, _, _ = store.Posts.AdminList(ctx, repository.AdminPostFilter{Page: pg(10), Sort: "published_desc"})
	if list[0].Slug != "c-slug" || list[3].Slug != "b-slug" { // NULLS LAST
		t.Fatalf("published_desc: %v", titles(list))
	}
	_, total, _ = store.Posts.AdminList(ctx, repository.AdminPostFilter{Page: pg(10), CategorySlug: "brand-insight"})
	if total != 1 {
		t.Fatalf("category: %d", total)
	}
	pub, total, _ := store.Posts.ListPublished(ctx, repository.PostFilter{Page: pg(10)}, now)
	if total != 1 || pub[0].Slug != "a-slug" {
		t.Fatal("public list must exclude scheduled posts")
	}
	if _, err := store.Posts.GetPublishedBySlug(ctx, "c-slug", now.Add(72*time.Hour)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("scheduled post visible publicly even after its time (before the scheduler ran)")
	}

	taken, err := store.Posts.SlugsTaken(ctx, []string{"a-slug", "legacy-a", "free", "b-slug"}, "")
	sort.Strings(taken)
	if err != nil || fmt.Sprint(taken) != "[a-slug b-slug legacy-a]" {
		t.Fatalf("slugs taken: %v %v", taken, err)
	}
	taken, _ = store.Posts.SlugsTaken(ctx, []string{"a-slug", "legacy-a"}, a.ID)
	if len(taken) != 0 {
		t.Fatalf("exclude id: %v", taken)
	}

	st, err := store.Posts.Stats(ctx)
	if err != nil || st.Published != 1 || st.Drafts != 1 || st.Scheduled != 2 || st.NextScheduledAt == nil ||
		!st.NextScheduledAt.Equal(soon) {
		t.Fatalf("stats: %+v %v", st, err)
	}
	got, err := store.Posts.SetStatus(ctx, a.ID, domain.PostDraft, a.PublishedAt)
	if err != nil || got.Status != domain.PostDraft || !got.PublishedAt.Equal(past) {
		t.Fatalf("set status: %+v %v", got, err)
	}
	if _, err := store.Posts.SetStatus(ctx, uuid.NewString(), domain.PostDraft, nil); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("set status missing: %v", err)
	}
	if _, err := store.Posts.SetStatus(ctx, a.ID, domain.PostScheduled, nil); err == nil {
		t.Fatal("scheduled without published_at must violate the CHECK")
	}
}

func titles(ps []domain.Post) []string {
	out := []string{}
	for _, p := range ps {
		out = append(out, p.Slug)
	}
	return out
}

type countingAuditor struct {
	mu  sync.Mutex
	ids []string
}

func (c *countingAuditor) Record(_ context.Context, ev domain.AuditEvent) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ev.Action == domain.AuditPostPublish && ev.Actor.IsSystem() && ev.Metadata["scheduled"] == true {
		c.ids = append(c.ids, ev.TargetID)
	}
}

type nopRV struct{}

func (nopRV) Revalidate(...string) {}

// Several schedulers racing (as with several replicas) publish and audit each
// due post exactly once.
func TestSchedulerIdempotentConcurrent(t *testing.T) {
	store, _ := setup(t)
	ctx := context.Background()
	const n = 40
	due := time.Now().Add(-time.Minute)
	future := time.Now().Add(time.Hour)
	want := map[string]bool{}
	for i := 0; i < n; i++ {
		p := domain.Post{Slug: fmt.Sprintf("due-%d", i), Title: "t", BodyMarkdown: "x", Status: domain.PostScheduled,
			PublishedAt: &due}
		if err := store.Posts.Create(ctx, &p, nil); err != nil {
			t.Fatal(err)
		}
		want[p.ID] = true
	}
	notDue := domain.Post{Slug: "not-due", Title: "t", BodyMarkdown: "x", Status: domain.PostScheduled, PublishedAt: &future}
	_ = store.Posts.Create(ctx, &notDue, nil)

	au := &countingAuditor{}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	var wg sync.WaitGroup
	start := make(chan struct{})
	counts := make([]int, 6)
	errs := make([]error, 6)
	for i := range counts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sch := service.NewPostScheduler(store.Posts, au, nopRV{}, log)
			<-start
			counts[i], errs[i] = sch.RunOnce(ctx)
		}()
	}
	close(start)
	wg.Wait()
	sum := 0
	for i := range counts {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		sum += counts[i]
	}
	if sum != n || len(au.ids) != n {
		t.Fatalf("published %d, audited %d, want %d (per runner %v)", sum, len(au.ids), n, counts)
	}
	slices.Sort(au.ids)
	if len(slices.Compact(slices.Clone(au.ids))) != n {
		t.Fatal("a post was audited twice")
	}
	for _, id := range au.ids {
		if !want[id] {
			t.Fatalf("unexpected post %s published", id)
		}
	}
	if again, _ := service.NewPostScheduler(store.Posts, au, nopRV{}, log).RunOnce(ctx); again != 0 {
		t.Fatalf("second pass published %d", again)
	}
	st, _ := store.Posts.Stats(ctx)
	if st.Published != n || st.Scheduled != 1 {
		t.Fatalf("stats after run: %+v", st)
	}
	pub, total, _ := store.Posts.ListPublished(ctx, repository.PostFilter{Page: pg(50)}, time.Now())
	if total != n || len(pub) != n {
		t.Fatalf("public list after publish: %d", total)
	}
}

func newLead(t *testing.T, store *repository.Store, name string) domain.Lead {
	t.Helper()
	l := domain.Lead{FirstName: name, Phone: "0812345678", Email: "l@example.com", PreferredChannel: domain.ChannelLine,
		ConsentAt: time.Now()}
	if err := store.Leads.Create(context.Background(), &l); err != nil {
		t.Fatal(err)
	}
	return l
}

func TestLeadsCRMIntegration(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	owner := mkContentUser(t, store, pool, "owner@example.com", "Owner", domain.RoleOwner, true)
	sales := mkContentUser(t, store, pool, "sales@example.com", "ฝ่ายขาย", domain.RoleSales, true)
	mkContentUser(t, store, pool, "viewer@example.com", "Viewer", domain.RoleViewer, true)
	mkContentUser(t, store, pool, "gone@example.com", "Gone", domain.RoleSales, false)

	as, err := store.Leads.Assignees(ctx, []domain.Role{domain.RoleOwner, domain.RoleSales})
	if err != nil || len(as) != 2 || as[0].ID != owner.ID || as[1].ID != sales.ID {
		t.Fatalf("assignees: %+v %v", as, err)
	}

	l := newLead(t, store, "A")
	other := newLead(t, store, "B")
	act := domain.Actor{ID: sales.ID, Email: sales.Email, Name: sales.Name, Role: domain.RoleSales}
	st := domain.LeadContacted
	before, after, err := store.Leads.Apply(ctx, l.ID, repository.LeadChange{Status: &st, AssignSet: true,
		AssignedTo: &sales.ID}, act)
	if err != nil || before.Status != domain.LeadNew || before.AssignedTo != nil || after.Status != st ||
		after.AssignedTo == nil || after.AssignedTo.Name != "ฝ่ายขาย" {
		t.Fatalf("apply: %+v %+v %v", before, after, err)
	}
	note := "legacy"
	if _, after, err = store.Leads.Apply(ctx, l.ID, repository.LeadChange{Note: &note}, act); err != nil ||
		after.Note != "legacy" || after.AssignedTo == nil || after.Status != st {
		t.Fatalf("note only keeps the rest: %+v %v", after, err)
	}
	if _, _, err := store.Leads.Apply(ctx, uuid.NewString(), repository.LeadChange{}, act); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("apply missing: %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	n, err := store.Leads.AddNote(ctx, l.ID, act, "โทรแล้ว")
	if err != nil || n.Kind != "note" || n.Body != "โทรแล้ว" || n.Actor == nil || n.ActorName != "ฝ่ายขาย" {
		t.Fatalf("note: %+v %v", n, err)
	}
	if _, err := store.Leads.AddNote(ctx, uuid.NewString(), act, "x"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("note on missing lead: %v", err)
	}
	acts, err := store.Leads.Activities(ctx, l.ID)
	if err != nil || len(acts) != 3 || acts[0].Kind != "note" {
		t.Fatalf("activities: %+v %v", acts, err)
	}
	kinds := map[string]domain.LeadActivity{}
	for _, a := range acts[1:] {
		kinds[a.Kind] = a
	}
	if kinds["status"].From != "new" || kinds["status"].To != "contacted" || kinds["assign"].From != "" ||
		kinds["assign"].To != "ฝ่ายขาย" || kinds["assign"].Actor == nil || kinds["assign"].Actor.Email != sales.Email {
		t.Fatalf("activity rows: %+v", kinds)
	}

	list, total, _ := store.Leads.List(ctx, repository.LeadFilter{Page: pg(10), Assigned: sales.ID})
	if total != 1 || list[0].ID != l.ID {
		t.Fatalf("assigned filter: %d", total)
	}
	list, total, _ = store.Leads.List(ctx, repository.LeadFilter{Page: pg(10), Assigned: "none"})
	if total != 1 || list[0].ID != other.ID {
		t.Fatalf("unassigned filter: %d", total)
	}
	from := time.Now().Add(-time.Hour)
	to := time.Now().Add(time.Hour)
	_, total, _ = store.Leads.List(ctx, repository.LeadFilter{Page: pg(10), CreatedFrom: &from, CreatedTo: &to})
	if total != 2 {
		t.Fatalf("date window: %d", total)
	}
	_, total, _ = store.Leads.List(ctx, repository.LeadFilter{Page: pg(10), CreatedFrom: &to})
	if total != 0 {
		t.Fatalf("future window: %d", total)
	}

	// deleting the acting user keeps the name snapshot
	if _, err := pool.Exec(ctx, `DELETE FROM admin_users WHERE id = $1`, sales.ID); err != nil {
		t.Fatal(err)
	}
	acts, _ = store.Leads.Activities(ctx, l.ID)
	if acts[0].Actor != nil || acts[0].ActorID != nil || acts[0].ActorName != "ฝ่ายขาย" {
		t.Fatalf("deleted actor: %+v", acts[0])
	}
	got, _ := store.Leads.Get(ctx, l.ID)
	if got.AssignedTo != nil {
		t.Fatal("assigned_to must be cleared when the user is deleted (ON DELETE SET NULL)")
	}
}

func TestLeadBoardIntegration(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	u := mkContentUser(t, store, pool, "s@example.com", "S", domain.RoleSales, true)
	var ids []string
	for i := 0; i < 4; i++ {
		ids = append(ids, newLead(t, store, fmt.Sprintf("N%d", i)).ID)
		time.Sleep(2 * time.Millisecond)
	}
	spam := newLead(t, store, "Spam")
	if _, err := pool.Exec(ctx, `UPDATE leads SET status = 'spam' WHERE id = $1`, spam.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE leads SET assigned_to = $2 WHERE id = $1`, ids[0], u.ID); err != nil {
		t.Fatal(err)
	}
	cols, counts, err := store.Leads.Board(ctx, repository.LeadFilter{}, 2)
	if err != nil || counts[domain.LeadNew] != 4 || counts[domain.LeadSpam] != 1 || len(cols[domain.LeadNew]) != 2 ||
		cols[domain.LeadNew][0].ID != ids[3] || len(cols[domain.LeadSpam]) != 1 {
		t.Fatalf("board: %v %v", counts, err)
	}
	cols, counts, _ = store.Leads.Board(ctx, repository.LeadFilter{Assigned: u.ID, Query: "N0"}, 50)
	if counts[domain.LeadNew] != 1 || len(cols[domain.LeadNew]) != 1 || cols[domain.LeadNew][0].AssignedTo == nil {
		t.Fatalf("filtered board: %v", counts)
	}
}

func TestLeadStatsBangkok(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 14, 5, 0, 0, 0, time.UTC) // 12:00 in Bangkok
	at := map[string]time.Time{
		"today":         now,
		"today-early":   time.Date(2026, 11, 13, 17, 30, 0, 0, time.UTC), // 00:30 Nov 14 Bangkok
		"yesterday":     time.Date(2026, 11, 13, 16, 30, 0, 0, time.UTC), // 23:30 Nov 13 Bangkok
		"three-days":    now.AddDate(0, 0, -3),
		"ten-days":      now.AddDate(0, 0, -10),
		"forty-days":    now.AddDate(0, 0, -40),
		"deleted-today": now,
	}
	for name, ts := range at {
		l := newLead(t, store, name)
		if _, err := pool.Exec(ctx, `UPDATE leads SET created_at = $2 WHERE id = $1`, l.ID, ts); err != nil {
			t.Fatal(err)
		}
		if name == "ten-days" {
			_, _ = pool.Exec(ctx, `UPDATE leads SET status = 'qualified' WHERE id = $1`, l.ID)
		}
		if name == "deleted-today" {
			_, _ = pool.Exec(ctx, `UPDATE leads SET deleted_at = now() WHERE id = $1`, l.ID)
		}
	}
	s, err := store.Leads.Stats(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if s.Today != 2 || s.Yesterday != 1 || s.Last7 != 4 || s.Prev7 != 1 || s.Last30 != 5 || s.Prev30 != 1 {
		t.Fatalf("counts: %+v", s)
	}
	if s.ByStatus[domain.LeadNew] != 5 || s.ByStatus[domain.LeadQualified] != 1 || s.ByStatus[domain.LeadSpam] != 0 {
		t.Fatalf("by status: %v", s.ByStatus)
	}
	if len(s.Daily) != 30 || s.Daily[0].Date != "2026-10-16" || s.Daily[29].Date != "2026-11-14" ||
		s.Daily[29].Count != 2 || s.Daily[28].Count != 1 || s.Daily[26].Count != 1 || s.Daily[19].Count != 1 {
		t.Fatalf("daily: %+v", s.Daily)
	}
	sum := 0
	for _, d := range s.Daily {
		sum += d.Count
	}
	if sum != s.Last30 {
		t.Fatalf("daily sum %d != last30 %d", sum, s.Last30)
	}
	// empty table: still 30 zero-filled days
	empty, _ := setup(t)
	s, err = empty.Leads.Stats(ctx, now)
	if err != nil || len(s.Daily) != 30 || s.Today != 0 || s.ByStatus[domain.LeadNew] != 0 {
		t.Fatalf("empty stats: %+v %v", s, err)
	}
}

func TestMediaUsageIntegration(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	u := mkContentUser(t, store, pool, "ed@example.com", "Editor", domain.RoleEditor, true)
	mk := func(name, mime, alt string) domain.Media {
		m := domain.Media{StorageKey: uuid.NewString() + ".png", URL: "http://x/media/a.png", OriginalName: name,
			Mime: mime, SizeBytes: 10, Width: 4, Height: 3, UploadedBy: &u.ID, Alt: alt}
		if err := store.Media.Create(ctx, &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	cover := mk("cover.png", "image/png", "ภาพปก")
	body := mk("body.png", "image/png", "")
	unused := mk("unused.webp", "image/webp", "")
	if cover.Alt != "ภาพปก" || cover.Uploader == nil || cover.Uploader.Name != "Editor" || cover.UsageCount != 0 {
		t.Fatalf("created: %+v", cover)
	}
	p := domain.Post{Slug: "p", Title: "P", Status: domain.PostDraft, CoverMediaID: &cover.ID,
		Cover:        &domain.Cover{URL: cover.URL},
		BodyMarkdown: "![a](http://x/media/" + body.StorageKey + ")"}
	if err := store.Posts.Create(ctx, &p, nil); err != nil {
		t.Fatal(err)
	}
	gone := domain.Post{Slug: "gone", Title: "G", Status: domain.PostDraft, BodyMarkdown: unused.StorageKey}
	_ = store.Posts.Create(ctx, &gone, nil)
	_, _ = store.Posts.SoftDelete(ctx, gone.ID)

	list, total, err := store.Media.List(ctx, repository.MediaFilter{Page: pg(10)})
	if err != nil || total != 3 {
		t.Fatalf("list: %d %v", total, err)
	}
	usage := map[string]int{}
	for _, m := range list {
		usage[m.ID] = m.UsageCount
	}
	if usage[cover.ID] != 1 || usage[body.ID] != 1 || usage[unused.ID] != 0 || list[0].ID != unused.ID {
		t.Fatalf("usage counts / order: %v", usage)
	}
	_, total, _ = store.Media.List(ctx, repository.MediaFilter{Page: pg(10), Query: "ปก"})
	if total != 1 {
		t.Fatalf("alt search: %d", total)
	}
	_, total, _ = store.Media.List(ctx, repository.MediaFilter{Page: pg(10), Mime: "image/webp"})
	if total != 1 {
		t.Fatalf("type filter: %d", total)
	}
	us, err := store.Media.Usage(ctx, cover.ID)
	if err != nil || len(us) != 1 || us[0].Kind != "cover" || us[0].PostID != p.ID || us[0].Status != domain.PostDraft {
		t.Fatalf("cover usage: %+v %v", us, err)
	}
	us, _ = store.Media.Usage(ctx, body.ID)
	if len(us) != 1 || us[0].Kind != "body" {
		t.Fatalf("body usage: %+v", us)
	}
	m, err := store.Media.UpdateAlt(ctx, body.ID, "ใหม่")
	if err != nil || m.Alt != "ใหม่" || m.UsageCount != 1 {
		t.Fatalf("update alt: %+v %v", m, err)
	}
	if _, err := store.Media.UpdateAlt(ctx, uuid.NewString(), "x"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("alt missing: %v", err)
	}

	_, err = store.Media.SoftDeleteUnused(ctx, cover.ID)
	var iu *domain.InUseError
	if !errors.As(err, &iu) || iu.Count != 1 {
		t.Fatalf("delete in use: %v", err)
	}
	if del, err := store.Media.SoftDeleteUnused(ctx, unused.ID); err != nil || del.StorageKey != unused.StorageKey {
		t.Fatalf("delete unused: %+v %v", del, err)
	}
	if _, err := store.Media.Get(ctx, unused.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("deleted media visible")
	}
	if _, err := store.Media.SoftDeleteUnused(ctx, unused.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("double delete: %v", err)
	}
	_, _ = store.Posts.SoftDelete(ctx, p.ID)
	if _, err := store.Media.SoftDeleteUnused(ctx, cover.ID); err != nil {
		t.Fatalf("delete after post removed: %v", err)
	}
	_, total, _ = store.Media.List(ctx, repository.MediaFilter{Page: pg(10)})
	if total != 1 {
		t.Fatalf("list after deletes: %d", total)
	}
}
