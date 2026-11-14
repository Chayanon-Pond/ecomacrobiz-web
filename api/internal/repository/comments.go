package repository

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type PGComments struct{ db DB }

// Every viewer-aware query binds $1 = viewer member id (NULL = anonymous)
// and $2 = viewer is a moderator.
const viewerArgs = 2

// visible is the per-viewer visibility predicate for comment alias a.
func visible(a string) string {
	return fmt.Sprintf(`(%[1]s.status = 'published' OR (%[1]s.status = 'pending' AND %[1]s.member_id = $1::uuid)
		OR ($2::boolean AND %[1]s.status IN ('pending', 'hidden')))`, a)
}

func commentCols() string {
	return `c.id, c.post_id, p.slug, p.title, c.parent_id, c.reply_to_id,
	c.member_id, COALESCE(m.display_name, ''), COALESCE(m.avatar_key, ''), COALESCE(m.role, ''),
	rt.id IS NOT NULL, rt.member_id, COALESCE(rtm.display_name, ''), COALESCE(rtm.avatar_key, ''), COALESCE(rtm.role, ''),
	c.body, c.status, c.content_hash, c.like_count, c.report_count,
	c.created_at, c.updated_at, c.edited_at, c.deleted_at, c.moderated_at,
	c.moderated_by_admin IS NOT NULL, COALESCE(au.name, au.email, ''), c.moderated_by_member IS NOT NULL, COALESCE(mm.display_name, ''),
	ci.id, COALESCE(ci.storage_key, ''), COALESCE(ci.width, 0), COALESCE(ci.height, 0), COALESCE(ci.size_bytes, 0),
	(SELECT count(*) FROM comments r WHERE r.parent_id = c.id AND ` + visible("r") + `),
	EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.member_id = $1::uuid)`
}

const commentJoins = `
	JOIN posts p ON p.id = c.post_id
	LEFT JOIN members m ON m.id = c.member_id
	LEFT JOIN comments rt ON rt.id = c.reply_to_id
	LEFT JOIN members rtm ON rtm.id = rt.member_id
	LEFT JOIN admin_users au ON au.id = c.moderated_by_admin
	LEFT JOIN members mm ON mm.id = c.moderated_by_member
	LEFT JOIN comment_images ci ON ci.comment_id = c.id`

func scanComment(row pgx.Row) (domain.Comment, error) {
	var (
		c                                  domain.Comment
		authorName, authorAvatar, authorRl string
		hasRT                              bool
		rtMember                           *string
		rtName, rtAvatar, rtRole           string
		status                             string
		byAdmin, byMember                  bool
		adminName, memberName              string
		imgID                              *string
		img                                domain.CommentImage
	)
	err := row.Scan(&c.ID, &c.PostID, &c.PostSlug, &c.PostTitle, &c.ParentID, &c.ReplyToID,
		&c.MemberID, &authorName, &authorAvatar, &authorRl,
		&hasRT, &rtMember, &rtName, &rtAvatar, &rtRole,
		&c.Body, &status, &c.ContentHash, &c.LikeCount, &c.ReportCount,
		&c.CreatedAt, &c.UpdatedAt, &c.EditedAt, &c.DeletedAt, &c.ModeratedAt,
		&byAdmin, &adminName, &byMember, &memberName,
		&imgID, &img.StorageKey, &img.Width, &img.Height, &img.SizeBytes,
		&c.ReplyCount, &c.LikedByMe)
	if err != nil {
		return c, mapErr(err)
	}
	c.Status = domain.CommentStatus(status)
	if c.MemberID != nil {
		c.Author = &domain.MemberRef{ID: *c.MemberID, DisplayName: authorName, AvatarKey: authorAvatar,
			Role: domain.MemberRole(authorRl)}
	}
	if hasRT {
		c.ReplyTo = &domain.MemberRef{}
		if rtMember != nil {
			c.ReplyTo = &domain.MemberRef{ID: *rtMember, DisplayName: rtName, AvatarKey: rtAvatar,
				Role: domain.MemberRole(rtRole)}
		}
	}
	switch {
	case byAdmin:
		c.ModeratedByKind, c.ModeratedByName = "admin", adminName
	case byMember:
		c.ModeratedByKind, c.ModeratedByName = "member", memberName
	}
	if imgID != nil {
		img.ID = *imgID
		img.CommentID = &c.ID
		if c.MemberID != nil {
			img.MemberID = *c.MemberID
		}
		c.Image = &img
	}
	return c, nil
}

