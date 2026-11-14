package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

// Revalidator is implemented by notify.Revalidator; it must not block.
type Revalidator interface {
	Revalidate(tags ...string)
}

type PostService struct {
	posts      repository.Posts
	categories repository.Categories
	media      repository.Media
	revalidate Revalidator
	audit      Auditor
	log        *slog.Logger
	Now        func() time.Time
}

func NewPostService(posts repository.Posts, cats repository.Categories, media repository.Media,
	rv Revalidator, audit Auditor, log *slog.Logger) *PostService {
	return &PostService{posts: posts, categories: cats, media: media, revalidate: rv, audit: audit, log: log,
		Now: time.Now}
}

type CoverInput struct {
	URL    string `json:"url"`
	Alt    string `json:"alt"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// PostInput is the admin create/update body (PUT replaces the post; absent
// published_at and legacy_slugs keep their stored values on update).
type PostInput struct {
	Slug           string      `json:"slug"`
	Title          string      `json:"title"`
	Excerpt        string      `json:"excerpt"`
	BodyMarkdown   string      `json:"body_markdown"`
	CoverMediaID   *string     `json:"cover_media_id"`
	Cover          *CoverInput `json:"cover"`
	Categories     []string    `json:"categories"`
	Author         string      `json:"author"`
	Status         string      `json:"status"`
	PublishedAt    *time.Time  `json:"published_at"`
	Featured       bool        `json:"featured"`
	ReadingMinutes *int        `json:"reading_minutes"`
	SEOTitle       string      `json:"seo_title"`
	SEODescription string      `json:"seo_description"`
	LegacySlugs    *[]string   `json:"legacy_slugs"`
}

var slugRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

const (
	maxSlugLen = 120
	maxPerPage = 50
)

func ValidSlug(s string) bool { return len(s) <= maxSlugLen && slugRe.MatchString(s) }

// NormalizePage clamps page/per_page into [1..] / [1..max] with defaults.
func NormalizePage(page, perPage, def, max int) domain.Page {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = def
	}
	if perPage > max {
		perPage = max
	}
	return domain.Page{Page: page, PerPage: perPage}
}

// EstimateReadingMinutes: ~200 words/min for spaced scripts, ~800 chars/min
// for Thai (no word spaces). Always at least 1.
func EstimateReadingMinutes(body string) int {
	words, thai := 0, 0
	for _, f := range strings.Fields(body) {
		words++
		for _, r := range f {
			if r >= 0x0E00 && r <= 0x0E7F {
				thai++
			}
		}
	}
	m := words/200 + thai/800
	if m < 1 {
		m = 1
	}
	return m
}

// ---- public ----

func (s *PostService) Categories(ctx context.Context) ([]domain.Category, error) {
	return s.categories.List(ctx)
}

func (s *PostService) ListPublished(ctx context.Context, page domain.Page, category string) ([]domain.Post, int, error) {
	return s.posts.ListPublished(ctx, repository.PostFilter{Page: page, CategorySlug: strings.TrimSpace(category)}, s.Now())
}

func (s *PostService) GetPublished(ctx context.Context, slug string) (domain.Post, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" || len(slug) > 400 {
		return domain.Post{}, domain.ErrNotFound
	}
	return s.posts.GetPublishedBySlug(ctx, slug, s.Now())
}

// ---- admin ----

func (s *PostService) AdminList(ctx context.Context, f repository.AdminPostFilter) ([]domain.Post, int, error) {
	var v domain.Validator
	if f.Status == "all" {
		f.Status = ""
	}
	if f.Status != "" && !domain.PostStatus(f.Status).Valid() {
		v.Add("status", "สถานะต้องเป็น all, draft, published หรือ scheduled")
	}
	if f.Sort != "" && !slices.Contains(repository.PostSorts, f.Sort) {
		v.Add("sort", "รูปแบบการเรียงลำดับไม่ถูกต้อง")
	}
	f.CategorySlug = strings.TrimSpace(f.CategorySlug)
	if err := v.Err(); err != nil {
		return nil, 0, err
	}
	return s.posts.AdminList(ctx, f)
}

func (s *PostService) Get(ctx context.Context, id string) (domain.Post, error) {
	if _, err := uuid.Parse(id); err != nil {
		return domain.Post{}, domain.ErrNotFound
	}
	return s.posts.GetByID(ctx, id)
}

// canPublish: publishing, scheduling and touching non-draft posts needs
// posts:publish (posts:write alone may only work on drafts).
func canPublish(a domain.Actor) bool { return a.Role.Has(domain.PermPostsPublish) }

func (s *PostService) record(ctx context.Context, a domain.Actor, action string, p domain.Post, meta map[string]any) {
	if meta == nil {
		meta = map[string]any{}
	}
	meta["slug"] = p.Slug
	s.audit.Record(ctx, domain.AuditEvent{Actor: a, Action: action, TargetType: domain.TargetPost, TargetID: p.ID,
		Metadata: meta})
}

func (s *PostService) Create(ctx context.Context, in PostInput, actor domain.Actor) (domain.Post, error) {
	if st := domain.PostStatus(strings.TrimSpace(in.Status)); st.Valid() && st != domain.PostDraft && !canPublish(actor) {
		return domain.Post{}, domain.ErrNoPermission
	}
	p, err := s.build(ctx, in, nil)
	if err != nil {
		return p, err
	}
	var by *string
	if !actor.IsSystem() {
		by = &actor.ID
	}
	if err := s.posts.Create(ctx, &p, by); err != nil {
		return p, slugConflict(err)
	}
	s.log.Info("post created", "post_id", p.ID, "slug", p.Slug, "status", p.Status, "actor", actor.ID)
	s.record(ctx, actor, domain.AuditPostCreate, p, map[string]any{"status": string(p.Status)})
	s.revalidate.Revalidate("posts", "post:"+p.Slug)
	return p, nil
}

// updateAction maps a status transition onto its audit action.
func updateAction(from, to domain.Post) string {
	switch {
	case to.Status == domain.PostPublished && from.Status != domain.PostPublished:
		return domain.AuditPostPublish
	case from.Status == domain.PostPublished && to.Status == domain.PostDraft:
		return domain.AuditPostUnpublish
	case to.Status == domain.PostScheduled &&
		(from.Status != domain.PostScheduled || !sameTime(from.PublishedAt, to.PublishedAt)):
		return domain.AuditPostSchedule
	default:
		return domain.AuditPostUpdate
	}
}

func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

func (s *PostService) Update(ctx context.Context, id string, in PostInput, actor domain.Actor) (domain.Post, error) {
	existing, err := s.Get(ctx, id)
	if err != nil {
		return existing, err
	}
	newStatus := domain.PostStatus(strings.TrimSpace(in.Status))
	if !canPublish(actor) && (existing.Status != domain.PostDraft || (newStatus.Valid() && newStatus != domain.PostDraft)) {
		return domain.Post{}, domain.ErrNoPermission
	}
	p, err := s.build(ctx, in, &existing)
	if err != nil {
		return p, err
	}
	p.ID = existing.ID
	if err := s.posts.Update(ctx, &p); err != nil {
		return p, slugConflict(err)
	}
	action := updateAction(existing, p)
	s.log.Info("post updated", "post_id", p.ID, "slug", p.Slug, "status", p.Status, "action", action,
		"actor", actor.ID)
	meta := map[string]any{"from": string(existing.Status), "to": string(p.Status)}
	if p.Status == domain.PostScheduled && p.PublishedAt != nil {
		meta["published_at"] = p.PublishedAt.UTC().Format(time.RFC3339)
	}
	if existing.Slug != p.Slug {
		meta["old_slug"] = existing.Slug
	}
	s.record(ctx, actor, action, p, meta)
	tags := []string{"posts", "post:" + p.Slug}
	if existing.Slug != p.Slug {
		tags = append(tags, "post:"+existing.Slug)
	}
	s.revalidate.Revalidate(tags...)
	return p, nil
}

func (s *PostService) Delete(ctx context.Context, id string, actor domain.Actor) error {
	existing, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if existing.Status != domain.PostDraft && !canPublish(actor) {
		return domain.ErrNoPermission
	}
	p, err := s.posts.SoftDelete(ctx, id)
	if err != nil {
		return err
	}
	s.log.Info("post deleted", "post_id", p.ID, "slug", p.Slug, "actor", actor.ID)
	s.record(ctx, actor, domain.AuditPostDelete, p, map[string]any{"status": string(p.Status)})
	s.revalidate.Revalidate("posts", "post:"+p.Slug)
	return nil
}

func slugConflict(err error) error {
	if errors.Is(err, domain.ErrConflict) {
		return &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"slug": "slug นี้ถูกใช้งานแล้ว"}}
	}
	return err
}

// ValidatePostInput performs the checks that need no database access.
func ValidatePostInput(in PostInput) (domain.Post, *domain.Validator) {
	v := &domain.Validator{}
	p := domain.Post{
		Slug:           strings.TrimSpace(in.Slug),
		Title:          cleanLine(in.Title),
		Excerpt:        cleanText(in.Excerpt),
		BodyMarkdown:   strings.TrimSpace(strings.ReplaceAll(in.BodyMarkdown, "\r\n", "\n")),
		Author:         cleanLine(in.Author),
		Status:         domain.PostStatus(strings.TrimSpace(in.Status)),
		Featured:       in.Featured,
		SEOTitle:       cleanLine(in.SEOTitle),
		SEODescription: cleanText(in.SEODescription),
		PublishedAt:    in.PublishedAt,
	}
	switch {
	case p.Slug == "":
		v.Add("slug", "กรุณากรอก slug")
	case len(p.Slug) > maxSlugLen:
		v.Add("slug", fmt.Sprintf("slug ต้องไม่เกิน %d ตัวอักษร", maxSlugLen))
	case !slugRe.MatchString(p.Slug):
		v.Add("slug", "slug ใช้ได้เฉพาะ a-z ตัวพิมพ์เล็ก ตัวเลข และขีดกลาง (-) คั่นระหว่างคำ")
	}
	switch n := runeLen(p.Title); {
	case n == 0:
		v.Add("title", "กรุณากรอกชื่อบทความ")
	case n > 200:
		v.Add("title", "ชื่อบทความต้องไม่เกิน 200 ตัวอักษร")
	}
	if runeLen(p.Excerpt) > 300 {
		v.Add("excerpt", "คำโปรยต้องไม่เกิน 300 ตัวอักษร")
	}
	if !p.Status.Valid() {
		v.Add("status", "สถานะต้องเป็น draft, published หรือ scheduled")
	}
	if p.Status != domain.PostDraft && p.BodyMarkdown == "" {
		v.Add("body_markdown", "กรุณากรอกเนื้อหาบทความก่อนเผยแพร่")
	}
	if runeLen(p.BodyMarkdown) > 200_000 {
		v.Add("body_markdown", "เนื้อหาบทความยาวเกินกำหนด (200,000 ตัวอักษร)")
	}
	if runeLen(p.Author) > 100 {
		v.Add("author", "ชื่อผู้เขียนต้องไม่เกิน 100 ตัวอักษร")
	}
	if runeLen(p.SEOTitle) > 200 {
		v.Add("seo_title", "SEO title ต้องไม่เกิน 200 ตัวอักษร")
	}
	if runeLen(p.SEODescription) > 400 {
		v.Add("seo_description", "SEO description ต้องไม่เกิน 400 ตัวอักษร")
	}
	if in.ReadingMinutes != nil {
		if *in.ReadingMinutes < 0 || *in.ReadingMinutes > 600 {
			v.Add("reading_minutes", "เวลาอ่านต้องอยู่ระหว่าง 0-600 นาที")
		} else {
			p.ReadingMinutes = *in.ReadingMinutes
		}
	}

	seen := map[string]bool{}
	for _, c := range in.Categories {
		c = strings.TrimSpace(c)
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		p.Categories = append(p.Categories, domain.CategoryRef{Slug: c})
	}
	if len(p.Categories) > 10 {
		v.Add("categories", "เลือกหมวดหมู่ได้ไม่เกิน 10 หมวด")
	}

	if in.Cover != nil {
		// A cover with only alt is kept so it can pair with cover_media_id;
		// build() drops it again if no URL gets resolved.
		c := &domain.Cover{URL: strings.TrimSpace(in.Cover.URL), Alt: cleanLine(in.Cover.Alt),
			Width: in.Cover.Width, Height: in.Cover.Height}
		if c.URL != "" && !validCoverURL(c.URL) {
			v.Add("cover.url", "URL รูปปกต้องขึ้นต้นด้วย / หรือ https://")
		}
		if runeLen(c.Alt) > 300 {
			v.Add("cover.alt", "คำอธิบายรูปปกต้องไม่เกิน 300 ตัวอักษร")
		}
		if c.Width < 0 || c.Width > 20000 || c.Height < 0 || c.Height > 20000 {
			v.Add("cover.width", "ขนาดรูปปกไม่ถูกต้อง")
		}
		p.Cover = c
	}
	if in.CoverMediaID != nil && strings.TrimSpace(*in.CoverMediaID) != "" {
		id := strings.TrimSpace(*in.CoverMediaID)
		if _, err := uuid.Parse(id); err != nil {
			v.Add("cover_media_id", "รหัสไฟล์สื่อไม่ถูกต้อง")
		} else {
			p.CoverMediaID = &id
		}
	}
	if in.LegacySlugs != nil {
		p.LegacySlugs = []string{}
		for _, ls := range *in.LegacySlugs {
			ls = cleanLine(ls)
			if ls == "" {
				continue
			}
			if runeLen(ls) > 300 || strings.Contains(ls, "/") {
				v.Add("legacy_slugs", "legacy slug ไม่ถูกต้อง")
				break
			}
			p.LegacySlugs = append(p.LegacySlugs, ls)
		}
		if len(p.LegacySlugs) > 20 {
			v.Add("legacy_slugs", "legacy slug ได้ไม่เกิน 20 รายการ")
		}
	}
	return p, v
}

func validCoverURL(u string) bool {
	if len(u) > 1000 {
		return false
	}
	if strings.HasPrefix(u, "/") {
		return !strings.HasPrefix(u, "//") && !strings.Contains(u, `\`)
	}
	parsed, err := url.Parse(u)
	return err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != ""
}

// build validates input and resolves categories/media; existing is nil on create.
func (s *PostService) build(ctx context.Context, in PostInput, existing *domain.Post) (domain.Post, error) {
	p, v := ValidatePostInput(in)
	if len(p.Categories) > 0 && !v.Has("categories") {
		slugs := p.CategorySlugs()
		found, err := s.categories.ExistingSlugs(ctx, slugs)
		if err != nil {
			return p, err
		}
		have := map[string]bool{}
		for _, f := range found {
			have[f] = true
		}
		for _, sl := range slugs {
			if !have[sl] {
				v.Add("categories", "ไม่พบหมวดหมู่: "+sl)
			}
		}
	}
	if p.CoverMediaID != nil {
		m, err := s.media.Get(ctx, *p.CoverMediaID)
		switch {
		case errors.Is(err, domain.ErrNotFound):
			v.Add("cover_media_id", "ไม่พบไฟล์สื่อที่เลือก")
		case err != nil:
			return p, err
		default:
			alt := ""
			if p.Cover != nil {
				alt = p.Cover.Alt
			}
			p.Cover = &domain.Cover{URL: m.URL, Alt: alt, Width: m.Width, Height: m.Height}
		}
	}
	if err := v.Err(); err != nil {
		return p, err
	}
	if p.Cover != nil && p.Cover.URL == "" {
		p.Cover = nil
	}
	if existing != nil {
		if p.PublishedAt == nil {
			p.PublishedAt = existing.PublishedAt
		}
		if in.LegacySlugs == nil {
			p.LegacySlugs = existing.LegacySlugs
		}
	}
	if p.LegacySlugs == nil {
		p.LegacySlugs = []string{}
	}
	if p.Status == domain.PostPublished && p.PublishedAt == nil {
		t := s.Now().UTC().Truncate(time.Second)
		p.PublishedAt = &t
	}
	if p.PublishedAt != nil {
		t := p.PublishedAt.UTC()
		p.PublishedAt = &t
	}
	if p.Status == domain.PostScheduled && (p.PublishedAt == nil || !p.PublishedAt.After(s.Now())) {
		return p, &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"published_at": MsgScheduleInPast}}
	}
	if in.ReadingMinutes == nil || p.ReadingMinutes == 0 {
		p.ReadingMinutes = EstimateReadingMinutes(p.BodyMarkdown)
	}
	return p, nil
}
