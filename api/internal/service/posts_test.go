package service

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
)

type recRevalidator struct {
	mu   sync.Mutex
	tags [][]string
}

func (r *recRevalidator) Revalidate(tags ...string) {
	r.mu.Lock()
	r.tags = append(r.tags, tags)
	r.mu.Unlock()
}

func validPost() PostInput {
	return PostInput{Slug: "branding-vs-marketing", Title: "Branding กับ Marketing ต่างกันอย่างไร",
		Excerpt: "สรุปสั้น", BodyMarkdown: "## หัวข้อ\n\nเนื้อหา", Categories: []string{"brand-insight"},
		Author: "ECOMACROBIZ", Status: "published"}
}

func TestValidSlug(t *testing.T) {
	good := []string{"a", "branding-vs-marketing", "post-2026", "x1-y2-z3"}
	bad := []string{"", "Branding", "with space", "-lead", "trail-", "double--dash", "under_score", "ไทย",
		"a/b", strings.Repeat("a", 121)}
	for _, s := range good {
		if !ValidSlug(s) {
			t.Errorf("ValidSlug(%q) = false", s)
		}
	}
	for _, s := range bad {
		if ValidSlug(s) {
			t.Errorf("ValidSlug(%q) = true", s)
		}
	}
}

func TestValidatePostInputRequired(t *testing.T) {
	_, v := ValidatePostInput(PostInput{})
	f := fieldErrs(t, v.Err())
	for _, k := range []string{"slug", "title", "status"} {
		if f[k] == "" {
			t.Errorf("missing error for %s: %v", k, f)
		}
	}
	in := validPost()
	in.BodyMarkdown = ""
	_, v = ValidatePostInput(in)
	if fieldErrs(t, v.Err())["body_markdown"] == "" {
		t.Error("published post without body must fail")
	}
	in.Status = "draft"
	_, v = ValidatePostInput(in)
	if v.Err() != nil {
		t.Errorf("draft without body should pass: %v", v.Err())
	}
	in = validPost()
	in.Slug = "Bad Slug"
	in.Status = "archived"
	in.Cover = &CoverInput{URL: "javascript:alert(1)"}
	_, v = ValidatePostInput(in)
	f = fieldErrs(t, v.Err())
	if f["slug"] == "" || f["status"] == "" || f["cover.url"] == "" {
		t.Errorf("fields: %v", f)
	}
}

func TestCoverURL(t *testing.T) {
	for _, u := range []string{"/images/knowledge/x/cover.webp", "https://api.example.com/media/a.png"} {
		if !validCoverURL(u) {
			t.Errorf("%s rejected", u)
		}
	}
	for _, u := range []string{"//evil.com/x.png", "javascript:alert(1)", "data:image/png;base64,AA", `/\evil`} {
		if validCoverURL(u) {
			t.Errorf("%s accepted", u)
		}
	}
}

func newPostSvc() (*PostService, *fake.Store, *recRevalidator) {
	store := fake.New()
	rv := &recRevalidator{}
	return NewPostService(store.PostsRepo(), store.CategoriesRepo(), store.MediaRepo(), testRedirects(store), rv, NopAuditor{}, discard), store, rv
}