func collectComments(rows pgx.Rows, err error) ([]domain.Comment, error) {
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Comment, error) { return scanComment(row) })
}

func viewerParams(v CommentViewer) []any {
	var id *string
	if v.MemberID != "" {
		id = &v.MemberID
	}
	return []any{id, v.Moderator}
}

func (r *PGComments) ListTop(ctx context.Context, f CommentListFilter) ([]domain.Comment, int, error) {
	where := ` WHERE c.post_id = $3 AND c.parent_id IS NULL AND (` + visible("c") + ` OR (c.status = 'deleted'
		AND EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id AND ` + visible("r") + `)))`
	args := append(viewerParams(f.Viewer), f.PostID)
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM comments c`+where, args...).Scan(&total); err != nil {
		return nil, 0, mapErr(err)
	}
	order := "c.created_at DESC, c.id DESC"
	if f.Sort == "top" {
		order = "c.like_count DESC, c.created_at DESC, c.id DESC"
	}
	list, err := collectComments(r.db.Query(ctx, `SELECT `+commentCols()+` FROM comments c`+commentJoins+where+
		` ORDER BY `+order+` LIMIT $4 OFFSET $5`, append(args, f.PerPage, f.Offset())...))
	if err != nil || len(list) == 0 || f.RepliesPreview <= 0 {
		return list, total, err
	}
	ids := make([]string, len(list))
	idx := map[string]int{}
	for i, c := range list {
		ids[i] = c.ID
		idx[c.ID] = i
	}
	replies, err := collectComments(r.db.Query(ctx, `SELECT `+commentCols()+` FROM (
			SELECT c2.*, row_number() OVER (PARTITION BY c2.parent_id ORDER BY c2.created_at, c2.id) AS rn
			FROM comments c2 WHERE c2.parent_id = ANY($3::uuid[]) AND `+visible("c2")+`) c`+commentJoins+`
		WHERE c.rn <= $4 ORDER BY c.parent_id, c.created_at, c.id`, append(viewerParams(f.Viewer), ids, f.RepliesPreview)...))
	if err != nil {
		return nil, 0, err
	}
	for _, rp := range replies {
		i := idx[*rp.ParentID]
		list[i].Replies = append(list[i].Replies, rp)
	}
	return list, total, nil
}

func (r *PGComments) ListReplies(ctx context.Context, parentID string, v CommentViewer, p domain.Page) ([]domain.Comment, int, error) {
	where := ` WHERE c.parent_id = $3 AND ` + visible("c")
	args := append(viewerParams(v), parentID)
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM comments c`+where, args...).Scan(&total); err != nil {
		return nil, 0, mapErr(err)
	}
	list, err := collectComments(r.db.Query(ctx, `SELECT `+commentCols()+` FROM comments c`+commentJoins+where+
		` ORDER BY c.created_at, c.id LIMIT $4 OFFSET $5`, append(args, p.PerPage, p.Offset())...))
	return list, total, err
}

func (r *PGComments) Get(ctx context.Context, id string, v CommentViewer) (domain.Comment, error) {
	return scanComment(r.db.QueryRow(ctx, `SELECT `+commentCols()+` FROM comments c`+commentJoins+` WHERE c.id = $3`,
		append(viewerParams(v), id)...))
}

// bumpComments adjusts post_stats.comment_count by delta (upserting the row).
func bumpComments(ctx context.Context, tx pgx.Tx, postID string, delta int) error {
	if delta == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO post_stats (post_id, comment_count) VALUES ($1, GREATEST($2::int, 0))
		ON CONFLICT (post_id) DO UPDATE SET comment_count = GREATEST(post_stats.comment_count + $2::int, 0)`, postID, delta)
	return err
}

func statusDelta(from, to domain.CommentStatus) int {
	d := 0
	if from == domain.CommentPublished {
		d--
	}
	if to == domain.CommentPublished {
		d++
	}
	return d
}

func (r *PGComments) Create(ctx context.Context, c *domain.Comment, imageID string) error {
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO comments (post_id, parent_id, reply_to_id, member_id, body, status,
			content_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id, created_at, updated_at`,
			c.PostID, c.ParentID, c.ReplyToID, c.MemberID, c.Body, string(c.Status), c.ContentHash, c.CreatedAt).
			Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return err
		}
		if imageID != "" {
			tag, err := tx.Exec(ctx, `UPDATE comment_images SET comment_id = $1
				WHERE id::text = $2 AND member_id = $3 AND comment_id IS NULL`, c.ID, imageID, c.MemberID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return ErrImageUnavailable
			}
		}
		return bumpComments(ctx, tx, c.PostID, statusDelta("", c.Status))
	})
	if err == ErrImageUnavailable {
		return err
	}
	return mapErr(err)
}

