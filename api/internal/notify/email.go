package notify

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type EmailConfig struct {
	Host     string
	Port     int // 587 = STARTTLS (required), 465 = implicit TLS, 25/1025 = STARTTLS if offered
	Username string
	Password string
	From     string
	To       []string
}

// Email sends the lead summary over SMTP. STARTTLS is mandatory on every port
// except 465 (implicit TLS) and localhost relays used in development.
type Email struct {
	cfg EmailConfig
	// tlsConfig is overridable in tests.
	tlsConfig *tls.Config
}

func NewEmail(cfg EmailConfig) *Email {
	return &Email{cfg: cfg, tlsConfig: &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12}}
}

func (e *Email) Name() string { return "email" }

func (e *Email) NotifyLead(ctx context.Context, lead domain.Lead) error {
	name := strings.TrimSpace(lead.FirstName + " " + lead.LastName)
	subject := "ผู้ติดต่อใหม่: " + name
	if lead.Company != "" {
		subject += " (" + lead.Company + ")"
	}
	msg, err := BuildMessage(e.cfg.From, e.cfg.To, lead.Email, subject, LeadText(lead), time.Now())
	if err != nil {
		return err
	}
	return e.send(ctx, msg)
}

// BuildMessage renders an RFC 5322 UTF-8 message with base64 body; header
// values are stripped of CR/LF to prevent header injection.
func BuildMessage(from string, to []string, replyTo, subject, body string, now time.Time) ([]byte, error) {
	fromAddr, err := mail.ParseAddress(from)
	if err != nil {
		return nil, fmt.Errorf("invalid SMTP_FROM: %w", err)
	}
	var b bytes.Buffer
	h := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, stripCRLF(v)) }
	h("From", fromAddr.String())
	h("To", strings.Join(to, ", "))
	if replyTo != "" {
		if a, err := mail.ParseAddress(replyTo); err == nil {
			h("Reply-To", a.String())
		}
	}
	h("Subject", mime.BEncoding.Encode("UTF-8", stripCRLF(subject)))
	h("Date", now.Format(time.RFC1123Z))
	h("Message-ID", "<"+randomHex(16)+"@"+domainOf(fromAddr.Address)+">")
	h("MIME-Version", "1.0")
	h("Content-Type", `text/plain; charset="UTF-8"`)
	h("Content-Transfer-Encoding", "base64")
	b.WriteString("\r\n")
	enc := base64.StdEncoding.EncodeToString([]byte(body))
	for len(enc) > 76 {
		b.WriteString(enc[:76] + "\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc + "\r\n")
	return b.Bytes(), nil
}

func (e *Email) send(ctx context.Context, msg []byte) error {
	addr := net.JoinHostPort(e.cfg.Host, strconv.Itoa(e.cfg.Port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	var err error
	if e.cfg.Port == 465 {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: e.tlsConfig}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("smtp dial: %w", err)
	}
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	c, err := smtp.NewClient(conn, e.cfg.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp handshake: %w", err)
	}
	defer c.Close()
	if e.cfg.Port != 465 {
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(e.tlsConfig); err != nil {
				return fmt.Errorf("smtp starttls: %w", err)
			}
		} else if !isLocalHost(e.cfg.Host) {
			return errors.New("smtp server does not offer STARTTLS; refusing to send credentials in clear text")
		}
	}
	if e.cfg.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", e.cfg.Username, e.cfg.Password, e.cfg.Host)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	from, _ := mail.ParseAddress(e.cfg.From)
	if err := c.Mail(from.Address); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	for _, rcpt := range e.cfg.To {
		a, err := mail.ParseAddress(rcpt)
		if err != nil {
			return fmt.Errorf("invalid SMTP_TO %q: %w", rcpt, err)
		}
		if err := c.Rcpt(a.Address); err != nil {
			return fmt.Errorf("smtp RCPT TO: %w", err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp data close: %w", err)
	}
	return c.Quit()
}

func isLocalHost(h string) bool {
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func stripCRLF(s string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(s)
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func domainOf(addr string) string {
	if i := strings.LastIndexByte(addr, '@'); i >= 0 {
		return addr[i+1:]
	}
	return "localhost"
}
