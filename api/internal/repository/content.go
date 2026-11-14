package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// userRef builds a UserRef from a nullable id plus the joined name/email.
func userRef(id, name, email *string) *domain.UserRef {
	if id == nil || *id == "" {
		return nil
	}
	r := &domain.UserRef{ID: *id}
	if name != nil {
		r.Name = *name
	}
	if email != nil {
		r.Email = *email
	}
	return r
}

func adminPostOrder(sort string) string {
	switch sort {
	case "updated_asc":
		return "p.updated_at ASC, p.id ASC"
	case "published_desc":
		return "p.published_at DESC NULLS LAST, p.id DESC"
	case "published_asc":
		return "p.published_at ASC NULLS LAST, p.id ASC"
	case "title_asc":
		return "p.title ASC, p.id ASC"
	default:
		return "p.updated_at DESC, p.id DESC"
	}
}

// ---- posts ----

func (r *PGPosts) SlugsTaken(ctx context.Context, candidates []string, excludeID string) ([]string, error) {
	if len(candidates) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT c FROM unnest($1::text[]) AS c
		 WHERE EXISTS (SELECT 1 FROM posts p
		                WHERE p.deleted_at IS NULL AND p.id::text <> $2
		                  AND (p.slug = c OR p.legacy_slugs @> ARRAY[c]))`, candidates, excludeID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (r *PGPosts) SetStatus(ctx context.Context, id string, status domain.PostStatus, publishedAt *time.Time, plan *RedirectPlan) (domain.Post, error) {
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE posts SET status = $2, published_at = $3 WHERE id = $1 AND deleted_at IS NULL`,
			id, string(status), publishedAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return applyRedirectPlan(ctx, tx, plan)
	})
	if err != nil {
		return domain.Post{}, mapErr(err)
	}
	return r.GetByID(ctx, id)
}

// PublishDue relies on Postgres row locking: a concurrent UPDATE re-checks
// status='scheduled' after the first commits, so each row is flipped (and
// returned) exactly once across replicas. Redirect rows for the published
// URLs are deleted in the same transaction (a live post wins).
func (r *PGPosts) PublishDue(ctx context.Context, now time.Time) ([]domain.PostRef, error) {
	var out []domain.PostRef
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			UPDATE posts SET status = 'published'
			 WHERE status = 'scheduled' AND published_at <= $1 AND deleted_at IS NULL
			RETURNING id, slug, legacy_slugs`, now)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, scanPostRef)
		if err != nil {
			return err
		}
		var paths []string
		for _, p := range out {
			paths = append(paths, p.Paths()...)
		}
		return applyRedirectPlan(ctx, tx, &RedirectPlan{Remove: paths})
	})
	return out, mapErr(err)
}

func (r *PGPosts) Stats(ctx context.Context) (domain.PostStats, error) {
	var s domain.PostStats
	err := r.db.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE status = 'published')::int,
		       count(*) FILTER (WHERE status = 'draft')::int,
		       count(*) FILTER (WHERE status = 'scheduled')::int,
		       min(published_at) FILTER (WHERE status = 'scheduled')
		  FROM posts WHERE deleted_at IS NULL`).Scan(&s.Published, &s.Drafts, &s.Scheduled, &s.NextScheduledAt)
	return s, mapErr(err)
}

// ---- leads ----

// leadWhere builds the WHERE clause over unqualified leads columns.
func leadWhere(f LeadFilter) (string, []any) {
	conds := []string{"deleted_at IS NULL"}
	var args []any
	if f.Status != "" {
		args = append(args, f.Status)
		conds = append(conds, fmt.Sprintf("status = $%d", len(args)))
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		args = append(args, likePattern(q))
		conds = append(conds, fmt.Sprintf(`(first_name ILIKE $%[1]d OR last_name ILIKE $%[1]d OR email ILIKE $%[1]d
			OR phone ILIKE $%[1]d OR company ILIKE $%[1]d OR line_id ILIKE $%[1]d)`, len(args)))
	}
	switch f.Assigned {
	case "":
	case "none":
		conds = append(conds, "assigned_to IS NULL")
	default:
		args = append(args, f.Assigned)
		conds = append(conds, fmt.Sprintf("assigned_to = $%d", len(args)))
	}
	if f.CreatedFrom != nil {
		args = append(args, *f.CreatedFrom)
		conds = append(conds, fmt.Sprintf("created_at >= $%d", len(args)))
	}
	if f.CreatedTo != nil {
		args = append(args, *f.CreatedTo)
		conds = append(conds, fmt.Sprintf("created_at < $%d", len(args)))
	}
	return strings.Join(conds, " AND "), args
}

