// Package config loads and validates the server configuration from the
// environment. Every variable is documented in api/.env.example.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type RateLimit struct {
	Events int
	Per    time.Duration
}

func (r RateLimit) String() string { return fmt.Sprintf("%d/%s", r.Events, r.Per) }

type Config struct {
	Port        int
	DatabaseURL string
	AppEnv      string // development | production | test
	LogLevel    slog.Level

	CORSAllowedOrigins []string
	TrustedProxies     []string
	HSTSEnabled        bool

	CookieSecure bool
	CookieDomain string
	SessionTTL   time.Duration

	// InviteTTL is the lifetime of invitation and password-reset links.
	InviteTTL time.Duration
	// WebBaseURL (optional) is the public web origin used to build the links
	// e-mailed for invitations/resets: <WebBaseURL>/admin/invite#token=...
	WebBaseURL string

	PublicBaseURL  string
	MediaDir       string
	MaxUploadBytes int64
	// MediaMaxDimension: uploaded JPEG/PNG are downscaled so the longest
	// side is at most this many pixels.
	MediaMaxDimension int

	// SchedulerInterval: how often scheduled posts are checked (min 5s).
	SchedulerInterval time.Duration

	ContactRateLimit RateLimit
	LoginRateLimit   RateLimit

	SMTPHost     string
	SMTPPort     int
	SMTPUsername string
	SMTPPassword string
	SMTPFrom     string
	SMTPTo       []string

	ResendAPIKey string

	LineChannelAccessToken string
	LineTo                 string

	WebRevalidateURL string
	RevalidateSecret string

	AdminEmail         string
	AdminPassword      string
	AdminName          string
	AdminResetPassword bool

	MigrateOnStart  bool
	ShutdownTimeout time.Duration
}

const MinPasswordLen = 12

func (c *Config) IsProduction() bool { return c.AppEnv == "production" }

// Load reads the environment. Use LoadFrom in tests.
func Load() (*Config, error) { return LoadFrom(os.Getenv) }

func LoadFrom(getenv func(string) string) (*Config, error) {
	e := &envReader{get: getenv}
	c := &Config{
		Port:               e.int("PORT", 8080),
		DatabaseURL:        e.str("DATABASE_URL", ""),
		AppEnv:             strings.ToLower(e.str("APP_ENV", "development")),
		CORSAllowedOrigins: e.list("CORS_ALLOWED_ORIGINS"),
		TrustedProxies:     e.list("TRUSTED_PROXIES"),
		HSTSEnabled:        e.bool("HSTS_ENABLED", false),
		CookieSecure:       e.bool("COOKIE_SECURE", true),
		CookieDomain:       e.str("COOKIE_DOMAIN", ""),
		SessionTTL:         e.duration("SESSION_TTL", 24*time.Hour),
		InviteTTL:          e.duration("INVITE_TTL", 72*time.Hour),
		WebBaseURL:         strings.TrimRight(e.str("WEB_BASE_URL", ""), "/"),
		PublicBaseURL:      strings.TrimRight(e.str("PUBLIC_BASE_URL", "http://localhost:8080"), "/"),
		MediaDir:           e.str("MEDIA_DIR", "./data/media"),
		MaxUploadBytes:     int64(e.int("MAX_UPLOAD_MB", 8)) << 20,
		MediaMaxDimension:  e.int("MEDIA_MAX_DIMENSION", 2560),
		SchedulerInterval:  e.duration("SCHEDULER_INTERVAL", 60*time.Second),
		ContactRateLimit:   e.rate("CONTACT_RATE_LIMIT", RateLimit{5, 10 * time.Minute}),
		LoginRateLimit:     e.rate("LOGIN_RATE_LIMIT", RateLimit{10, 15 * time.Minute}),
		SMTPHost:           e.str("SMTP_HOST", ""),
		SMTPPort:           e.int("SMTP_PORT", 587),
		SMTPUsername:       e.str("SMTP_USERNAME", ""),
		SMTPPassword:       e.str("SMTP_PASSWORD", ""),
		SMTPFrom:           e.str("SMTP_FROM", ""),
		SMTPTo:             e.list("SMTP_TO"),

		ResendAPIKey:           e.str("RESEND_API_KEY", ""),
		LineChannelAccessToken: e.str("LINE_CHANNEL_ACCESS_TOKEN", ""),
		LineTo:                 e.str("LINE_TO", ""),
		WebRevalidateURL:       e.str("WEB_REVALIDATE_URL", ""),
		RevalidateSecret:       e.str("REVALIDATE_SECRET", ""),
		AdminEmail:             strings.ToLower(e.str("ADMIN_EMAIL", "")),
		AdminPassword:          e.raw("ADMIN_PASSWORD"),
		AdminName:              e.str("ADMIN_NAME", "Admin"),
		AdminResetPassword:     e.bool("ADMIN_RESET_PASSWORD", false),
		MigrateOnStart:         e.bool("MIGRATE_ON_START", false),
		ShutdownTimeout:        e.duration("SHUTDOWN_TIMEOUT", 20*time.Second),
	}
	lvl := e.str("LOG_LEVEL", "info")
	if err := c.LogLevel.UnmarshalText([]byte(lvl)); err != nil {
		e.fail("LOG_LEVEL", "must be debug, info, warn or error")
	}
	c.validate(e)
	if len(e.errs) > 0 {
		return nil, errors.Join(e.errs...)
	}
	return c, nil
}

