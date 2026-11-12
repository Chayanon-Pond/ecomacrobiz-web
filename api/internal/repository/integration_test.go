package repository_test

// Integration tests against a real Postgres. They run only when
// TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgres://escoma:escoma@localhost:55432/escoma?sslmode=disable go test ./internal/repository/
// Each run migrates a fresh, randomly named schema and drops it afterwards.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/migrations"
)

func setup(t *testing.T) (*repository.Store, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping Postgres integration test")
	}
	ctx := context.Background()
	schema := "it_" + uuid.NewString()[:8]
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	if err := migrations.Run(ctx, db, slog.New(slog.NewTextHandler(io.Discard, nil)), "up"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return repository.NewStore(pool), pool
}

func TestMigrationsDownUp(t *testing.T) {
	_, pool := setup(t)
	ctx := context.Background()
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	for _, dir := range []string{"down", "down", "up"} {
		if err := migrations.Run(ctx, db, log, dir); err != nil {
			t.Fatalf("migrate %s: %v", dir, err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM categories").Scan(&n); err != nil || n != 4 {
		t.Fatalf("categories after down/down/up: %d %v", n, err)
	}
}

func TestCategoriesAndPosts(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()

	cats, err := store.Categories.List(ctx)
	if err != nil || len(cats) != 4 || cats[0].Slug != "business-growth" {
		t.Fatalf("seeded categories: %+v %v", cats, err)
	}
	if err := store.Categories.Upsert(ctx, domain.Category{Slug: "brand-insight", Name: "Brand Insight",
		NameTH: "อินไซต์แบรนด์ (ใหม่)", SortOrder: 20}); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Categories.ExistingSlugs(ctx, []string{"brand-insight", "nope"})
	if len(got) != 1 {
		t.Fatalf("existing slugs: %v", got)
	}

	u := domain.AdminUser{Email: "Admin@Example.com", Name: "Admin", PasswordHash: "$2a$10$x"}
	if err := store.AdminUsers.Create(ctx, &u); err != nil {
		t.Fatal(err)
	}
	if u.Email != "admin@example.com" {
		t.Fatalf("email not lowercased: %s", u.Email)
	}

	pub := time.Now().Add(-time.Hour).UTC().Truncate(time.Microsecond)
	p := domain.Post{Slug: "branding-vs-marketing", LegacySlugs: []string{"แบรนด์ดิ้ง"}, Title: "Branding กับ Marketing",
		Excerpt: "สั้น", BodyMarkdown: "## หัวข้อ", Status: domain.PostPublished, PublishedAt: &pub,
		Cover:      &domain.Cover{URL: "/images/x.webp", Alt: "ปก", Width: 1600, Height: 900},
		Categories: []domain.CategoryRef{{Slug: "brand-insight"}, {Slug: "learning-hub"}}, ReadingMinutes: 3}
	if err := store.Posts.Create(ctx, &p, &u.ID); err != nil {
		t.Fatal(err)
	}
	if p.ID == "" || len(p.Categories) != 2 || p.Categories[0].NameTH != "อินไซต์แบรนด์ (ใหม่)" || p.Cover.Width != 1600 {
		t.Fatalf("created: %+v", p)
	}
	dup := p
	if err := store.Posts.Create(ctx, &dup, nil); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("duplicate slug: %v", err)
	}

	draft := domain.Post{Slug: "draft-one", Title: "ร่าง", Status: domain.PostDraft}
	future := time.Now().Add(24 * time.Hour)
	sched := domain.Post{Slug: "scheduled", Title: "ตั้งเวลา", Status: domain.PostPublished, PublishedAt: &future}
	for _, x := range []*domain.Post{&draft, &sched} {
		if err := store.Posts.Create(ctx, x, nil); err != nil {
			t.Fatal(err)
		}
	}

	now := time.Now()
	list, total, err := store.Posts.ListPublished(ctx, repository.PostFilter{Page: domain.Page{Page: 1, PerPage: 12}}, now)
	if err != nil || total != 1 || len(list) != 1 || list[0].BodyMarkdown != "" || len(list[0].Categories) != 2 {
		t.Fatalf("public list: %d %+v %v", total, list, err)
	}
	list, total, _ = store.Posts.ListPublished(ctx, repository.PostFilter{Page: domain.Page{Page: 1, PerPage: 12},
		CategorySlug: "business-growth"}, now)
	if total != 0 || len(list) != 0 {
		t.Fatalf("category filter: %d", total)
	}
	got1, err := store.Posts.GetPublishedBySlug(ctx, "แบรนด์ดิ้ง", now)
	if err != nil || got1.ID != p.ID || got1.BodyMarkdown != "## หัวข้อ" {
		t.Fatalf("legacy lookup: %+v %v", got1, err)
	}
	if _, err := store.Posts.GetPublishedBySlug(ctx, "draft-one", now); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("draft visible: %v", err)
	}

	cats, _ = store.Categories.List(ctx)
	counts := map[string]int{}
	for _, c := range cats {
		counts[c.Slug] = c.PostCount
	}
	if counts["brand-insight"] != 1 || counts["business-growth"] != 0 {
		t.Fatalf("post counts: %v", counts)
	}

	all, total, err := store.Posts.AdminList(ctx, repository.AdminPostFilter{Page: domain.Page{Page: 1, PerPage: 10},
		Status: "all", Query: "ร่าง"})
	if err != nil || total != 1 || all[0].Slug != "draft-one" {
		t.Fatalf("admin search: %d %v", total, err)
	}
	_, total, _ = store.Posts.AdminList(ctx, repository.AdminPostFilter{Page: domain.Page{Page: 1, PerPage: 10},
		Query: "100%_"})
	if total != 0 {
		t.Fatal("LIKE metacharacters must be escaped")
	}

	before := p.UpdatedAt
	time.Sleep(5 * time.Millisecond)
	p.Title = "แก้ไขแล้ว"
	p.Categories = []domain.CategoryRef{{Slug: "business-growth"}}
	p.Cover = nil
	if err := store.Posts.Update(ctx, &p); err != nil {
		t.Fatal(err)
	}
	if p.Title != "แก้ไขแล้ว" || len(p.Categories) != 1 || p.Cover != nil || !p.UpdatedAt.After(before) {
		t.Fatalf("updated: %+v", p)
	}

	deleted, err := store.Posts.SoftDelete(ctx, p.ID)
	if err != nil || deleted.Slug != p.Slug {
		t.Fatal(err)
	}
	if _, err := store.Posts.GetByID(ctx, p.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("soft-deleted post still visible")
	}
	// slug is reusable after soft delete (partial unique index)
	again := domain.Post{Slug: p.Slug, Title: "ใหม่", Status: domain.PostDraft}
	if err := store.Posts.Create(ctx, &again, nil); err != nil {
		t.Fatalf("reuse slug: %v", err)
	}
	if _, err := store.Posts.GetByID(ctx, "not-a-uuid"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("malformed uuid: %v", err)
	}
	var rows int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM posts").Scan(&rows)
	if rows != 4 {
		t.Fatalf("rows incl. soft-deleted: %d", rows)
	}
}

