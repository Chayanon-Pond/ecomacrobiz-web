package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/storage"
)

// EngagementService: public counters, post likes and view counting.
type EngagementService struct {
	repo  repository.Engagement
	posts repository.Posts
	cfg   CommentServiceConfig
	log   *slog.Logger
	Now   func() time.Time

	mu      sync.Mutex
	saltDay time.Time
	salt    []byte
}

func NewEngagementService(repo repository.Engagement, posts repository.Posts, cfg CommentServiceConfig,
	log *slog.Logger) *EngagementService {
	return &EngagementService{repo: repo, posts: posts, cfg: cfg, log: log, Now: time.Now}
}

const maxStatsSlugs = 50

// Stats returns counters for up to 50 slugs (unknown slugs omitted).
func (s *EngagementService) Stats(ctx context.Context, raw string) (map[string]domain.CommunityStats, error) {
	var slugs []string
	seen := map[string]bool{}
	for _, p := range strings.Split(raw, ",") {
		if p = strings.TrimSpace(p); p != "" && len(p) <= 200 && !seen[p] {
			seen[p] = true
			slugs = append(slugs, p)
		}
	}
	if len(slugs) > maxStatsSlugs {
		return nil, &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"slugs": "ขอได้ครั้งละไม่เกิน 50 บทความ"}}
	}
	return s.repo.StatsBySlugs(ctx, slugs, s.Now())
}

func (s *EngagementService) post(ctx context.Context, slug string) (domain.Post, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" || len(slug) > 200 {
		return domain.Post{}, domain.ErrNotFound
	}
	return s.posts.GetPublishedBySlug(ctx, slug, s.Now())
}

// PostStats returns the counters of one post and whether viewer liked it.
func (s *EngagementService) PostStats(ctx context.Context, slug string, viewer *domain.Member) (domain.CommunityStats, bool, error) {
	p, err := s.post(ctx, slug)
	if err != nil {
		return domain.CommunityStats{}, false, err
	}
	mid := ""
	if viewer != nil {
		mid = viewer.ID
	}
	return s.repo.PostStats(ctx, p.ID, mid)
}

// LikePost toggles the member's like (idempotent).
func (s *EngagementService) LikePost(ctx context.Context, m domain.Member, slug string, like bool) (bool, int, error) {
	if m.Banned() {
		return false, 0, domain.ErrMemberBanned
	}
	if s.cfg.RequireVerified && !m.EmailVerified() {
		return false, 0, domain.ErrEmailUnverified
	}
	p, err := s.post(ctx, slug)
	if err != nil {
		return false, 0, err
	}
	return s.repo.LikePost(ctx, p.ID, m.ID, like, s.Now().UTC())
}

func utcDay(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func (s *EngagementService) daySalt(ctx context.Context, day time.Time) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.salt != nil && s.saltDay.Equal(day) {
		return s.salt, nil
	}
	cand := make([]byte, 32)
	if _, err := rand.Read(cand); err != nil {
		return nil, err
	}
	salt, err := s.repo.DaySalt(ctx, day, cand)
	if err != nil {
		return nil, err
	}
	s.salt, s.saltDay = salt, day
	return salt, nil
}

// VisitorHash = HMAC-SHA256(daily salt, ip + "\n" + ua).
func VisitorHash(salt []byte, ip, ua string) []byte {
	m := hmac.New(sha256.New, salt)
	m.Write([]byte(ip + "\n" + ua))
	return m.Sum(nil)
}

// RecordView counts at most one view per (UTC day, post, visitor). Bots,
// unknown posts and errors are silently ignored (the endpoint is 204 always).
func (s *EngagementService) RecordView(ctx context.Context, slug, ip, ua string) {
	if IsBotUA(ua) {
		return
	}
	p, err := s.post(ctx, slug)
	if err != nil {
		return
	}
	day := utcDay(s.Now())
	salt, err := s.daySalt(ctx, day)
	if err != nil {
		s.log.Warn("view salt", "err", err)
		return
	}
	if _, err := s.repo.RecordView(ctx, day, p.ID, VisitorHash(salt, ip, ua)); err != nil {
		s.log.Warn("record view", "err", err)
	}
}

// CommunityJanitor is the hourly purge: expired member sessions, tokens and
// OAuth states; view salts/dedupe rows older than yesterday; unattached
// comment images older than 24 h (row + file).
type CommunityJanitor struct {
	engagement repository.Engagement
	comments   repository.Comments
	store      storage.MediaStore
	log        *slog.Logger
	Now        func() time.Time
}

func NewCommunityJanitor(engagement repository.Engagement, comments repository.Comments, store storage.MediaStore,
	log *slog.Logger) *CommunityJanitor {
	return &CommunityJanitor{engagement: engagement, comments: comments, store: store, log: log, Now: time.Now}
}

// RunOnce performs one purge pass.
func (j *CommunityJanitor) RunOnce(ctx context.Context) error {
	now := j.Now().UTC()
	res, err := j.engagement.PurgeExpired(ctx, now, utcDay(now).AddDate(0, 0, -1))
	if err != nil {
		return err
	}
	images := 0
	for {
		keys, err := j.comments.TakeStaleImages(ctx, now.Add(-24*time.Hour), 200)
		if err != nil {
			return err
		}
		for _, k := range keys {
			if err := j.store.Delete(ctx, k); err != nil {
				j.log.Error("purge comment image file", "key", k, "err", err)
			}
		}
		images += len(keys)
		if len(keys) < 200 {
			break
		}
	}
	if res.Sessions+res.Tokens+res.States+res.Dedupe+res.Salts > 0 || images > 0 {
		j.log.Info("community purge", "sessions", res.Sessions, "tokens", res.Tokens, "oauth_states", res.States,
			"view_dedupe", res.Dedupe, "view_salts", res.Salts, "images", images)
	}
	return nil
}

// Run purges now and then every interval until ctx is done.
func (j *CommunityJanitor) Run(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if err := j.RunOnce(ctx); err != nil && ctx.Err() == nil {
			j.log.Warn("community purge failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
