package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
)

type recAuditor struct {
	mu     sync.Mutex
	events []domain.AuditEvent
}

func (r *recAuditor) Record(_ context.Context, ev domain.AuditEvent) {
	r.mu.Lock()
	r.events = append(r.events, ev)
	r.mu.Unlock()
}

func (r *recAuditor) actions() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.events))
	for i, e := range r.events {
		out[i] = e.Action
	}
	return out
}

func (r *recAuditor) last() domain.AuditEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.events[len(r.events)-1]
}

// withRole registers a temporary role (e.g. posts:write without publish,
// which no built-in role has) for the duration of the test.
func withRole(t *testing.T, name string, perms ...domain.Permission) domain.Actor {
	t.Helper()
	r := domain.Role(name)
	domain.RolePermissions[r] = perms
	t.Cleanup(func() { delete(domain.RolePermissions, r) })
	return domain.Actor{ID: "00000000-0000-0000-0000-0000000000bb", Email: name + "@example.com", Role: r}
}

func newAuditedPostSvc(t *testing.T) (*PostService, *fake.Store, *recRevalidator, *recAuditor) {
	t.Helper()
	store := fake.New()
	rv := &recRevalidator{}
	au := &recAuditor{}
	return NewPostService(store.PostsRepo(), store.CategoriesRepo(), store.MediaRepo(), rv, au, discard), store, rv, au
}

func TestPostPublishPermission(t *testing.T) {
	svc, _, _, _ := newAuditedPostSvc(t)
	ctx := context.Background()
	writer := withRole(t, "writer", domain.PermPostsRead, domain.PermPostsWrite)

	for _, st := range []string{"published", "scheduled"} {
		in := validPost()
		in.Status = st
		if _, err := svc.Create(ctx, in, writer); !errors.Is(err, domain.ErrNoPermission) {
			t.Fatalf("writer create %s: %v", st, err)
		}
	}
	in := validPost()
	in.Status = "draft"
	draft, err := svc.Create(ctx, in, writer)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Update(ctx, draft.ID, in, writer); err != nil {
		t.Fatalf("draft->draft by writer: %v", err)
	}
	in.Status = "published"
	if _, err := svc.Update(ctx, draft.ID, in, writer); !errors.Is(err, domain.ErrNoPermission) {
		t.Fatalf("draft->published by writer: %v", err)
	}
	pub, err := svc.Update(ctx, draft.ID, in, testOwner)
	if err != nil {
		t.Fatal(err)
	}
	in.Status = "draft"
	if _, err := svc.Update(ctx, pub.ID, in, writer); !errors.Is(err, domain.ErrNoPermission) {
		t.Fatalf("published->draft by writer: %v", err)
	}
	if err := svc.Delete(ctx, pub.ID, writer); !errors.Is(err, domain.ErrNoPermission) {
		t.Fatalf("delete published by writer: %v", err)
	}
	if _, err := svc.Bulk(ctx, BulkInput{Action: "publish", IDs: []string{pub.ID}}, writer); !errors.Is(err, domain.ErrNoPermission) {
		t.Fatalf("bulk by writer: %v", err)
	}
	other := validPost()
	other.Slug, other.Status = "writer-draft", "draft"
	d2, _ := svc.Create(ctx, other, writer)
	if err := svc.Delete(ctx, d2.ID, writer); err != nil {
		t.Fatalf("delete own draft: %v", err)
	}
	if d2.CreatedBy != nil {
		t.Fatalf("created_by resolves only known users, got %+v", d2.CreatedBy)
	}
}

