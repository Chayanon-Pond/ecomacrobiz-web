package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type PGLeads struct{ db DB }

const leadCols = `id, first_name, last_name, company, line_id, phone, email, preferred_channel,
	COALESCE(to_char(preferred_date, 'YYYY-MM-DD'), ''), COALESCE(preferred_time, ''), message, consent_at,
	status, note, source_page, COALESCE(host(ip), ''), user_agent, created_at, updated_at,
	assigned_to, (SELECT a.name FROM admin_users a WHERE a.id = leads.assigned_to),
	(SELECT a.email FROM admin_users a WHERE a.id = leads.assigned_to)`

func scanLead(row pgx.Row) (domain.Lead, error) {
	var l domain.Lead
	var channel, status string
	var asID, asName, asEmail *string
	err := row.Scan(&l.ID, &l.FirstName, &l.LastName, &l.Company, &l.LineID, &l.Phone, &l.Email, &channel,
		&l.PreferredDate, &l.PreferredTime, &l.Message, &l.ConsentAt, &status, &l.Note, &l.SourcePage, &l.IP,
		&l.UserAgent, &l.CreatedAt, &l.UpdatedAt, &asID, &asName, &asEmail)
	l.PreferredChannel = domain.Channel(channel)
	l.Status = domain.LeadStatus(status)
	l.AssignedTo = userRef(asID, asName, asEmail)
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
	where, args := leadWhere(f)
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

type PGMedia struct{ db DB }

const mediaCols = `id, storage_key, url, original_name, mime, size_bytes, COALESCE(width, 0), COALESCE(height, 0),
	uploaded_by, created_at, alt,
	(SELECT a.name FROM admin_users a WHERE a.id = media.uploaded_by),
	(SELECT a.email FROM admin_users a WHERE a.id = media.uploaded_by),
	(SELECT count(*) FROM posts p WHERE ` + mediaUsedBy + `)::int`

func scanMedia(row pgx.Row) (domain.Media, error) {
	var m domain.Media
	var upName, upEmail *string
	err := row.Scan(&m.ID, &m.StorageKey, &m.URL, &m.OriginalName, &m.Mime, &m.SizeBytes, &m.Width, &m.Height,
		&m.UploadedBy, &m.CreatedAt, &m.Alt, &upName, &upEmail, &m.UsageCount)
	m.Uploader = userRef(m.UploadedBy, upName, upEmail)
	return m, mapErr(err)
}

func (r *PGMedia) Create(ctx context.Context, m *domain.Media) error {
	created, err := scanMedia(r.db.QueryRow(ctx, `
		INSERT INTO media (storage_key, url, original_name, mime, size_bytes, width, height, uploaded_by, alt)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, 0), NULLIF($7, 0), $8, $9)
		RETURNING `+mediaCols,
		m.StorageKey, m.URL, m.OriginalName, m.Mime, m.SizeBytes, m.Width, m.Height, m.UploadedBy, m.Alt))
	if err != nil {
		return err
	}
	*m = created
	return nil
}

func (r *PGMedia) Get(ctx context.Context, id string) (domain.Media, error) {
	return scanMedia(r.db.QueryRow(ctx, `SELECT `+mediaCols+` FROM media WHERE id = $1 AND deleted_at IS NULL`, id))
}
