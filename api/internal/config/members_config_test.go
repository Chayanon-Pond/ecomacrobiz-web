package config

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

var key32 = base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))

func merge(ms ...map[string]string) map[string]string {
	out := map[string]string{}
	for _, m := range ms {
		for k, v := range m {
			out[k] = v
		}
	}
	return out
}

func TestMemberConfigDefaults(t *testing.T) {
	c, err := LoadFrom(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	m := c.Members
	if m.SessionTTL != 720*time.Hour || m.RequireVerifiedEmail || !m.HoldFirstComment || m.GoogleEnabled() ||
		m.RegisterRateLimit != (RateLimit{5, time.Hour}) || m.LoginRateLimit != (RateLimit{10, 15 * time.Minute}) ||
		m.CommentRateLimit != (RateLimit{6, time.Minute}) || m.CommentIPRateLimit != (RateLimit{30, 10 * time.Minute}) ||
		m.CommentImageMaxBytes != 5<<20 || m.AvatarMaxBytes != 5<<20 || m.OIDCIssuerURL != DefaultOIDCIssuer ||
		m.IssuerOverridden() {
		t.Fatalf("defaults: %+v", m)
	}
	// verified-e-mail gate defaults on when mail can be sent
	mail := map[string]string{"RESEND_API_KEY": "re_x", "SMTP_FROM": "a@example.com", "SMTP_TO": "b@example.com",
		"WEB_BASE_URL": "https://www.example.com"}
	c, err = LoadFrom(env(mail))
	if err != nil || !c.Members.RequireVerifiedEmail || !c.MemberMailEnabled() {
		t.Fatalf("with transport: %v %+v", err, c.Members)
	}
	c, _ = LoadFrom(env(merge(mail, map[string]string{"MEMBER_REQUIRE_VERIFIED_EMAIL": "false"})))
	if c.Members.RequireVerifiedEmail {
		t.Fatal("explicit false must win")
	}
	c, err = LoadFrom(env(merge(mail, map[string]string{"GOOGLE_CLIENT_ID": "id", "GOOGLE_CLIENT_SECRET": "s"})))
	if err != nil || !c.Members.GoogleEnabled() ||
		c.GoogleRedirectURL() != "https://www.example.com/api/community/auth/google/callback" {
		t.Fatalf("google: %v %s", err, c.GoogleRedirectURL())
	}
	// the stub issuer is fine outside production
	c, err = LoadFrom(env(map[string]string{"OIDC_ISSUER_URL": "http://127.0.0.1:18090/"}))
	if err != nil || c.Members.OIDCIssuerURL != "http://127.0.0.1:18090" || !c.Members.IssuerOverridden() {
		t.Fatalf("stub issuer: %v", err)
	}
}

func TestMemberConfigRejects(t *testing.T) {
	prod := map[string]string{"APP_ENV": "production", "CORS_ALLOWED_ORIGINS": "https://www.example.com",
		"MEMBER_DATA_KEY": key32, "MEMBER_INDEX_KEY": key32}
	if _, err := LoadFrom(env(prod)); err != nil {
		t.Fatalf("valid production config rejected: %v", err)
	}
	if _, err := LoadFrom(env(merge(prod, map[string]string{"MEMBER_DATA_KEY": "2:" + key32 + ",1:" + key32}))); err != nil {
		t.Fatalf("rotation spec rejected: %v", err)
	}
	cases := []struct {
		vars map[string]string
		key  string
	}{
		{merge(prod, map[string]string{"MEMBER_DATA_KEY": ""}), "MEMBER_DATA_KEY"},
		{merge(prod, map[string]string{"MEMBER_INDEX_KEY": ""}), "MEMBER_INDEX_KEY"},
		{map[string]string{"MEMBER_DATA_KEY": "c2hvcnQ="}, "MEMBER_DATA_KEY"},
		{map[string]string{"MEMBER_DATA_KEY": "0:" + key32}, "MEMBER_DATA_KEY"},
		{map[string]string{"MEMBER_INDEX_KEY": "not base64!"}, "MEMBER_INDEX_KEY"},
		{map[string]string{"MEMBER_SESSION_TTL": "30m"}, "MEMBER_SESSION_TTL"},
		{map[string]string{"MEMBER_SESSION_TTL": "3000h"}, "MEMBER_SESSION_TTL"},
		{map[string]string{"MEMBER_REQUIRE_VERIFIED_EMAIL": "true"}, "MEMBER_REQUIRE_VERIFIED_EMAIL"},
		{map[string]string{"COMMENT_RATE_LIMIT": "x"}, "COMMENT_RATE_LIMIT"},
		{map[string]string{"AVATAR_MAX_MB": "0"}, "AVATAR_MAX_MB"},
		{map[string]string{"GOOGLE_CLIENT_ID": "id", "WEB_BASE_URL": "https://w.example.com"}, "GOOGLE_CLIENT_ID"},
		{map[string]string{"GOOGLE_CLIENT_ID": "id", "GOOGLE_CLIENT_SECRET": "s"}, "GOOGLE_CLIENT_ID"},
		{map[string]string{"OIDC_ISSUER_URL": "accounts.google.com"}, "OIDC_ISSUER_URL"},
		{merge(prod, map[string]string{"OIDC_ISSUER_URL": "http://127.0.0.1:18090"}), "OIDC_ISSUER_URL"},
		{merge(prod, map[string]string{"OIDC_ISSUER_URL": "https://idp.example.com"}), "OIDC_ISSUER_URL"},
	}
	for _, c := range cases {
		_, err := LoadFrom(env(c.vars))
		if err == nil || !strings.Contains(err.Error(), c.key) {
			t.Errorf("%v: want %s error, got %v", c.vars, c.key, err)
		}
	}
}