func collectLeads(rows pgx.Rows) ([]domain.Lead, error) {
	defer rows.Close()
	var out []domain.Lead
	for rows.Next() {
		l, err := scanLead(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (r *PGLeads) Board(ctx context.Context, f LeadFilter, perColumn int) (map[domain.LeadStatus][]domain.Lead, map[domain.LeadStatus]int, error) {
	f.Status = ""
	where, args := leadWhere(f)
	counts := map[domain.LeadStatus]int{}
	rows, err := r.db.Query(ctx, `SELECT status, count(*)::int FROM leads WHERE `+where+` GROUP BY status`, args...)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			rows.Close()
			return nil, nil, err
		}
		counts[domain.LeadStatus(st)] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	args = append(args, perColumn)
	rows, err = r.db.Query(ctx, fmt.Sprintf(`SELECT %s FROM (
		SELECT leads.*, row_number() OVER (PARTITION BY status ORDER BY created_at DESC, id DESC) AS rn
		  FROM leads WHERE %s) AS leads
		WHERE rn <= $%d ORDER BY created_at DESC, id DESC`, leadCols, where, len(args)), args...)
	if err != nil {
		return nil, nil, err
	}
	list, err := collectLeads(rows)
	if err != nil {
		return nil, nil, err
	}
	cols := map[domain.LeadStatus][]domain.Lead{}
	for _, l := range list {
		cols[l.Status] = append(cols[l.Status], l)
	}
	return cols, counts, nil
}

func actorArgs(a domain.Actor) (*string, string) {
	if a.IsSystem() {
		return nil, ""
	}
	id := a.ID
	name := a.Name
	if name == "" {
		name = a.Email
	}
	return &id, name
}

func refLabel(r *domain.UserRef) string {
	if r == nil {
		return ""
	}
	if r.Name != "" {
		return r.Name
	}
	return r.Email
}

func (r *PGLeads) Apply(ctx context.Context, id string, ch LeadChange, actor domain.Actor) (before, after domain.Lead, err error) {
	actorID, actorName := actorArgs(actor)
	err = withTx(ctx, r.db, func(tx pgx.Tx) error {
		var err error
		before, err = scanLead(tx.QueryRow(ctx, `SELECT `+leadCols+` FROM leads
			WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id))
		if err != nil {
			return err
		}
		status := before.Status
		if ch.Status != nil {
			status = *ch.Status
		}
		var assigned *string
		if before.AssignedTo != nil {
			assigned = &before.AssignedTo.ID
		}
		if ch.AssignSet {
			assigned = ch.AssignedTo
		}
		after, err = scanLead(tx.QueryRow(ctx, `
			UPDATE leads SET status = $2, assigned_to = $3, note = COALESCE($4, note)
			 WHERE id = $1 RETURNING `+leadCols, id, string(status), assigned, ch.Note))
		if err != nil {
			return err
		}
		const ins = `INSERT INTO lead_activities (lead_id, actor_id, actor_name, kind, from_value, to_value)
			VALUES ($1, $2, $3, $4, $5, $6)`
		if after.Status != before.Status {
			if _, err := tx.Exec(ctx, ins, id, actorID, actorName, domain.LeadActivityStatus,
				string(before.Status), string(after.Status)); err != nil {
				return err
			}
		}
		if refID(before.AssignedTo) != refID(after.AssignedTo) {
			if _, err := tx.Exec(ctx, ins, id, actorID, actorName, domain.LeadActivityAssign,
				refLabel(before.AssignedTo), refLabel(after.AssignedTo)); err != nil {
				return err
			}
		}
		return nil
	})
	return before, after, mapErr(err)
}

func refID(r *domain.UserRef) string {
	if r == nil {
		return ""
	}
	return r.ID
}

const activityCols = `a.id, a.lead_id, a.actor_id, a.actor_name, a.kind, a.body, a.from_value, a.to_value,
	a.created_at`

func (r *PGLeads) AddNote(ctx context.Context, leadID string, actor domain.Actor, body string) (domain.LeadActivity, error) {
	actorID, actorName := actorArgs(actor)
	var a domain.LeadActivity
	err := r.db.QueryRow(ctx, `
		INSERT INTO lead_activities AS a (lead_id, actor_id, actor_name, kind, body)
		SELECT id, $2, $3, 'note', $4 FROM leads WHERE id = $1 AND deleted_at IS NULL
		RETURNING `+activityCols, leadID, actorID, actorName, body).
		Scan(&a.ID, &a.LeadID, &a.ActorID, &a.ActorName, &a.Kind, &a.Body, &a.From, &a.To, &a.CreatedAt)
	if err != nil {
		return a, mapErr(err)
	}
	if actorID != nil {
		a.Actor = &domain.UserRef{ID: actor.ID, Name: actor.Name, Email: actor.Email}
	}
	return a, nil
}

func (r *PGLeads) Activities(ctx context.Context, leadID string) ([]domain.LeadActivity, error) {
	rows, err := r.db.Query(ctx, `SELECT `+activityCols+`, u.name, u.email
		  FROM lead_activities a LEFT JOIN admin_users u ON u.id = a.actor_id
		 WHERE a.lead_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT 500`, leadID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.LeadActivity, error) {
		var a domain.LeadActivity
		var name, email *string
		err := row.Scan(&a.ID, &a.LeadID, &a.ActorID, &a.ActorName, &a.Kind, &a.Body, &a.From, &a.To,
			&a.CreatedAt, &name, &email)
		a.Actor = userRef(a.ActorID, name, email)
		return a, err
	})
}

func (r *PGLeads) Assignees(ctx context.Context, roles []domain.Role) ([]domain.UserRef, error) {
	rs := make([]string, len(roles))
	for i, x := range roles {
		rs[i] = string(x)
	}
	rows, err := r.db.Query(ctx, `SELECT id, name, email FROM admin_users
		WHERE is_active AND role = ANY($1) ORDER BY lower(name), email`, rs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.UserRef, error) {
		var u domain.UserRef
		err := row.Scan(&u.ID, &u.Name, &u.Email)
		return u, err
	})
}

// Stats counts leads by Asia/Bangkok calendar day relative to now, in one
// query (count FILTER + generate_series for the zero-filled 30-day series).
func (r *PGLeads) Stats(ctx context.Context, now time.Time) (domain.LeadStats, error) {
	s := domain.LeadStats{ByStatus: map[domain.LeadStatus]int{}}
	var st [5]int
	var days []string
	var counts []int32
	err := r.db.QueryRow(ctx, `
		WITH b AS (SELECT ($1::timestamptz AT TIME ZONE 'Asia/Bangkok')::date AS today),
		l AS (SELECT status, (created_at AT TIME ZONE 'Asia/Bangkok')::date AS d FROM leads WHERE deleted_at IS NULL),
		daily AS (
			SELECT g.day::date AS day, count(l.d)::int AS n
			  FROM b CROSS JOIN LATERAL generate_series(b.today - 29, b.today, interval '1 day') AS g(day)
			  LEFT JOIN l ON l.d = g.day::date
			 GROUP BY g.day)
		SELECT count(l.d) FILTER (WHERE l.d = b.today)::int,
		       count(l.d) FILTER (WHERE l.d = b.today - 1)::int,
		       count(l.d) FILTER (WHERE l.d BETWEEN b.today - 6 AND b.today)::int,
		       count(l.d) FILTER (WHERE l.d BETWEEN b.today - 13 AND b.today - 7)::int,
		       count(l.d) FILTER (WHERE l.d BETWEEN b.today - 29 AND b.today)::int,
		       count(l.d) FILTER (WHERE l.d BETWEEN b.today - 59 AND b.today - 30)::int,
		       count(l.d) FILTER (WHERE l.status = 'new')::int,
		       count(l.d) FILTER (WHERE l.status = 'contacted')::int,
		       count(l.d) FILTER (WHERE l.status = 'qualified')::int,
		       count(l.d) FILTER (WHERE l.status = 'closed')::int,
		       count(l.d) FILTER (WHERE l.status = 'spam')::int,
		       (SELECT array_agg(to_char(day, 'YYYY-MM-DD') ORDER BY day) FROM daily),
		       (SELECT array_agg(n ORDER BY day) FROM daily)
		  FROM b LEFT JOIN l ON true
		 GROUP BY b.today`, now).Scan(&s.Today, &s.Yesterday, &s.Last7, &s.Prev7, &s.Last30, &s.Prev30,
		&st[0], &st[1], &st[2], &st[3], &st[4], &days, &counts)
	if err != nil {
		return s, mapErr(err)
	}
	for i, k := range []domain.LeadStatus{domain.LeadNew, domain.LeadContacted, domain.LeadQualified,
		domain.LeadClosed, domain.LeadSpam} {
		s.ByStatus[k] = st[i]
	}
	s.Daily = make([]domain.DayCount, len(days))
	for i := range days {
		s.Daily[i] = domain.DayCount{Date: days[i], Count: int(counts[i])}
	}
	return s, nil
}

// ---- media ----

// mediaUsedBy matches live posts (alias p) that reference the row of table
// "media" as cover or inside the markdown body.
const mediaUsedBy = `p.deleted_at IS NULL AND (p.cover_media_id = media.id OR p.og_media_id = media.id
	OR strpos(p.body_markdown, media.storage_key) > 0)`

func (r *PGMedia) List(ctx context.Context, f MediaFilter) ([]domain.Media, int, error) {
	conds := []string{"deleted_at IS NULL"}
	var args []any
	if q := strings.TrimSpace(f.Query); q != "" {
		args = append(args, likePattern(q))
		conds = append(conds, fmt.Sprintf("(original_name ILIKE $%[1]d OR alt ILIKE $%[1]d)", len(args)))
	}
	if f.Mime != "" {
		args = append(args, f.Mime)
		conds = append(conds, fmt.Sprintf("mime = $%d", len(args)))
	}
	where := strings.Join(conds, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM media WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	n := len(args)
	args = append(args, f.PerPage, f.Offset())
	rows, err := r.db.Query(ctx, fmt.Sprintf(`SELECT %s FROM media WHERE %s
		ORDER BY created_at DESC, id DESC LIMIT $%d OFFSET $%d`, mediaCols, where, n+1, n+2), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []domain.Media
	for rows.Next() {
		m, err := scanMedia(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	return out, total, rows.Err()
}

func (r *PGMedia) Usage(ctx context.Context, id string) ([]domain.MediaUsage, error) {
	rows, err := r.db.Query(ctx, `
		SELECT p.id, p.title, p.slug, p.status,
		       CASE WHEN p.cover_media_id = media.id THEN 'cover'
		            WHEN p.og_media_id = media.id THEN 'og' ELSE 'body' END
		  FROM media JOIN posts p ON `+mediaUsedBy+`
		 WHERE media.id = $1 AND media.deleted_at IS NULL
		 ORDER BY p.updated_at DESC, p.id`, id)
	if err != nil {
		return nil, mapErr(err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.MediaUsage, error) {
		var u domain.MediaUsage
		var st string
		err := row.Scan(&u.PostID, &u.Title, &u.Slug, &st, &u.Kind)
		u.Status = domain.PostStatus(st)
		return u, err
	})
	return out, mapErr(err)
}

func (r *PGMedia) UpdateAlt(ctx context.Context, id, alt string) (domain.Media, error) {
	return scanMedia(r.db.QueryRow(ctx, `UPDATE media SET alt = $2 WHERE id = $1 AND deleted_at IS NULL
		RETURNING `+mediaCols, id, alt))
}

func (r *PGMedia) SoftDeleteUnused(ctx context.Context, id string) (domain.Media, error) {
	m, err := scanMedia(r.db.QueryRow(ctx, `
		UPDATE media SET deleted_at = now()
		 WHERE id = $1 AND deleted_at IS NULL
		   AND NOT EXISTS (SELECT 1 FROM posts p WHERE `+mediaUsedBy+`)
		RETURNING `+mediaCols, id))
	if !errors.Is(err, domain.ErrNotFound) {
		return m, err
	}
	cur, gerr := r.Get(ctx, id)
	if gerr != nil {
		return m, gerr
	}
	return cur, &domain.InUseError{Count: cur.UsageCount}
}
