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

type PGCategories struct{ db DB }

func (r *PGCategories) List(ctx context.Context) ([]domain.Category, error) {
	rows, err := r.db.Query(ctx, `
		SELECT c.id, c.slug, c.name, c.name_th, c.description, c.sort_order,
		       (SELECT count(*) FROM post_categories pc
		          JOIN posts p ON p.id = pc.post_id
		         WHERE pc.category_id = c.id AND p.deleted_at IS NULL
		           AND p.status = 'published' AND p.published_at <= now())::int
		  FROM categories c
		 ORDER BY c.sort_order, c.slug`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Category, error) {
		var c domain.Category
		err := row.Scan(&c.ID, &c.Slug, &c.Name, &c.NameTH, &c.Description, &c.SortOrder, &c.PostCount)
		return c, err
	})
	return out, err
}

func (r *PGCategories) ExistingSlugs(ctx context.Context, slugs []string) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT slug FROM categories WHERE slug = ANY($1)`, slugs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (r *PGCategories) Upsert(ctx context.Context, c domain.Category) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO categories (slug, name, name_th, description, sort_order)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (slug) DO UPDATE
		   SET name = EXCLUDED.name, name_th = EXCLUDED.name_th,
		       description = EXCLUDED.description, sort_order = EXCLUDED.sort_order
		 WHERE (categories.name, categories.name_th, categories.description, categories.sort_order)
		       IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.name_th, EXCLUDED.description, EXCLUDED.sort_order)`,
		c.Slug, c.Name, c.NameTH, c.Description, c.SortOrder)
	return mapErr(err)
}

type PGPosts struct{ db DB }

const postColsTmpl = `p.id, p.slug, p.legacy_slugs, p.title, p.excerpt, %s, p.cover_media_id,
	p.cover_url, p.cover_alt, p.cover_width, p.cover_height, p.author, p.status, p.published_at,
	p.featured, p.reading_minutes, p.seo_title, p.seo_description, p.created_at, p.updated_at,
	p.created_by, (SELECT u.name FROM admin_users u WHERE u.id = p.created_by),
	(SELECT u.email FROM admin_users u WHERE u.id = p.created_by),
	p.focus_keyword, p.canonical_url, p.noindex, p.og_media_id, p.og_image_url, p.og_image_alt,
	p.og_image_width, p.og_image_height`

var (
	postSummaryCols = fmt.Sprintf(postColsTmpl, `'' AS body_markdown`)
	postDetailCols  = fmt.Sprintf(postColsTmpl, `p.body_markdown`)
)

func scanPost(row pgx.Row) (domain.Post, error) {
	var (
		p                       domain.Post
		coverURL                *string
		coverAlt                string
		coverWidth, coverHeight *int32
		status                  string
		legacy                  []string
		byID, byName, byEmail   *string
		ogURL                   *string
		ogAlt                   string
		ogWidth, ogHeight       *int32
	)
	err := row.Scan(&p.ID, &p.Slug, &legacy, &p.Title, &p.Excerpt, &p.BodyMarkdown, &p.CoverMediaID,
		&coverURL, &coverAlt, &coverWidth, &coverHeight, &p.Author, &status, &p.PublishedAt,
		&p.Featured, &p.ReadingMinutes, &p.SEOTitle, &p.SEODescription, &p.CreatedAt, &p.UpdatedAt,
		&byID, &byName, &byEmail,
		&p.FocusKeyword, &p.CanonicalURL, &p.NoIndex, &p.OGMediaID, &ogURL, &ogAlt, &ogWidth, &ogHeight)
	if err != nil {
		return p, err
	}
	p.CreatedBy = userRef(byID, byName, byEmail)
	p.Status = domain.PostStatus(status)
	if legacy == nil {
		legacy = []string{}
	}
	p.LegacySlugs = legacy
	if coverURL != nil && *coverURL != "" {
		c := &domain.Cover{URL: *coverURL, Alt: coverAlt}
		if coverWidth != nil {
			c.Width = int(*coverWidth)
		}
		if coverHeight != nil {
			c.Height = int(*coverHeight)
		}
		p.Cover = c
	}
	p.OGImage = imageFrom(ogURL, ogAlt, ogWidth, ogHeight)
	p.Categories = []domain.CategoryRef{}
	return p, nil
}

