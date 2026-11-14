package service

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

// OptionalString distinguishes an absent JSON field (Set=false) from null
// (Set=true, Value=nil) and a string value.
type OptionalString struct {
	Set   bool
	Value *string
}

func (o *OptionalString) UnmarshalJSON(b []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		o.Value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	o.Value = &s
	return nil
}

func refID(r *domain.UserRef) string {
	if r == nil {
		return ""
	}
	return r.ID
}

// LeadStatuses in board/display order.
var LeadStatuses = []domain.LeadStatus{domain.LeadNew, domain.LeadContacted, domain.LeadQualified,
	domain.LeadClosed, domain.LeadSpam}

// LeadQuery is the raw list/board query string.
type LeadQuery struct {
	Status   string
	Q        string
	Assigned string // "", "me", "none" or a user id
	From, To string // YYYY-MM-DD, Asia/Bangkok, inclusive
}

// Filter validates q and converts it to a repository filter ("me" = actor).
// From/To become [from 00:00, to+1 00:00) Bangkok bounds in UTC.
func (s *LeadService) Filter(q LeadQuery, actor domain.Actor) (repository.LeadFilter, error) {
	var v domain.Validator
	f := repository.LeadFilter{Query: q.Q}
	switch st := strings.TrimSpace(q.Status); {
	case st == "" || st == "all":
	case domain.LeadStatus(st).Valid():
		f.Status = st
	default:
		v.Add("status", "สถานะไม่ถูกต้อง")
	}
	switch a := strings.TrimSpace(q.Assigned); a {
	case "", "all", "any":
	case "me":
		f.Assigned = actor.ID
		if f.Assigned == "" {
			f.Assigned = "none"
		}
	case "none":
		f.Assigned = "none"
	default:
		if _, err := uuid.Parse(a); err != nil {
			v.Add("assigned", "ค่า assigned ต้องเป็น me, none หรือรหัสผู้ใช้")
		} else {
			f.Assigned = a
		}
	}
	day := func(field, val string) *time.Time {
		val = strings.TrimSpace(val)
		if val == "" {
			return nil
		}
		t, err := time.ParseInLocation("2006-01-02", val, bangkok)
		if err != nil {
			v.Add(field, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD")
			return nil
		}
		return &t
	}
	if from := day("from", q.From); from != nil {
		t := from.UTC()
		f.CreatedFrom = &t
	}
	if to := day("to", q.To); to != nil {
		t := to.AddDate(0, 0, 1).UTC()
		f.CreatedTo = &t
	}
	if f.CreatedFrom != nil && f.CreatedTo != nil && !f.CreatedFrom.Before(*f.CreatedTo) {
		v.Add("to", "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น")
	}
	return f, v.Err()
}

const boardPerColumn = 50

type LeadBoard struct {
	Columns map[domain.LeadStatus][]domain.Lead
	Counts  map[domain.LeadStatus]int
}

// Board: newest first, at most 50 leads per status column; every status key
// is present.
func (s *LeadService) Board(ctx context.Context, f repository.LeadFilter) (LeadBoard, error) {
	cols, counts, err := s.leads.Board(ctx, f, boardPerColumn)
	if err != nil {
		return LeadBoard{}, err
	}
	b := LeadBoard{Columns: map[domain.LeadStatus][]domain.Lead{}, Counts: map[domain.LeadStatus]int{}}
	for _, st := range LeadStatuses {
		b.Columns[st] = cols[st]
		if b.Columns[st] == nil {
			b.Columns[st] = []domain.Lead{}
		}
		b.Counts[st] = counts[st]
	}
	return b, nil
}

// assigneeRoles are the roles granting leads:write.
func assigneeRoles() []domain.Role {
	var out []domain.Role
	for _, r := range domain.Roles {
		if r.Has(domain.PermLeadsWrite) {
			out = append(out, r)
		}
	}
	return out
}

// Assignees: active users whose role has leads:write.
func (s *LeadService) Assignees(ctx context.Context) ([]domain.UserRef, error) {
	out, err := s.leads.Assignees(ctx, assigneeRoles())
	if out == nil {
		out = []domain.UserRef{}
	}
	return out, err
}

func (s *LeadService) assignable(ctx context.Context, userID string) (bool, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return false, nil
	}
	users, err := s.Assignees(ctx)
	if err != nil {
		return false, err
	}
	return slices.ContainsFunc(users, func(u domain.UserRef) bool { return u.ID == userID }), nil
}

const maxNoteLen = 4000

// AddNote appends a note to the lead's timeline. The audit entry records only
// the length, never the text.
func (s *LeadService) AddNote(ctx context.Context, leadID, body string, actor domain.Actor) (domain.LeadActivity, error) {
	if _, err := uuid.Parse(leadID); err != nil {
		return domain.LeadActivity{}, domain.ErrNotFound
	}
	body = cleanText(body)
	switch n := runeLen(body); {
	case n == 0:
		return domain.LeadActivity{}, &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"body": "กรุณากรอกบันทึก"}}
	case n > maxNoteLen:
		return domain.LeadActivity{}, &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"body": "บันทึกต้องไม่เกิน 4000 ตัวอักษร"}}
	}
	a, err := s.leads.AddNote(ctx, leadID, actor, body)
	if err != nil {
		return a, err
	}
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditLeadNote, TargetType: domain.TargetLead,
		TargetID: leadID, Metadata: map[string]any{"length": runeLen(body)}})
	return a, nil
}

// Activities returns the lead's timeline, newest first (404 for unknown leads).
func (s *LeadService) Activities(ctx context.Context, leadID string) ([]domain.LeadActivity, error) {
	if _, err := s.Get(ctx, leadID); err != nil {
		return nil, err
	}
	return s.leads.Activities(ctx, leadID)
}

// DashboardLeads is the leads section of GET /dashboard.
type DashboardLeads struct {
	domain.LeadStats
	Recent []domain.Lead
}

func (s *LeadService) Dashboard(ctx context.Context) (DashboardLeads, error) {
	st, err := s.leads.Stats(ctx, s.Now())
	if err != nil {
		return DashboardLeads{}, err
	}
	recent, _, err := s.leads.List(ctx, repository.LeadFilter{Page: domain.Page{Page: 1, PerPage: 5}})
	if err != nil {
		return DashboardLeads{}, err
	}
	return DashboardLeads{LeadStats: st, Recent: recent}, nil
}