func TestPostAuditTransitionsAndSchedule(t *testing.T) {
	svc, _, _, au := newAuditedPostSvc(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 14, 3, 0, 0, 0, time.UTC)
	svc.Now = func() time.Time { return now }

	in := validPost()
	in.Status = "draft"
	p, err := svc.Create(ctx, in, testOwner)
	if err != nil {
		t.Fatal(err)
	}
	past := now.Add(-time.Minute)
	in.Status, in.PublishedAt = "scheduled", &past
	if _, err := svc.Update(ctx, p.ID, in, testOwner); fieldErrs(t, err)["published_at"] != MsgScheduleInPast {
		t.Fatalf("schedule in the past: %v", err)
	}
	in.PublishedAt = nil
	if _, err := svc.Update(ctx, p.ID, in, testOwner); fieldErrs(t, err)["published_at"] != MsgScheduleInPast {
		t.Fatalf("schedule without date: %v", err)
	}
	future := now.Add(2 * time.Hour)
	in.PublishedAt = &future
	p, err = svc.Update(ctx, p.ID, in, testOwner)
	if err != nil || p.Status != domain.PostScheduled || !p.PublishedAt.Equal(future) {
		t.Fatalf("schedule: %+v %v", p, err)
	}
	in.Status, in.PublishedAt = "published", nil
	if p, err = svc.Update(ctx, p.ID, in, testOwner); err != nil {
		t.Fatal(err)
	}
	in.Title = "แก้ชื่อ"
	if _, err = svc.Update(ctx, p.ID, in, testOwner); err != nil {
		t.Fatal(err)
	}
	in.Status = "draft"
	if _, err = svc.Update(ctx, p.ID, in, testOwner); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, p.ID, testOwner); err != nil {
		t.Fatal(err)
	}
	want := []string{"post.create", "post.schedule", "post.publish", "post.update", "post.unpublish", "post.delete"}
	if got := au.actions(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("audit actions:\n got %v\nwant %v", got, want)
	}
	ev := au.events[2]
	if ev.Actor.ID != testOwner.ID || ev.TargetType != domain.TargetPost || ev.TargetID != p.ID ||
		ev.Metadata["from"] != "scheduled" || ev.Metadata["to"] != "published" || ev.Metadata["slug"] != p.Slug {
		t.Fatalf("publish event: %+v", ev)
	}
}

func TestSlugCheck(t *testing.T) {
	svc, _, _, _ := newAuditedPostSvc(t)
	ctx := context.Background()
	legacy := []string{"old-name"}
	in := validPost()
	in.Slug, in.LegacySlugs = "my-post", &legacy
	p, _ := svc.Create(ctx, in, testOwner)
	in.Slug, in.LegacySlugs = "my-post-2", nil
	_, _ = svc.Create(ctx, in, testOwner)

	cases := []struct {
		slug, exclude string
		want          SlugCheck
	}{
		{"free-slug", "", SlugCheck{Slug: "free-slug", Valid: true, Available: true, Suggestion: "free-slug"}},
		{"my-post", "", SlugCheck{Slug: "my-post", Valid: true, Available: false, Suggestion: "my-post-3"}},
		{"my-post", p.ID, SlugCheck{Slug: "my-post", Valid: true, Available: true, Suggestion: "my-post"}},
		{"old-name", "", SlugCheck{Slug: "old-name", Valid: true, Available: false, Suggestion: "old-name-2"}},
		{"My Post!", "", SlugCheck{Slug: "My Post!", Valid: false, Available: false, Suggestion: "my-post-3"}},
		{"ไทยล้วน", "", SlugCheck{Slug: "ไทยล้วน", Valid: false}},
	}
	for _, c := range cases {
		got, err := svc.SlugCheck(ctx, c.slug, c.exclude)
		if err != nil || got != c.want {
			t.Errorf("SlugCheck(%q,%q) = %+v %v, want %+v", c.slug, c.exclude, got, err, c.want)
		}
	}
	long := strings.Repeat("a", 120)
	got, _ := svc.SlugCheck(ctx, long, "")
	if got.Suggestion != long {
		t.Errorf("long free slug: %q", got.Suggestion)
	}
}

