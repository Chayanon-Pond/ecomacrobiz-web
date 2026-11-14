package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

const MsgScheduleInPast = "เวลาเผยแพร่ต้องอยู่ในอนาคต"

// ---- slug check ----

type SlugCheck struct {
	Slug       string `json:"slug"`
	Valid      bool   `json:"valid"`
	Available  bool   `json:"available"`
	Suggestion string `json:"suggestion"`
}

// Slugify lower-cases and replaces every run of characters outside a-z0-9
// with a single dash ("" when nothing usable remains, e.g. Thai-only input).
func Slugify(s string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			if dash && b.Len() > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(r)
			dash = false
			continue
		}
		dash = true
	}
	return b.String()
}

// SlugCheck reports whether slug is valid and free (not the slug or a legacy
// slug of another live post) and suggests the first free "slug", "slug-2", …
func (s *PostService) SlugCheck(ctx context.Context, slug, excludeID string) (SlugCheck, error) {
	slug = strings.TrimSpace(slug)
	res := SlugCheck{Slug: slug, Valid: ValidSlug(slug)}
	if _, err := uuid.Parse(excludeID); err != nil {
		excludeID = ""
	}
	base := slug
	if !res.Valid {
		base = Slugify(slug)
	}
	if base == "" {
		return res, nil
	}
	const batch = 25
	for start := 1; start <= 4*batch; start += batch {
		cands := make([]string, 0, batch)
		for n := start; n < start+batch; n++ {
			suffix := ""
			if n > 1 {
				suffix = fmt.Sprintf("-%d", n)
			}
			b := base
			if len(b)+len(suffix) > maxSlugLen {
				b = strings.TrimRight(b[:maxSlugLen-len(suffix)], "-")
			}
			cands = append(cands, b+suffix)
		}
		taken, err := s.posts.SlugsTaken(ctx, cands, excludeID)
		if err != nil {
			return res, err
		}
		used := map[string]bool{}
		for _, t := range taken {
			used[t] = true
		}
		if start == 1 && res.Valid {
			res.Available = !used[slug]
		}
		for _, c := range cands {
			if !used[c] {
				res.Suggestion = c
				return res, nil
			}
		}
	}
	return res, nil
}

// ---- bulk ----

type BulkInput struct {
	Action string   `json:"action"`
	IDs    []string `json:"ids"`
}

type BulkFailure struct {
	ID      string `json:"id"`
	Message string `json:"message"`
}

type BulkResult struct {
	Succeeded []string      `json:"succeeded"`
	Failed    []BulkFailure `json:"failed"`
}

const maxBulkIDs = 100

// Bulk publishes, unpublishes or deletes up to 100 posts. Each item is
// processed and audited independently; one revalidate call covers all tags.
func (s *PostService) Bulk(ctx context.Context, in BulkInput, actor domain.Actor) (BulkResult, error) {
	if !canPublish(actor) {
		return BulkResult{}, domain.ErrNoPermission
	}
	var v domain.Validator
	switch in.Action {
	case "publish", "unpublish", "delete":
	default:
		v.Add("action", "action ต้องเป็น publish, unpublish หรือ delete")
	}
	var ids []string
	seen := map[string]bool{}
	for _, id := range in.IDs {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 || len(ids) > maxBulkIDs {
		v.Add("ids", fmt.Sprintf("เลือกบทความ 1-%d รายการ", maxBulkIDs))
	}
	if err := v.Err(); err != nil {
		return BulkResult{}, err
	}
	res := BulkResult{Succeeded: []string{}, Failed: []BulkFailure{}}
	tags := []string{"posts"}
	for _, id := range ids {
		slug, err := s.bulkOne(ctx, in.Action, id, actor)
		if err != nil {
			res.Failed = append(res.Failed, BulkFailure{ID: id, Message: bulkErrMessage(err)})
			if !isExpected(err) {
				s.log.Error("bulk post action failed", "action", in.Action, "post_id", id, "err", err)
			}
			continue
		}
		res.Succeeded = append(res.Succeeded, id)
		if slug != "" {
			tags = append(tags, "post:"+slug)
		}
	}
	if len(tags) > 1 {
		s.revalidate.Revalidate(tags...)
	}
	s.log.Info("bulk post action", "action", in.Action, "succeeded", len(res.Succeeded), "failed", len(res.Failed),
		"actor", actor.ID)
	return res, nil
}

var errEmptyBody = errors.New("empty body")

func isExpected(err error) bool {
	return errors.Is(err, domain.ErrNotFound) || errors.Is(err, errEmptyBody)
}

func bulkErrMessage(err error) string {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return "ไม่พบบทความ"
	case errors.Is(err, errEmptyBody):
		return "กรุณากรอกเนื้อหาบทความก่อนเผยแพร่"
	default:
		return domain.MsgInternal
	}
}

// bulkOne returns the slug to revalidate ("" when nothing changed).
func (s *PostService) bulkOne(ctx context.Context, action, id string, actor domain.Actor) (string, error) {
	p, err := s.Get(ctx, id)
	if err != nil {
		return "", err
	}
	meta := map[string]any{"from": string(p.Status), "bulk": true}
	switch action {
	case "publish":
		if p.Status == domain.PostPublished {
			return "", nil
		}
		if strings.TrimSpace(p.BodyMarkdown) == "" {
			return "", errEmptyBody
		}
		now := s.Now().UTC().Truncate(time.Second)
		at := p.PublishedAt
		if at == nil || at.After(now) {
			at = &now
		}
		if _, err := s.posts.SetStatus(ctx, id, domain.PostPublished, at); err != nil {
			return "", err
		}
		s.record(ctx, actor, domain.AuditPostPublish, p, meta)
	case "unpublish":
		if p.Status == domain.PostDraft {
			return "", nil
		}
		if _, err := s.posts.SetStatus(ctx, id, domain.PostDraft, p.PublishedAt); err != nil {
			return "", err
		}
		s.record(ctx, actor, domain.AuditPostUnpublish, p, meta)
	case "delete":
		if _, err := s.posts.SoftDelete(ctx, id); err != nil {
			return "", err
		}
		meta["status"] = meta["from"]
		delete(meta, "from")
		s.record(ctx, actor, domain.AuditPostDelete, p, meta)
	}
	return p.Slug, nil
}

// ---- dashboard ----

// DashboardPosts is the posts section of GET /dashboard.
type DashboardPosts struct {
	domain.PostStats
	Recent []domain.Post
}

func (s *PostService) Dashboard(ctx context.Context) (DashboardPosts, error) {
	st, err := s.posts.Stats(ctx)
	if err != nil {
		return DashboardPosts{}, err
	}
	recent, _, err := s.posts.AdminList(ctx, repository.AdminPostFilter{Page: domain.Page{Page: 1, PerPage: 5},
		Sort: "updated_desc"})
	if err != nil {
		return DashboardPosts{}, err
	}
	return DashboardPosts{PostStats: st, Recent: recent}, nil
}
