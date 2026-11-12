// Package notify delivers new-lead notifications (SMTP email, LINE Messaging
// API push) and the web revalidation webhook. All delivery is asynchronous so
// an HTTP request never blocks or fails because of a notification channel.
package notify

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// Notifier delivers a lead notification over one channel.
type Notifier interface {
	Name() string
	NotifyLead(ctx context.Context, lead domain.Lead) error
}

// Dispatcher fans a lead out to every configured notifier in the background.
type Dispatcher struct {
	notifiers []Notifier
	timeout   time.Duration
	log       *slog.Logger
	wg        sync.WaitGroup
}

func NewDispatcher(log *slog.Logger, timeout time.Duration, notifiers ...Notifier) *Dispatcher {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &Dispatcher{notifiers: notifiers, timeout: timeout, log: log}
}

// LeadCreated returns immediately; each notifier runs in its own goroutine
// with its own timeout. Failures are logged, never returned.
func (d *Dispatcher) LeadCreated(lead domain.Lead) {
	if len(d.notifiers) == 0 {
		d.log.Info("lead notification skipped: no notifier configured", "lead_id", lead.ID)
		return
	}
	for _, n := range d.notifiers {
		d.wg.Add(1)
		go func(n Notifier) {
			defer d.wg.Done()
			defer func() {
				if r := recover(); r != nil {
					d.log.Error("notifier panic", "notifier", n.Name(), "lead_id", lead.ID, "panic", fmt.Sprint(r))
				}
			}()
			ctx, cancel := context.WithTimeout(context.Background(), d.timeout)
			defer cancel()
			start := time.Now()
			if err := n.NotifyLead(ctx, lead); err != nil {
				d.log.Error("lead notification failed", "notifier", n.Name(), "lead_id", lead.ID, "err", err)
				return
			}
			d.log.Info("lead notification sent", "notifier", n.Name(), "lead_id", lead.ID,
				"duration_ms", time.Since(start).Milliseconds())
		}(n)
	}
}

// Wait blocks until in-flight notifications finish or ctx is done.
func (d *Dispatcher) Wait(ctx context.Context) {
	done := make(chan struct{})
	go func() { d.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
		d.log.Warn("shutdown: abandoning in-flight notifications")
	}
}

var bangkok = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Bangkok"); err == nil {
		return loc
	}
	return time.FixedZone("ICT", 7*3600)
}()

var channelLabels = map[domain.Channel]string{
	domain.ChannelEmail: "อีเมล",
	domain.ChannelLine:  "LINE",
	domain.ChannelPhone: "โทรศัพท์",
}

// LeadText renders a plain-text Thai summary used by both email and LINE.
func LeadText(l domain.Lead) string {
	var b strings.Builder
	name := strings.TrimSpace(l.FirstName + " " + l.LastName)
	fmt.Fprintf(&b, "มีผู้ติดต่อใหม่จากเว็บไซต์ ECOMACROBIZ\n\n")
	line := func(label, v string) {
		if v != "" {
			fmt.Fprintf(&b, "%s: %s\n", label, v)
		}
	}
	line("ชื่อ", name)
	line("บริษัท", l.Company)
	line("โทรศัพท์", l.Phone)
	line("อีเมล", l.Email)
	line("LINE ID", l.LineID)
	line("ช่องทางที่สะดวก", channelLabels[l.PreferredChannel])
	when := strings.TrimSpace(l.PreferredDate + " " + l.PreferredTime)
	line("วัน/เวลาที่สะดวก", when)
	line("หน้าที่ส่ง", l.SourcePage)
	if !l.CreatedAt.IsZero() {
		line("เวลาที่ส่ง", l.CreatedAt.In(bangkok).Format("2006-01-02 15:04")+" (เวลาไทย)")
	}
	if l.Message != "" {
		fmt.Fprintf(&b, "\nข้อความ:\n%s\n", l.Message)
	}
	fmt.Fprintf(&b, "\nรหัสอ้างอิง: %s\n", l.ID)
	return b.String()
}