func TestBulk(t *testing.T) {
	svc, _, rv, au := newAuditedPostSvc(t)
	ctx := context.Background()
	mk := func(slug, status, body string) domain.Post {
		in := validPost()
		in.Slug, in.Status, in.BodyMarkdown = slug, status, body
		p, err := svc.Create(ctx, in, testOwner)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	d1 := mk("d1", "draft", "เนื้อหา")
	d2 := mk("d2", "draft", "")
	p1 := mk("p1", "published", "x")
	rv.tags, au.events = nil, nil

	res, err := svc.Bulk(ctx, BulkInput{Action: "publish",
		IDs: []string{d1.ID, d2.ID, p1.ID, "00000000-0000-0000-0000-000000000000", "bad", d1.ID}}, testOwner)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Succeeded) != 2 || len(res.Failed) != 3 {
		t.Fatalf("result: %+v", res)
	}
	if len(rv.tags) != 1 || strings.Join(rv.tags[0], ",") != "posts,post:d1" {
		t.Fatalf("one revalidate call expected: %v", rv.tags)
	}
	if got := au.actions(); len(got) != 1 || got[0] != domain.AuditPostPublish || au.last().Metadata["bulk"] != true {
		t.Fatalf("audit: %v", au.events)
	}
	got, _ := svc.Get(ctx, d1.ID)
	if got.Status != domain.PostPublished || got.PublishedAt == nil {
		t.Fatalf("published: %+v", got)
	}

	res, _ = svc.Bulk(ctx, BulkInput{Action: "unpublish", IDs: []string{d1.ID, p1.ID}}, testOwner)
	if len(res.Succeeded) != 2 {
		t.Fatalf("unpublish: %+v", res)
	}
	res, _ = svc.Bulk(ctx, BulkInput{Action: "delete", IDs: []string{d1.ID, d2.ID}}, testOwner)
	if len(res.Succeeded) != 2 {
		t.Fatalf("delete: %+v", res)
	}
	if _, err := svc.Get(ctx, d2.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("bulk delete")
	}
	for _, in := range []BulkInput{{Action: "archive", IDs: []string{d1.ID}}, {Action: "delete"},
		{Action: "delete", IDs: make([]string, 101)}} {
		if in.IDs != nil && len(in.IDs) == 101 {
			for i := range in.IDs {
				in.IDs[i] = strings.Repeat("x", i+1)
			}
		}
		if _, err := svc.Bulk(ctx, in, testOwner); err == nil {
			t.Errorf("invalid bulk accepted: %s %d", in.Action, len(in.IDs))
		}
	}
}

func TestAdminListValidation(t *testing.T) {
	svc, _, _, _ := newAuditedPostSvc(t)
	ctx := context.Background()
	for _, f := range []repository.AdminPostFilter{{Status: "archived"}, {Sort: "random"}} {
		f.Page = domain.Page{Page: 1, PerPage: 10}
		if _, _, err := svc.AdminList(ctx, f); err == nil {
			t.Errorf("accepted %+v", f)
		}
	}
	in := validPost()
	in.Status = "draft"
	in.Categories = []string{"learning-hub"}
	_, _ = svc.Create(ctx, in, testOwner)
	in.Slug, in.Title, in.Categories = "b", "A first", nil
	_, _ = svc.Create(ctx, in, testOwner)
	list, total, err := svc.AdminList(ctx, repository.AdminPostFilter{Page: domain.Page{Page: 1, PerPage: 10},
		Status: "all", Sort: "title_asc"})
	if err != nil || total != 2 || list[0].Title != "A first" {
		t.Fatalf("sort: %+v %v", list, err)
	}
	_, total, _ = svc.AdminList(ctx, repository.AdminPostFilter{Page: domain.Page{Page: 1, PerPage: 10},
		CategorySlug: "learning-hub"})
	if total != 1 {
		t.Fatalf("category filter: %d", total)
	}
}

// ---- scheduler ----

