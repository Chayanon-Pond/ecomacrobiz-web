package config

import (
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestDefaults(t *testing.T) {
	c, err := LoadFrom(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != 8080 || c.AppEnv != "development" || !c.CookieSecure || c.SessionTTL != 24*time.Hour ||
		c.MaxUploadBytes != 8<<20 || c.ContactRateLimit != (RateLimit{5, 10 * time.Minute}) ||
		c.LoginRateLimit != (RateLimit{10, 15 * time.Minute}) || c.PublicBaseURL != "http://localhost:8080" ||
		c.SMTPEnabled() || c.LineEnabled() || c.MigrateOnStart {
		t.Fatalf("defaults: %+v", c)
	}
	if c.RequireDB() == nil {
		t.Error("RequireDB should fail without DATABASE_URL")
	}
}

func TestParse(t *testing.T) {
	c, err := LoadFrom(env(map[string]string{
		"PORT": "9090", "CORS_ALLOWED_ORIGINS": "https://ecomacrobiz.com, http://localhost:3100/",
		"TRUSTED_PROXIES": "127.0.0.1, 10.0.0.0/8", "CONTACT_RATE_LIMIT": "3/1h", "SMTP_HOST": "smtp.example.com",
		"SMTP_FROM": "Site <noreply@example.com>", "SMTP_TO": "a@example.com,b@example.com", "LOG_LEVEL": "debug",
		"ADMIN_EMAIL": "Admin@Example.com", "ADMIN_PASSWORD": "twelve-chars!", "PUBLIC_BASE_URL": "https://api.x.com/",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != 9090 || len(c.CORSAllowedOrigins) != 2 || c.CORSAllowedOrigins[1] != "http://localhost:3100" ||
		len(c.TrustedProxies) != 2 || c.ContactRateLimit.Events != 3 || c.ContactRateLimit.Per != time.Hour ||
		!c.SMTPEnabled() || len(c.SMTPTo) != 2 || c.AdminEmail != "admin@example.com" ||
		c.PublicBaseURL != "https://api.x.com" {
		t.Fatalf("parsed: %+v", c)
	}
}

func TestInvalid(t *testing.T) {
	cases := map[string]map[string]string{
		"PORT":                 {"PORT": "abc"},
		"LOG_LEVEL":            {"LOG_LEVEL": "loud"},
		"CORS_ALLOWED_ORIGINS": {"CORS_ALLOWED_ORIGINS": "ecomacrobiz.com"},
		"TRUSTED_PROXIES":      {"TRUSTED_PROXIES": "not-an-ip"},
		"CONTACT_RATE_LIMIT":   {"CONTACT_RATE_LIMIT": "five"},
		"ADMIN_PASSWORD":       {"ADMIN_EMAIL": "a@b.co", "ADMIN_PASSWORD": "short"},
		"ADMIN_EMAIL":          {"ADMIN_EMAIL": "a@b.co"},
		"REVALIDATE_SECRET":    {"WEB_REVALIDATE_URL": "http://web/api/revalidate"},
		"COOKIE_SECURE":        {"APP_ENV": "production", "COOKIE_SECURE": "false", "CORS_ALLOWED_ORIGINS": "https://x.com"},
		"SESSION_TTL":          {"SESSION_TTL": "1s"},
	}
	for key, m := range cases {
		_, err := LoadFrom(env(m))
		if err == nil || !strings.Contains(err.Error(), key) {
			t.Errorf("%s: err = %v", key, err)
		}
	}
}

func TestParseRateLimit(t *testing.T) {
	if r, err := ParseRateLimit("5/10m"); err != nil || r.Events != 5 || r.Per != 10*time.Minute {
		t.Fatalf("%+v %v", r, err)
	}
	for _, bad := range []string{"5", "0/1m", "-1/1m", "5/0s", "5/abc", "x/1m"} {
		if _, err := ParseRateLimit(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}