func (r *PGComments) Edit(ctx context.Context, id, body string, hash []byte, now time.Time) error {
	return mapErr(withTx(ctx, r.db, func(tx pgx.Tx) error {
		var prev string
		if err := tx.QueryRow(ctx, `SELECT body FROM comments WHERE id = $1 FOR UPDATE`, id).Scan(&prev); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO comment_edits (comment_id, body, edited_at) VALUES ($1, $2, $3)`,
			id, prev, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE comments SET body = $2, content_hash = $3, edited_at = $4 WHERE id = $1`,
			id, body, hash, now)
		return err
	}))
}

func (r *PGComments) SetStatus(ctx context.Context, id string, to domain.CommentStatus, by CommentModerator, now time.Time) (StatusChange, error) {
	var out StatusChange
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		var from, postID string
		if err := tx.QueryRow(ctx, `SELECT c.status, c.post_id, p.slug FROM comments c JOIN posts p ON p.id = c.post_id
			WHERE c.id = $1 FOR UPDATE OF c`, id).Scan(&from, &postID, &out.PostSlug); err != nil {
			return err
		}
		out.From, out.To = domain.CommentStatus(from), to
		if out.From == to {
			return nil
		}
		var admin, member *string
		if by.AdminID != "" {
			admin = &by.AdminID
		}
		if by.MemberID != "" {
			member = &by.MemberID
		}
		moderated := admin != nil || member != nil
		if to == domain.CommentDeleted {
			if _, err := tx.Exec(ctx, `UPDATE comments SET status = 'deleted', body = '', deleted_at = $2,
				moderated_at = CASE WHEN $5 THEN $2 ELSE moderated_at END,
				moderated_by_admin = CASE WHEN $5 THEN $3::uuid ELSE moderated_by_admin END,
				moderated_by_member = CASE WHEN $5 THEN $4::uuid ELSE moderated_by_member END
				WHERE id = $1`, id, now, admin, member, moderated); err != nil {
				return err
			}
			// Earlier versions of a deleted comment must not outlive it.
			if _, err := tx.Exec(ctx, `DELETE FROM comment_edits WHERE comment_id = $1`, id); err != nil {
				return err
			}
			err := tx.QueryRow(ctx, `DELETE FROM comment_images WHERE comment_id = $1 RETURNING storage_key`, id).
				Scan(&out.ImageKey)
			if err != nil && err != pgx.ErrNoRows {
				return err
			}
		} else if _, err := tx.Exec(ctx, `UPDATE comments SET status = $2, moderated_at = $3,
			moderated_by_admin = $4, moderated_by_member = $5 WHERE id = $1`, id, string(to), now, admin, member); err != nil {
			return err
		}
		return bumpComments(ctx, tx, postID, statusDelta(out.From, to))
	})
	return out, mapErr(err)
}

func (r *PGComments) Like(ctx context.Context, commentID, memberID string, like bool, now time.Time) (bool, int, error) {
	var count int
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		var status string
		// No row lock here: the counter update below takes the row lock
		// (taking FOR SHARE first would deadlock concurrent togglers on the
		// share -> exclusive upgrade).
		if err := tx.QueryRow(ctx, `SELECT status FROM comments WHERE id = $1`, commentID).Scan(&status); err != nil {
			return err
		}
		if status != string(domain.CommentPublished) {
			return domain.ErrNotFound
		}
		var q string
		if like {
			q = `INSERT INTO comment_likes (comment_id, member_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`
		} else {
			q = `DELETE FROM comment_likes WHERE comment_id = $1 AND member_id = $2 AND $3::timestamptz IS NOT NULL`
		}
		tag, err := tx.Exec(ctx, q, commentID, memberID, now)
		if err != nil {
			return err
		}
		delta := 0
		if tag.RowsAffected() == 1 {
			delta = 1
			if !like {
				delta = -1
			}
		}
		return tx.QueryRow(ctx, `UPDATE comments SET like_count = GREATEST(like_count + $2::int, 0)
			WHERE id = $1 RETURNING like_count`, commentID, delta).Scan(&count)
	})
	return like, count, mapErr(err)
}

