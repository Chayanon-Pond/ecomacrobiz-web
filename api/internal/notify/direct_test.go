package notify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestResendSendTo(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	r := NewResend("re_test", "ECOMACROBIZ <no-reply@example.com>", []string{"sales@example.com"})
	r.URL = srv.URL
	if err := r.SendTo(context.Background(), []string{"New <new@example.com>"}, "หัวเรื่อง\r\nBcc: x", "ลิงก์"); err != nil {
		t.Fatal(err)
	}
	to, _ := got["to"].([]any)
	if len(to) != 1 || to[0] != "new@example.com" || got["subject"] != "หัวเรื่อง  Bcc: x" || got["text"] != "ลิงก์" {
		t.Fatalf("payload: %v", got)
	}
	if _, has := got["reply_to"]; has {
		t.Fatal("direct mail must not set reply_to")
	}
	if err := r.SendTo(context.Background(), []string{"not an address"}, "s", "b"); err == nil {
		t.Fatal("invalid recipient accepted")
	}
}

type fakeSender struct {
	mu   sync.Mutex
	to   []string
	err  error
	done chan struct{}
}

func (f *fakeSender) Name() string { return "fake" }
func (f *fakeSender) SendTo(_ context.Context, to []string, _, _ string) error {
	f.mu.Lock()
	f.to = append(f.to, to...)
	f.mu.Unlock()
	f.done <- struct{}{}
	return f.err
}

func TestMailer(t *testing.T) {
	var nilMailer *Mailer
	if nilMailer.Send("a@example.com", "s", "b") || NewMailer(nil, discard, 0).Send("a@example.com", "s", "b") {
		t.Fatal("disabled mailer must report false")
	}
	nilMailer.Wait(context.Background())

	f := &fakeSender{done: make(chan struct{}, 2), err: errors.New("smtp down")}
	m := NewMailer(f, discard, time.Second)
	if !m.Send("a@example.com", "s", "b") || !m.Send("b@example.com", "s", "b") {
		t.Fatal("queued mail must report true even if delivery later fails")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	m.Wait(ctx)
	if len(f.to) != 2 {
		t.Fatalf("sent to %v", f.to)
	}
}
