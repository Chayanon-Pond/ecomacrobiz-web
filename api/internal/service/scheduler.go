package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

// PostScheduler publishes scheduled posts whose published_at has passed.
// The flip is one atomic UPDATE, so several replicas may run it concurrently
// and each post is published (and audited) exactly once.
type PostScheduler struct {
	posts      repository.Posts
	audit      Auditor
	revalidate Revalidator
	log        *slog.Logger
	Now        func() time.Time
}

func NewPostScheduler(posts repository.Posts, audit Auditor, rv Revalidator, log *slog.Logger) *PostScheduler {
	return &PostScheduler{posts: posts, audit: audit, revalidate: rv, log: log, Now: time.Now}
}

// RunOnce publishes every due post and returns how many were published.
func (s *PostScheduler) RunOnce(ctx context.Context) (int, error) {
	due, err := s.posts.PublishDue(ctx, s.Now())
	if err != nil {
		return 0, err
	}
	if len(due) == 0 {
		return 0, nil
	}
	// The UPDATE is committed: finish the bookkeeping even during shutdown.
	ctx = context.WithoutCancel(ctx)
	tags := []string{"posts"}
	for _, p := range due {
		s.audit.Record(ctx, domain.AuditEvent{Action: domain.AuditPostPublish, TargetType: domain.TargetPost,
			TargetID: p.ID, Metadata: map[string]any{"slug": p.Slug, "scheduled": true}})
		tags = append(tags, "post:"+p.Slug)
		s.log.Info("scheduled post published", "post_id", p.ID, "slug", p.Slug)
	}
	s.revalidate.Revalidate(tags...)
	return len(due), nil
}

// Run calls RunOnce immediately and then every interval until ctx is done.
func (s *PostScheduler) Run(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if _, err := s.RunOnce(ctx); err != nil && ctx.Err() == nil {
			s.log.Warn("post scheduler run failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