func TestSchedulerRunOnce(t *testing.T) {
	store := fake.New()
	rv := &recRevalidator{}
	au := &recAuditor{}
	posts := NewPostService(store.PostsRepo(), store.CategoriesRepo(), store.MediaRepo(), rv, NopAuditor{}, discard)
	t0 := time.Date(2026, 11, 14, 3, 0, 0, 0, time.UTC)
	posts.Now = func() time.Time { return t0 }
	at1, at2 := t0.Add(time.Hour), t0.Add(3*time.Hour)
	for i, at := range []*time.Time{&at1, &at2} {
		in := validPost()
		in.Slug, in.Status, in.PublishedAt = []string{"soon", "later"}[i], "scheduled", at
		if _, err := posts.Create(context.Background(), in, testOwner); err != nil {
			t.Fatal(err)
		}
	}
	rv.tags = nil
	now := t0
	sch := NewPostScheduler(store.PostsRepo(), au, rv, discard)
	sch.Now = func() time.Time { return now }
	ctx := context.Background()

	if n, err := sch.RunOnce(ctx); n != 0 || err != nil || len(rv.tags) != 0 {
		t.Fatalf("nothing due: %d %v %v", n, err, rv.tags)
	}
	now = t0.Add(2 * time.Hour)
	if n, err := sch.RunOnce(ctx); n != 1 || err != nil {
		t.Fatalf("one due: %d %v", n, err)
	}
	ev := au.last()
	if !ev.Actor.IsSystem() || ev.Action != domain.AuditPostPublish || ev.Metadata["scheduled"] != true ||
		ev.Metadata["slug"] != "soon" {
		t.Fatalf("audit: %+v", ev)
	}
	if len(rv.tags) != 1 || strings.Join(rv.tags[0], ",") != "posts,post:soon" {
		t.Fatalf("revalidate: %v", rv.tags)
	}
	if n, _ := sch.RunOnce(ctx); n != 0 {
		t.Fatal("second run must be a no-op")
	}
	list, _, _ := posts.ListPublished(ctx, NormalizePage(1, 10, 10, 50), "")
	if len(list) != 0 { // posts.Now is still t0: published_at (t0+1h) is in its future
		t.Fatalf("public list uses its own clock: %d", len(list))
	}
	posts.Now = func() time.Time { return now }
	if list, _, _ = posts.ListPublished(ctx, NormalizePage(1, 10, 10, 50), ""); len(list) != 1 {
		t.Fatalf("published post visible: %d", len(list))
	}
}

func TestSchedulerRunStopsOnCancel(t *testing.T) {
	store := fake.New()
	sch := NewPostScheduler(store.PostsRepo(), NopAuditor{}, &recRevalidator{}, discard)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { sch.Run(ctx, 5*time.Millisecond); close(done) }()
	time.Sleep(20 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after cancel")
	}
}

// ---- leads ----

func newLeadEnv(t *testing.T) (*LeadService, *fake.Store, *recAuditor, domain.AdminUser, domain.AdminUser) {
	t.Helper()
	store := fake.New()
	au := &recAuditor{}
	ctx := context.Background()
	sales := domain.AdminUser{Email: "sales@example.com", Name: "Sales", PasswordHash: "x", Role: domain.RoleSales}
	viewer := domain.AdminUser{Email: "viewer@example.com", Name: "Viewer", PasswordHash: "x", Role: domain.RoleViewer}
	for _, u := range []*domain.AdminUser{&sales, &viewer} {
		if err := store.AdminUsersRepo().Create(ctx, u); err != nil {
			t.Fatal(err)
		}
	}
	return NewLeadService(store.LeadsRepo(), au, discard), store, au, sales, viewer
}

func contentActor(u domain.AdminUser) domain.Actor {
	return domain.Actor{ID: u.ID, Email: u.Email, Name: u.Name, Role: u.Role}
}

