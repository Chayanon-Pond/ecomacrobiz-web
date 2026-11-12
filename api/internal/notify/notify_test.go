package notify

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

var discard = slog.New(slog.NewTextHandler(io.Discard, nil))

func sampleLead() domain.Lead {
	return domain.Lead{ID: "lead-1", FirstName: "สมชาย", LastName: "ใจดี", Company: "บริษัท ก จำกัด",
		Phone: "0812345678", Email: "somchai@example.com", PreferredChannel: domain.ChannelLine,
		PreferredDate: "2026-12-01", PreferredTime: "10:00", Message: "สนใจ", CreatedAt: time.Now()}
}

func TestLeadText(t *testing.T) {
	txt := LeadText(sampleLead())
	for _, want := range []string{"สมชาย ใจดี", "0812345678", "ช่องทางที่สะดวก: LINE", "2026-12-01 10:00", "lead-1"} {
		if !strings.Contains(txt, want) {
			t.Errorf("missing %q in:\n%s", want, txt)
		}
	}
}

func TestLinePush(t *testing.T) {
	var got struct {
		To       string `json:"to"`
		Messages []struct {
			Type, Text string
		} `json:"messages"`
	}
	var auth, retryKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth, retryKey = r.Header.Get("Authorization"), r.Header.Get("X-Line-Retry-Key")
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()
	l := NewLine("test-token", "Uxxxxxxxx")
	l.URL = srv.URL
	if err := l.NotifyLead(context.Background(), sampleLead()); err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer test-token" || retryKey == "" || got.To != "Uxxxxxxxx" || len(got.Messages) != 1 ||
		got.Messages[0].Type != "text" || !strings.Contains(got.Messages[0].Text, "สมชาย") {
		t.Fatalf("auth=%q retry=%q body=%+v", auth, retryKey, got)
	}

	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"message":"Invalid token"}`, http.StatusUnauthorized)
	}))
	defer bad.Close()
	l.URL = bad.URL
	if err := l.NotifyLead(context.Background(), sampleLead()); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("want 401 error, got %v", err)
	}
}

func TestBuildMessageNoHeaderInjection(t *testing.T) {
	msg, err := BuildMessage("ECOMACROBIZ <noreply@example.com>", []string{"sales@example.com"},
		"x@example.com", "ผู้ติดต่อใหม่\r\nBcc: victim@example.com", "เนื้อหา", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	s := string(msg)
	headers := s[:strings.Index(s, "\r\n\r\n")]
	for _, line := range strings.Split(headers, "\r\n") {
		if strings.HasPrefix(strings.ToLower(line), "bcc:") {
			t.Fatalf("header injection: %q", line)
		}
	}
	if !strings.Contains(headers, "Subject: =?UTF-8?b?") || !strings.Contains(headers, "Reply-To: <x@example.com>") {
		t.Fatalf("headers:\n%s", headers)
	}
	if _, err := BuildMessage("bad from", nil, "", "s", "b", time.Now()); err == nil {
		t.Error("invalid from accepted")
	}
}

type slowNotifier struct {
	calls atomic.Int32
	fail  bool
}

func (s *slowNotifier) Name() string { return "slow" }
func (s *slowNotifier) NotifyLead(ctx context.Context, _ domain.Lead) error {
	s.calls.Add(1)
	select {
	case <-time.After(200 * time.Millisecond):
	case <-ctx.Done():
		return ctx.Err()
	}
	if s.fail {
		return errors.New("boom")
	}
	return nil
}

func TestDispatcherIsAsyncAndFansOut(t *testing.T) {
	a, b := &slowNotifier{}, &slowNotifier{fail: true}
	d := NewDispatcher(discard, time.Second, a, b)
	start := time.Now()
	d.LeadCreated(sampleLead())
	if time.Since(start) > 50*time.Millisecond {
		t.Fatal("LeadCreated must not block")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	d.Wait(ctx)
	if a.calls.Load() != 1 || b.calls.Load() != 1 {
		t.Fatalf("calls a=%d b=%d", a.calls.Load(), b.calls.Load())
	}
	NewDispatcher(discard, time.Second).LeadCreated(sampleLead()) // no notifiers: no-op
}

func TestDispatcherTimeout(t *testing.T) {
	n := &slowNotifier{}
	d := NewDispatcher(discard, 20*time.Millisecond, n)
	d.LeadCreated(sampleLead())
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	start := time.Now()
	d.Wait(ctx)
	if time.Since(start) > 150*time.Millisecond {
		t.Fatal("notifier timeout not applied")
	}
}

func TestRevalidator(t *testing.T) {
	type req struct {
		secret string
		tags   []string
	}
	got := make(chan req, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Tags []string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		got <- req{r.Header.Get("x-revalidate-secret"), body.Tags}
	}))
	defer srv.Close()
	rv := NewRevalidator(srv.URL, "s3cret", discard)
	rv.Revalidate("posts", "post:a")
	select {
	case r := <-got:
		if r.secret != "s3cret" || len(r.tags) != 2 || r.tags[1] != "post:a" {
			t.Fatalf("%+v", r)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("webhook not called")
	}
	rv.Wait(context.Background())
	NewRevalidator("", "", discard).Revalidate("posts") // disabled: no-op
}

func TestResendSend(t *testing.T) {
	var auth string
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"x"}`))
	}))
	defer srv.Close()
	r := NewResend("re_test", "ECOMACROBIZ Website <no-reply@example.com>", []string{"sales@example.com"})
	r.URL = srv.URL
	if err := r.NotifyLead(context.Background(), sampleLead()); err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer re_test" {
		t.Fatalf("auth = %q", auth)
	}
	if to, _ := got["to"].([]any); len(to) != 1 || to[0] != "sales@example.com" {
		t.Fatalf("to = %v", got["to"])
	}
	if got["reply_to"] != "somchai@example.com" || !strings.Contains(got["text"].(string), "สมชาย") {
		t.Fatalf("payload = %v", got)
	}

	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"message":"bad key"}`, http.StatusUnauthorized)
	}))
	defer srv2.Close()
	r.URL = srv2.URL
	if err := r.NotifyLead(context.Background(), sampleLead()); err == nil {
		t.Fatal("want error on 401")
	}
}
