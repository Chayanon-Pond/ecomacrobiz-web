package repository

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type PGMembers struct{ db DB }

const memberCols = `m.id, m.display_name, m.email_ciphertext, m.email_key_id, m.email_index, m.email_verified_at,
	COALESCE(m.password_hash, ''), m.password_changed_at, m.role, COALESCE(m.avatar_key, ''), m.terms_version,
	m.consented_at, m.last_login_at, m.banned_at, m.banned_reason, m.created_at, m.updated_at`

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func scanMemberInto(m *domain.Member, role *string) []any {
	return []any{&m.ID, &m.DisplayName, &m.EmailCiphertext, &m.EmailKeyID, &m.EmailIndex, &m.EmailVerifiedAt,
		&m.PasswordHash, &m.PasswordChangedAt, role, &m.AvatarKey, &m.TermsVersion, &m.ConsentedAt, &m.LastLoginAt,
		&m.BannedAt, &m.BannedReason, &m.CreatedAt, &m.UpdatedAt}
}

func scanMember(row pgx.Row) (domain.Member, error) {
	var m domain.Member
	var role string
	err := row.Scan(scanMemberInto(&m, &role)...)
	m.Role = domain.MemberRole(role)
	return m, mapErr(err)
}

func nullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (r *PGMembers) Create(ctx context.Context, m *domain.Member, ident *domain.MemberIdentity) error {
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		role := m.Role
		if role == "" {
			role = domain.MemberRoleMember
		}
		created, err := scanMember(tx.QueryRow(ctx, `
			INSERT INTO members AS m (id, display_name, email_ciphertext, email_key_id, email_index, email_verified_at,
				password_hash, password_changed_at, role, terms_version, consented_at, last_login_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING `+memberCols, m.ID, m.DisplayName, m.EmailCiphertext, m.EmailKeyID, m.EmailIndex,
			m.EmailVerifiedAt, nullStr(m.PasswordHash), m.PasswordChangedAt, string(role), m.TermsVersion,
			m.ConsentedAt, m.LastLoginAt))
		if err != nil {
			return err
		}
		if ident != nil {
			ident.MemberID = created.ID
			if err := insertIdentity(ctx, tx, ident); err != nil {
				return err
			}
		}
		*m = created
		return nil
	})
	return mapErr(err)
}

func insertIdentity(ctx context.Context, q rowQuerier, ident *domain.MemberIdentity) error {
	return mapErr(q.QueryRow(ctx, `
		INSERT INTO member_identities (member_id, provider, subject_hash, last_used_at) VALUES ($1, $2, $3, $4)
		RETURNING id, created_at`, ident.MemberID, ident.Provider, ident.SubjectHash, ident.LastUsedAt).
		Scan(&ident.ID, &ident.CreatedAt))
}

func (r *PGMembers) GetByID(ctx context.Context, id string) (domain.Member, error) {
	return scanMember(r.db.QueryRow(ctx, `SELECT `+memberCols+` FROM members m WHERE m.id = $1`, id))
}

func (r *PGMembers) GetByEmailIndex(ctx context.Context, idx []byte) (domain.Member, error) {
	return scanMember(r.db.QueryRow(ctx, `SELECT `+memberCols+` FROM members m WHERE m.email_index = $1`, idx))
}

func (r *PGMembers) GetByIdentity(ctx context.Context, provider string, subjectHash []byte) (domain.Member, error) {
	return scanMember(r.db.QueryRow(ctx, `SELECT `+memberCols+` FROM members m
		JOIN member_identities i ON i.member_id = m.id WHERE i.provider = $1 AND i.subject_hash = $2`,
		provider, subjectHash))
}

func (r *PGMembers) Identities(ctx context.Context, memberID string) ([]domain.MemberIdentity, error) {
	rows, err := r.db.Query(ctx, `SELECT id, member_id, provider, subject_hash, created_at, last_used_at
		FROM member_identities WHERE member_id = $1 ORDER BY created_at`, memberID)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.MemberIdentity, error) {
		var i domain.MemberIdentity
		err := row.Scan(&i.ID, &i.MemberID, &i.Provider, &i.SubjectHash, &i.CreatedAt, &i.LastUsedAt)
		return i, err
	})
}

func (r *PGMembers) AddIdentity(ctx context.Context, ident *domain.MemberIdentity, verifiedAt *time.Time) error {
	return mapErr(withTx(ctx, r.db, func(tx pgx.Tx) error {
		if err := insertIdentity(ctx, tx, ident); err != nil {
			return err
		}
		if verifiedAt != nil {
			_, err := tx.Exec(ctx, `UPDATE members SET email_verified_at = $2 WHERE id = $1 AND email_verified_at IS NULL`,
				ident.MemberID, *verifiedAt)
			return err
		}
		return nil
	}))
}

