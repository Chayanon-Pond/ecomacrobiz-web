package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

const LinePushURL = "https://api.line.me/v2/bot/message/push"

// Line pushes a text message via the LINE Messaging API (LINE Notify was
// discontinued in 2025). To is a user, group or room id.
type Line struct {
	Token  string
	To     string
	URL    string // defaults to LinePushURL; overridable in tests
	Client *http.Client
}

func NewLine(token, to string) *Line {
	return &Line{Token: token, To: to, URL: LinePushURL, Client: &http.Client{Timeout: 10 * time.Second}}
}

func (l *Line) Name() string { return "line" }

const lineMaxText = 5000

func (l *Line) NotifyLead(ctx context.Context, lead domain.Lead) error {
	text := []rune(LeadText(lead))
	if len(text) > lineMaxText {
		text = append(text[:lineMaxText-1], '…')
	}
	payload, err := json.Marshal(map[string]any{
		"to":       l.To,
		"messages": []map[string]string{{"type": "text", "text": string(text)}},
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, l.URL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+l.Token)
	// Lets LINE de-duplicate if this request is ever retried.
	req.Header.Set("X-Line-Retry-Key", uuid.NewString())
	resp, err := l.Client.Do(req)
	if err != nil {
		return fmt.Errorf("line push: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("line push: status %d: %s", resp.StatusCode, bytes.TrimSpace(body))
	}
	return nil
}
