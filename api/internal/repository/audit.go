package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type PGAuditLogs struct{ db DB }

func (r *PGAuditLogs) Insert(ctx context.Context, ev domain.AuditEvent) error {
	meta := ev.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	b, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	var actorID *string
	if ev.Actor.ID != "" {
		actorID = &ev.Actor.ID
	}
	_, err = r.db.Exec(ctx, `
		INSERT INTO audit_logs (actor_id, actor_email, action, target_type, target_id, metadata, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
		actorID, ev.Actor.Email, ev.Action, ev.TargetType, ev.TargetID, string(b), ev.Actor.IP, ev.Actor.UserAgent)
	return mapErr(err)
}

func (r *PGAuditLogs) List(ctx context.Context, f AuditFilter) ([]domain.AuditEntry, int, error) {
	var conds []string
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}
	if f.ActorID != "" {
		add("a.actor_id = $%d", f.ActorID)
	}
	if f.Action != "" {
		add("a.action = $%d", f.Action)
	}
	if f.TargetType != "" {
		add("a.target_type = $%d", f.TargetType)
	}
	if f.TargetID != "" {
		add("a.target_id = $%d", f.TargetID)
	}
	if f.From != nil {
		add("a.created_at >= $%d", *f.From)
	}
	if f.To != nil {
		add("a.created_at < $%d", *f.To)
	}
	where := ""
	if len(conds) > 0 {
		where = " WHERE " + strings.Join(conds, " AND ")
	}
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM audit_logs a`+where, args...).Scan(&total); err != nil {
		return nil, 0, mapErr(err)
	}
	n := len(args)
	args = append(args, f.PerPage, f.Offset())
	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		SELECT a.id, a.created_at, a.actor_id, a.actor_email, COALESCE(u.name, ''), a.action, a.target_type,
		       a.target_id, a.metadata, a.ip, a.user_agent
		  FROM audit_logs a LEFT JOIN admin_users u ON u.id = a.actor_id%s
		 ORDER BY a.created_at DESC, a.id DESC LIMIT $%d OFFSET $%d`, where, n+1, n+2), args...)
	if err != nil {
		return nil, 0, mapErr(err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.AuditEntry, error) {
		var e domain.AuditEntry
		var meta []byte
		err := row.Scan(&e.ID, &e.CreatedAt, &e.ActorID, &e.ActorEmail, &e.ActorName, &e.Action, &e.TargetType,
			&e.TargetID, &meta, &e.IP, &e.UserAgent)
		if err == nil {
			err = json.Unmarshal(meta, &e.Metadata)
		}
		return e, err
	})
	return out, total, err
}
