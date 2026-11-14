package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// TurnstileURL is Cloudflare's siteverify endpoint.
const TurnstileURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// Turnstile verifies Cloudflare Turnstile tokens (HumanVerifier).
type Turnstile struct {
	Secret string
	URL    string
	Client *http.Client
	Log    *slog.Logger
}

func NewTurnstile(secret string, log *slog.Logger) *Turnstile {
	return &Turnstile{Secret: secret, URL: TurnstileURL, Client: &http.Client{Timeout: 5 * time.Second}, Log: log}
}

// Verify fails closed: network errors and malformed answers reject.
func (t *Turnstile) Verify(ctx context.Context, token, ip string) bool {
	token = strings.TrimSpace(token)
	if token == "" || len(token) > 2048 {
		return false
	}
	form := url.Values{"secret": {t.Secret}, "response": {token}}
	if ip != "" {
		form.Set("remoteip", ip)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.URL, strings.NewReader(form.Encode()))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := t.Client.Do(req)
	if err != nil {
		t.Log.Warn("turnstile verify failed", "err", err)
		return false
	}
	defer resp.Body.Close()
	var out struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, resp.Body, 64<<10)).Decode(&out); err != nil {
		return false
	}
	return out.Success
}