func TestLeadFilter(t *testing.T) {
	svc := NewLeadService(fake.New().LeadsRepo(), NopAuditor{}, discard)
	me := testOwner
	f, err := svc.Filter(LeadQuery{Status: "new", Assigned: "me", From: "2026-11-01", To: "2026-11-14"}, me)
	if err != nil {
		t.Fatal(err)
	}
	if f.Status != "new" || f.Assigned != me.ID ||
		!f.CreatedFrom.Equal(time.Date(2026, 10, 31, 17, 0, 0, 0, time.UTC)) ||
		!f.CreatedTo.Equal(time.Date(2026, 11, 14, 17, 0, 0, 0, time.UTC)) {
		t.Fatalf("filter: %+v from=%v to=%v", f, f.CreatedFrom, f.CreatedTo)
	}
	if f, _ := svc.Filter(LeadQuery{Assigned: "none", Status: "all"}, me); f.Assigned != "none" || f.Status != "" {
		t.Fatalf("none/all: %+v", f)
	}
	for _, q := range []LeadQuery{{Status: "won"}, {Assigned: "bob"}, {From: "14/11/2026"},
		{From: "2026-11-14", To: "2026-11-01"}} {
		if _, err := svc.Filter(q, me); err == nil {
			t.Errorf("accepted %+v", q)
		}
	}
}

func TestLeadAssignNotesActivity(t *testing.T) {
	svc, store, au, sales, viewer := newLeadEnv(t)
	ctx := context.Background()
	l := domain.Lead{FirstName: "A", Phone: "0812345678", Email: "a@b.co", PreferredChannel: domain.ChannelPhone}
	_ = store.LeadsRepo().Create(ctx, &l)
	act := contentActor(sales)

	as, err := svc.Assignees(ctx)
	if err != nil || len(as) != 1 || as[0].ID != sales.ID {
		t.Fatalf("assignees (sales only; no owner in this store): %+v %v", as, err)
	}
	if _, err := svc.Update(ctx, l.ID, LeadUpdate{AssignedTo: OptionalString{Set: true, Value: &viewer.ID}}, act); fieldErrs(t, err)["assigned_to"] == "" {
		t.Fatalf("viewer must not be assignable: %v", err)
	}
	got, err := svc.Update(ctx, l.ID, LeadUpdate{Status: "contacted",
		AssignedTo: OptionalString{Set: true, Value: &sales.ID}}, act)
	if err != nil || got.Status != domain.LeadContacted || got.AssignedTo == nil || got.AssignedTo.ID != sales.ID {
		t.Fatalf("update: %+v %v", got, err)
	}
	if got := au.actions(); strings.Join(got, ",") != "lead.status_change,lead.assign" {
		t.Fatalf("audit: %v", got)
	}
	// absent assigned_to keeps it; null unassigns
	got, _ = svc.Update(ctx, l.ID, LeadUpdate{Status: "qualified"}, act)
	if got.AssignedTo == nil {
		t.Fatal("absent assigned_to must keep the assignee")
	}
	got, _ = svc.Update(ctx, l.ID, LeadUpdate{AssignedTo: OptionalString{Set: true}}, act)
	if got.AssignedTo != nil || got.Status != domain.LeadQualified {
		t.Fatalf("unassign: %+v", got)
	}

	secret := "ลูกค้าขอใบเสนอราคา เบอร์ส่วนตัว 0899999999"
	a, err := svc.AddNote(ctx, l.ID, "  "+secret+"  ", act)
	if err != nil || a.Kind != domain.LeadActivityNote || a.Body != secret || a.Actor == nil || a.Actor.ID != sales.ID {
		t.Fatalf("note: %+v %v", a, err)
	}
	ev := au.last()
	if ev.Action != domain.AuditLeadNote || ev.Metadata["length"] != runeLen(secret) || len(ev.Metadata) != 1 {
		t.Fatalf("note audit must hold only the length: %+v", ev.Metadata)
	}
	for _, body := range []string{"   ", strings.Repeat("ก", 4001)} {
		if _, err := svc.AddNote(ctx, l.ID, body, act); fieldErrs(t, err)["body"] == "" {
			t.Errorf("note %d runes accepted", runeLen(body))
		}
	}
	if _, err := svc.AddNote(ctx, "00000000-0000-0000-0000-000000000000", "x", act); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("note on missing lead: %v", err)
	}
	acts, err := svc.Activities(ctx, l.ID)
	if err != nil || len(acts) != 5 {
		t.Fatalf("activities: %d %v", len(acts), err)
	}
	kinds := []string{}
	for _, a := range acts {
		kinds = append(kinds, a.Kind)
	}
	// newest first: note, unassign, qualified, assign, contacted
	if strings.Join(kinds, ",") != "note,assign,status,assign,status" || acts[3].To != "Sales" || acts[1].From != "Sales" {
		t.Fatalf("timeline: %v %+v", kinds, acts)
	}
	if _, err := svc.Activities(ctx, "nope"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("activities on bad id")
	}
}

