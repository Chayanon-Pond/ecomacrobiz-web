package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

const ResendURL = "https://api.resend.com/emails"

// Resend sends the lead e-mail through Resend's HTTPS API. Use it where
// outbound SMTP is blocked (Railway Free/Trial/Hobby plans block SMTP).
type Resend struct {
	APIKey string
	From   string
	To     []string
	URL    string // defaults to ResendURL; overridable in tests
	Client *http.Client
}

func NewResend(apiKey, from string, to []string) *Resend {
	return &Resend{APIKey: apiKey, From: from, To: to, URL: ResendURL, Client: &http.Client{Timeout: 10 * time.Second}}
}

func (r *Resend) Name() string { return "email-resend" }

func (r *Resend) NotifyLead(ctx context.Context, lead domain.Lead) error {
	from, err := mail.ParseAddress(r.From)
	if err != nil {
		return fmt.Errorf("invalid SMTP_FROM: %w", err)
	}
	to := make([]string, 0, len(r.To))
	for _, rcpt := range r.To {
		a, err := mail.ParseAddress(rcpt)
		if err != nil {
			return fmt.Errorf("invalid SMTP_TO %q: %w", rcpt, err)
		}
		to = append(to, a.Address)
	}
	name := strings.TrimSpace(lead.FirstName + " " + lead.LastName)
	subject := "ผู้ติดต่อใหม่: " + name
	if lead.Company != "" {
		subject += " (" + lead.Company + ")"
	}
	body := map[string]any{
		"from":    from.String(),
		"to":      to,
		"subject": stripCRLF(subject),
		"text":    LeadText(lead),
	}
	if a, err := mail.ParseAddress(lead.Email); err == nil && lead.Email != "" {
		body["reply_to"] = a.Address
	}
	return r.post(ctx, body)
}

func (r *Resend) post(ctx context.Context, body map[string]any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.URL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Idempotency-Key", uuid.NewString())
	resp, err := r.Client.Do(req)
	if err != nil {
		return fmt.Errorf("resend: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("resend: status %d: %s", resp.StatusCode, bytes.TrimSpace(b))
	}
	return nil
}
