package notify

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestIndexNowSubmit(t *testing.T) {
	var (
		mu    sync.Mutex
		got   []map[string]any
		ctype string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		ctype = r.Header.Get("Content-Type")
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		got = append(got, body)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	n := NewIndexNow("abc12345-key", "https://www.example.com/", log)
	n.Endpoint = srv.URL
	n.Submit("/knowledge/สวัสดี", "/knowledge", "/knowledge", "https://www.example.com/a",
		"https://other.example.org/x", "//evil.example/x")
	n.Wait(context.Background())

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || ctype != "application/json; charset=utf-8" {
		t.Fatalf("requests: %d %q", len(got), ctype)
	}
	b := got[0]
	if b["host"] != "www.example.com" || b["key"] != "abc12345-key" ||
		b["keyLocation"] != "https://www.example.com/abc12345-key.txt" {
		t.Fatalf("body: %v", b)
	}
	list, _ := b["urlList"].([]any)
	want := []string{"https://www.example.com/knowledge/%E0%B8%AA%E0%B8%A7%E0%B8%B1%E0%B8%AA%E0%B8%94%E0%B8%B5",
		"https://www.example.com/knowledge", "https://www.example.com/a"}
	if len(list) != len(want) {
		t.Fatalf("urlList: %v", list)
	}
	for i, u := range want {
		if list[i] != u {
			t.Fatalf("urlList[%d] = %v want %s", i, list[i], u)
		}
	}
}

func TestIndexNowDisabledAndFailures(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	for _, n := range []*IndexNow{NewIndexNow("", "https://www.example.com", log), NewIndexNow("abc12345", "", log)} {
		if n.Enabled() {
			t.Fatal("must be disabled without key and base URL")
		}
		n.Endpoint = srv.URL
		n.Submit("/knowledge/a")
		n.Wait(context.Background())
	}
	if calls != 0 {
		t.Fatalf("disabled notifier sent %d requests", calls)
	}

	// Errors are logged only; Submit never blocks the caller.
	n := NewIndexNow("abc12345", "https://www.example.com", log)
	n.Endpoint = srv.URL
	start := time.Now()
	n.Submit("/knowledge/a")
	if time.Since(start) > time.Second {
		t.Fatal("Submit blocked")
	}
	n.Wait(context.Background())
	if calls != 1 {
		t.Fatalf("calls: %d", calls)
	}
	if !ValidIndexNowKey("abc12345") || ValidIndexNowKey("short") || ValidIndexNowKey("bad key!") {
		t.Fatal("key validation")
	}
}
