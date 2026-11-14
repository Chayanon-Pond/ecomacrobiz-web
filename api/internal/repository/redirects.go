package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// imageFrom builds an optional image (cover / OG) from nullable columns.
func imageFrom(url *string, alt string, w, h *int32) *domain.Cover {
	if url == nil || *url == "" {
		return nil
	}
	c := &domain.Cover{URL: *url, Alt: alt}
	if w != nil {
		c.Width = int(*w)
	}
	if h != nil {
		c.Height = int(*h)
	}
	return c
}

func imageArgs(c *domain.Cover) (url *string, alt string, w, h *int) {
	if c == nil {
		return nil, "", nil, nil
	}
	u := c.URL
	url, alt = &u, c.Alt
	if c.Width > 0 {
		v := c.Width
		w = &v
	}
	if c.Height > 0 {
		v := c.Height
		h = &v
	}
	return
}

func scanPostRef(row pgx.CollectableRow) (domain.PostRef, error) {
	var p domain.PostRef
	err := row.Scan(&p.ID, &p.Slug, &p.LegacySlugs)
	return p, err
}

// applyRedirectPlan runs inside the caller's transaction.
func applyRedirectPlan(ctx context.Context, tx pgx.Tx, plan *RedirectPlan) error {
	if plan.Empty() {
		return nil
	}
	if len(plan.Remove) > 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM redirects WHERE from_path = ANY($1)`, plan.Remove); err != nil {
			return err
		}
	}
	for _, s := range plan.Set {
		r := s.Redirect
		if _, err := tx.Exec(ctx, `
			INSERT INTO redirects (from_path, to_path, status_code, kind, note, created_by)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (from_path) DO UPDATE
			   SET to_path = EXCLUDED.to_path, status_code = EXCLUDED.status_code, kind = EXCLUDED.kind,
			       note = EXCLUDED.note, created_by = EXCLUDED.created_by`,
			r.From, r.To, r.Status, r.Kind, r.Note, s.CreatedBy); err != nil {
			return err
		}
		if r.Status == 301 && r.To != nil {
			if _, err := repoint(ctx, tx, r.From, *r.To); err != nil {
				return err
			}
		}
	}
	for _, m := range plan.Repoint {
		if _, err := repoint(ctx, tx, m.Old, m.New); err != nil {
			return err
		}
	}
	return nil
}

// repoint flattens chains: 301s pointing at oldTo now point at newTo. A row
// that would point at itself (from == newTo) is dropped instead.
func repoint(ctx context.Context, tx pgx.Tx, oldTo, newTo string) (int, error) {
	if oldTo == newTo {
		return 0, nil
	}
	if _, err := tx.Exec(ctx, `DELETE FROM redirects WHERE status_code = 301 AND to_path = $1 AND from_path = $2`,
		oldTo, newTo); err != nil {
		return 0, err
	}
	tag, err := tx.Exec(ctx, `UPDATE redirects SET to_path = $2 WHERE status_code = 301 AND to_path = $1`,
		oldTo, newTo)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (r *PGPosts) LiveSlugs(ctx context.Context, now time.Time) ([]domain.PostRef, error) {
	rows, err := r.db.Query(ctx, `SELECT p.id, p.slug, p.legacy_slugs FROM posts p WHERE `+publishedWhere+`
		ORDER BY p.slug`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanPostRef)
}

func (r *PGPosts) LinkSuggestions(ctx context.Context, excludeID, query string, limit int, now time.Time) ([]domain.LinkSuggestion, error) {
	kw := ""
	if q := strings.TrimSpace(query); q != "" {
		kw = likePattern(q)
	}
	rows, err := r.db.Query(ctx, `
		SELECT id, title, slug FROM (
			SELECT p.id, p.title, p.slug, p.published_at,
			       (SELECT count(*) FROM post_categories a JOIN post_categories b ON b.category_id = a.category_id
			         WHERE a.post_id = p.id AND b.post_id::text = $2) AS shared,
			       ($3 <> '' AND (p.title ILIKE $3 OR p.excerpt ILIKE $3)) AS kw
			  FROM posts p
			 WHERE `+publishedWhere+` AND p.id::text <> $2) s
		 WHERE shared > 0 OR kw
		 ORDER BY shared DESC, kw DESC, published_at DESC, id
		 LIMIT $4`, now, excludeID, kw, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.LinkSuggestion, error) {
		var s domain.LinkSuggestion
		err := row.Scan(&s.ID, &s.Title, &s.Slug)
		return s, err
	})
}

// ---- redirects ----

type PGRedirects struct{ db DB }

const redirectCols = `r.id, r.from_path, r.to_path, r.status_code, r.kind, r.note, r.created_by,
	(SELECT u.name FROM admin_users u WHERE u.id = r.created_by),
	(SELECT u.email FROM admin_users u WHERE u.id = r.created_by), r.created_at, r.updated_at`

func scanRedirect(row pgx.Row) (domain.Redirect, error) {
	var (
		d                     domain.Redirect
		byID, byName, byEmail *string
	)
	err := row.Scan(&d.ID, &d.From, &d.To, &d.Status, &d.Kind, &d.Note, &byID, &byName, &byEmail,
		&d.CreatedAt, &d.UpdatedAt)
	d.CreatedBy = userRef(byID, byName, byEmail)
	return d, err
}

func collectRedirects(rows pgx.Rows) ([]domain.Redirect, error) {
	defer rows.Close()
	var out []domain.Redirect
	for rows.Next() {
		d, err := scanRedirect(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *PGRedirects) List(ctx context.Context, f RedirectFilter) ([]domain.Redirect, int, error) {
	conds := []string{"true"}
	var args []any
	if q := strings.TrimSpace(f.Query); q != "" {
		args = append(args, likePattern(q))
		conds = append(conds, fmt.Sprintf("(r.from_path ILIKE $%[1]d OR r.to_path ILIKE $%[1]d OR r.note ILIKE $%[1]d)",
			len(args)))
	}
	if f.Kind != "" {
		args = append(args, f.Kind)
		conds = append(conds, fmt.Sprintf("r.kind = $%d", len(args)))
	}
	if f.Status != 0 {
		args = append(args, f.Status)
		conds = append(conds, fmt.Sprintf("r.status_code = $%d", len(args)))
	}
	where := strings.Join(conds, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM redirects r WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	n := len(args)
	args = append(args, f.PerPage, f.Offset())
	rows, err := r.db.Query(ctx, fmt.Sprintf(`SELECT %s FROM redirects r WHERE %s
		ORDER BY r.from_path, r.id LIMIT $%d OFFSET $%d`, redirectCols, where, n+1, n+2), args...)
	if err != nil {
		return nil, 0, err
	}
	out, err := collectRedirects(rows)
	return out, total, err
}

func (r *PGRedirects) All(ctx context.Context) ([]domain.Redirect, error) {
	rows, err := r.db.Query(ctx, `SELECT `+redirectCols+` FROM redirects r ORDER BY r.from_path`)
	if err != nil {
		return nil, err
	}
	return collectRedirects(rows)
}

func (r *PGRedirects) Get(ctx context.Context, id string) (domain.Redirect, error) {
	d, err := scanRedirect(r.db.QueryRow(ctx, `SELECT `+redirectCols+` FROM redirects r WHERE r.id = $1`, id))
	return d, mapErr(err)
}

func (r *PGRedirects) GetByFrom(ctx context.Context, from string) (domain.Redirect, error) {
	d, err := scanRedirect(r.db.QueryRow(ctx, `SELECT `+redirectCols+` FROM redirects r WHERE r.from_path = $1`, from))
	return d, mapErr(err)
}

func (r *PGRedirects) Create(ctx context.Context, d *domain.Redirect, createdBy *string) (int, error) {
	n := 0
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO redirects (from_path, to_path, status_code, kind, note, created_by)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			d.From, d.To, d.Status, d.Kind, d.Note, createdBy).Scan(&d.ID); err != nil {
			return err
		}
		var err error
		n, err = flattenTo(ctx, tx, d)
		return err
	})
	if err != nil {
		return 0, mapErr(err)
	}
	fresh, err := r.Get(ctx, d.ID)
	*d = fresh
	return n, err
}

func (r *PGRedirects) Update(ctx context.Context, d *domain.Redirect) (int, error) {
	n := 0
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE redirects SET from_path = $2, to_path = $3, status_code = $4, kind = $5,
			note = $6 WHERE id = $1`, d.ID, d.From, d.To, d.Status, d.Kind, d.Note)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		n, err = flattenTo(ctx, tx, d)
		return err
	})
	if err != nil {
		return 0, mapErr(err)
	}
	fresh, err := r.Get(ctx, d.ID)
	*d = fresh
	return n, err
}

func flattenTo(ctx context.Context, tx pgx.Tx, d *domain.Redirect) (int, error) {
	if d.Status != 301 || d.To == nil {
		return 0, nil
	}
	return repoint(ctx, tx, d.From, *d.To)
}

func (r *PGRedirects) Delete(ctx context.Context, id string) (domain.Redirect, error) {
	d, err := r.Get(ctx, id)
	if err != nil {
		return d, err
	}
	tag, err := r.db.Exec(ctx, `DELETE FROM redirects WHERE id = $1`, id)
	if err != nil {
		return d, mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return d, domain.ErrNotFound
	}
	return d, nil
}
