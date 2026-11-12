package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

const (
	MinPasswordLen = 12
	MaxPasswordLen = 72 // bcrypt limit (bytes)
	DefaultBcrypt  = 12
)

type AuthService struct {
	users     repository.AdminUsers
	sessions  repository.Sessions
	ttl       time.Duration
	cost      int
	dummyHash []byte
	log       *slog.Logger
	Now       func() time.Time
}

// NewAuthService; cost <= 0 uses DefaultBcrypt (tests pass bcrypt.MinCost).
func NewAuthService(users repository.AdminUsers, sessions repository.Sessions, ttl time.Duration, cost int,
	log *slog.Logger) *AuthService {
	if cost <= 0 {
		cost = DefaultBcrypt
	}
	// Compared against when the email is unknown so response timing does not
	// reveal which accounts exist.
	dummy, _ := bcrypt.GenerateFromPassword([]byte("timing-equaliser-not-a-password"), cost)
	return &AuthService{users: users, sessions: sessions, ttl: ttl, cost: cost, dummyHash: dummy, log: log, Now: time.Now}
}

func (s *AuthService) TTL() time.Duration { return s.ttl }

type LoginResult struct {
	User      domain.AdminUser
	Token     string // raw cookie value; only its SHA-256 is stored
	CSRFToken string
	ExpiresAt time.Time
}

// ValidatePassword enforces the admin password policy.
func ValidatePassword(pw string) error {
	if len(pw) < MinPasswordLen {
		return fmt.Errorf("password must be at least %d characters", MinPasswordLen)
	}
	if len(pw) > MaxPasswordLen {
		return fmt.Errorf("password must be at most %d bytes", MaxPasswordLen)
	}
	return nil
}

func (s *AuthService) HashPassword(pw string) (string, error) {
	if err := ValidatePassword(pw); err != nil {
		return "", err
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), s.cost)
	return string(h), err
}

func NormalizeEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

func (s *AuthService) Login(ctx context.Context, email, password string, meta RequestMeta) (LoginResult, error) {
	email = NormalizeEmail(email)
	var v domain.Validator
	if email == "" {
		v.Add("email", "กรุณากรอกอีเมล")
	}
	if password == "" {
		v.Add("password", "กรุณากรอกรหัสผ่าน")
	}
	if err := v.Err(); err != nil {
		return LoginResult{}, err
	}
	user, err := s.users.GetByEmail(ctx, email)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return LoginResult{}, err
	}
	if err != nil || !user.IsActive || len(password) > MaxPasswordLen {
		_ = bcrypt.CompareHashAndPassword(s.dummyHash, []byte(password))
		s.log.Warn("admin login failed", "reason", "unknown_or_inactive", "ip", meta.IP)
		return LoginResult{}, domain.ErrUnauthorized
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		s.log.Warn("admin login failed", "reason", "bad_password", "user_id", user.ID, "ip", meta.IP)
		return LoginResult{}, domain.ErrUnauthorized
	}
	token, err := RandomToken()
	if err != nil {
		return LoginResult{}, err
	}
	csrf, err := RandomToken()
	if err != nil {
		return LoginResult{}, err
	}
	now := s.Now().UTC()
	sess := domain.Session{
		AdminUserID: user.ID,
		TokenHash:   HashToken(token),
		CSRFToken:   csrf,
		IP:          meta.IP,
		UserAgent:   truncateRunes(cleanLine(meta.UserAgent), 500),
		CreatedAt:   now,
		ExpiresAt:   now.Add(s.ttl),
	}
	if err := s.sessions.Create(ctx, &sess); err != nil {
		return LoginResult{}, err
	}
	if err := s.users.TouchLogin(ctx, user.ID, now); err != nil {
		s.log.Warn("touch last_login_at failed", "user_id", user.ID, "err", err)
	}
	s.log.Info("admin login", "user_id", user.ID, "ip", meta.IP)
	return LoginResult{User: user, Token: token, CSRFToken: csrf, ExpiresAt: sess.ExpiresAt}, nil
}

// Authenticate resolves a raw session token to a live session and user.
func (s *AuthService) Authenticate(ctx context.Context, token string) (domain.Session, domain.AdminUser, error) {
	if token == "" || len(token) > 256 {
		return domain.Session{}, domain.AdminUser{}, domain.ErrUnauthorized
	}
	sess, user, err := s.sessions.GetValid(ctx, HashToken(token), s.Now().UTC())
	if errors.Is(err, domain.ErrNotFound) {
		return sess, user, domain.ErrUnauthorized
	}
	return sess, user, err
}

func (s *AuthService) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.sessions.DeleteByTokenHash(ctx, HashToken(token))
}

func (s *AuthService) PurgeExpiredSessions(ctx context.Context) (int64, error) {
	return s.sessions.DeleteExpired(ctx, s.Now().UTC())
}

// EnsureAdmin creates the bootstrap admin if missing. An existing password is
// only replaced when reset is true (and then all its sessions are revoked).
func (s *AuthService) EnsureAdmin(ctx context.Context, email, password, name string, reset bool) (string, error) {
	email = NormalizeEmail(email)
	if !ValidEmail(email) {
		return "", errors.New("ADMIN_EMAIL is not a valid email address")
	}
	if err := ValidatePassword(password); err != nil {
		return "", fmt.Errorf("ADMIN_PASSWORD: %w", err)
	}
	name = cleanLine(name)
	existing, err := s.users.GetByEmail(ctx, email)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		hash, err := s.HashPassword(password)
		if err != nil {
			return "", err
		}
		u := domain.AdminUser{Email: email, Name: name, PasswordHash: hash}
		if err := s.users.Create(ctx, &u); err != nil {
			return "", err
		}
		return "created", nil
	case err != nil:
		return "", err
	}
	if name != "" && name != existing.Name {
		if err := s.users.UpdateName(ctx, existing.ID, name); err != nil {
			return "", err
		}
	}
	if !reset {
		return "exists", nil
	}
	hash, err := s.HashPassword(password)
	if err != nil {
		return "", err
	}
	if err := s.users.UpdatePassword(ctx, existing.ID, hash); err != nil {
		return "", err
	}
	if err := s.sessions.DeleteByUser(ctx, existing.ID); err != nil {
		return "", err
	}
	return "password_reset", nil
}

// RandomToken returns 32 random bytes, base64url without padding.
func RandomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// CSRFEqual compares tokens in constant time; empty never matches.
func CSRFEqual(expected, got string) bool {
	if expected == "" || got == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(got)) == 1
}