func TestUpsertBySlugIdempotent(t *testing.T) {
	store, _ := setup(t)
	ctx := context.Background()
	pub := time.Date(2026, 11, 9, 3, 0, 0, 0, time.UTC)
	upd := time.Date(2026, 11, 10, 3, 0, 0, 0, time.UTC)
	mk := func() domain.Post {
		return domain.Post{Slug: "seeded", LegacySlugs: []string{"ไทย"}, Title: "Seed", BodyMarkdown: "x",
			Status: domain.PostPublished, PublishedAt: &pub, UpdatedAt: upd, ReadingMinutes: 2,
			Categories: []domain.CategoryRef{{Slug: "brand-insight"}}}
	}
	p := mk()
	changed, err := store.Posts.UpsertBySlug(ctx, &p)
	if err != nil || !changed || p.ID == "" {
		t.Fatalf("first: %v %v", changed, err)
	}
	q := mk()
	changed, err = store.Posts.UpsertBySlug(ctx, &q)
	if err != nil || changed || q.ID != p.ID {
		t.Fatalf("second (no-op): changed=%v id=%s err=%v", changed, q.ID, err)
	}
	got, _ := store.Posts.GetByID(ctx, p.ID)
	if !got.UpdatedAt.Equal(upd) {
		t.Fatalf("updated_at from source not kept: %v", got.UpdatedAt)
	}
	r := mk()
	r.Categories = append(r.Categories, domain.CategoryRef{Slug: "learning-hub"})
	if changed, _ := store.Posts.UpsertBySlug(ctx, &r); !changed {
		t.Fatal("category change not detected")
	}
	got, _ = store.Posts.GetByID(ctx, p.ID)
	if len(got.Categories) != 2 {
		t.Fatalf("categories: %+v", got.Categories)
	}
}