func (r *PGMembers) TouchIdentity(ctx context.Context, provider string, subjectHash []byte, at time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE member_identities SET last_used_at = $3 WHERE provider = $1 AND subject_hash = $2`,
		provider, subjectHash, at)
	return mapErr(err)
}

func (r *PGMembers) DeleteIdentity(ctx context.Context, memberID, provider string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM member_identities WHERE member_id = $1 AND provider = $2`, memberID, provider)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *PGMembers) UpdateDisplayName(ctx context.Context, id, name string) (domain.Member, error) {
	return scanMember(r.db.QueryRow(ctx, `UPDATE members m SET display_name = $2 WHERE m.id = $1 RETURNING `+memberCols,
		id, name))
}

func (r *PGMembers) SetAvatar(ctx context.Context, id, key string, onlyIfNone bool) (string, bool, error) {
	var prev string
	applied := false
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		var cur *string
		if err := tx.QueryRow(ctx, `SELECT avatar_key FROM members WHERE id = $1 FOR UPDATE`, id).Scan(&cur); err != nil {
			return err
		}
		if cur != nil {
			prev = *cur
		}
		if onlyIfNone && prev != "" {
			return nil
		}
		applied = true
		_, err := tx.Exec(ctx, `UPDATE members SET avatar_key = $2 WHERE id = $1`, id, nullStr(key))
		return err
	})
	return prev, applied, mapErr(err)
}

func (r *PGMembers) UpdateEmail(ctx context.Context, id string, upd EmailUpdate, verifiedAt *time.Time) error {
	return updateEmail(ctx, r.db, id, upd, verifiedAt)
}

type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func updateEmail(ctx context.Context, db execer, id string, upd EmailUpdate, verifiedAt *time.Time) error {
	tag, err := db.Exec(ctx, `UPDATE members SET email_ciphertext = $2, email_key_id = $3, email_index = $4,
		email_verified_at = $5 WHERE id = $1`, id, upd.Ciphertext, upd.KeyID, upd.Index, verifiedAt)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *PGMembers) SetPassword(ctx context.Context, id, hash string, at time.Time, keepSessionID string) error {
	return mapErr(withTx(ctx, r.db, func(tx pgx.Tx) error { return setMemberPassword(ctx, tx, id, hash, at, keepSessionID) }))
}

func setMemberPassword(ctx context.Context, tx pgx.Tx, id, hash string, at time.Time, keepSessionID string) error {
	tag, err := tx.Exec(ctx, `UPDATE members SET password_hash = $2, password_changed_at = $3 WHERE id = $1`, id, hash, at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if _, err := tx.Exec(ctx, `DELETE FROM member_sessions WHERE member_id = $1 AND ($2 = '' OR id::text <> $2)`,
		id, keepSessionID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE member_tokens SET used_at = $2
		WHERE member_id = $1 AND purpose = 'reset_password' AND used_at IS NULL`, id, at)
	return err
}

func (r *PGMembers) MarkVerified(ctx context.Context, id string, at time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE members SET email_verified_at = $2 WHERE id = $1 AND email_verified_at IS NULL`, id, at)
	return mapErr(err)
}

func (r *PGMembers) TouchLogin(ctx context.Context, id string, at time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE members SET last_login_at = $2 WHERE id = $1`, id, at)
	return mapErr(err)
}

func (r *PGMembers) HasPublishedComment(ctx context.Context, id string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM comments WHERE member_id = $1 AND status = 'published')`,
		id).Scan(&ok)
	return ok, mapErr(err)
}

