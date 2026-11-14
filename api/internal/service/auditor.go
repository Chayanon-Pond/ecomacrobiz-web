package service

import (
	"context"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// Auditor records audit events. Implemented by AuditService (Postgres);
// NopAuditor is for tests/tools. Record must not fail the caller's request:
// implementations log and swallow storage errors.
type Auditor interface {
	Record(ctx context.Context, ev domain.AuditEvent)
}

// NopAuditor discards events.
type NopAuditor struct{}

func (NopAuditor) Record(context.Context, domain.AuditEvent) {}
