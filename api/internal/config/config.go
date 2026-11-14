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
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/vault"
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

	// IndexNowKey (optional, 8-128 [a-zA-Z0-9-]): with WebBaseURL set, changed
	// post URLs are submitted to IndexNow. The web serves /<key>.txt.
	IndexNowKey string

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

	Members MemberConfig
}

// MemberConfig: community members, Google sign-in and comments.
type MemberConfig struct {
	// DataKey / IndexKey: raw MEMBER_DATA_KEY / MEMBER_INDEX_KEY (validated
	// here, parsed by vault). Empty outside production = ephemeral keys.
	DataKey  string
	IndexKey string

	SessionTTL time.Duration
	// RequireVerifiedEmail gates comments/likes/reports/uploads.
	RequireVerifiedEmail bool
	HoldFirstComment     bool

	RegisterRateLimit  RateLimit
	LoginRateLimit     RateLimit
	CommentRateLimit   RateLimit
	CommentIPRateLimit RateLimit

	CommentImageMaxBytes int64
	AvatarMaxBytes       int64

	TurnstileSecret string

	GoogleClientID     string
	GoogleClientSecret string
	OIDCIssuerURL      string
}

// DefaultOIDCIssuer is Google's issuer; OIDC_ISSUER_URL overrides it only
// for the local stub provider (cmd/oidcstub).
const DefaultOIDCIssuer = "https://accounts.google.com"

func (m MemberConfig) GoogleEnabled() bool { return m.GoogleClientID != "" }

// IssuerOverridden reports whether OIDC_ISSUER_URL points somewhere else
// than Google (only allowed outside production).
func (m MemberConfig) IssuerOverridden() bool { return m.OIDCIssuerURL != DefaultOIDCIssuer }

// GoogleRedirectURL is the OAuth redirect URI registered at Google.
func (c *Config) GoogleRedirectURL() string {
	return c.WebBaseURL + "/api/community/auth/google/callback"
}

// MemberMailEnabled: member verification/reset e-mails need a transport and
// WEB_BASE_URL (to build the links).
func (c *Config) MemberMailEnabled() bool { return c.EmailProvider() != "" && c.WebBaseURL != "" }

const MinPasswordLen = 12

var indexNowKeyRe = regexp.MustCompile(`^[a-zA-Z0-9-]{8,128}$`)

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
		IndexNowKey:        e.str("INDEXNOW_KEY", ""),
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
	c.Members = MemberConfig{
		DataKey:              e.raw("MEMBER_DATA_KEY"),
		IndexKey:             e.raw("MEMBER_INDEX_KEY"),
		SessionTTL:           e.duration("MEMBER_SESSION_TTL", 720*time.Hour),
		RequireVerifiedEmail: e.bool("MEMBER_REQUIRE_VERIFIED_EMAIL", c.MemberMailEnabled()),
		HoldFirstComment:     e.bool("MEMBER_HOLD_FIRST_COMMENT", true),
		RegisterRateLimit:    e.rate("MEMBER_REGISTER_RATE_LIMIT", RateLimit{5, time.Hour}),
		LoginRateLimit:       e.rate("MEMBER_LOGIN_RATE_LIMIT", RateLimit{10, 15 * time.Minute}),
		CommentRateLimit:     e.rate("COMMENT_RATE_LIMIT", RateLimit{6, time.Minute}),
		CommentIPRateLimit:   e.rate("COMMENT_IP_RATE_LIMIT", RateLimit{30, 10 * time.Minute}),
		CommentImageMaxBytes: int64(e.int("COMMENT_IMAGE_MAX_MB", 5)) << 20,
		AvatarMaxBytes:       int64(e.int("AVATAR_MAX_MB", 5)) << 20,
		TurnstileSecret:      e.str("TURNSTILE_SECRET", ""),
		GoogleClientID:       e.str("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:   e.str("GOOGLE_CLIENT_SECRET", ""),
		OIDCIssuerURL:        strings.TrimRight(e.str("OIDC_ISSUER_URL", DefaultOIDCIssuer), "/"),
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
	if c.IndexNowKey != "" && !indexNowKeyRe.MatchString(c.IndexNowKey) {
		e.fail("INDEXNOW_KEY", "must be 8-128 characters of a-z, A-Z, 0-9 or -")
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
	c.validateMembers(e)
	if c.IsProduction() {
		if !c.CookieSecure {
			e.fail("COOKIE_SECURE", "must be true in production")
		}
		if len(c.CORSAllowedOrigins) == 0 {
			e.fail("CORS_ALLOWED_ORIGINS", "required in production")
		}
	}
}

func (c *Config) validateMembers(e *envReader) {
	m := &c.Members
	if m.DataKey != "" {
		if _, err := vault.ParseKeyring(m.DataKey); err != nil {
			e.fail("MEMBER_DATA_KEY", err.Error()+` (one base64 32-byte key, or "id:base64,id:base64")`)
		}
	} else if c.IsProduction() {
		e.fail("MEMBER_DATA_KEY", "required in production (base64 of 32 random bytes)")
	}
	if m.IndexKey != "" {
		if _, err := vault.ParseIndexKey(m.IndexKey); err != nil {
			e.fail("MEMBER_INDEX_KEY", err.Error())
		}
	} else if c.IsProduction() {
		e.fail("MEMBER_INDEX_KEY", "required in production (base64 of 32 random bytes)")
	}
	if m.SessionTTL < time.Hour || m.SessionTTL > 2160*time.Hour {
		e.fail("MEMBER_SESSION_TTL", "must be between 1h and 2160h")
	}
	if m.RequireVerifiedEmail && !c.MemberMailEnabled() {
		e.fail("MEMBER_REQUIRE_VERIFIED_EMAIL", "true needs an e-mail transport (RESEND_API_KEY or SMTP_*) and WEB_BASE_URL")
	}
	if m.CommentImageMaxBytes <= 0 || m.CommentImageMaxBytes > 20<<20 {
		e.fail("COMMENT_IMAGE_MAX_MB", "must be 1-20")
	}
	if m.AvatarMaxBytes <= 0 || m.AvatarMaxBytes > 20<<20 {
		e.fail("AVATAR_MAX_MB", "must be 1-20")
	}
	if (m.GoogleClientID == "") != (m.GoogleClientSecret == "") {
		e.fail("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together")
	}
	if m.GoogleClientID != "" && c.WebBaseURL == "" {
		e.fail("GOOGLE_CLIENT_ID", "Google sign-in needs WEB_BASE_URL (the redirect URI is derived from it)")
	}
	u, err := url.Parse(m.OIDCIssuerURL)
	switch {
	case err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.RawQuery != "" || u.Fragment != "":
		e.fail("OIDC_ISSUER_URL", "must be an absolute URL such as https://accounts.google.com")
	case u.Scheme != "https" && c.IsProduction():
		e.fail("OIDC_ISSUER_URL", "must be https in production")
	case m.IssuerOverridden() && c.IsProduction():
		e.fail("OIDC_ISSUER_URL", "may only be overridden outside production (local stub provider)")
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