func (r *PGMembers) Delete(ctx context.Context, id string) (DeletedMember, error) {
	var out DeletedMember
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		var avatar *string
		if err := tx.QueryRow(ctx, `SELECT avatar_key FROM members WHERE id = $1 FOR UPDATE`, id).Scan(&avatar); err != nil {
			return err
		}
		if avatar != nil {
			out.AvatarKey = *avatar
		}
		rows, err := tx.Query(ctx, `SELECT DISTINCT p.slug FROM comments c JOIN posts p ON p.id = c.post_id
			WHERE c.member_id = $1 AND c.status = 'published' ORDER BY p.slug`, id)
		if err != nil {
			return err
		}
		if out.AffectedSlugs, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		for _, q := range []string{
			`UPDATE post_stats s SET like_count = GREATEST(s.like_count - 1, 0)
				FROM post_likes l WHERE l.post_id = s.post_id AND l.member_id = $1`,
			`DELETE FROM post_likes WHERE member_id = $1`,
			`UPDATE comments c SET like_count = GREATEST(c.like_count - 1, 0)
				FROM comment_likes l WHERE l.comment_id = c.id AND l.member_id = $1`,
			`DELETE FROM comment_likes WHERE member_id = $1`,
			`UPDATE comments c SET report_count = GREATEST(c.report_count - 1, 0)
				FROM comment_reports r WHERE r.comment_id = c.id AND r.member_id = $1`,
			`DELETE FROM comment_reports WHERE member_id = $1`,
		} {
			if _, err := tx.Exec(ctx, q, id); err != nil {
				return err
			}
		}
		rows, err = tx.Query(ctx, `DELETE FROM comment_images WHERE member_id = $1 RETURNING storage_key`, id)
		if err != nil {
			return err
		}
		if out.ImageKeys, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM members WHERE id = $1`, id)
		return err
	})
	return out, mapErr(err)
}

func (r *PGMembers) Export(ctx context.Context, id string) (MemberExport, error) {
	var out MemberExport
	var err error
	if out.Identities, err = r.Identities(ctx, id); err != nil {
		return out, err
	}
	rows, err := r.db.Query(ctx, `SELECT p.slug, c.body, c.status, c.created_at, c.edited_at
		FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.member_id = $1 ORDER BY c.created_at`, id)
	if err != nil {
		return out, mapErr(err)
	}
	out.Comments, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (ExportComment, error) {
		var c ExportComment
		var st string
		err := row.Scan(&c.PostSlug, &c.Body, &st, &c.CreatedAt, &c.EditedAt)
		c.Status = domain.CommentStatus(st)
		return c, err
	})
	if err != nil {
		return out, err
	}
	rows, err = r.db.Query(ctx, `SELECT p.slug FROM post_likes l JOIN posts p ON p.id = l.post_id
		WHERE l.member_id = $1 ORDER BY l.created_at`, id)
	if err != nil {
		return out, mapErr(err)
	}
	if out.LikedPosts, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
		return out, err
	}
	rows, err = r.db.Query(ctx, `SELECT comment_id::text FROM comment_likes WHERE member_id = $1 ORDER BY created_at`, id)
	if err != nil {
		return out, mapErr(err)
	}
	out.LikedComments, err = pgx.CollectRows(rows, pgx.RowTo[string])
	return out, err
}

const memberAdminExtra = `, EXISTS (SELECT 1 FROM member_identities i WHERE i.member_id = m.id AND i.provider = 'google'),
	(SELECT count(*) FROM comments c WHERE c.member_id = m.id AND c.status <> 'deleted')`

func scanMemberAdmin(row pgx.Row) (MemberAdminRow, error) {
	var out MemberAdminRow
	var role string
	dst := append(scanMemberInto(&out.Member, &role), &out.HasGoogle, &out.CommentCount)
	err := row.Scan(dst...)
	out.Member.Role = domain.MemberRole(role)
	return out, mapErr(err)
}

func (r *PGMembers) AdminList(ctx context.Context, f MemberFilter) ([]MemberAdminRow, int, error) {
	var conds []string
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, strings.ReplaceAll(cond, "$?", "$"+strconv.Itoa(len(args))))
	}
	if f.EmailIndex != nil {
		add("m.email_index = $?", f.EmailIndex)
	}
	if f.Name != "" {
		add(`m.display_name ILIKE $? ESCAPE '\'`, likePattern(f.Name))
	}
	if f.Role != "" {
		add("m.role = $?", f.Role)
	}
	where := ""
	if len(conds) > 0 {
		where = " WHERE " + strings.Join(conds, " AND ")
	}
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM members m`+where, args...).Scan(&total); err != nil {
		return nil, 0, mapErr(err)
	}
	args = append(args, f.PerPage, f.Offset())
	rows, err := r.db.Query(ctx, `SELECT `+memberCols+memberAdminExtra+` FROM members m`+where+
		` ORDER BY m.created_at DESC, m.id LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, 0, mapErr(err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (MemberAdminRow, error) { return scanMemberAdmin(row) })
	return out, total, err
}

func (r *PGMembers) AdminGet(ctx context.Context, id string) (MemberAdminRow, error) {
	return scanMemberAdmin(r.db.QueryRow(ctx, `SELECT `+memberCols+memberAdminExtra+` FROM members m WHERE m.id = $1`, id))
}

