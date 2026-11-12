package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// Revalidator calls the Next.js on-demand revalidation webhook
// (WEB_REVALIDATE_URL) fire-and-forget. A zero URL makes it a logged no-op.
type Revalidator struct {
	URL    string
	Secret string
	Client *http.Client
	Log    *slog.Logger
	wg     sync.WaitGroup
}

func NewRevalidator(url, secret string, log *slog.Logger) *Revalidator {
	return &Revalidator{URL: url, Secret: secret, Log: log, Client: &http.Client{Timeout: 5 * time.Second}}
}

func (r *Revalidator) Revalidate(tags ...string) {
	if r.URL == "" {
		r.Log.Debug("revalidate skipped: WEB_REVALIDATE_URL unset", "tags", tags)
		return
	}
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if err := r.send(ctx, tags); err != nil {
			r.Log.Warn("revalidate webhook failed", "tags", tags, "err", err)
			return
		}
		r.Log.Info("revalidate webhook sent", "tags", tags)
	}()
}

func (r *Revalidator) send(ctx context.Context, tags []string) error {
	body, _ := json.Marshal(map[string][]string{"tags": tags})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-revalidate-secret", r.Secret)
	resp, err := r.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}

// Wait blocks until in-flight webhooks finish or ctx is done.
func (r *Revalidator) Wait(ctx context.Context) {
	done := make(chan struct{})
	go func() { r.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
}