func TestLeadBoardAndDashboard(t *testing.T) {
	svc, store, _, sales, _ := newLeadEnv(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 14, 5, 0, 0, 0, time.UTC) // 12:00 Bangkok
	svc.Now = func() time.Time { return now }
	mk := func(created time.Time, st domain.LeadStatus) domain.Lead {
		l := domain.Lead{FirstName: "L", Phone: "0812345678", Email: "l@b.co", PreferredChannel: domain.ChannelLine,
			Status: st}
		_ = store.LeadsRepo().Create(ctx, &l)
		store.SetLeadCreatedAt(l.ID, created)
		return l
	}
	mk(now, domain.LeadNew)
	mk(time.Date(2026, 11, 13, 17, 30, 0, 0, time.UTC), domain.LeadNew)       // 00:30 today Bangkok
	mk(time.Date(2026, 11, 13, 16, 30, 0, 0, time.UTC), domain.LeadContacted) // 23:30 yesterday Bangkok
	mk(now.AddDate(0, 0, -10), domain.LeadSpam)
	mk(now.AddDate(0, 0, -40), domain.LeadClosed)
	l := mk(now.AddDate(0, 0, -3), domain.LeadNew)
	_, _ = svc.Update(ctx, l.ID, LeadUpdate{AssignedTo: OptionalString{Set: true, Value: &sales.ID}}, contentActor(sales))

	d, err := svc.Dashboard(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if d.Today != 2 || d.Yesterday != 1 || d.Last7 != 4 || d.Prev7 != 1 || d.Last30 != 5 || d.Prev30 != 1 {
		t.Fatalf("counts: %+v", d.LeadStats)
	}
	if d.ByStatus[domain.LeadNew] != 3 || d.ByStatus[domain.LeadQualified] != 0 || len(d.Recent) != 5 {
		t.Fatalf("by status/recent: %+v %d", d.ByStatus, len(d.Recent))
	}
	if len(d.Daily) != 30 || d.Daily[29].Date != "2026-11-14" || d.Daily[29].Count != 2 ||
		d.Daily[28].Count != 1 || d.Daily[0].Date != "2026-10-16" {
		t.Fatalf("daily: %+v", d.Daily)
	}

	f, _ := svc.Filter(LeadQuery{Assigned: "me"}, contentActor(sales))
	b, err := svc.Board(ctx, f)
	if err != nil || b.Counts[domain.LeadNew] != 1 || len(b.Columns[domain.LeadSpam]) != 0 || b.Columns[domain.LeadSpam] == nil {
		t.Fatalf("board: %+v %v", b, err)
	}
	f, _ = svc.Filter(LeadQuery{}, contentActor(sales))
	b, _ = svc.Board(ctx, f)
	if b.Counts[domain.LeadNew] != 3 || len(b.Columns) != 5 {
		t.Fatalf("board all: %+v", b.Counts)
	}
}

func TestExportAudit(t *testing.T) {
	svc, store, au, sales, _ := newLeadEnv(t)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		l := domain.Lead{FirstName: "L", Phone: "0812345678", Email: "l@b.co", PreferredChannel: domain.ChannelLine}
		_ = store.LeadsRepo().Create(ctx, &l)
	}
	var sb strings.Builder
	if err := svc.ExportCSV(ctx, &sb, "", contentActor(sales)); err != nil {
		t.Fatal(err)
	}
	ev := au.last()
	if ev.Action != domain.AuditLeadExport || ev.Metadata["rows"] != 3 || ev.Metadata["status"] != "" ||
		ev.Actor.ID != sales.ID {
		t.Fatalf("export audit: %+v", ev)
	}
}