func (r *PGMembers) SetRole(ctx context.Context, id string, role domain.MemberRole, reason string, now time.Time) (before, after domain.Member, err error) {
	err = withTx(ctx, r.db, func(tx pgx.Tx) error {
		cur, err := scanMember(tx.QueryRow(ctx, `SELECT `+memberCols+` FROM members m WHERE m.id = $1 FOR UPDATE`, id))
		if err != nil {
			return err
		}
		before = cur
		var bannedAt *time.Time
		bannedReason := ""
		if role == domain.MemberRoleBanned {
			bannedAt, bannedReason = cur.BannedAt, reason
			if bannedAt == nil {
				bannedAt = &now
			}
		}
		after, err = scanMember(tx.QueryRow(ctx, `UPDATE members m SET role = $2, banned_at = $3, banned_reason = $4
			WHERE m.id = $1 RETURNING `+memberCols, id, string(role), bannedAt, bannedReason))
		if err != nil {
			return err
		}
		if role == domain.MemberRoleBanned {
			_, err = tx.Exec(ctx, `DELETE FROM member_sessions WHERE member_id = $1`, id)
		}
		return err
	})
	return before, after, mapErr(err)
}

// ---- sessions ----

type PGMemberSessions struct{ db DB }

const memberSessionCols = `s.id, s.member_id, s.token_hash, s.csrf_token, s.ip, s.user_agent, s.created_at,
	s.expires_at, s.last_seen_at`

func scanMemberSession(row pgx.Row, extra ...any) (domain.MemberSession, error) {
	var s domain.MemberSession
	dst := append([]any{&s.ID, &s.MemberID, &s.TokenHash, &s.CSRFToken, &s.IP, &s.UserAgent, &s.CreatedAt,
		&s.ExpiresAt, &s.LastSeenAt}, extra...)
	return s, mapErr(row.Scan(dst...))
}

func (r *PGMemberSessions) Create(ctx context.Context, s *domain.MemberSession) error {
	created, err := scanMemberSession(r.db.QueryRow(ctx, `
		INSERT INTO member_sessions AS s (member_id, token_hash, csrf_token, ip, user_agent, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING `+memberSessionCols,
		s.MemberID, s.TokenHash, s.CSRFToken, s.IP, s.UserAgent, s.CreatedAt, s.ExpiresAt))
	if err != nil {
		return err
	}
	*s = created
	return nil
}

func (r *PGMemberSessions) GetValid(ctx context.Context, tokenHash []byte, now time.Time) (domain.MemberSession, domain.Member, error) {
	var m domain.Member
	var role string
	s, err := scanMemberSession(r.db.QueryRow(ctx, `SELECT `+memberSessionCols+`, `+memberCols+`
		FROM member_sessions s JOIN members m ON m.id = s.member_id
		WHERE s.token_hash = $1 AND s.expires_at > $2`, tokenHash, now), scanMemberInto(&m, &role)...)
	m.Role = domain.MemberRole(role)
	return s, m, err
}

func (r *PGMemberSessions) Touch(ctx context.Context, id string, now time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE member_sessions SET last_seen_at = $2
		WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < $2::timestamptz - interval '1 minute')`, id, now)
	return mapErr(err)
}

func (r *PGMemberSessions) DeleteByTokenHash(ctx context.Context, tokenHash []byte) error {
	_, err := r.db.Exec(ctx, `DELETE FROM member_sessions WHERE token_hash = $1`, tokenHash)
	return mapErr(err)
}

func (r *PGMemberSessions) ListByMember(ctx context.Context, memberID string, now time.Time) ([]domain.MemberSession, error) {
	rows, err := r.db.Query(ctx, `SELECT `+memberSessionCols+` FROM member_sessions s
		WHERE s.member_id = $1 AND s.expires_at > $2 ORDER BY s.created_at DESC`, memberID, now)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.MemberSession, error) {
		return scanMemberSession(row)
	})
}

func (r *PGMemberSessions) DeleteByMemberExcept(ctx context.Context, memberID, keepID string) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM member_sessions WHERE member_id = $1 AND ($2 = '' OR id::text <> $2)`,
		memberID, keepID)
	if err != nil {
		return 0, mapErr(err)
	}
	return tag.RowsAffected(), nil
}

// ---- tokens ----

type PGMemberTokens struct{ db DB }

