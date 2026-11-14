package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type PGAdminUsers struct{ db DB }

const adminCols = `id, email, name, password_hash, role, is_active, last_login_at, created_at,
	password_changed_at, invited_by`

func scanAdmin(row pgx.Row) (domain.AdminUser, error) {
	var u domain.AdminUser
	var role string
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &role, &u.IsActive, &u.LastLoginAt, &u.CreatedAt,
		&u.PasswordChangedAt, &u.InvitedBy)
	u.Role = domain.Role(role)
	return u, mapErr(err)
}

func (r *PGAdminUsers) GetByEmail(ctx context.Context, email string) (domain.AdminUser, error) {
	return scanAdmin(r.db.QueryRow(ctx, `SELECT `+adminCols+` FROM admin_users WHERE lower(email) = lower($1)`, email))
}

func (r *PGAdminUsers) GetByID(ctx context.Context, id string) (domain.AdminUser, error) {
	return scanAdmin(r.db.QueryRow(ctx, `SELECT `+adminCols+` FROM admin_users WHERE id = $1`, id))
}

// Create inserts an active user. An empty Role is stored as viewer.
func (r *PGAdminUsers) Create(ctx context.Context, u *domain.AdminUser) error {
	created, err := insertAdmin(ctx, r.db, u)
	if err != nil {
		return err
	}
	*u = created
	return nil
}

func insertAdmin(ctx context.Context, db interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}, u *domain.AdminUser) (domain.AdminUser, error) {
	role := u.Role
	if role == "" {
		role = domain.RoleViewer
	}
	return scanAdmin(db.QueryRow(ctx, `
		INSERT INTO admin_users (email, name, password_hash, is_active, role, invited_by, password_changed_at)
		VALUES (lower($1), $2, $3, true, $4, $5, $6)
		RETURNING `+adminCols, u.Email, u.Name, u.PasswordHash, string(role), u.InvitedBy, u.PasswordChangedAt))
}

func (r *PGAdminUsers) UpdatePassword(ctx context.Context, id, hash string) error {
	_, err := r.db.Exec(ctx, `UPDATE admin_users SET password_hash = $2, password_changed_at = now() WHERE id = $1`,
		id, hash)
	return mapErr(err)
}

func (r *PGAdminUsers) SetPassword(ctx context.Context, id, hash string, at time.Time) error {
	tag, err := r.db.Exec(ctx, `UPDATE admin_users SET password_hash = $2, password_changed_at = $3 WHERE id = $1`,
		id, hash, at)
	if err == nil && tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return mapErr(err)
}

func (r *PGAdminUsers) UpdateName(ctx context.Context, id, name string) error {
	_, err := r.db.Exec(ctx, `UPDATE admin_users SET name = $2 WHERE id = $1 AND name <> $2`, id, name)
	return mapErr(err)
}

func (r *PGAdminUsers) TouchLogin(ctx context.Context, id string, at time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE admin_users SET last_login_at = $2 WHERE id = $1`, id, at)
	return mapErr(err)
}

func (r *PGAdminUsers) List(ctx context.Context) ([]domain.AdminUser, error) {
	rows, err := r.db.Query(ctx, `SELECT `+adminCols+` FROM admin_users
		ORDER BY (role = 'owner') DESC, lower(name), lower(email)`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.AdminUser, error) { return scanAdmin(row) })
}

func (r *PGAdminUsers) CountActiveOwners(ctx context.Context) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM admin_users WHERE role = 'owner' AND is_active`).Scan(&n)
	return n, err
}

func (r *PGAdminUsers) RestoreOwner(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE admin_users SET role = 'owner', is_active = true
		WHERE id = $1 AND (role <> 'owner' OR NOT is_active)`, id)
	return mapErr(err)
}

// lockOwners locks every active owner row (in id order, so concurrent
// callers queue instead of deadlocking) and the target row, and returns the
// number of active owners and the target.
func lockOwners(ctx context.Context, tx pgx.Tx, id string) (int, domain.AdminUser, error) {
	rows, err := tx.Query(ctx, `SELECT id FROM admin_users WHERE role = 'owner' AND is_active ORDER BY id FOR UPDATE`)
	if err != nil {
		return 0, domain.AdminUser{}, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, domain.AdminUser{}, err
	}
	u, err := scanAdmin(tx.QueryRow(ctx, `SELECT `+adminCols+` FROM admin_users WHERE id = $1 FOR UPDATE`, id))
	return len(ids), u, err
}

func isActiveOwner(u domain.AdminUser) bool { return u.IsActive && u.Role == domain.RoleOwner }

func (r *PGAdminUsers) UpdateAccess(ctx context.Context, id string, role *domain.Role, active *bool) (before, after domain.AdminUser, err error) {
	err = withTx(ctx, r.db, func(tx pgx.Tx) error {
		owners, u, err := lockOwners(ctx, tx, id)
		if err != nil {
			return err
		}
		before = u
		next := u
		if role != nil {
			next.Role = *role
		}
		if active != nil {
			next.IsActive = *active
		}
		if isActiveOwner(u) && !isActiveOwner(next) && owners <= 1 {
			return domain.ErrLastOwner
		}
		after, err = scanAdmin(tx.QueryRow(ctx, `UPDATE admin_users SET role = $2, is_active = $3 WHERE id = $1
			RETURNING `+adminCols, id, string(next.Role), next.IsActive))
		if err != nil {
			return err
		}
		if u.IsActive && !next.IsActive {
			if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE admin_user_id = $1`, id); err != nil {
				return err
			}
		}
		return nil
	})
	return before, after, mapErr(err)
}

