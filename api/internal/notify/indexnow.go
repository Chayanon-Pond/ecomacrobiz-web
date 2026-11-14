package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// IndexNowEndpoint is the shared IndexNow API (forwards to Bing, Yandex, ...).
const IndexNowEndpoint = "https://api.indexnow.org/indexnow"

var indexNowKeyRe = regexp.MustCompile(`^[a-zA-Z0-9-]{8,128}$`)

// ValidIndexNowKey reports whether key is a valid IndexNow key (8-128 of
// a-z, A-Z, 0-9 and '-').
func ValidIndexNowKey(key string) bool { return indexNowKeyRe.MatchString(key) }

// IndexNow submits changed URLs fire-and-forget. It is a no-op when the key
// or the site base URL is unset. Failures are logged, never returned.
type IndexNow struct {
	Endpoint string
	Key      string
	BaseURL  string // public web origin, e.g. https://www.example.com
	Client   *http.Client
	Log      *slog.Logger
	host     string
	wg       sync.WaitGroup
}

func NewIndexNow(key, baseURL string, log *slog.Logger) *IndexNow {
	n := &IndexNow{Endpoint: IndexNowEndpoint, Key: key, BaseURL: strings.TrimRight(baseURL, "/"), Log: log,
		Client: &http.Client{Timeout: 10 * time.Second}}
	if u, err := url.Parse(n.BaseURL); err == nil {
		n.host = u.Host
	}
	return n
}

func (n *IndexNow) Enabled() bool { return n.Key != "" && n.host != "" }

// absolute turns a site path into an absolute URL; absolute URLs are kept
// only when they are on the site's host (IndexNow rejects other hosts).
func (n *IndexNow) absolute(raw string) string {
	if strings.HasPrefix(raw, "/") && !strings.HasPrefix(raw, "//") {
		return n.BaseURL + (&url.URL{Path: raw}).EscapedPath()
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || !strings.EqualFold(u.Host, n.host) {
		return ""
	}
	return u.String()
}

// Submit accepts site paths ("/knowledge/x") or absolute URLs on the site.
func (n *IndexNow) Submit(urls ...string) {
	if !n.Enabled() {
		return
	}
	var list []string
	for _, raw := range urls {
		if a := n.absolute(raw); a != "" && !slices.Contains(list, a) {
			list = append(list, a)
		}
	}
	if len(list) == 0 {
		return
	}
	n.wg.Add(1)
	go func() {
		defer n.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := n.send(ctx, list); err != nil {
			n.Log.Warn("indexnow submit failed", "urls", len(list), "err", err)
			return
		}
		n.Log.Info("indexnow submitted", "urls", list)
	}()
}

func (n *IndexNow) send(ctx context.Context, list []string) error {
	body, _ := json.Marshal(map[string]any{"host": n.host, "key": n.Key,
		"keyLocation": n.BaseURL + "/" + n.Key + ".txt", "urlList": list})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.Endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := n.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// 200 OK and 202 Accepted (key validation pending) are both success.
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}

// Wait blocks until in-flight submissions finish or ctx is done.
func (n *IndexNow) Wait(ctx context.Context) {
	done := make(chan struct{})
	go func() { n.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
}
