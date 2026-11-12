package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type PGLeads struct{ db DB }

const leadCols = `id, first_name, last_name, company, line_id, phone, email, preferred_channel,
	COALESCE(to_char(preferred_date, 'YYYY-MM-DD'), ''), COALESCE(preferred_time, ''), message, consent_at,
	status, note, source_page, COALESCE(host(ip), ''), user_agent, created_at, updated_at`

func scanLead(row pgx.Row) (domain.Lead, error) {
	var l domain.Lead
	var channel, status string
	err := row.Scan(&l.ID, &l.FirstName, &l.LastName, &l.Company, &l.LineID, &l.Phone, &l.Email, &channel,
		&l.PreferredDate, &l.PreferredTime, &l.Message, &l.ConsentAt, &status, &l.Note, &l.SourcePage, &l.IP,
		&l.UserAgent, &l.CreatedAt, &l.UpdatedAt)
	l.PreferredChannel = domain.Channel(channel)
	l.Status = domain.LeadStatus(status)
	return l, err
}

func (r *PGLeads) Create(ctx context.Context, l *domain.Lead) error {
	if l.Status == "" {
		l.Status = domain.LeadNew
	}
	row := r.db.QueryRow(ctx, `
		INSERT INTO leads (first_name, last_name, company, line_id, phone, email, preferred_channel,
		                   preferred_date, preferred_time, message, consent_at, status, source_page, ip, user_agent)
		VALUES ($1,$2,$3,$4,$5,$6,$7, NULLIF($8,'')::date, NULLIF($9,''), $10, $11, $12, $13,
		        NULLIF($14,'')::inet, $15)
		RETURNING `+leadCols,
		l.FirstName, l.LastName, l.Company, l.LineID, l.Phone, l.Email, string(l.PreferredChannel),
		l.PreferredDate, l.PreferredTime, l.Message, l.ConsentAt, string(l.Status), l.SourcePage, l.IP, l.UserAgent)
	created, err := scanLead(row)
	if err != nil {
		return mapErr(err)
	}
	*l = created
	return nil
}

func (r *PGLeads) List(ctx context.Context, f LeadFilter) ([]domain.Lead, int, error) {
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
	where := strings.Join(conds, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM leads WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	n := len(args)
	args = append(args, f.PerPage, f.Offset())
	rows, err := r.db.Query(ctx, fmt.Sprintf(`SELECT %s FROM leads WHERE %s
		ORDER BY created_at DESC, id DESC LIMIT $%d OFFSET $%d`, leadCols, where, n+1, n+2), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []domain.Lead
	for rows.Next() {
		l, err := scanLead(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, l)
	}
	return out, total, rows.Err()
}

func (r *PGLeads) Get(ctx context.Context, id string) (domain.Lead, error) {
	l, err := scanLead(r.db.QueryRow(ctx, `SELECT `+leadCols+` FROM leads WHERE id = $1 AND deleted_at IS NULL`, id))
	return l, mapErr(err)
}

func (r *PGLeads) UpdateStatus(ctx context.Context, id string, status domain.LeadStatus, note *string) (domain.Lead, error) {
	l, err := scanLead(r.db.QueryRow(ctx, `
		UPDATE leads SET status = $2, note = COALESCE($3, note)
		 WHERE id = $1 AND deleted_at IS NULL
		RETURNING `+leadCols, id, string(status), note))
	return l, mapErr(err)
}

type PGAdminUsers struct{ db DB }

const adminCols = `id, email, name, password_hash, is_active, last_login_at, created_at`

func scanAdmin(row pgx.Row) (domain.AdminUser, error) {
	var u domain.AdminUser
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.IsActive, &u.LastLoginAt, &u.CreatedAt)
	return u, mapErr(err)
}

func (r *PGAdminUsers) GetByEmail(ctx context.Context, email string) (domain.AdminUser, error) {
	return scanAdmin(r.db.QueryRow(ctx, `SELECT `+adminCols+` FROM admin_users WHERE lower(email) = lower($1)`, email))
}

func (r *PGAdminUsers) GetByID(ctx context.Context, id string) (domain.AdminUser, error) {
	return scanAdmin(r.db.QueryRow(ctx, `SELECT `+adminCols+` FROM admin_users WHERE id = $1`, id))
}

func (r *PGAdminUsers) Create(ctx context.Context, u *domain.AdminUser) error {
	created, err := scanAdmin(r.db.QueryRow(ctx, `
		INSERT INTO admin_users (email, name, password_hash, is_active) VALUES (lower($1), $2, $3, true)
		RETURNING `+adminCols, u.Email, u.Name, u.PasswordHash))
	if err != nil {
		return err
	}
	*u = created
	return nil
}

func (r *PGAdminUsers) UpdatePassword(ctx context.Context, id, hash string) error {
	_, err := r.db.Exec(ctx, `UPDATE admin_users SET password_hash = $2 WHERE id = $1`, id, hash)
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

type PGSessions struct{ db DB }

func (r *PGSessions) Create(ctx context.Context, s *domain.Session) error {
	err := r.db.QueryRow(ctx, `
		INSERT INTO sessions (admin_user_id, token_hash, csrf_token, ip, user_agent, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		s.AdminUserID, s.TokenHash, s.CSRFToken, s.IP, s.UserAgent, s.CreatedAt, s.ExpiresAt).Scan(&s.ID)
	return mapErr(err)
}

func (r *PGSessions) GetValid(ctx context.Context, tokenHash []byte, now time.Time) (domain.Session, domain.AdminUser, error) {
	var s domain.Session
	var u domain.AdminUser
	err := r.db.QueryRow(ctx, `
		SELECT s.id, s.admin_user_id, s.token_hash, s.csrf_token, s.ip, s.user_agent, s.created_at, s.expires_at,
		       u.id, u.email, u.name, u.password_hash, u.is_active, u.last_login_at, u.created_at
		  FROM sessions s JOIN admin_users u ON u.id = s.admin_user_id
		 WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.is_active`, tokenHash, now).
		Scan(&s.ID, &s.AdminUserID, &s.TokenHash, &s.CSRFToken, &s.IP, &s.UserAgent, &s.CreatedAt, &s.ExpiresAt,
			&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.IsActive, &u.LastLoginAt, &u.CreatedAt)
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

type PGMedia struct{ db DB }

const mediaCols = `id, storage_key, url, original_name, mime, size_bytes, COALESCE(width, 0), COALESCE(height, 0),
	uploaded_by, created_at`

func scanMedia(row pgx.Row) (domain.Media, error) {
	var m domain.Media
	err := row.Scan(&m.ID, &m.StorageKey, &m.URL, &m.OriginalName, &m.Mime, &m.SizeBytes, &m.Width, &m.Height,
		&m.UploadedBy, &m.CreatedAt)
	return m, mapErr(err)
}

func (r *PGMedia) Create(ctx context.Context, m *domain.Media) error {
	created, err := scanMedia(r.db.QueryRow(ctx, `
		INSERT INTO media (storage_key, url, original_name, mime, size_bytes, width, height, uploaded_by)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, 0), NULLIF($7, 0), $8)
		RETURNING `+mediaCols,
		m.StorageKey, m.URL, m.OriginalName, m.Mime, m.SizeBytes, m.Width, m.Height, m.UploadedBy))
	if err != nil {
		return err
	}
	*m = created
	return nil
}

func (r *PGMedia) Get(ctx context.Context, id string) (domain.Media, error) {
	return scanMedia(r.db.QueryRow(ctx, `SELECT `+mediaCols+` FROM media WHERE id = $1 AND deleted_at IS NULL`, id))
}
