package service

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
)

var discard = slog.New(slog.NewTextHandler(io.Discard, nil))

func validContact() ContactInput {
	return ContactInput{
		FirstName: "สมชาย", LastName: "ใจดี", Phone: "081-234-5678", Email: "somchai@example.co.th",
		PreferredChannel: "line", Consent: true, Message: "สนใจบริการออกแบบแบรนด์",
	}
}

func fieldErrs(t *testing.T, err error) map[string]string {
	t.Helper()
	if err == nil {
		return nil
	}
	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("want ValidationError, got %T %v", err, err)
	}
	return ve.Fields
}

func TestNormalizePhone(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"0812345678", "0812345678", true},
		{"081-234-5678", "0812345678", true},
		{"081 234 5678", "0812345678", true},
		{"0612345678", "0612345678", true},
		{"0912345678", "0912345678", true},
		{"021234567", "021234567", true}, // Bangkok landline, 9 digits
		{"02-123-4567", "021234567", true},
		{"+66812345678", "+66812345678", true},
		{"+66 81 234 5678", "+66812345678", true},
		{"+6621234567", "+6621234567", true},
		{"  0812345678  ", "0812345678", true},
		{"081234567", "081234567", true}, // 9 digits allowed by contract
		{"08123456", "", false},          // too short
		{"08123456789", "", false},       // too long
		{"812345678", "", false},         // missing leading 0
		{"+1 415 555 0100", "", false},
		{"+660812345678", "", false},
		{"08x2345678", "", false},
		{"(081)2345678", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := NormalizePhone(c.in)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("NormalizePhone(%q) = %q,%v want %q,%v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestValidEmail(t *testing.T) {
	good := []string{"a@b.co", "first.last+tag@example.co.th", "x_y@sub.domain.com"}
	bad := []string{"", "plain", "a@b", "a@.com", "a@b.", "a b@c.com", "Name <a@b.com>", "a@@b.com",
		"a@b..com", strings.Repeat("a", 65) + "@b.com", "a@b.com\r\nBcc: x@y.com"}
	for _, e := range good {
		if !ValidEmail(e) {
			t.Errorf("ValidEmail(%q) = false", e)
		}
	}
	for _, e := range bad {
		if ValidEmail(e) {
			t.Errorf("ValidEmail(%q) = true", e)
		}
	}
}

func TestValidateContactRequiredAndThaiMessages(t *testing.T) {
	_, err := ValidateContact(ContactInput{}, time.Now())
	f := fieldErrs(t, err)
	want := map[string]string{
		"first_name":        "กรุณากรอกชื่อ",
		"phone":             "กรุณากรอกเบอร์โทรศัพท์",
		"email":             "กรุณากรอกอีเมล",
		"preferred_channel": "กรุณาเลือกช่องทางที่สะดวกให้ติดต่อ",
		"consent":           "กรุณายินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล",
	}
	for k, v := range want {
		if f[k] != v {
			t.Errorf("field %s = %q want %q", k, f[k], v)
		}
	}
	if len(f) != len(want) {
		t.Errorf("unexpected fields: %v", f)
	}
}

func TestValidateContactFormats(t *testing.T) {
	in := validContact()
	in.Phone = "12345"
	in.Email = "not-an-email"
	in.PreferredChannel = "fax"
	f := fieldErrs(t, func() error { _, err := ValidateContact(in, time.Now()); return err }())
	if f["phone"] != "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง" || f["email"] != "รูปแบบอีเมลไม่ถูกต้อง" ||
		f["preferred_channel"] == "" {
		t.Fatalf("fields: %v", f)
	}
}

func TestValidateContactChannels(t *testing.T) {
	for _, ch := range []string{"email", "line", "phone", "LINE", " Email "} {
		in := validContact()
		in.PreferredChannel = ch
		if _, err := ValidateContact(in, time.Now()); err != nil {
			t.Errorf("channel %q rejected: %v", ch, err)
		}
	}
	for _, ch := range []string{"", "tel", "sms"} {
		in := validContact()
		in.PreferredChannel = ch
		if _, err := ValidateContact(in, time.Now()); err == nil {
			t.Errorf("channel %q accepted", ch)
		}
	}
}

func TestValidateContactDateBangkok(t *testing.T) {
	// 2026-11-12 17:30 UTC == 2026-11-13 00:30 in Bangkok: "today" is the 13th.
	now := time.Date(2026, 11, 12, 17, 30, 0, 0, time.UTC)
	cases := []struct {
		date string
		ok   bool
	}{
		{"2026-11-13", true},
		{"2026-12-01", true},
		{"2026-11-12", false}, // still "today" in UTC, already past in Bangkok
		{"2026-01-01", false},
		{"2026-02-30", false},
		{"13/11/2026", false},
		{"2026-11-13T10:00", false},
		{"2030-01-01", false}, // more than 2 years ahead
	}
	for _, c := range cases {
		in := validContact()
		in.PreferredDate = c.date
		lead, err := ValidateContact(in, now)
		if c.ok && err != nil {
			t.Errorf("date %s rejected: %v", c.date, err)
		}
		if !c.ok && fieldErrs(t, err)["preferred_date"] == "" {
			t.Errorf("date %s accepted", c.date)
		}
		if c.ok && lead.PreferredDate != c.date {
			t.Errorf("date not kept: %q", lead.PreferredDate)
		}
	}
	in := validContact()
	in.PreferredDate = "2026-11-12"
	if f := fieldErrs(t, func() error { _, err := ValidateContact(in, now); return err }()); f["preferred_date"] != "กรุณาเลือกวันที่ตั้งแต่วันนี้เป็นต้นไป" {
		t.Errorf("past date message: %q", f["preferred_date"])
	}
}

func TestValidateContactTimeAndLengths(t *testing.T) {
	for _, tm := range []string{"00:00", "09:30", "23:59"} {
		in := validContact()
		in.PreferredTime = tm
		if _, err := ValidateContact(in, time.Now()); err != nil {
			t.Errorf("time %s rejected", tm)
		}
	}
	for _, tm := range []string{"24:00", "9:30", "12:60", "noon"} {
		in := validContact()
		in.PreferredTime = tm
		if _, err := ValidateContact(in, time.Now()); err == nil {
			t.Errorf("time %s accepted", tm)
		}
	}
	in := validContact()
	in.FirstName = strings.Repeat("ก", 101)
	in.Message = strings.Repeat("ข", 2001)
	in.Company = strings.Repeat("c", 201)
	f := fieldErrs(t, func() error { _, err := ValidateContact(in, time.Now()); return err }())
	for _, k := range []string{"first_name", "message", "company"} {
		if f[k] == "" {
			t.Errorf("%s length not enforced", k)
		}
	}
	// Thai text is measured in characters, not bytes: 100 Thai chars is fine.
	in = validContact()
	in.FirstName = strings.Repeat("ก", 100)
	if _, err := ValidateContact(in, time.Now()); err != nil {
		t.Errorf("100 Thai chars rejected: %v", err)
	}
}

func TestValidateContactConsent(t *testing.T) {
	in := validContact()
	in.Consent = false
	f := fieldErrs(t, func() error { _, err := ValidateContact(in, time.Now()); return err }())
	if f["consent"] == "" || len(f) != 1 {
		t.Fatalf("fields: %v", f)
	}
}

type recNotifier struct {
	mu    sync.Mutex
	leads []domain.Lead
}

func (r *recNotifier) LeadCreated(l domain.Lead) {
	r.mu.Lock()
	r.leads = append(r.leads, l)
	r.mu.Unlock()
}

func TestSubmitStoresAndNotifies(t *testing.T) {
	store := fake.New()
	n := &recNotifier{}
	svc := NewContactService(store.LeadsRepo(), n, discard)
	res, err := svc.Submit(context.Background(), validContact(), RequestMeta{IP: "203.0.113.9", UserAgent: "UA"})
	if err != nil || !res.Stored || res.ID == "" {
		t.Fatalf("submit: %+v %v", res, err)
	}
	leads := store.Leads()
	if len(leads) != 1 || leads[0].Phone != "0812345678" || leads[0].IP != "203.0.113.9" ||
		leads[0].Status != domain.LeadNew || leads[0].ConsentAt.IsZero() {
		t.Fatalf("stored lead: %+v", leads)
	}
	if len(n.leads) != 1 || n.leads[0].ID != res.ID {
		t.Fatalf("notifier got %v", n.leads)
	}
}

func TestSubmitHoneypot(t *testing.T) {
	store := fake.New()
	n := &recNotifier{}
	svc := NewContactService(store.LeadsRepo(), n, discard)
	in := ContactInput{Website: "http://spam.example"} // invalid otherwise, still 201-like
	res, err := svc.Submit(context.Background(), in, RequestMeta{})
	if err != nil || res.Stored || res.ID == "" {
		t.Fatalf("honeypot: %+v %v", res, err)
	}
	if len(store.Leads()) != 0 || len(n.leads) != 0 {
		t.Fatal("honeypot submission must not be stored or notified")
	}
}
