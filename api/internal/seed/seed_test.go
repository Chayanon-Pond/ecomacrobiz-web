package seed

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
)

var discard = slog.New(slog.NewTextHandler(io.Discard, nil))

func loadFixture(t *testing.T) Bundle {
	t.Helper()
	f, err := os.Open("testdata/posts.json")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	b, err := Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestToPost(t *testing.T) {
	b := loadFixture(t)
	p, err := ToPost(b.Posts[0], time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if p.Status != "published" || p.PublishedAt.Format(time.RFC3339) != "2026-11-09T03:00:00Z" ||
		p.Cover == nil || p.Cover.Width != 1600 || !p.Featured || p.ReadingMinutes != 5 {
		t.Fatalf("%+v", p)
	}
	// legacy slug identical to the canonical one is dropped
	if len(p.LegacySlugs) != 0 {
		t.Errorf("legacy: %v", p.LegacySlugs)
	}
	p2, _ := ToPost(b.Posts[1], time.Now())
	if p2.Cover != nil || p2.ReadingMinutes < 1 || p2.LegacySlugs[0] != "แนวคิดการเติบโตทางธุรกิจ" {
		t.Fatalf("%+v", p2)
	}
	bad := b.Posts[0]
	bad.Slug = "ภาษาไทย"
	bad.PublishedAt = "yesterday"
	if _, err := ToPost(bad, time.Now()); err == nil || !strings.Contains(err.Error(), "publishedAt") {
		t.Fatalf("invalid post accepted: %v", err)
	}
}

func TestRunIdempotent(t *testing.T) {
	store := fake.New()
	ctx := context.Background()
	b := loadFixture(t)
	for i := 0; i < 2; i++ {
		res, err := Run(ctx, b, store.CategoriesRepo(), store.PostsRepo(), discard)
		if err != nil {
			t.Fatal(err)
		}
		if res.Categories != 4 || res.PostsChanged+res.PostsSame != 2 {
			t.Fatalf("run %d: %+v", i, res)
		}
	}
	posts, total, _ := store.PostsRepo().AdminList(ctx, repository.AdminPostFilter{Page: pageAll})
	if total != 2 || len(posts) != 2 {
		t.Fatalf("posts after 2 runs: %d", total)
	}
	cats, _ := store.CategoriesRepo().List(ctx)
	if len(cats) != 4 || cats[0].NameTH != "การเติบโตทางธุรกิจ" {
		t.Fatalf("cats: %+v", cats)
	}

	b.Posts[0].Categories = []string{"does-not-exist"}
	if _, err := Run(ctx, b, store.CategoriesRepo(), store.PostsRepo(), discard); err == nil {
		t.Fatal("unknown category accepted")
	}
}

var pageAll = domain.Page{Page: 1, PerPage: 100}