func collectPosts(rows pgx.Rows) ([]domain.Post, error) {
	defer rows.Close()
	var out []domain.Post
	for rows.Next() {
		p, err := scanPost(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *PGPosts) attachCategories(ctx context.Context, q DB, posts []domain.Post) error {
	if len(posts) == 0 {
		return nil
	}
	ids := make([]string, len(posts))
	idx := make(map[string]int, len(posts))
	for i, p := range posts {
		ids[i] = p.ID
		idx[p.ID] = i
	}
	rows, err := q.Query(ctx, `
		SELECT pc.post_id::text, c.slug, c.name, c.name_th
		  FROM post_categories pc JOIN categories c ON c.id = pc.category_id
		 WHERE pc.post_id = ANY($1::uuid[])
		 ORDER BY c.sort_order, c.slug`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var postID string
		var c domain.CategoryRef
		if err := rows.Scan(&postID, &c.Slug, &c.Name, &c.NameTH); err != nil {
			return err
		}
		i := idx[postID]
		posts[i].Categories = append(posts[i].Categories, c)
	}
	return rows.Err()
}

const publishedWhere = `p.deleted_at IS NULL AND p.status = 'published' AND p.published_at <= $1`

func (r *PGPosts) ListPublished(ctx context.Context, f PostFilter, now time.Time) ([]domain.Post, int, error) {
	where := publishedWhere
	args := []any{now}
	if f.CategorySlug != "" {
		args = append(args, f.CategorySlug)
		where += ` AND EXISTS (SELECT 1 FROM post_categories pc JOIN categories c ON c.id = pc.category_id
		                        WHERE pc.post_id = p.id AND c.slug = $2)`
	}
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM posts p WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	n := len(args)
	args = append(args, f.PerPage, f.Offset())
	rows, err := r.db.Query(ctx, fmt.Sprintf(`SELECT %s FROM posts p WHERE %s
		ORDER BY p.published_at DESC, p.id DESC LIMIT $%d OFFSET $%d`, postSummaryCols, where, n+1, n+2), args...)
	if err != nil {
		return nil, 0, err
	}
	posts, err := collectPosts(rows)
	if err != nil {
		return nil, 0, err
	}
	return posts, total, r.attachCategories(ctx, r.db, posts)
}

func (r *PGPosts) GetPublishedBySlug(ctx context.Context, slug string, now time.Time) (domain.Post, error) {
	row := r.db.QueryRow(ctx, `SELECT `+postDetailCols+` FROM posts p
		WHERE `+publishedWhere+` AND (p.slug = $2 OR p.legacy_slugs @> ARRAY[$2]::text[])
		ORDER BY (p.slug = $2) DESC, p.published_at DESC LIMIT 1`, now, slug)
	return r.one(ctx, row)
}

func (r *PGPosts) one(ctx context.Context, row pgx.Row) (domain.Post, error) {
	p, err := scanPost(row)
	if err != nil {
		return p, mapErr(err)
	}
	posts := []domain.Post{p}
	if err := r.attachCategories(ctx, r.db, posts); err != nil {
		return p, err
	}
	return posts[0], nil
}

func (r *PGPosts) AdminList(ctx context.Context, f AdminPostFilter) ([]domain.Post, int, error) {
	conds := []string{"p.deleted_at IS NULL"}
	var args []any
	if domain.PostStatus(f.Status).Valid() {
		args = append(args, f.Status)
		conds = append(conds, fmt.Sprintf("p.status = $%d", len(args)))
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		args = append(args, likePattern(q))
		conds = append(conds, fmt.Sprintf("(p.title ILIKE $%[1]d OR p.slug ILIKE $%[1]d)", len(args)))
	}
	if f.CategorySlug != "" {
		args = append(args, f.CategorySlug)
		conds = append(conds, fmt.Sprintf(`EXISTS (SELECT 1 FROM post_categories pc JOIN categories c
			ON c.id = pc.category_id WHERE pc.post_id = p.id AND c.slug = $%d)`, len(args)))
	}
	where := strings.Join(conds, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM posts p WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	n := len(args)
	args = append(args, f.PerPage, f.Offset())
	rows, err := r.db.Query(ctx, fmt.Sprintf(`SELECT %s FROM posts p WHERE %s
		ORDER BY %s LIMIT $%d OFFSET $%d`, postSummaryCols, where, adminPostOrder(f.Sort), n+1, n+2), args...)
	if err != nil {
		return nil, 0, err
	}
	posts, err := collectPosts(rows)
	if err != nil {
		return nil, 0, err
	}
	return posts, total, r.attachCategories(ctx, r.db, posts)
}

func (r *PGPosts) GetByID(ctx context.Context, id string) (domain.Post, error) {
	row := r.db.QueryRow(ctx, `SELECT `+postDetailCols+` FROM posts p WHERE p.id = $1 AND p.deleted_at IS NULL`, id)
	return r.one(ctx, row)
}

func coverArgs(p *domain.Post) (url *string, alt string, w, h *int) {
	if p.Cover == nil {
		return nil, "", nil, nil
	}
	u := p.Cover.URL
	url = &u
	alt = p.Cover.Alt
	if p.Cover.Width > 0 {
		v := p.Cover.Width
		w = &v
	}
	if p.Cover.Height > 0 {
		v := p.Cover.Height
		h = &v
	}
	return
}

func replaceCategories(ctx context.Context, tx pgx.Tx, postID string, slugs []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM post_categories WHERE post_id = $1`, postID); err != nil {
		return err
	}
	if len(slugs) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO post_categories (post_id, category_id)
		SELECT $1, id FROM categories WHERE slug = ANY($2) ON CONFLICT DO NOTHING`, postID, slugs)
	return err
}

func (r *PGPosts) reload(ctx context.Context, p *domain.Post) error {
	fresh, err := r.GetByID(ctx, p.ID)
	if err != nil {
		return err
	}
	*p = fresh
	return nil
}

func (r *PGPosts) Create(ctx context.Context, p *domain.Post, createdBy *string, plan *RedirectPlan) error {
	cu, ca, cw, ch := coverArgs(p)
	ou, oa, ow, oh := imageArgs(p.OGImage)
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO posts (slug, legacy_slugs, title, excerpt, body_markdown, cover_media_id, cover_url,
			                   cover_alt, cover_width, cover_height, author, status, published_at, featured,
			                   reading_minutes, seo_title, seo_description, created_by, focus_keyword, canonical_url,
			                   noindex, og_media_id, og_image_url, og_image_alt, og_image_width, og_image_height)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
			RETURNING id`,
			p.Slug, nonNil(p.LegacySlugs), p.Title, p.Excerpt, p.BodyMarkdown, p.CoverMediaID, cu, ca, cw, ch,
			p.Author, string(p.Status), p.PublishedAt, p.Featured, p.ReadingMinutes, p.SEOTitle,
			p.SEODescription, createdBy, p.FocusKeyword, p.CanonicalURL, p.NoIndex, p.OGMediaID, ou, oa, ow, oh).Scan(&p.ID)
		if err != nil {
			return err
		}
		if err := replaceCategories(ctx, tx, p.ID, p.CategorySlugs()); err != nil {
			return err
		}
		return applyRedirectPlan(ctx, tx, plan)
	})
	if err != nil {
		return mapErr(err)
	}
	return r.reload(ctx, p)
}

func (r *PGPosts) Update(ctx context.Context, p *domain.Post, plan *RedirectPlan) error {
	cu, ca, cw, ch := coverArgs(p)
	ou, oa, ow, oh := imageArgs(p.OGImage)
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE posts SET slug=$2, legacy_slugs=$3, title=$4, excerpt=$5, body_markdown=$6, cover_media_id=$7,
			       cover_url=$8, cover_alt=$9, cover_width=$10, cover_height=$11, author=$12, status=$13,
			       published_at=$14, featured=$15, reading_minutes=$16, seo_title=$17, seo_description=$18,
			       focus_keyword=$19, canonical_url=$20, noindex=$21, og_media_id=$22, og_image_url=$23,
			       og_image_alt=$24, og_image_width=$25, og_image_height=$26
			 WHERE id = $1 AND deleted_at IS NULL`,
			p.ID, p.Slug, nonNil(p.LegacySlugs), p.Title, p.Excerpt, p.BodyMarkdown, p.CoverMediaID, cu, ca, cw, ch,
			p.Author, string(p.Status), p.PublishedAt, p.Featured, p.ReadingMinutes, p.SEOTitle, p.SEODescription,
			p.FocusKeyword, p.CanonicalURL, p.NoIndex, p.OGMediaID, ou, oa, ow, oh)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		if err := replaceCategories(ctx, tx, p.ID, p.CategorySlugs()); err != nil {
			return err
		}
		return applyRedirectPlan(ctx, tx, plan)
	})
	if err != nil {
		return mapErr(err)
	}
	return r.reload(ctx, p)
}