func (r *PGComments) Report(ctx context.Context, rep domain.CommentReport, threshold int) (bool, string, error) {
	held := false
	slug := ""
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		var status, postID string
		var authorRole *string
		if err := tx.QueryRow(ctx, `SELECT c.status, c.post_id, p.slug, m.role FROM comments c
			JOIN posts p ON p.id = c.post_id LEFT JOIN members m ON m.id = c.member_id
			WHERE c.id = $1 FOR UPDATE OF c`, rep.CommentID).Scan(&status, &postID, &slug, &authorRole); err != nil {
			return err
		}
		if status != string(domain.CommentPublished) {
			return domain.ErrNotFound
		}
		var inserted bool
		if err := tx.QueryRow(ctx, `INSERT INTO comment_reports (comment_id, member_id, reason, note, created_at)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (comment_id, member_id) DO UPDATE SET reason = EXCLUDED.reason, note = EXCLUDED.note
			RETURNING (xmax = 0)`, rep.CommentID, rep.MemberID, rep.Reason, rep.Note, rep.CreatedAt).Scan(&inserted); err != nil {
			return err
		}
		if !inserted {
			return nil
		}
		var count int
		if err := tx.QueryRow(ctx, `UPDATE comments SET report_count = report_count + 1
			WHERE id = $1 RETURNING report_count`, rep.CommentID).Scan(&count); err != nil {
			return err
		}
		trusted := authorRole != nil && domain.MemberRole(*authorRole).PublishesDirectly()
		if count >= threshold && !trusted {
			if _, err := tx.Exec(ctx, `UPDATE comments SET status = 'pending' WHERE id = $1`, rep.CommentID); err != nil {
				return err
			}
			held = true
			return bumpComments(ctx, tx, postID, -1)
		}
		return nil
	})
	return held, slug, mapErr(err)
}