func (c *Config) validate(e *envReader) {
	if c.Port < 1 || c.Port > 65535 {
		e.fail("PORT", "must be 1-65535")
	}
	switch c.AppEnv {
	case "development", "production", "test":
	default:
		e.fail("APP_ENV", "must be development, production or test")
	}
	for _, o := range c.CORSAllowedOrigins {
		u, err := url.Parse(o)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || (u.Path != "" && u.Path != "/") {
			e.fail("CORS_ALLOWED_ORIGINS", fmt.Sprintf("%q is not an origin like https://example.com", o))
		}
	}
	for i, o := range c.CORSAllowedOrigins {
		c.CORSAllowedOrigins[i] = strings.TrimRight(o, "/")
	}
	for _, p := range c.TrustedProxies {
		if net.ParseIP(p) == nil {
			if _, _, err := net.ParseCIDR(p); err != nil {
				e.fail("TRUSTED_PROXIES", fmt.Sprintf("%q is not an IP or CIDR", p))
			}
		}
	}
	if u, err := url.Parse(c.PublicBaseURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		e.fail("PUBLIC_BASE_URL", "must be an absolute http(s) URL")
	}
	if c.SessionTTL < time.Minute {
		e.fail("SESSION_TTL", "must be at least 1m")
	}
	if c.InviteTTL < 10*time.Minute || c.InviteTTL > 30*24*time.Hour {
		e.fail("INVITE_TTL", "must be between 10m and 720h")
	}
	if c.WebBaseURL != "" {
		if u, err := url.Parse(c.WebBaseURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
			u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			e.fail("WEB_BASE_URL", "must be an origin like https://www.example.com")
		}
	}
	if c.MaxUploadBytes <= 0 || c.MaxUploadBytes > 100<<20 {
		e.fail("MAX_UPLOAD_MB", "must be 1-100")
	}
	if c.MediaMaxDimension < 320 || c.MediaMaxDimension > 10000 {
		e.fail("MEDIA_MAX_DIMENSION", "must be 320-10000")
	}
	if c.SchedulerInterval < 5*time.Second {
		e.fail("SCHEDULER_INTERVAL", "must be at least 5s")
	}
	if c.MediaDir == "" {
		e.fail("MEDIA_DIR", "must not be empty")
	}
	if c.WebRevalidateURL != "" {
		if u, err := url.Parse(c.WebRevalidateURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			e.fail("WEB_REVALIDATE_URL", "must be an absolute http(s) URL")
		}
		if c.RevalidateSecret == "" {
			e.fail("REVALIDATE_SECRET", "required when WEB_REVALIDATE_URL is set")
		}
	}
	if c.AdminPassword != "" && len(c.AdminPassword) < MinPasswordLen {
		e.fail("ADMIN_PASSWORD", fmt.Sprintf("must be at least %d characters", MinPasswordLen))
	}
	if len(c.AdminPassword) > 72 {
		e.fail("ADMIN_PASSWORD", "must be at most 72 bytes (bcrypt limit)")
	}
	if (c.AdminEmail == "") != (c.AdminPassword == "") {
		e.fail("ADMIN_EMAIL", "ADMIN_EMAIL and ADMIN_PASSWORD must be set together")
	}
	if c.IsProduction() {
		if !c.CookieSecure {
			e.fail("COOKIE_SECURE", "must be true in production")
		}
		if len(c.CORSAllowedOrigins) == 0 {
			e.fail("CORS_ALLOWED_ORIGINS", "required in production")
		}
	}
}

