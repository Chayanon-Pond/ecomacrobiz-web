package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

type ContactInput struct {
	FirstName        string `json:"first_name"`
	LastName         string `json:"last_name"`
	Company          string `json:"company"`
	LineID           string `json:"line_id"`
	Phone            string `json:"phone"`
	Email            string `json:"email"`
	PreferredChannel string `json:"preferred_channel"`
	PreferredDate    string `json:"preferred_date"`
	PreferredTime    string `json:"preferred_time"`
	Message          string `json:"message"`
	Consent          bool   `json:"consent"`
	Website          string `json:"website"` // honeypot
	SourcePage       string `json:"source_page"`
}

type RequestMeta struct {
	IP        string
	UserAgent string
}

// LeadNotifier is implemented by notify.Dispatcher; it must not block.
type LeadNotifier interface {
	LeadCreated(lead domain.Lead)
}

type ContactService struct {
	leads    repository.Leads
	notifier LeadNotifier
	log      *slog.Logger
	Now      func() time.Time
}

func NewContactService(leads repository.Leads, notifier LeadNotifier, log *slog.Logger) *ContactService {
	return &ContactService{leads: leads, notifier: notifier, log: log, Now: time.Now}
}

// SubmitResult reports the id returned to the client; Stored is false for
// honeypot submissions (which still get a plausible fake id).
type SubmitResult struct {
	ID     string
	Stored bool
}

func (s *ContactService) Submit(ctx context.Context, in ContactInput, meta RequestMeta) (SubmitResult, error) {
	if strings.TrimSpace(in.Website) != "" {
		s.log.Info("contact honeypot triggered; submission discarded", "ip", meta.IP)
		return SubmitResult{ID: uuid.NewString()}, nil
	}
	now := s.Now()
	lead, err := ValidateContact(in, now)
	if err != nil {
		return SubmitResult{}, err
	}
	lead.ConsentAt = now.UTC()
	lead.Status = domain.LeadNew
	lead.IP = meta.IP
	lead.UserAgent = truncateRunes(cleanLine(meta.UserAgent), 500)
	if err := s.leads.Create(ctx, &lead); err != nil {
		return SubmitResult{}, fmt.Errorf("create lead: %w", err)
	}
	s.log.Info("lead created", "lead_id", lead.ID, "channel", lead.PreferredChannel)
	if s.notifier != nil {
		s.notifier.LeadCreated(lead)
	}
	return SubmitResult{ID: lead.ID, Stored: true}, nil
}

var (
	phoneLocalRe = regexp.MustCompile(`^0[0-9]{8,9}$`)
	phoneIntlRe  = regexp.MustCompile(`^\+66[0-9]{8,9}$`)
	dateRe       = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`)
	timeRe       = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)
)

// NormalizePhone strips spaces and dashes and reports whether the result is a
// Thai number: 0 + 8-9 digits (02 landline, 06/08/09 mobile) or +66 + 8-9 digits.
func NormalizePhone(raw string) (string, bool) {
	p := strings.NewReplacer(" ", "", "-", "", " ", "").Replace(strings.TrimSpace(raw))
	return p, phoneLocalRe.MatchString(p) || phoneIntlRe.MatchString(p)
}

func ValidEmail(s string) bool {
	if s == "" || len(s) > 254 || strings.ContainsAny(s, " \t\r\n<>\"") {
		return false
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s {
		return false
	}
	at := strings.LastIndexByte(s, '@')
	local, dom := s[:at], s[at+1:]
	if local == "" || len(local) > 64 || !strings.Contains(dom, ".") ||
		strings.HasPrefix(dom, ".") || strings.HasSuffix(dom, ".") || strings.Contains(dom, "..") {
		return false
	}
	return true
}

// ValidateContact cleans the input and returns the lead to store, or a
// *domain.ValidationError with Thai field messages.
func ValidateContact(in ContactInput, now time.Time) (domain.Lead, error) {
	var v domain.Validator
	l := domain.Lead{
		FirstName:  cleanLine(in.FirstName),
		LastName:   cleanLine(in.LastName),
		Company:    cleanLine(in.Company),
		LineID:     cleanLine(in.LineID),
		Email:      cleanLine(in.Email),
		Message:    cleanText(in.Message),
		SourcePage: cleanLine(in.SourcePage),
	}

	switch n := runeLen(l.FirstName); {
	case n == 0:
		v.Add("first_name", "กรุณากรอกชื่อ")
	case n > 100:
		v.Add("first_name", "ชื่อต้องไม่เกิน 100 ตัวอักษร")
	}
	if runeLen(l.LastName) > 100 {
		v.Add("last_name", "นามสกุลต้องไม่เกิน 100 ตัวอักษร")
	}
	if runeLen(l.Company) > 200 {
		v.Add("company", "ชื่อบริษัทต้องไม่เกิน 200 ตัวอักษร")
	}
	if runeLen(l.LineID) > 100 {
		v.Add("line_id", "LINE ID ต้องไม่เกิน 100 ตัวอักษร")
	}

	if strings.TrimSpace(in.Phone) == "" {
		v.Add("phone", "กรุณากรอกเบอร์โทรศัพท์")
	} else if p, ok := NormalizePhone(in.Phone); !ok {
		v.Add("phone", "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง")
	} else {
		l.Phone = p
	}

	if l.Email == "" {
		v.Add("email", "กรุณากรอกอีเมล")
	} else if !ValidEmail(l.Email) {
		v.Add("email", "รูปแบบอีเมลไม่ถูกต้อง")
	}

	ch := domain.Channel(strings.ToLower(strings.TrimSpace(in.PreferredChannel)))
	if !ch.Valid() {
		v.Add("preferred_channel", "กรุณาเลือกช่องทางที่สะดวกให้ติดต่อ")
	} else {
		l.PreferredChannel = ch
	}

	if d := strings.TrimSpace(in.PreferredDate); d != "" {
		t, err := time.ParseInLocation("2006-01-02", d, bangkok)
		switch {
		case !dateRe.MatchString(d) || err != nil:
			v.Add("preferred_date", "รูปแบบวันที่ไม่ถูกต้อง")
		default:
			today := now.In(bangkok)
			startOfToday := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, bangkok)
			if t.Before(startOfToday) {
				v.Add("preferred_date", "กรุณาเลือกวันที่ตั้งแต่วันนี้เป็นต้นไป")
			} else if t.After(startOfToday.AddDate(2, 0, 0)) {
				v.Add("preferred_date", "วันที่ไกลเกินไป กรุณาเลือกวันที่ภายใน 2 ปี")
			} else {
				l.PreferredDate = d
			}
		}
	}

	if t := strings.TrimSpace(in.PreferredTime); t != "" {
		if !timeRe.MatchString(t) {
			v.Add("preferred_time", "รูปแบบเวลาไม่ถูกต้อง (ชั่วโมง:นาที)")
		} else {
			l.PreferredTime = t
		}
	}

	if runeLen(l.Message) > 2000 {
		v.Add("message", "ข้อความต้องไม่เกิน 2000 ตัวอักษร")
	}
	if runeLen(l.SourcePage) > 200 {
		v.Add("source_page", "source_page ต้องไม่เกิน 200 ตัวอักษร")
	}
	if !in.Consent {
		v.Add("consent", "กรุณายินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล")
	}
	return l, v.Err()
}
