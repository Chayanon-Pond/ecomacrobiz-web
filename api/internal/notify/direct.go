package notify

import (
	"context"
	"fmt"
	"log/slog"
	"net/mail"
	"sync"
	"time"
)

// DirectSender sends one plain-text e-mail to explicit recipients (used for
// invitation and password-reset links). Implemented by *Email and *Resend.
type DirectSender interface {
	Name() string
	SendTo(ctx context.Context, to []string, subject, body string) error
}

func (e *Email) SendTo(ctx context.Context, to []string, subject, body string) error {
	msg, err := BuildMessage(e.cfg.From, to, "", subject, body, time.Now())
	if err != nil {
		return err
	}
	return e.send(ctx, to, msg)
}

func (r *Resend) SendTo(ctx context.Context, to []string, subject, body string) error {
	from, err := mail.ParseAddress(r.From)
	if err != nil {
		return fmt.Errorf("invalid SMTP_FROM: %w", err)
	}
	rcpts := make([]string, 0, len(to))
	for _, t := range to {
		a, err := mail.ParseAddress(t)
		if err != nil {
			return fmt.Errorf("invalid recipient: %w", err)
		}
		rcpts = append(rcpts, a.Address)
	}
	return r.post(ctx, map[string]any{"from": from.String(), "to": rcpts, "subject": stripCRLF(subject), "text": body})
}

// Mailer sends direct e-mails in the background (like Dispatcher): Send
// never blocks the request and never returns a delivery error. A nil sender
// disables it.
type Mailer struct {
	sender  DirectSender
	timeout time.Duration
	log     *slog.Logger
	wg      sync.WaitGroup
}

func NewMailer(sender DirectSender, log *slog.Logger, timeout time.Duration) *Mailer {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &Mailer{sender: sender, timeout: timeout, log: log}
}

func (m *Mailer) Enabled() bool { return m != nil && m.sender != nil }

// Send queues one e-mail to a single recipient and reports whether it was
// queued (false when disabled). The body may contain secrets (one-time
// links), so neither it nor the recipient is logged.
func (m *Mailer) Send(to, subject, body string) bool {
	if !m.Enabled() {
		return false
	}
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		defer func() {
			if r := recover(); r != nil {
				m.log.Error("direct email panic", "sender", m.sender.Name(), "panic", fmt.Sprint(r))
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), m.timeout)
		defer cancel()
		start := time.Now()
		if err := m.sender.SendTo(ctx, []string{to}, subject, body); err != nil {
			m.log.Error("direct email failed", "sender", m.sender.Name(), "subject", subject, "err", err)
			return
		}
		m.log.Info("direct email sent", "sender", m.sender.Name(), "subject", subject,
			"duration_ms", time.Since(start).Milliseconds())
	}()
	return true
}

// Wait blocks until in-flight e-mails finish or ctx is done.
func (m *Mailer) Wait(ctx context.Context) {
	if m == nil {
		return
	}
	done := make(chan struct{})
	go func() { m.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
		m.log.Warn("shutdown: abandoning in-flight direct emails")
	}
}
