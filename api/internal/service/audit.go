package service

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

// AuditService implements Auditor over the audit_logs table and serves the
// owner's audit view.
type AuditService struct {
	repo repository.AuditLogs
	log  *slog.Logger
}

func NewAuditService(repo repository.AuditLogs, log *slog.Logger) *AuditService {
	return &AuditService{repo: repo, log: log}
}

// secretKey matches metadata keys that must never be stored, whatever a
// caller passes (defence in depth; callers should not send them at all).
func secretKey(k string) bool {
	k = strings.ToLower(k)
	for _, s := range []string{"password", "passwd", "token", "hash", "secret", "cookie", "csrf"} {
		if strings.Contains(k, s) {
			return true
		}
	}
	return false
}

// SanitizeMetadata drops secret-looking keys (recursively in nested maps).
func SanitizeMetadata(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		if secretKey(k) {
			continue
		}
		if nested, ok := v.(map[string]any); ok {
			v = SanitizeMetadata(nested)
		}
		out[k] = v
	}
	return out
}

// Record stores ev. It never fails the caller: storage errors are logged.
// The write survives a cancelled request context (bounded by 5 s).
func (s *AuditService) Record(ctx context.Context, ev domain.AuditEvent) {
	ev.Metadata = SanitizeMetadata(ev.Metadata)
	ev.Actor.UserAgent = truncateRunes(cleanLine(ev.Actor.UserAgent), 500)
	ev.Actor.Email = truncateRunes(ev.Actor.Email, 254)
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.repo.Insert(ctx, ev); err != nil {
		s.log.Error("audit write failed", "action", ev.Action, "actor_id", ev.Actor.ID, "target_type", ev.TargetType,
			"target_id", ev.TargetID, "err", err)
	}
}

// AuditQuery is the raw GET /audit filter (dates YYYY-MM-DD, Asia/Bangkok,
// inclusive).
type AuditQuery struct {
	ActorID    string
	Action     string
	TargetType string
	TargetID   string
	From, To   string
	Page       int
	PerPage    int
}

func (s *AuditService) List(ctx context.Context, q AuditQuery) ([]domain.AuditEntry, domain.Page, int, error) {
	var v domain.Validator
	f := repository.AuditFilter{
		Page:       NormalizePage(q.Page, q.PerPage, 50, 100),
		ActorID:    strings.TrimSpace(q.ActorID),
		Action:     strings.TrimSpace(q.Action),
		TargetType: strings.TrimSpace(q.TargetType),
		TargetID:   truncateRunes(strings.TrimSpace(q.TargetID), 200),
	}
	if f.ActorID != "" {
		if _, err := uuid.Parse(f.ActorID); err != nil {
			v.Add("actor_id", "รหัสผู้ใช้ไม่ถูกต้อง")
		}
	}
	if len(f.Action) > 64 {
		v.Add("action", "ประเภทกิจกรรมไม่ถูกต้อง")
	}
	if len(f.TargetType) > 32 {
		v.Add("target_type", "ประเภทเป้าหมายไม่ถูกต้อง")
	}
	if q.From != "" {
		d, err := time.ParseInLocation("2006-01-02", q.From, bangkok)
		if err != nil {
			v.Add("from", "รูปแบบวันที่ต้องเป็น YYYY-MM-DD")
		} else {
			f.From = &d
		}
	}
	if q.To != "" {
		d, err := time.ParseInLocation("2006-01-02", q.To, bangkok)
		if err != nil {
			v.Add("to", "รูปแบบวันที่ต้องเป็น YYYY-MM-DD")
		} else {
			end := d.AddDate(0, 0, 1) // inclusive day
			f.To = &end
		}
	}
	if f.From != nil && f.To != nil && !f.From.Before(*f.To) {
		v.Add("to", "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น")
	}
	if err := v.Err(); err != nil {
		return nil, f.Page, 0, err
	}
	entries, total, err := s.repo.List(ctx, f)
	return entries, f.Page, total, err
}
