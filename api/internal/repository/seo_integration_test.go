package repository_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/service"
	"github.com/ecomacrobiz/escoma/api/migrations"
)

type seoIT struct {
	store *repository.Store
	pool  *pgxpool.Pool
	posts *service.PostService
	rs    *service.RedirectService
	actor domain.Actor
	ctx   context.Context
}

func newSEOIT(t *testing.T) *seoIT {
	t.Helper()
	store, pool := setup(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	u := mkContentUser(t, store, pool, "seo-editor@example.com", "บรรณาธิการ", domain.RoleEditor, true)
	rs := service.NewRedirectService(store.Redirects, store.Posts, nopRV{}, service.NopAuditor{}, log)
	rs.SetSiteBaseURL("https://www.example.com")
	ps := service.NewPostService(store.Posts, store.Categories, store.Media, rs, nopRV{}, service.NopAuditor{}, log)
	return &seoIT{store: store, pool: pool, posts: ps, rs: rs, ctx: context.Background(),
		actor: domain.Actor{ID: u.ID, Email: u.Email, Name: u.Name, Role: domain.RoleEditor}}
}

func (e *seoIT) publicMap(t *testing.T) map[string]string {
	t.Helper()
	rs, err := e.rs.Public(e.ctx)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, r := range rs {
		v := "410"
		if r.To != nil {
			v = *r.To
		}
		out[r.From] = v
	}
	return out
}

func (e *seoIT) rowKinds(t *testing.T) map[string]string {
	t.Helper()
	rows, err := e.pool.Query(e.ctx, `SELECT from_path, kind FROM redirects`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var f, k string
		if err := rows.Scan(&f, &k); err != nil {
			t.Fatal(err)
		}
		out[f] = k
	}
	return out
}

func seoPostInput(slug, status string) service.PostInput {
	return service.PostInput{Slug: slug, Title: "บทความ " + slug, BodyMarkdown: "เนื้อหา", Status: status,
		Categories: []string{"brand-insight"}}
}

func sptr(s string) *string { return &s }

func TestRedirectsIntegration(t *testing.T) {
	e := newSEOIT(t)
	ctx := e.ctx

	// Path normalization: Thai + percent-encoding + trailing slash are stored decoded.
	d, n, err := e.rs.Create(ctx, service.RedirectInput{From: "/post/%E0%B8%AA%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%87/",
		To: sptr("/b"), Status: 301, Note: "ไทย"}, e.actor)
	if err != nil || d.From != "/post/สร้าง" || n != 0 || d.CreatedBy == nil || d.CreatedBy.Name != "บรรณาธิการ" {
		t.Fatalf("create: %+v %d %v", d, n, err)
	}
	if _, _, err := e.rs.Create(ctx, service.RedirectInput{From: "/post/สร้าง", Status: 410}, e.actor); err == nil {
		t.Fatal("duplicate decoded from accepted")
	}
	// Chain + loop rejected.
	for _, in := range []service.RedirectInput{
		{From: "/c", To: sptr("/post/สร้าง"), Status: 301},
		{From: "/b", To: sptr("/post/%E0%B8%AA%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%87"), Status: 301},
	} {
		var ve *domain.ValidationError
		if _, _, err := e.rs.Create(ctx, in, e.actor); !errors.As(err, &ve) || ve.Fields["to"] != service.MsgRedirectChain {
			t.Fatalf("chain/loop %+v: %v", in, err)
		}
	}
	// Flatten: /b -> /c re-points /post/สร้าง to /c (one transaction).
	b, n, err := e.rs.Create(ctx, service.RedirectInput{From: "/b", To: sptr("/c"), Status: 301}, e.actor)
	if err != nil || n != 1 {
		t.Fatalf("flatten: %d %v", n, err)
	}
	if got, _ := e.store.Redirects.GetByFrom(ctx, "/post/สร้าง"); got.To == nil || *got.To != "/c" {
		t.Fatalf("flattened row: %+v", got)
	}
	// updated_at trigger + DB CHECK (301 needs a target).
	time.Sleep(10 * time.Millisecond)
	upd, _, err := e.rs.Update(ctx, b.ID, service.RedirectInput{From: "/b", Status: 410}, e.actor)
	if err != nil || upd.To != nil || !upd.UpdatedAt.After(b.UpdatedAt) {
		t.Fatalf("update: %+v %v", upd, err)
	}
	if _, err := e.pool.Exec(ctx, `INSERT INTO redirects (from_path, status_code) VALUES ('/bad', 301)`); err == nil {
		t.Fatal("301 without to_path accepted by the DB")
	}
	list, total, err := e.store.Redirects.List(ctx, repository.RedirectFilter{Page: pg(10), Query: "สร้าง"})
	if err != nil || total != 1 || list[0].Note != "ไทย" {
		t.Fatalf("list q: %d %v", total, err)
	}

	// Shadowing: a live post URL cannot be a redirect source.
	if _, err := e.posts.Create(ctx, seoPostInput("live", "published"), e.actor); err != nil {
		t.Fatal(err)
	}
	var ve *domain.ValidationError
	if _, _, err := e.rs.Create(ctx, service.RedirectInput{From: "/knowledge/live/", Status: 410}, e.actor); !errors.As(err, &ve) ||
		ve.Fields["from"] != service.MsgRedirectLivePost {
		t.Fatalf("shadowing: %v", err)
	}
	if err := e.rs.Delete(ctx, b.ID, e.actor); err != nil {
		t.Fatal(err)
	}
}

func TestPostRedirectsIntegration(t *testing.T) {
	e := newSEOIT(t)
	ctx := e.ctx
	if _, err := e.posts.Create(ctx, seoPostInput("target", "published"), e.actor); err != nil {
		t.Fatal(err)
	}
	in := seoPostInput("first", "published")
	legacy := []string{"ทำไมธุรกิจ-b2b"}
	in.LegacySlugs = &legacy
	in.FocusKeyword, in.NoIndex, in.CanonicalURL = "b2b", true, "https://partner.example.com/x"
	in.OGImage = &service.CoverInput{URL: "https://cdn.example.com/og.jpg", Alt: "OG", Width: 1200, Height: 630}
	p, err := e.posts.Create(ctx, in, e.actor)
	if err != nil {
		t.Fatal(err)
	}
	if p.FocusKeyword != "b2b" || !p.NoIndex || p.CanonicalURL != in.CanonicalURL || p.OGImage == nil ||
		p.OGImage.Height != 630 {
		t.Fatalf("seo columns: %+v %+v", p, p.OGImage)
	}
	// A stale 410 row for the slug is removed when it goes live again later.
	if _, _, err := e.rs.Create(ctx, service.RedirectInput{From: "/knowledge/second", Status: 410}, e.actor); err != nil {
		t.Fatal(err)
	}

	// Slug change: legacy slug + public map lists it + row for the new slug removed.
	in.Slug = "second"
	if p, err = e.posts.Update(ctx, p.ID, in, e.actor); err != nil {
		t.Fatal(err)
	}
	if len(p.LegacySlugs) != 2 || p.LegacySlugs[1] != "first" {
		t.Fatalf("legacy: %v", p.LegacySlugs)
	}
	in.LegacySlugs = nil // keep the stored list (a client would echo it back)
	pm := e.publicMap(t)
	if pm["/knowledge/first"] != "/knowledge/second" || pm["/knowledge/ทำไมธุรกิจ-b2b"] != "/knowledge/second" {
		t.Fatalf("public after slug change: %v", pm)
	}
	if _, ok := pm["/knowledge/second"]; ok {
		t.Fatalf("live slug still redirected: %v", pm)
	}

	// Unpublish without target => auto 410 rows.
	in.Status = "draft"
	if p, err = e.posts.Update(ctx, p.ID, in, e.actor); err != nil {
		t.Fatal(err)
	}
	pm, kinds := e.publicMap(t), e.rowKinds(t)
	for _, path := range []string{"/knowledge/second", "/knowledge/first", "/knowledge/ทำไมธุรกิจ-b2b"} {
		if pm[path] != "410" || kinds[path] != "auto" {
			t.Fatalf("%s after unpublish: %q %q", path, pm[path], kinds[path])
		}
	}
	// Republish removes them.
	in.Status = "published"
	if p, err = e.posts.Update(ctx, p.ID, in, e.actor); err != nil {
		t.Fatal(err)
	}
	if kinds = e.rowKinds(t); len(kinds) != 0 {
		t.Fatalf("rows after republish: %v", kinds)
	}
	// Unpublish with target => 301.
	in.Status, in.RedirectTo = "draft", sptr("/knowledge/target")
	if _, err = e.posts.Update(ctx, p.ID, in, e.actor); err != nil {
		t.Fatal(err)
	}
	if pm = e.publicMap(t); pm["/knowledge/second"] != "/knowledge/target" || pm["/knowledge/first"] != "/knowledge/target" {
		t.Fatalf("unpublish 301: %v", pm)
	}

	// Bulk publish removes rows; bulk delete => 410.
	if res, err := e.posts.Bulk(ctx, service.BulkInput{Action: "publish", IDs: []string{p.ID}}, e.actor); err != nil ||
		len(res.Succeeded) != 1 {
		t.Fatalf("bulk publish: %+v %v", res, err)
	}
	if kinds = e.rowKinds(t); len(kinds) != 0 {
		t.Fatalf("rows after bulk publish: %v", kinds)
	}
	if _, err := e.posts.Bulk(ctx, service.BulkInput{Action: "delete", IDs: []string{p.ID}}, e.actor); err != nil {
		t.Fatal(err)
	}
	if pm = e.publicMap(t); pm["/knowledge/second"] != "410" || pm["/knowledge/first"] != "410" {
		t.Fatalf("bulk delete 410: %v", pm)
	}

	// Scheduler publish removes rows for the post's URLs.
	sch := seoPostInput("scheduled-one", "scheduled")
	at := time.Now().Add(time.Hour)
	sch.PublishedAt = &at
	sp, err := e.posts.Create(ctx, sch, e.actor)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.rs.Create(ctx, service.RedirectInput{From: "/knowledge/scheduled-one", Status: 410}, e.actor); err != nil {
		t.Fatal(err)
	}
	scheduler := service.NewPostScheduler(e.store.Posts, service.NopAuditor{}, nopRV{},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	scheduler.Now = func() time.Time { return at.Add(time.Minute) }
	if n, err := scheduler.RunOnce(ctx); n != 1 || err != nil {
		t.Fatalf("scheduler: %d %v", n, err)
	}
	if _, ok := e.rowKinds(t)["/knowledge/scheduled-one"]; ok {
		t.Fatal("scheduler publish kept the redirect row")
	}

	// Link suggestions: live posts sharing a category, excluding the source.
	ls, err := e.store.Posts.LinkSuggestions(ctx, sp.ID, "", 8, time.Now().Add(2*time.Hour))
	if err != nil || len(ls) != 1 || ls[0].Slug != "target" {
		t.Fatalf("link suggestions: %+v %v", ls, err)
	}
	ls, _ = e.store.Posts.LinkSuggestions(ctx, "", "scheduled", 8, time.Now().Add(2*time.Hour))
	if len(ls) != 1 || ls[0].Slug != "scheduled-one" {
		t.Fatalf("keyword suggestions: %+v", ls)
	}
}

func TestMigration00004UpDownUp(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	p := domain.Post{Slug: "keep-me", Title: "เก็บไว้", Status: domain.PostPublished, BodyMarkdown: "x",
		PublishedAt: ptrTime(time.Now().Add(-time.Hour)), NoIndex: true}
	if err := store.Posts.Create(ctx, &p, nil, nil); err != nil {
		t.Fatal(err)
	}
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	exists := func(sql string) bool {
		var ok bool
		if err := pool.QueryRow(ctx, sql).Scan(&ok); err != nil {
			t.Fatal(err)
		}
		return ok
	}
	const hasTable = `SELECT to_regclass('redirects') IS NOT NULL`
	const hasCol = `SELECT EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'posts' AND column_name = 'noindex')`
	if !exists(hasTable) || !exists(hasCol) {
		t.Fatal("00004 not applied")
	}
	if err := migrations.Run(ctx, db, log, "down"); err != nil {
		t.Fatalf("down: %v", err)
	}
	if exists(hasTable) || exists(hasCol) {
		t.Fatal("00004 down left objects behind")
	}
	if err := migrations.Run(ctx, db, log, "up"); err != nil {
		t.Fatalf("up again: %v", err)
	}
	got, err := store.Posts.GetByID(ctx, p.ID)
	if err != nil || got.Title != "เก็บไว้" || got.NoIndex || got.FocusKeyword != "" || got.OGImage != nil {
		t.Fatalf("existing row after down/up: %+v %v", got, err)
	}
}

func ptrTime(t time.Time) *time.Time { return &t }

func TestOGMediaUsageIntegration(t *testing.T) {
	store, _ := setup(t)
	ctx := context.Background()
	m := domain.Media{StorageKey: "og-image-0a1b2c3d.png", URL: "http://x/media/og-image-0a1b2c3d.png",
		OriginalName: "og.png", Mime: "image/png", SizeBytes: 10, Width: 1200, Height: 630}
	if err := store.Media.Create(ctx, &m); err != nil {
		t.Fatal(err)
	}
	p := domain.Post{Slug: "og", Title: "OG", Status: domain.PostDraft, OGMediaID: &m.ID,
		OGImage: &domain.Cover{URL: m.URL, Alt: "og", Width: 1200, Height: 630}}
	if err := store.Posts.Create(ctx, &p, nil, nil); err != nil {
		t.Fatal(err)
	}
	if p.OGMediaID == nil || p.OGImage == nil || p.OGImage.Width != 1200 {
		t.Fatalf("og stored: %+v", p)
	}
	usage, err := store.Media.Usage(ctx, m.ID)
	if err != nil || len(usage) != 1 || usage[0].Kind != "og" {
		t.Fatalf("usage: %+v %v", usage, err)
	}
	var iu *domain.InUseError
	if _, err := store.Media.SoftDeleteUnused(ctx, m.ID); !errors.As(err, &iu) {
		t.Fatalf("og media deletable while in use: %v", err)
	}
}
