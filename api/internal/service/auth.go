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
	audit     Auditor
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
	return &AuthService{users: users, sessions: sessions, ttl: ttl, cost: cost, dummyHash: dummy, audit: NopAuditor{},
		log: log, Now: time.Now}
}

// SetAuditor enables audit records for login/logout (default: none).
func (s *AuthService) SetAuditor(a Auditor) {
	if a != nil {
		s.audit = a
	}
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
	failed := func() {
		// Attempted email only (to spot brute force); never the password.
		s.audit.Record(ctx, domain.AuditEvent{Actor: metaActor(meta), Action: domain.AuditLoginFailed,
			Metadata: map[string]any{"email": truncateRunes(email, 254)}})
	}
	if err != nil || !user.IsActive || len(password) > MaxPasswordLen {
		_ = bcrypt.CompareHashAndPassword(s.dummyHash, []byte(password))
		s.log.Warn("admin login failed", "reason", "unknown_or_inactive", "ip", meta.IP)
		failed()
		return LoginResult{}, domain.ErrUnauthorized
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		s.log.Warn("admin login failed", "reason", "bad_password", "user_id", user.ID, "ip", meta.IP)
		failed()
		return LoginResult{}, domain.ErrUnauthorized
	}
	res, err := s.StartSession(ctx, user, meta)
	if err != nil {
		return LoginResult{}, err
	}
	s.audit.Record(ctx, domain.AuditEvent{Actor: UserActor(res.User, meta), Action: domain.AuditLoginSuccess,
		TargetType: domain.TargetUser, TargetID: user.ID})
	s.log.Info("admin login", "user_id", user.ID, "ip", meta.IP)
	return res, nil
}

func metaActor(meta RequestMeta) domain.Actor {
	return domain.Actor{IP: meta.IP, UserAgent: truncateRunes(cleanLine(meta.UserAgent), 500)}
}

// UserActor is the audit actor for u acting from meta.
func UserActor(u domain.AdminUser, meta RequestMeta) domain.Actor {
	a := metaActor(meta)
	a.ID, a.Email, a.Name, a.Role = u.ID, u.Email, u.Name, u.Role
	return a
}

// StartSession creates a session for an already-authenticated user (login,
// invite accept, password reset) and stamps last_login_at.
func (s *AuthService) StartSession(ctx context.Context, user domain.AdminUser, meta RequestMeta) (LoginResult, error) {
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
	} else {
		user.LastLoginAt = &now
	}
	return LoginResult{User: user, Token: token, CSRFToken: csrf, ExpiresAt: sess.ExpiresAt}, nil
}

// Authenticate resolves a raw session token to a live session and user.
func (s *AuthService) Authenticate(ctx context.Context, token string) (domain.Session, domain.AdminUser, error) {
	if token == "" || len(token) > 256 {
		return domain.Session{}, domain.AdminUser{}, domain.ErrUnauthorized
	}
	now := s.Now().UTC()
	sess, user, err := s.sessions.GetValid(ctx, HashToken(token), now)
	if errors.Is(err, domain.ErrNotFound) {
		return sess, user, domain.ErrUnauthorized
	}
	if err != nil {
		return sess, user, err
	}
	// last_seen_at: at most one write per session per minute (the SQL
	// re-checks, so concurrent requests cannot write more often).
	if sess.LastSeenAt == nil || now.Sub(*sess.LastSeenAt) >= time.Minute {
		if err := s.sessions.Touch(ctx, sess.ID, now); err != nil {
			s.log.Warn("touch session failed", "session_id", sess.ID, "err", err)
		}
	}
	return sess, user, nil
}

// Logout deletes the session; actor (zero for an anonymous call) is audited
// when a session was present.
func (s *AuthService) Logout(ctx context.Context, token string, actor domain.Actor) error {
	if token == "" {
		return nil
	}
	if err := s.sessions.DeleteByTokenHash(ctx, HashToken(token)); err != nil {
		return err
	}
	if actor.ID != "" {
		s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditLogout,
			TargetType: domain.TargetUser, TargetID: actor.ID})
	}
	return nil
}

func (s *AuthService) PurgeExpiredSessions(ctx context.Context) (int64, error) {
	return s.sessions.DeleteExpired(ctx, s.Now().UTC())
}

// EnsureAdmin creates the bootstrap admin (role owner) if missing. An
// existing password is only replaced when reset is true. reset is also the
// break-glass recovery for a locked-out installation: it restores
// role=owner and is_active=true, sets the password and revokes all of that
// user's sessions.
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
		u := domain.AdminUser{Email: email, Name: name, PasswordHash: hash, Role: domain.RoleOwner}
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
	if err := s.users.SetPassword(ctx, existing.ID, hash, s.Now().UTC()); err != nil {
		return "", err
	}
	if err := s.users.RestoreOwner(ctx, existing.ID); err != nil {
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