func (r *PGComments) HasRecentDuplicate(ctx context.Context, memberID string, hash []byte, since time.Time, excludeID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM comments WHERE member_id = $1 AND content_hash = $2
		AND created_at >= $3 AND status <> 'deleted' AND ($4 = '' OR id::text <> $4))`, memberID, hash, since, excludeID).Scan(&ok)
	return ok, mapErr(err)
}

func (r *PGComments) History(ctx context.Context, id string) ([]domain.CommentEdit, error) {
	rows, err := r.db.Query(ctx, `SELECT body, edited_at FROM comment_edits WHERE comment_id = $1
		ORDER BY edited_at DESC, id DESC`, id)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.CommentEdit, error) {
		var e domain.CommentEdit
		err := row.Scan(&e.Body, &e.EditedAt)
		return e, err
	})
}

func (r *PGComments) AdminList(ctx context.Context, f AdminCommentFilter) ([]domain.Comment, int, AdminCommentCounts, error) {
	var counts AdminCommentCounts
	if err := r.db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status = 'pending'),
		count(*) FILTER (WHERE report_count > 0 AND status IN ('published', 'pending')) FROM comments`).
		Scan(&counts.Pending, &counts.Reported); err != nil {
		return nil, 0, counts, mapErr(err)
	}
	// Filter placeholders are written as "$?" and numbered per query: the
	// count query has no viewer parameters, the list query starts after them.
	var conds []string
	var condArgs []any
	add := func(cond string, v any) {
		conds = append(conds, cond)
		condArgs = append(condArgs, v)
	}
	switch f.Status {
	case "", "all":
	case "reported":
		conds = append(conds, "c.report_count > 0 AND c.status IN ('published', 'pending')")
	default:
		add("c.status = $?", f.Status)
	}
	if f.Query != "" {
		add(`c.body ILIKE $? ESCAPE '\'`, likePattern(f.Query))
	}
	if f.PostSlug != "" {
		add("p.slug = $?", f.PostSlug)
	}
	if f.MemberID != "" {
		add("c.member_id::text = $?", f.MemberID)
	}
	where := func(first int) string {
		if len(conds) == 0 {
			return ""
		}
		n := first
		w := strings.Join(conds, " AND ")
		for strings.Contains(w, "$?") {
			w = strings.Replace(w, "$?", "$"+strconv.Itoa(n), 1)
			n++
		}
		return " WHERE " + w
	}
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM comments c JOIN posts p ON p.id = c.post_id`+where(1),
		condArgs...).Scan(&total); err != nil {
		return nil, 0, counts, mapErr(err)
	}
	args := append(viewerParams(CommentViewer{Moderator: true}), condArgs...)
	n := len(args)
	list, err := collectComments(r.db.Query(ctx, `SELECT `+commentCols()+` FROM comments c`+commentJoins+where(viewerArgs+1)+
		` ORDER BY c.created_at DESC, c.id DESC LIMIT $`+strconv.Itoa(n+1)+` OFFSET $`+strconv.Itoa(n+2),
		append(args, f.PerPage, f.Offset())...))
	if err != nil || len(list) == 0 {
		return list, total, counts, err
	}
	ids := make([]string, len(list))
	idx := map[string]int{}
	for i, c := range list {
		ids[i] = c.ID
		idx[c.ID] = i
	}
	rows, err := r.db.Query(ctx, `SELECT comment_id, member_id, reason, note, created_at FROM (
		SELECT r.*, row_number() OVER (PARTITION BY r.comment_id ORDER BY r.created_at DESC) AS rn
		FROM comment_reports r WHERE r.comment_id = ANY($1::uuid[])) x WHERE rn <= 10 ORDER BY comment_id, created_at DESC`, ids)
	if err != nil {
		return nil, 0, counts, mapErr(err)
	}
	reports, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.CommentReport, error) {
		var rp domain.CommentReport
		err := row.Scan(&rp.CommentID, &rp.MemberID, &rp.Reason, &rp.Note, &rp.CreatedAt)
		return rp, err
	})
	if err != nil {
		return nil, 0, counts, err
	}
	for _, rp := range reports {
		i := idx[rp.CommentID]
		list[i].Reports = append(list[i].Reports, rp)
	}
	return list, total, counts, nil
}

func (r *PGComments) HidePublishedBy(ctx context.Context, memberID, adminID string, now time.Time) ([]string, error) {
	var slugs []string
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		var admin *string
		if adminID != "" {
			admin = &adminID
		}
		rows, err := tx.Query(ctx, `UPDATE comments SET status = 'hidden', moderated_at = $2, moderated_by_admin = $3,
			moderated_by_member = NULL WHERE member_id = $1 AND status = 'published' RETURNING post_id::text`,
			memberID, now, admin)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		perPost := map[string]int{}
		for _, id := range ids {
			perPost[id]++
		}
		for postID, n := range perPost {
			if err := bumpComments(ctx, tx, postID, -n); err != nil {
				return err
			}
			var slug string
			if err := tx.QueryRow(ctx, `SELECT slug FROM posts WHERE id = $1`, postID).Scan(&slug); err != nil {
				return err
			}
			slugs = append(slugs, slug)
		}
		return nil
	})
	return slugs, mapErr(err)
}

func (r *PGComments) CreateImage(ctx context.Context, img *domain.CommentImage) error {
	return mapErr(r.db.QueryRow(ctx, `INSERT INTO comment_images (member_id, storage_key, width, height, size_bytes, created_at)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, img.MemberID, img.StorageKey, img.Width, img.Height, img.SizeBytes,
		img.CreatedAt).Scan(&img.ID))
}

