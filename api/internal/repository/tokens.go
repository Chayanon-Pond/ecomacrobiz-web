package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type PGUserTokens struct{ db DB }

const tokenCols = `t.id, t.purpose, t.token_hash, t.email, t.role, t.user_id, t.created_at, t.expires_at,
	t.used_at, t.revoked_at, t.created_by, COALESCE(c.name, ''), COALESCE(c.email, '')`

const tokenFrom = ` FROM user_tokens t LEFT JOIN admin_users c ON c.id = t.created_by `

func scanToken(row pgx.Row) (domain.UserToken, error) {
	var (
		t                    domain.UserToken
		purpose              string
		role                 *string
		createdBy            *string
		creatorName, crEmail string
	)
	err := row.Scan(&t.ID, &purpose, &t.TokenHash, &t.Email, &role, &t.UserID, &t.CreatedAt, &t.ExpiresAt,
		&t.UsedAt, &t.RevokedAt, &createdBy, &creatorName, &crEmail)
	t.Purpose = domain.TokenPurpose(purpose)
	if role != nil {
		r := domain.Role(*role)
		t.Role = &r
	}
	if createdBy != nil {
		t.CreatedBy = &domain.UserRef{ID: *createdBy, Name: creatorName, Email: crEmail}
	}
	return t, mapErr(err)
}

// byID re-reads a token with its creator joined (mutations return only the id).
func (r *PGUserTokens) byID(ctx context.Context, q interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}, id string) (domain.UserToken, error) {
	return scanToken(q.QueryRow(ctx, `SELECT `+tokenCols+tokenFrom+`WHERE t.id = $1`, id))
}

func (r *PGUserTokens) Create(ctx context.Context, t *domain.UserToken) error {
	var role *string
	if t.Role != nil {
		s := string(*t.Role)
		role = &s
	}
	var createdBy *string
	if t.CreatedBy != nil {
		createdBy = &t.CreatedBy.ID
	}
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO user_tokens (purpose, token_hash, email, role, user_id, created_by, expires_at)
		VALUES ($1, $2, lower($3), $4, $5, $6, $7) RETURNING id`,
		string(t.Purpose), t.TokenHash, t.Email, role, t.UserID, createdBy, t.ExpiresAt).Scan(&id)
	if err != nil {
		return mapErr(err)
	}
	created, err := r.byID(ctx, r.db, id)
	if err != nil {
		return err
	}
	*t = created
	return nil
}

func (r *PGUserTokens) Get(ctx context.Context, id string) (domain.UserToken, error) {
	return r.byID(ctx, r.db, id)
}

func (r *PGUserTokens) GetByHash(ctx context.Context, hash []byte) (domain.UserToken, error) {
	return scanToken(r.db.QueryRow(ctx, `SELECT `+tokenCols+tokenFrom+`WHERE t.token_hash = $1`, hash))
}

func (r *PGUserTokens) ListOpenInvites(ctx context.Context) ([]domain.UserToken, error) {
	rows, err := r.db.Query(ctx, `SELECT `+tokenCols+tokenFrom+`
		WHERE t.purpose = 'invite' AND t.used_at IS NULL AND t.revoked_at IS NULL
		ORDER BY t.created_at DESC, t.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.UserToken, error) { return scanToken(row) })
}

func (r *PGUserTokens) RevokeInvite(ctx context.Context, id string, now time.Time) (domain.UserToken, error) {
	var got string
	err := r.db.QueryRow(ctx, `UPDATE user_tokens SET revoked_at = $2
		WHERE id = $1 AND purpose = 'invite' AND used_at IS NULL AND revoked_at IS NULL RETURNING id`, id, now).Scan(&got)
	if err != nil {
		return domain.UserToken{}, mapErr(err)
	}
	return r.byID(ctx, r.db, got)
}

func (r *PGUserTokens) RevokeOpenInvitesFor(ctx context.Context, email string, now time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE user_tokens SET revoked_at = $2
		WHERE email = lower($1) AND purpose = 'invite' AND used_at IS NULL AND revoked_at IS NULL`, email, now)
	return mapErr(err)
}

func (r *PGUserTokens) RevokeOpenResetsFor(ctx context.Context, userID string, now time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE user_tokens SET revoked_at = $2
		WHERE user_id = $1 AND purpose = 'reset' AND used_at IS NULL AND revoked_at IS NULL`, userID, now)
	return mapErr(err)
}

func (r *PGUserTokens) RotateInvite(ctx context.Context, id string, hash []byte, expiresAt time.Time) (domain.UserToken, error) {
	var got string
	err := r.db.QueryRow(ctx, `UPDATE user_tokens SET token_hash = $2, expires_at = $3
		WHERE id = $1 AND purpose = 'invite' AND used_at IS NULL AND revoked_at IS NULL RETURNING id`,
		id, hash, expiresAt).Scan(&got)
	if err != nil {
		return domain.UserToken{}, mapErr(err)
	}
	return r.byID(ctx, r.db, got)
}

// consume atomically marks an open, unexpired token of the given purpose as
// used. Zero rows -> ErrTokenInvalid.
func consume(ctx context.Context, tx pgx.Tx, purpose domain.TokenPurpose, hash []byte, now time.Time) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `UPDATE user_tokens SET used_at = $3
		WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > $3
		RETURNING id`, hash, string(purpose), now).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrTokenInvalid
	}
	return id, err
}

func (r *PGUserTokens) AcceptInvite(ctx context.Context, hash []byte, now time.Time, u *domain.AdminUser) (domain.UserToken, error) {
	var tok domain.UserToken
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		id, err := consume(ctx, tx, domain.TokenInvite, hash, now)
		if err != nil {
			return err
		}
		if tok, err = r.byID(ctx, tx, id); err != nil {
			return err
		}
		nu := *u
		nu.Email = tok.Email
		nu.Role = *tok.Role
		nu.InvitedBy = nil
		if tok.CreatedBy != nil {
			nu.InvitedBy = &tok.CreatedBy.ID
		}
		nu.PasswordChangedAt = &now
		created, err := insertAdmin(ctx, tx, &nu)
		if err != nil {
			return mapErr(err)
		}
		if _, err := tx.Exec(ctx, `UPDATE user_tokens SET user_id = $2 WHERE id = $1`, id, created.ID); err != nil {
			return err
		}
		*u = created
		uid := created.ID
		tok.UserID = &uid
		return nil
	})
	return tok, mapErr(err)
}

func (r *PGUserTokens) ConsumeReset(ctx context.Context, hash []byte, now time.Time, passwordHash string) (domain.AdminUser, error) {
	var user domain.AdminUser
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		id, err := consume(ctx, tx, domain.TokenReset, hash, now)
		if err != nil {
			return err
		}
		user, err = scanAdmin(tx.QueryRow(ctx, `
			UPDATE admin_users SET password_hash = $2, password_changed_at = $3
			 WHERE id = (SELECT user_id FROM user_tokens WHERE id = $1) AND is_active
			RETURNING `+adminCols, id, passwordHash, now))
		if errors.Is(err, domain.ErrNotFound) {
			return domain.ErrTokenInvalid // user deactivated (or gone) since the link was issued
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM sessions WHERE admin_user_id = $1`, user.ID)
		return err
	})
	return user, mapErr(err)
}
