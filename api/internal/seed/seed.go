// Package seed imports the blog post bundle (web/src/content/posts/posts.json)
// into Postgres. It is idempotent: categories and posts are upserted by slug
// and unchanged rows are not touched.
package seed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

type Bundle struct {
	Categories []BundleCategory `json:"categories"`
	Posts      []BundlePost     `json:"posts"`
}

type BundleCategory struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	NameTH      string `json:"nameTh"`
	Description string `json:"description"`
}

type BundleCover struct {
	Src    string `json:"src"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Alt    string `json:"alt"`
}

type BundlePost struct {
	Slug           string       `json:"slug"`
	LegacySlugs    []string     `json:"legacySlugs"`
	Title          string       `json:"title"`
	Excerpt        string       `json:"excerpt"`
	SEOTitle       string       `json:"seoTitle"`
	SEODescription string       `json:"seoDescription"`
	Cover          *BundleCover `json:"cover"`
	Categories     []string     `json:"categories"`
	Author         string       `json:"author"`
	PublishedAt    string       `json:"publishedAt"`
	UpdatedAt      string       `json:"updatedAt"`
	ReadingMinutes int          `json:"readingMinutes"`
	Featured       bool         `json:"featured"`
	BodyMarkdown   string       `json:"bodyMarkdown"`
}

type Result struct {
	Categories   int
	PostsChanged int
	PostsSame    int
}

func Decode(r io.Reader) (Bundle, error) {
	var b Bundle
	dec := json.NewDecoder(r)
	if err := dec.Decode(&b); err != nil {
		return b, fmt.Errorf("decode posts bundle: %w", err)
	}
	return b, nil
}

func parseTime(field, v string) (*time.Time, error) {
	if strings.TrimSpace(v) == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return nil, fmt.Errorf("%s %q: %w", field, v, err)
	}
	t = t.UTC()
	return &t, nil
}

// ToPost converts and validates a bundle post (status is always published).
func ToPost(bp BundlePost, now time.Time) (domain.Post, error) {
	var errs []error
	if !service.ValidSlug(bp.Slug) {
		errs = append(errs, fmt.Errorf("slug %q is not ASCII kebab-case", bp.Slug))
	}
	if strings.TrimSpace(bp.Title) == "" {
		errs = append(errs, errors.New("title is empty"))
	}
	published, err := parseTime("publishedAt", bp.PublishedAt)
	if err != nil {
		errs = append(errs, err)
	}
	updated, err := parseTime("updatedAt", bp.UpdatedAt)
	if err != nil {
		errs = append(errs, err)
	}
	if len(errs) > 0 {
		return domain.Post{}, fmt.Errorf("post %q: %w", bp.Slug, errors.Join(errs...))
	}
	if published == nil {
		t := now.UTC().Truncate(time.Second)
		published = &t
	}
	p := domain.Post{
		Slug:           bp.Slug,
		LegacySlugs:    []string{},
		Title:          strings.TrimSpace(bp.Title),
		Excerpt:        strings.TrimSpace(bp.Excerpt),
		BodyMarkdown:   strings.TrimSpace(bp.BodyMarkdown),
		Author:         strings.TrimSpace(bp.Author),
		Status:         domain.PostPublished,
		PublishedAt:    published,
		Featured:       bp.Featured,
		ReadingMinutes: bp.ReadingMinutes,
		SEOTitle:       strings.TrimSpace(bp.SEOTitle),
		SEODescription: strings.TrimSpace(bp.SEODescription),
	}
	if updated != nil {
		p.UpdatedAt = *updated
	}
	if p.ReadingMinutes <= 0 {
		p.ReadingMinutes = service.EstimateReadingMinutes(p.BodyMarkdown)
	}
	seen := map[string]bool{}
	for _, ls := range bp.LegacySlugs {
		ls = strings.TrimSpace(ls)
		if ls != "" && ls != p.Slug && !seen[ls] {
			seen[ls] = true
			p.LegacySlugs = append(p.LegacySlugs, ls)
		}
	}
	for _, c := range bp.Categories {
		p.Categories = append(p.Categories, domain.CategoryRef{Slug: strings.TrimSpace(c)})
	}
	if bp.Cover != nil && strings.TrimSpace(bp.Cover.Src) != "" {
		p.Cover = &domain.Cover{URL: strings.TrimSpace(bp.Cover.Src), Alt: strings.TrimSpace(bp.Cover.Alt),
			Width: bp.Cover.Width, Height: bp.Cover.Height}
	}
	return p, nil
}

// Run upserts categories first (in file order -> sort_order), then posts.
// Categories referenced by posts but missing from the file are an error.
func Run(ctx context.Context, b Bundle, cats repository.Categories, posts repository.Posts, log *slog.Logger) (Result, error) {
	var res Result
	known := map[string]bool{}
	for i, c := range b.Categories {
		if !service.ValidSlug(c.Slug) || strings.TrimSpace(c.Name) == "" {
			return res, fmt.Errorf("category %d: invalid slug %q or empty name", i, c.Slug)
		}
		err := cats.Upsert(ctx, domain.Category{Slug: c.Slug, Name: strings.TrimSpace(c.Name),
			NameTH: strings.TrimSpace(c.NameTH), Description: strings.TrimSpace(c.Description), SortOrder: (i + 1) * 10})
		if err != nil {
			return res, fmt.Errorf("upsert category %q: %w", c.Slug, err)
		}
		known[c.Slug] = true
		res.Categories++
	}
	existing, err := cats.List(ctx)
	if err != nil {
		return res, err
	}
	for _, c := range existing {
		known[c.Slug] = true
	}
	now := time.Now()
	for _, bp := range b.Posts {
		p, err := ToPost(bp, now)
		if err != nil {
			return res, err
		}
		for _, c := range p.Categories {
			if !known[c.Slug] {
				return res, fmt.Errorf("post %q: unknown category %q", p.Slug, c.Slug)
			}
		}
		changed, err := posts.UpsertBySlug(ctx, &p)
		if err != nil {
			return res, fmt.Errorf("upsert post %q: %w", p.Slug, err)
		}
		if changed {
			res.PostsChanged++
		} else {
			res.PostsSame++
		}
		log.Info("seed post", "slug", p.Slug, "id", p.ID, "changed", changed)
	}
	return res, nil
}