func (r *PGComments) TakeStaleImages(ctx context.Context, before time.Time, limit int) ([]string, error) {
	rows, err := r.db.Query(ctx, `DELETE FROM comment_images WHERE id IN (
		SELECT id FROM comment_images WHERE comment_id IS NULL AND created_at < $1 ORDER BY created_at LIMIT $2)
		RETURNING storage_key`, before, limit)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// ---- engagement ----

type PGEngagement struct{ db DB }

func (r *PGEngagement) StatsBySlugs(ctx context.Context, slugs []string, now time.Time) (map[string]domain.CommunityStats, error) {
	out := map[string]domain.CommunityStats{}
	if len(slugs) == 0 {
		return out, nil
	}
	rows, err := r.db.Query(ctx, `SELECT p.slug, COALESCE(s.view_count, 0), COALESCE(s.like_count, 0),
		COALESCE(s.comment_count, 0) FROM posts p LEFT JOIN post_stats s ON s.post_id = p.id
		WHERE `+publishedWhere+` AND p.slug = ANY($2)`, now, slugs)
	if err != nil {
		return nil, mapErr(err)
	}
	defer rows.Close()
	for rows.Next() {
		var slug string
		var st domain.CommunityStats
		if err := rows.Scan(&slug, &st.Views, &st.Likes, &st.Comments); err != nil {
			return nil, err
		}
		out[slug] = st
	}
	return out, rows.Err()
}

func (r *PGEngagement) PostStats(ctx context.Context, postID, memberID string) (domain.CommunityStats, bool, error) {
	var st domain.CommunityStats
	var liked bool
	var mid *string
	if memberID != "" {
		mid = &memberID
	}
	err := r.db.QueryRow(ctx, `SELECT COALESCE(s.view_count, 0), COALESCE(s.like_count, 0), COALESCE(s.comment_count, 0),
		EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = $1 AND l.member_id = $2::uuid)
		FROM (SELECT $1::uuid AS id) p LEFT JOIN post_stats s ON s.post_id = p.id`, postID, mid).
		Scan(&st.Views, &st.Likes, &st.Comments, &liked)
	return st, liked, mapErr(err)
}

func (r *PGEngagement) LikePost(ctx context.Context, postID, memberID string, like bool, now time.Time) (bool, int, error) {
	var count int
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		var q string
		if like {
			q = `INSERT INTO post_likes (post_id, member_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`
		} else {
			q = `DELETE FROM post_likes WHERE post_id = $1 AND member_id = $2 AND $3::timestamptz IS NOT NULL`
		}
		tag, err := tx.Exec(ctx, q, postID, memberID, now)
		if err != nil {
			return err
		}
		delta := 0
		if tag.RowsAffected() == 1 {
			delta = 1
			if !like {
				delta = -1
			}
		}
		return tx.QueryRow(ctx, `INSERT INTO post_stats (post_id, like_count) VALUES ($1, GREATEST($2::int, 0))
			ON CONFLICT (post_id) DO UPDATE SET like_count = GREATEST(post_stats.like_count + $2::int, 0)
			RETURNING like_count`, postID, delta).Scan(&count)
	})
	return like, count, mapErr(err)
}

func (r *PGEngagement) DaySalt(ctx context.Context, day time.Time, candidate []byte) ([]byte, error) {
	if _, err := r.db.Exec(ctx, `INSERT INTO view_salts (day, salt) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING`,
		day, candidate); err != nil {
		return nil, mapErr(err)
	}
	var salt []byte
	err := r.db.QueryRow(ctx, `SELECT salt FROM view_salts WHERE day = $1`, day).Scan(&salt)
	return salt, mapErr(err)
}

func (r *PGEngagement) RecordView(ctx context.Context, day time.Time, postID string, visitorHash []byte) (bool, error) {
	tag, err := r.db.Exec(ctx, `WITH ins AS (
			INSERT INTO post_view_dedupe (day, post_id, visitor_hash) VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING RETURNING post_id)
		INSERT INTO post_stats (post_id, view_count) SELECT post_id, 1 FROM ins
		ON CONFLICT (post_id) DO UPDATE SET view_count = post_stats.view_count + 1`, day, postID, visitorHash)
	if err != nil {
		return false, mapErr(err)
	}
	return tag.RowsAffected() == 1, nil
}

func (r *PGEngagement) PurgeExpired(ctx context.Context, now time.Time, keepFrom time.Time) (PurgeResult, error) {
	var res PurgeResult
	for _, q := range []struct {
		dst *int64
		sql string
		arg any
	}{
		{&res.Sessions, `DELETE FROM member_sessions WHERE expires_at <= $1`, now},
		{&res.Tokens, `DELETE FROM member_tokens WHERE expires_at <= $1`, now},
		{&res.States, `DELETE FROM oauth_states WHERE expires_at <= $1`, now},
		{&res.Dedupe, `DELETE FROM post_view_dedupe WHERE day < $1`, keepFrom},
		{&res.Salts, `DELETE FROM view_salts WHERE day < $1`, keepFrom},
	} {
		tag, err := r.db.Exec(ctx, q.sql, q.arg)
		if err != nil {
			return res, mapErr(err)
		}
		*q.dst = tag.RowsAffected()
	}
	return res, nil
}
