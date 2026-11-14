package config

import (
	"strings"
	"testing"
	"time"
)

func TestInviteAndWebBaseURL(t *testing.T) {
	c, err := LoadFrom(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.InviteTTL != 72*time.Hour || c.WebBaseURL != "" || c.EmailProvider() != "" {
		t.Fatalf("defaults: ttl=%v web=%q provider=%q", c.InviteTTL, c.WebBaseURL, c.EmailProvider())
	}
	c, err = LoadFrom(env(map[string]string{"INVITE_TTL": "24h", "WEB_BASE_URL": "https://www.example.com/",
		"SMTP_HOST": "smtp.example.com", "SMTP_FROM": "a@example.com", "SMTP_TO": "b@example.com"}))
	if err != nil || c.InviteTTL != 24*time.Hour || c.WebBaseURL != "https://www.example.com" || c.EmailProvider() != "smtp" {
		t.Fatalf("parse: %+v %v", c, err)
	}
	c, _ = LoadFrom(env(map[string]string{"RESEND_API_KEY": "re_x", "SMTP_HOST": "smtp.example.com",
		"SMTP_FROM": "a@example.com", "SMTP_TO": "b@example.com"}))
	if c.EmailProvider() != "resend" {
		t.Fatalf("resend must win: %q", c.EmailProvider())
	}
	for _, bad := range []map[string]string{
		{"INVITE_TTL": "1m"}, {"INVITE_TTL": "2000h"}, {"INVITE_TTL": "x"},
		{"WEB_BASE_URL": "www.example.com"}, {"WEB_BASE_URL": "https://example.com/admin"},
		{"WEB_BASE_URL": "ftp://example.com"},
	} {
		if _, err := LoadFrom(env(bad)); err == nil {
			t.Errorf("%v accepted", bad)
		} else if !strings.Contains(err.Error(), "INVITE_TTL") && !strings.Contains(err.Error(), "WEB_BASE_URL") {
			t.Errorf("%v: %v", bad, err)
		}
	}
}