func TestLeads(t *testing.T) {
	store, _ := setup(t)
	ctx := context.Background()
	for i, name := range []string{"สมชาย", "สมหญิง", "John"} {
		l := domain.Lead{FirstName: name, Phone: "0812345678", Email: fmt.Sprintf("u%d@example.com", i),
			PreferredChannel: domain.ChannelLine, ConsentAt: time.Now(), IP: "203.0.113.9", UserAgent: "UA"}
		if i == 0 {
			l.PreferredDate, l.PreferredTime = "2026-12-01", "10:30"
		}
		if i == 2 {
			l.IP = ""
		}
		if err := store.Leads.Create(ctx, &l); err != nil {
			t.Fatal(err)
		}
		if l.ID == "" || l.Status != domain.LeadNew {
			t.Fatalf("created: %+v", l)
		}
		if i == 0 && (l.PreferredDate != "2026-12-01" || l.PreferredTime != "10:30" || l.IP != "203.0.113.9") {
			t.Fatalf("date/time/ip round trip: %+v", l)
		}
		time.Sleep(2 * time.Millisecond)
	}
	list, total, err := store.Leads.List(ctx, repository.LeadFilter{Page: domain.Page{Page: 1, PerPage: 2}})
	if err != nil || total != 3 || len(list) != 2 || list[0].FirstName != "John" || list[0].IP != "" {
		t.Fatalf("list: %d %+v %v", total, list, err)
	}
	_, total, _ = store.Leads.List(ctx, repository.LeadFilter{Page: domain.Page{Page: 1, PerPage: 10}, Query: "สม"})
	if total != 2 {
		t.Fatalf("search: %d", total)
	}
	note := "โทรกลับแล้ว"
	l, err := store.Leads.UpdateStatus(ctx, list[0].ID, domain.LeadContacted, &note)
	if err != nil || l.Status != domain.LeadContacted || l.Note != note || !l.UpdatedAt.After(l.CreatedAt) {
		t.Fatalf("update: %+v %v", l, err)
	}
	l, _ = store.Leads.UpdateStatus(ctx, l.ID, domain.LeadQualified, nil)
	if l.Note != note {
		t.Fatal("nil note must keep the existing note")
	}
	_, total, _ = store.Leads.List(ctx, repository.LeadFilter{Page: domain.Page{Page: 1, PerPage: 10}, Status: "qualified"})
	if total != 1 {
		t.Fatalf("status filter: %d", total)
	}
	if _, err := store.Leads.UpdateStatus(ctx, uuid.NewString(), domain.LeadSpam, nil); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("missing lead: %v", err)
	}
	if _, err := store.Leads.Get(ctx, l.ID); err != nil {
		t.Fatal(err)
	}
}

func TestSessionsAndMedia(t *testing.T) {
	store, _ := setup(t)
	ctx := context.Background()
	u := domain.AdminUser{Email: "a@example.com", Name: "A", PasswordHash: "h"}
	if err := store.AdminUsers.Create(ctx, &u); err != nil {
		t.Fatal(err)
	}
	if err := store.AdminUsers.Create(ctx, &domain.AdminUser{Email: "A@EXAMPLE.COM", PasswordHash: "h"}); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("case-insensitive unique email: %v", err)
	}
	if got, err := store.AdminUsers.GetByEmail(ctx, "A@Example.com"); err != nil || got.ID != u.ID {
		t.Fatalf("get by email: %v", err)
	}
	_ = store.AdminUsers.UpdatePassword(ctx, u.ID, "h2")
	_ = store.AdminUsers.TouchLogin(ctx, u.ID, time.Now())
	got, _ := store.AdminUsers.GetByID(ctx, u.ID)
	if got.PasswordHash != "h2" || got.LastLoginAt == nil {
		t.Fatalf("user: %+v", got)
	}

	now := time.Now().UTC()
	live := domain.Session{AdminUserID: u.ID, TokenHash: []byte("live-hash-000000000000000000000000"), CSRFToken: "c",
		CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	old := domain.Session{AdminUserID: u.ID, TokenHash: []byte("old-hash-0000000000000000000000000"), CSRFToken: "c",
		CreatedAt: now.Add(-2 * time.Hour), ExpiresAt: now.Add(-time.Hour)}
	for _, s := range []*domain.Session{&live, &old} {
		if err := store.Sessions.Create(ctx, s); err != nil {
			t.Fatal(err)
		}
	}
	s, user, err := store.Sessions.GetValid(ctx, live.TokenHash, now)
	if err != nil || s.ID != live.ID || user.Email != "a@example.com" {
		t.Fatalf("get valid: %v", err)
	}
	if _, _, err := store.Sessions.GetValid(ctx, old.TokenHash, now); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("expired session returned")
	}
	if n, _ := store.Sessions.DeleteExpired(ctx, now); n != 1 {
		t.Fatalf("delete expired: %d", n)
	}
	_ = store.Sessions.DeleteByTokenHash(ctx, live.TokenHash)
	if _, _, err := store.Sessions.GetValid(ctx, live.TokenHash, now); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("deleted session returned")
	}

	m := domain.Media{StorageKey: uuid.NewString() + ".png", URL: "http://x/media/a.png", OriginalName: "รูป.png",
		Mime: "image/png", SizeBytes: 123, Width: 4, Height: 3, UploadedBy: &u.ID}
	if err := store.Media.Create(ctx, &m); err != nil {
		t.Fatal(err)
	}
	gm, err := store.Media.Get(ctx, m.ID)
	if err != nil || gm.Width != 4 || gm.OriginalName != "รูป.png" || gm.UploadedBy == nil {
		t.Fatalf("media: %+v %v", gm, err)
	}
	if _, err := store.Media.Get(ctx, uuid.NewString()); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("missing media")
	}
}