func (r *PGPosts) SoftDelete(ctx context.Context, id string, plan *RedirectPlan) (domain.Post, error) {
	p, err := r.GetByID(ctx, id)
	if err != nil {
		return p, err
	}
	err = withTx(ctx, r.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE posts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return applyRedirectPlan(ctx, tx, plan)
	})
	return p, mapErr(err)
}

func (r *PGPosts) UpsertBySlug(ctx context.Context, p *domain.Post) (bool, error) {
	cu, ca, cw, ch := coverArgs(p)
	var updatedAt *time.Time
	if !p.UpdatedAt.IsZero() {
		t := p.UpdatedAt
		updatedAt = &t
	}
	changed := false
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO posts (slug, legacy_slugs, title, excerpt, body_markdown, cover_url, cover_alt, cover_width,
			                   cover_height, author, status, published_at, featured, reading_minutes, seo_title,
			                   seo_description, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, COALESCE($17, now()))
			ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE SET
			       legacy_slugs = EXCLUDED.legacy_slugs, title = EXCLUDED.title, excerpt = EXCLUDED.excerpt,
			       body_markdown = EXCLUDED.body_markdown, cover_url = EXCLUDED.cover_url,
			       cover_alt = EXCLUDED.cover_alt, cover_width = EXCLUDED.cover_width,
			       cover_height = EXCLUDED.cover_height, author = EXCLUDED.author, status = EXCLUDED.status,
			       published_at = EXCLUDED.published_at, featured = EXCLUDED.featured,
			       reading_minutes = EXCLUDED.reading_minutes, seo_title = EXCLUDED.seo_title,
			       seo_description = EXCLUDED.seo_description, updated_at = EXCLUDED.updated_at
			 WHERE (posts.legacy_slugs, posts.title, posts.excerpt, posts.body_markdown, posts.cover_url,
			        posts.cover_alt, posts.cover_width, posts.cover_height, posts.author, posts.status,
			        posts.published_at, posts.featured, posts.reading_minutes, posts.seo_title,
			        posts.seo_description, posts.updated_at)
			       IS DISTINCT FROM
			       (EXCLUDED.legacy_slugs, EXCLUDED.title, EXCLUDED.excerpt, EXCLUDED.body_markdown,
			        EXCLUDED.cover_url, EXCLUDED.cover_alt, EXCLUDED.cover_width, EXCLUDED.cover_height,
			        EXCLUDED.author, EXCLUDED.status, EXCLUDED.published_at, EXCLUDED.featured,
			        EXCLUDED.reading_minutes, EXCLUDED.seo_title, EXCLUDED.seo_description, EXCLUDED.updated_at)
			RETURNING id`,
			p.Slug, nonNil(p.LegacySlugs), p.Title, p.Excerpt, p.BodyMarkdown, cu, ca, cw, ch, p.Author,
			string(p.Status), p.PublishedAt, p.Featured, p.ReadingMinutes, p.SEOTitle, p.SEODescription,
			updatedAt).Scan(&p.ID)
		switch {
		case err == nil:
			changed = true
		case errors.Is(err, pgx.ErrNoRows):
			if err := tx.QueryRow(ctx, `SELECT id FROM posts WHERE slug = $1 AND deleted_at IS NULL`,
				p.Slug).Scan(&p.ID); err != nil {
				return err
			}
		default:
			return err
		}
		var before []string
		rows, err := tx.Query(ctx, `SELECT c.slug FROM post_categories pc JOIN categories c ON c.id = pc.category_id
			WHERE pc.post_id = $1 ORDER BY c.slug`, p.ID)
		if err != nil {
			return err
		}
		if before, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		if !sameSet(before, p.CategorySlugs()) {
			changed = true
			return replaceCategories(ctx, tx, p.ID, p.CategorySlugs())
		}
		return nil
	})
	return changed, mapErr(err)
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := make(map[string]int, len(a))
	for _, s := range a {
		m[s]++
	}
	for _, s := range b {
		if m[s] == 0 {
			return false
		}
		m[s]--
	}
	return true
}