// RequireDB fails when DATABASE_URL is unset; called by commands that need it.
func (c *Config) RequireDB() error {
	if c.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	return nil
}

func (c *Config) SMTPEnabled() bool {
	return c.SMTPHost != "" && c.SMTPFrom != "" && len(c.SMTPTo) > 0
}

// ResendEnabled: e-mail via Resend's HTTPS API (preferred over SMTP when set;
// Railway Hobby blocks outbound SMTP). Reuses SMTP_FROM / SMTP_TO.
func (c *Config) ResendEnabled() bool {
	return c.ResendAPIKey != "" && c.SMTPFrom != "" && len(c.SMTPTo) > 0
}

func (c *Config) LineEnabled() bool { return c.LineChannelAccessToken != "" && c.LineTo != "" }

// EmailProvider is the active e-mail transport: "resend", "smtp" or "".
func (c *Config) EmailProvider() string {
	switch {
	case c.ResendEnabled():
		return "resend"
	case c.SMTPEnabled():
		return "smtp"
	}
	return ""
}

type envReader struct {
	get  func(string) string
	errs []error
}

func (e *envReader) fail(key, msg string) { e.errs = append(e.errs, fmt.Errorf("%s: %s", key, msg)) }

func (e *envReader) raw(key string) string { return e.get(key) }

func (e *envReader) str(key, def string) string {
	if v := strings.TrimSpace(e.get(key)); v != "" {
		return v
	}
	return def
}

func (e *envReader) int(key string, def int) int {
	v := e.str(key, "")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		e.fail(key, "must be an integer")
		return def
	}
	return n
}

func (e *envReader) bool(key string, def bool) bool {
	v := e.str(key, "")
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		e.fail(key, "must be true or false")
		return def
	}
	return b
}

func (e *envReader) duration(key string, def time.Duration) time.Duration {
	v := e.str(key, "")
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		e.fail(key, "must be a Go duration such as 30s, 15m, 24h")
		return def
	}
	return d
}

func (e *envReader) list(key string) []string {
	var out []string
	for _, p := range strings.Split(e.get(key), ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// rate parses "N/duration", e.g. "5/10m".
func (e *envReader) rate(key string, def RateLimit) RateLimit {
	v := e.str(key, "")
	if v == "" {
		return def
	}
	r, err := ParseRateLimit(v)
	if err != nil {
		e.fail(key, err.Error())
		return def
	}
	return r
}

func ParseRateLimit(v string) (RateLimit, error) {
	n, d, ok := strings.Cut(v, "/")
	if !ok {
		return RateLimit{}, errors.New(`must look like "5/10m"`)
	}
	events, err := strconv.Atoi(strings.TrimSpace(n))
	if err != nil || events < 1 {
		return RateLimit{}, errors.New("event count must be a positive integer")
	}
	per, err := time.ParseDuration(strings.TrimSpace(d))
	if err != nil || per <= 0 {
		return RateLimit{}, errors.New("window must be a positive Go duration")
	}
	return RateLimit{Events: events, Per: per}, nil
}
