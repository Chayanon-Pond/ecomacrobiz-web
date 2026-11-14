package service

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
)

const testPassword = "correct-horse-battery"

func newAuth(t *testing.T) (*AuthService, *fake.Store) {
	t.Helper()
	store := fake.New()
	svc := NewAuthService(store.AdminUsersRepo(), store.SessionsRepo(), time.Hour, bcrypt.MinCost, discard)
	if _, err := svc.EnsureAdmin(context.Background(), "Admin@Example.com", testPassword, "Admin", false); err != nil {
		t.Fatal(err)
	}
	return svc, store
}

func TestLoginAndAuthenticate(t *testing.T) {
	svc, store := newAuth(t)
	ctx := context.Background()
	res, err := svc.Login(ctx, " admin@EXAMPLE.com ", testPassword, RequestMeta{IP: "1.2.3.4"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Token == "" || res.CSRFToken == "" || res.Token == res.CSRFToken || res.User.Email != "admin@example.com" {
		t.Fatalf("result: %+v", res)
	}
	user, _ := store.AdminUsersRepo().GetByEmail(ctx, "admin@example.com")
	if !bytes.HasPrefix([]byte(user.PasswordHash), []byte("$2")) {
		t.Fatal("password must be bcrypt-hashed")
	}
	if user.LastLoginAt == nil {
		t.Error("last_login_at not set")
	}
	sess, u, err := svc.Authenticate(ctx, res.Token)
	if err != nil || u.ID != user.ID || sess.CSRFToken != res.CSRFToken {
		t.Fatalf("authenticate: %v", err)
	}
	if bytes.Equal(sess.TokenHash, []byte(res.Token)) || !bytes.Equal(sess.TokenHash, HashToken(res.Token)) {
		t.Fatal("only the SHA-256 of the token may be stored")
	}
	if _, _, err := svc.Authenticate(ctx, res.Token+"x"); !errors.Is(err, domain.ErrUnauthorized) {
		t.Fatalf("tampered token: %v", err)
	}
	if err := svc.Logout(ctx, res.Token, domain.Actor{}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Authenticate(ctx, res.Token); !errors.Is(err, domain.ErrUnauthorized) {
		t.Fatal("session must be gone after logout")
	}
}

func TestLoginFailures(t *testing.T) {
	svc, store := newAuth(t)
	ctx := context.Background()
	for _, tc := range []struct{ email, pw string }{
		{"admin@example.com", "wrong-password-123"},
		{"nobody@example.com", testPassword},
		{"admin@example.com", string(bytes.Repeat([]byte("a"), 100))},
	} {
		if _, err := svc.Login(ctx, tc.email, tc.pw, RequestMeta{}); !errors.Is(err, domain.ErrUnauthorized) {
			t.Errorf("login(%s): %v", tc.email, err)
		}
	}
	if _, err := svc.Login(ctx, "", "", RequestMeta{}); len(fieldErrs(t, err)) != 2 {
		t.Errorf("empty login: %v", err)
	}
	u, _ := store.AdminUsersRepo().GetByEmail(ctx, "admin@example.com")
	store.SetActive(u.ID, false)
	if _, err := svc.Login(ctx, "admin@example.com", testPassword, RequestMeta{}); !errors.Is(err, domain.ErrUnauthorized) {
		t.Error("inactive user must not log in")
	}
}

func TestSessionExpiry(t *testing.T) {
	svc, store := newAuth(t)
	ctx := context.Background()
	start := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	svc.Now = func() time.Time { return start }
	res, err := svc.Login(ctx, "admin@example.com", testPassword, RequestMeta{})
	if err != nil {
		t.Fatal(err)
	}
	if !res.ExpiresAt.Equal(start.Add(time.Hour)) {
		t.Fatalf("expires_at = %v", res.ExpiresAt)
	}
	svc.Now = func() time.Time { return start.Add(59 * time.Minute) }
	if _, _, err := svc.Authenticate(ctx, res.Token); err != nil {
		t.Fatalf("before expiry: %v", err)
	}
	svc.Now = func() time.Time { return start.Add(time.Hour) }
	if _, _, err := svc.Authenticate(ctx, res.Token); !errors.Is(err, domain.ErrUnauthorized) {
		t.Fatalf("at expiry: %v", err)
	}
	if n, _ := svc.PurgeExpiredSessions(ctx); n != 1 || store.SessionCount() != 0 {
		t.Fatalf("purge: %d", n)
	}
}

func TestCSRFEqual(t *testing.T) {
	tok, _ := RandomToken()
	if !CSRFEqual(tok, tok) {
		t.Error("equal tokens")
	}
	if CSRFEqual(tok, tok[:len(tok)-1]) || CSRFEqual(tok, tok+"a") || CSRFEqual("", "") || CSRFEqual(tok, "") {
		t.Error("mismatch accepted")
	}
}

func TestEnsureAdmin(t *testing.T) {
	svc, store := newAuth(t)
	ctx := context.Background()
	before, _ := store.AdminUsersRepo().GetByEmail(ctx, "admin@example.com")

	out, err := svc.EnsureAdmin(ctx, "admin@example.com", "another-password-1", "Renamed", false)
	if err != nil || out != "exists" {
		t.Fatalf("exists: %s %v", out, err)
	}
	after, _ := store.AdminUsersRepo().GetByEmail(ctx, "admin@example.com")
	if after.PasswordHash != before.PasswordHash {
		t.Fatal("password must not be overwritten without ADMIN_RESET_PASSWORD")
	}
	if after.Name != "Renamed" {
		t.Error("name should sync")
	}

	res, _ := svc.Login(ctx, "admin@example.com", testPassword, RequestMeta{})
	out, err = svc.EnsureAdmin(ctx, "admin@example.com", "another-password-1", "Renamed", true)
	if err != nil || out != "password_reset" {
		t.Fatalf("reset: %s %v", out, err)
	}
	if _, err := svc.Login(ctx, "admin@example.com", "another-password-1", RequestMeta{}); err != nil {
		t.Fatalf("login with new password: %v", err)
	}
	if _, _, err := svc.Authenticate(ctx, res.Token); err == nil {
		t.Error("reset must revoke existing sessions")
	}

	if _, err := svc.EnsureAdmin(ctx, "new@example.com", "short", "", false); err == nil {
		t.Error("password < 12 chars must be rejected")
	}
	if _, err := svc.EnsureAdmin(ctx, "not-an-email", testPassword, "", false); err == nil {
		t.Error("invalid email must be rejected")
	}
}
