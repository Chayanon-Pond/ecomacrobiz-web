package service

import (
	"context"
	"encoding/csv"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

type LeadService struct {
	leads repository.Leads
	log   *slog.Logger
}

func NewLeadService(leads repository.Leads, log *slog.Logger) *LeadService {
	return &LeadService{leads: leads, log: log}
}

func validLeadStatusFilter(s string) error {
	if s == "" || domain.LeadStatus(s).Valid() {
		return nil
	}
	return &domain.ValidationError{Message: domain.MsgValidationFailed,
		Fields: map[string]string{"status": "สถานะไม่ถูกต้อง"}}
}

func (s *LeadService) List(ctx context.Context, f repository.LeadFilter) ([]domain.Lead, int, error) {
	if err := validLeadStatusFilter(f.Status); err != nil {
		return nil, 0, err
	}
	return s.leads.List(ctx, f)
}

func (s *LeadService) Get(ctx context.Context, id string) (domain.Lead, error) {
	if _, err := uuid.Parse(id); err != nil {
		return domain.Lead{}, domain.ErrNotFound
	}
	return s.leads.Get(ctx, id)
}

type LeadUpdate struct {
	Status string  `json:"status"`
	Note   *string `json:"note"`
}

func (s *LeadService) Update(ctx context.Context, id string, in LeadUpdate, actorID string) (domain.Lead, error) {
	if _, err := uuid.Parse(id); err != nil {
		return domain.Lead{}, domain.ErrNotFound
	}
	var v domain.Validator
	st := domain.LeadStatus(strings.TrimSpace(in.Status))
	if !st.Valid() {
		v.Add("status", "สถานะต้องเป็น new, contacted, qualified, closed หรือ spam")
	}
	var note *string
	if in.Note != nil {
		n := cleanText(*in.Note)
		if runeLen(n) > 2000 {
			v.Add("note", "บันทึกต้องไม่เกิน 2000 ตัวอักษร")
		}
		note = &n
	}
	if err := v.Err(); err != nil {
		return domain.Lead{}, err
	}
	l, err := s.leads.UpdateStatus(ctx, id, st, note)
	if err != nil {
		return l, err
	}
	s.log.Info("lead updated", "lead_id", id, "status", st, "actor", actorID)
	return l, nil
}

// CSVSafe neutralises spreadsheet formula injection (OWASP): cells starting
// with = + - @ (or tab / CR) are prefixed with a single quote.
func CSVSafe(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}

var leadCSVHeader = []string{
	"id", "created_at", "status", "first_name", "last_name", "company", "phone", "email", "line_id",
	"preferred_channel", "preferred_date", "preferred_time", "message", "note", "source_page", "consent_at", "ip",
}

const (
	exportBatch   = 500
	exportMaxRows = 100_000
)

// ExportCSV streams leads (newest first) as UTF-8 CSV with a BOM so Excel
// renders Thai correctly. Times are formatted in Asia/Bangkok.
func (s *LeadService) ExportCSV(ctx context.Context, w io.Writer, status string) error {
	if err := validLeadStatusFilter(status); err != nil {
		return err
	}
	if _, err := io.WriteString(w, "\xEF\xBB\xBF"); err != nil {
		return err
	}
	cw := csv.NewWriter(w)
	if err := cw.Write(leadCSVHeader); err != nil {
		return err
	}
	ts := func(t time.Time) string { return t.In(bangkok).Format("2006-01-02 15:04:05") }
	written := 0
	for page := 1; written < exportMaxRows; page++ {
		rows, total, err := s.leads.List(ctx, repository.LeadFilter{
			Page: domain.Page{Page: page, PerPage: exportBatch}, Status: status})
		if err != nil {
			return err
		}
		for _, l := range rows {
			rec := []string{l.ID, ts(l.CreatedAt), string(l.Status), l.FirstName, l.LastName, l.Company, l.Phone,
				l.Email, l.LineID, string(l.PreferredChannel), l.PreferredDate, l.PreferredTime, l.Message, l.Note,
				l.SourcePage, ts(l.ConsentAt), l.IP}
			for i := range rec {
				rec[i] = CSVSafe(rec[i])
			}
			if err := cw.Write(rec); err != nil {
				return err
			}
			written++
		}
		cw.Flush()
		if err := cw.Error(); err != nil {
			return err
		}
		if len(rows) < exportBatch || page*exportBatch >= total {
			break
		}
	}
	return nil
}