func TestPostCreateUpdateDelete(t *testing.T) {
	svc, _, rv := newPostSvc()
	ctx := context.Background()
	fixed := time.Date(2026, 11, 12, 3, 0, 0, 0, time.UTC)
	svc.Now = func() time.Time { return fixed }

	p, err := svc.Create(ctx, validPost(), testOwner)
	if err != nil {
		t.Fatal(err)
	}
	if p.PublishedAt == nil || !p.PublishedAt.Equal(fixed) || p.ReadingMinutes < 1 {
		t.Fatalf("published_at/reading: %+v", p)
	}
	if len(p.Categories) != 1 || p.Categories[0].Name != "Brand Insight" {
		t.Fatalf("categories: %+v", p.Categories)
	}
	if got := rv.tags[0]; strings.Join(got, ",") != "posts,post:branding-vs-marketing,redirects" {
		t.Fatalf("revalidate tags: %v", got)
	}

	// duplicate slug -> 422 on slug
	if _, err := svc.Create(ctx, validPost(), testOwner); fieldErrs(t, err)["slug"] != "slug นี้ถูกใช้งานแล้ว" {
		t.Fatalf("duplicate slug: %v", err)
	}
	// unknown category
	in := validPost()
	in.Slug = "other"
	in.Categories = []string{"nope"}
	if _, err := svc.Create(ctx, in, testOwner); !strings.Contains(fieldErrs(t, err)["categories"], "nope") {
		t.Fatalf("unknown category: %v", err)
	}

	// update: slug change, published_at kept, legacy slugs kept when absent
	ls := []string{"แบรนด์ดิ้ง"}
	in = validPost()
	in.LegacySlugs = &ls
	p, err = svc.Update(ctx, p.ID, in, testOwner)
	if err != nil || len(p.LegacySlugs) != 1 {
		t.Fatalf("update 1: %+v %v", p, err)
	}
	in = validPost()
	in.Slug = "branding-and-marketing"
	in.Title = "ใหม่"
	p, err = svc.Update(ctx, p.ID, in, testOwner)
	// the old slug of a published post becomes a legacy slug
	if err != nil || p.Slug != "branding-and-marketing" || strings.Join(p.LegacySlugs, ",") != "แบรนด์ดิ้ง,branding-vs-marketing" ||
		!p.PublishedAt.Equal(fixed) {
		t.Fatalf("update 2: %+v %v", p, err)
	}
	last := rv.tags[len(rv.tags)-1]
	if strings.Join(last, ",") != "posts,post:branding-and-marketing,post:branding-vs-marketing,redirects" {
		t.Fatalf("old slug not revalidated: %v", last)
	}

	if err := svc.Delete(ctx, p.ID, nil, testOwner); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctx, p.ID); err != domain.ErrNotFound {
		t.Fatalf("after delete: %v", err)
	}
	if err := svc.Delete(ctx, "not-a-uuid", nil, testOwner); err != domain.ErrNotFound {
		t.Fatalf("bad id: %v", err)
	}
}

func TestPublicVisibilityAndLegacySlug(t *testing.T) {
	svc, _, _ := newPostSvc()
	ctx := context.Background()
	future := time.Now().Add(48 * time.Hour)
	ls := []string{"แบรนด์ดิ้ง-vs-การตลาด"}

	pub := validPost()
	pub.LegacySlugs = &ls
	if _, err := svc.Create(ctx, pub, testOwner); err != nil {
		t.Fatal(err)
	}
	draft := validPost()
	draft.Slug, draft.Status = "draft-post", "draft"
	sched := validPost()
	sched.Slug, sched.PublishedAt = "scheduled", &future
	for _, in := range []PostInput{draft, sched} {
		if _, err := svc.Create(ctx, in, testOwner); err != nil {
			t.Fatal(err)
		}
	}
	list, total, err := svc.ListPublished(ctx, NormalizePage(1, 12, 12, 50), "")
	if err != nil || total != 1 || len(list) != 1 || list[0].BodyMarkdown != "" {
		t.Fatalf("public list: %d %+v %v", total, list, err)
	}
	if _, err := svc.GetPublished(ctx, "draft-post"); err != domain.ErrNotFound {
		t.Error("draft must be hidden")
	}
	if _, err := svc.GetPublished(ctx, "scheduled"); err != domain.ErrNotFound {
		t.Error("future post must be hidden")
	}
	p, err := svc.GetPublished(ctx, "แบรนด์ดิ้ง-vs-การตลาด")
	if err != nil || p.Slug != "branding-vs-marketing" {
		t.Fatalf("legacy slug lookup: %+v %v", p, err)
	}
}

func TestNormalizePage(t *testing.T) {
	cases := []struct{ p, pp, wantP, wantPP int }{
		{0, 0, 1, 12}, {-3, 500, 1, 50}, {2, 5, 2, 5},
	}
	for _, c := range cases {
		got := NormalizePage(c.p, c.pp, 12, 50)
		if got.Page != c.wantP || got.PerPage != c.wantPP {
			t.Errorf("NormalizePage(%d,%d) = %+v", c.p, c.pp, got)
		}
	}
}

func TestEstimateReadingMinutes(t *testing.T) {
	if EstimateReadingMinutes("") != 1 {
		t.Error("min 1")
	}
	if got := EstimateReadingMinutes(strings.Repeat("word ", 1000)); got != 5 {
		t.Errorf("1000 words = %d", got)
	}
	if got := EstimateReadingMinutes(strings.Repeat("ก", 4000)); got != 5 {
		t.Errorf("4000 Thai chars = %d", got)
	}
}

var testOwner = domain.Actor{ID: "00000000-0000-0000-0000-0000000000aa", Email: "owner@example.com",
	Name: "Owner", Role: domain.RoleOwner}