func (r *PGAdminUsers) Delete(ctx context.Context, id string) (domain.AdminUser, error) {
	var deleted domain.AdminUser
	err := withTx(ctx, r.db, func(tx pgx.Tx) error {
		owners, u, err := lockOwners(ctx, tx, id)
		if err != nil {
			return err
		}
		if isActiveOwner(u) && owners <= 1 {
			return domain.ErrLastOwner
		}
		deleted = u
		_, err = tx.Exec(ctx, `DELETE FROM admin_users WHERE id = $1`, id)
		return err
	})
	return deleted, mapErr(err)
}

type PGSessions struct{ db DB }

const sessionCols = `s.id, s.admin_user_id, s.token_hash, s.csrf_token, s.ip, s.user_agent, s.created_at,
	s.expires_at, s.last_seen_at`

func sessionDest(s *domain.Session) []any {
	return []any{&s.ID, &s.AdminUserID, &s.TokenHash, &s.CSRFToken, &s.IP, &s.UserAgent, &s.CreatedAt,
		&s.ExpiresAt, &s.LastSeenAt}
}

func (r *PGSessions) Create(ctx context.Context, s *domain.Session) error {
	err := r.db.QueryRow(ctx, `
		INSERT INTO sessions (admin_user_id, token_hash, csrf_token, ip, user_agent, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		s.AdminUserID, s.TokenHash, s.CSRFToken, s.IP, s.UserAgent, s.CreatedAt, s.ExpiresAt).Scan(&s.ID)
	return mapErr(err)
}

// GetValid only returns sessions of ACTIVE users, so a deactivated user is
// locked out even if a session row survived.
func (r *PGSessions) GetValid(ctx context.Context, tokenHash []byte, now time.Time) (domain.Session, domain.AdminUser, error) {
	var s domain.Session
	var u domain.AdminUser
	var role string
	dest := append(sessionDest(&s), &u.ID, &u.Email, &u.Name, &u.PasswordHash, &role, &u.IsActive, &u.LastLoginAt,
		&u.CreatedAt, &u.PasswordChangedAt, &u.InvitedBy)
	err := r.db.QueryRow(ctx, `
		SELECT `+sessionCols+`,
		       u.id, u.email, u.name, u.password_hash, u.role, u.is_active, u.last_login_at, u.created_at,
		       u.password_changed_at, u.invited_by
		  FROM sessions s JOIN admin_users u ON u.id = s.admin_user_id
		 WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.is_active`, tokenHash, now).Scan(dest...)
	u.Role = domain.Role(role)
	return s, u, mapErr(err)
}

func (r *PGSessions) DeleteByTokenHash(ctx context.Context, tokenHash []byte) error {
	_, err := r.db.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	return mapErr(err)
}

func (r *PGSessions) DeleteByUser(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM sessions WHERE admin_user_id = $1`, userID)
	return mapErr(err)
}

func (r *PGSessions) DeleteExpired(ctx context.Context, now time.Time) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM sessions WHERE expires_at <= $1`, now)
	return tag.RowsAffected(), mapErr(err)
}

func (r *PGSessions) ListByUser(ctx context.Context, userID string, now time.Time) ([]domain.Session, error) {
	rows, err := r.db.Query(ctx, `SELECT `+sessionCols+` FROM sessions s
		WHERE s.admin_user_id = $1 AND s.expires_at > $2 ORDER BY s.created_at DESC, s.id`, userID, now)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Session, error) {
		var s domain.Session
		err := row.Scan(sessionDest(&s)...)
		return s, err
	})
}

func (r *PGSessions) DeleteByUserExcept(ctx context.Context, userID, keepID string) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM sessions WHERE admin_user_id = $1 AND id <> $2`, userID, keepID)
	return tag.RowsAffected(), mapErr(err)
}

func (r *PGSessions) Touch(ctx context.Context, id string, now time.Time) error {
	_, err := r.db.Exec(ctx, `UPDATE sessions SET last_seen_at = $2
		WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < $2::timestamptz - interval '1 minute')`, id, now)
	return mapErr(err)
}