func (r *PGMemberTokens) Create(ctx context.Context, t *domain.MemberToken) error {
	return mapErr(r.db.QueryRow(ctx, `
		INSERT INTO member_tokens (id, member_id, purpose, token_hash, payload_ciphertext, payload_key_id, created_at, expires_at)
		VALUES (COALESCE(NULLIF($1, '')::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		t.ID, t.MemberID, string(t.Purpose), t.TokenHash, t.PayloadCiphertext, t.PayloadKeyID, t.CreatedAt, t.ExpiresAt).
		Scan(&t.ID))
}

func (r *PGMemberTokens) GetUsable(ctx context.Context, hash []byte, purposes []domain.MemberTokenPurpose, now time.Time) (domain.MemberToken, error) {
	ps := make([]string, len(purposes))
	for i, p := range purposes {
		ps[i] = string(p)
	}
	var t domain.MemberToken
	var purpose string
	err := r.db.QueryRow(ctx, `SELECT id, member_id, purpose, token_hash, payload_ciphertext, payload_key_id,
		created_at, expires_at, used_at FROM member_tokens
		WHERE token_hash = $1 AND purpose = ANY($2) AND used_at IS NULL AND expires_at > $3`, hash, ps, now).
		Scan(&t.ID, &t.MemberID, &purpose, &t.TokenHash, &t.PayloadCiphertext, &t.PayloadKeyID, &t.CreatedAt,
			&t.ExpiresAt, &t.UsedAt)
	t.Purpose = domain.MemberTokenPurpose(purpose)
	if err = mapErr(err); err == domain.ErrNotFound {
		return t, domain.ErrTokenInvalid
	}
	return t, err
}

// burn marks the token used if it still is usable (ErrTokenInvalid otherwise).
func burn(ctx context.Context, tx pgx.Tx, tokenID string, now time.Time) error {
	tag, err := tx.Exec(ctx, `UPDATE member_tokens SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND expires_at > $2`,
		tokenID, now)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrTokenInvalid
	}
	return nil
}

func (r *PGMemberTokens) ConsumeVerify(ctx context.Context, tokenID, memberID string, email *EmailUpdate, now time.Time) error {
	return mapErr(withTx(ctx, r.db, func(tx pgx.Tx) error {
		if err := burn(ctx, tx, tokenID, now); err != nil {
			return err
		}
		if email != nil {
			return updateEmail(ctx, tx, memberID, *email, &now)
		}
		tag, err := tx.Exec(ctx, `UPDATE members SET email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $1`,
			memberID, now)
		if err == nil && tag.RowsAffected() == 0 {
			return domain.ErrTokenInvalid
		}
		return err
	}))
}

func (r *PGMemberTokens) ConsumeReset(ctx context.Context, tokenID, memberID, passwordHash string, now time.Time) error {
	return mapErr(withTx(ctx, r.db, func(tx pgx.Tx) error {
		if err := burn(ctx, tx, tokenID, now); err != nil {
			return err
		}
		if err := setMemberPassword(ctx, tx, memberID, passwordHash, now, ""); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE members SET email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $1`,
			memberID, now)
		return err
	}))
}

func (r *PGMemberTokens) ConsumeLink(ctx context.Context, tokenID string, ident *domain.MemberIdentity, now time.Time) error {
	return mapErr(withTx(ctx, r.db, func(tx pgx.Tx) error {
		if err := burn(ctx, tx, tokenID, now); err != nil {
			return err
		}
		if err := insertIdentity(ctx, tx, ident); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE members SET email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $1`,
			ident.MemberID, now)
		return err
	}))
}

func (r *PGMemberTokens) RevokeOpen(ctx context.Context, memberID string, purpose domain.MemberTokenPurpose, now time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE member_tokens SET used_at = $3
		WHERE member_id = $1 AND purpose = $2 AND used_at IS NULL`, memberID, string(purpose), now)
	return mapErr(err)
}

// ---- oauth states ----

type PGOAuthStates struct{ db DB }

func (r *PGOAuthStates) Create(ctx context.Context, s *domain.OAuthState) error {
	_, err := r.db.Exec(ctx, `INSERT INTO oauth_states (state_hash, binding_hash, nonce, pkce_verifier_ciphertext, key_id,
		next_path, consent_version, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		s.StateHash, s.BindingHash, s.Nonce, s.VerifierCiphertext, s.KeyID, s.NextPath, s.ConsentVersion, s.CreatedAt,
		s.ExpiresAt)
	return mapErr(err)
}

func (r *PGOAuthStates) Take(ctx context.Context, stateHash []byte) (domain.OAuthState, error) {
	var s domain.OAuthState
	err := r.db.QueryRow(ctx, `DELETE FROM oauth_states WHERE state_hash = $1 RETURNING state_hash, binding_hash, nonce,
		pkce_verifier_ciphertext, key_id, next_path, consent_version, created_at, expires_at`, stateHash).
		Scan(&s.StateHash, &s.BindingHash, &s.Nonce, &s.VerifierCiphertext, &s.KeyID, &s.NextPath, &s.ConsentVersion,
			&s.CreatedAt, &s.ExpiresAt)
	return s, mapErr(err)
}
