package service

import (
	"context"
	"log/slog"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

// AccountService is the signed-in user's self-service: profile, password and
// sessions.
type AccountService struct {
	users    repository.AdminUsers
	sessions repository.Sessions
	auth     *AuthService
	audit    Auditor
	log      *slog.Logger
	Now      func() time.Time
}

func NewAccountService(users repository.AdminUsers, sessions repository.Sessions, auth *AuthService, audit Auditor,
	log *slog.Logger) *AccountService {
	if audit == nil {
		audit = NopAuditor{}
	}
	return &AccountService{users: users, sessions: sessions, auth: auth, audit: audit, log: log, Now: time.Now}
}

func (s *AccountService) UpdateProfile(ctx context.Context, actor domain.Actor, name string) (domain.AdminUser, error) {
	var v domain.Validator
	name = cleanLine(name)
	validateName(&v, name)
	if err := v.Err(); err != nil {
		return domain.AdminUser{}, err
	}
	if err := s.users.UpdateName(ctx, actor.ID, name); err != nil {
		return domain.AdminUser{}, err
	}
	u, err := s.users.GetByID(ctx, actor.ID)
	if err != nil {
		return domain.AdminUser{}, err
	}
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditProfileUpdate,
		TargetType: domain.TargetUser, TargetID: u.ID})
	return u, nil
}

type PasswordChange struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ChangePassword verifies the current password, stores the new one and
// signs out every other session of the user (the current one stays).
func (s *AccountService) ChangePassword(ctx context.Context, actor domain.Actor, sessionID string,
	in PasswordChange) error {
	var v domain.Validator
	if in.CurrentPassword == "" {
		v.Add("current_password", "กรุณากรอกรหัสผ่านปัจจุบัน")
	}
	validateNewPassword(&v, "new_password", in.NewPassword)
	if err := v.Err(); err != nil {
		return err
	}
	u, err := s.users.GetByID(ctx, actor.ID)
	if err != nil {
		return err
	}
	if len(in.CurrentPassword) > MaxPasswordLen ||
		bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(in.CurrentPassword)) != nil {
		return &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"current_password": domain.MsgWrongCurrentPass}}
	}
	if in.NewPassword == in.CurrentPassword {
		return &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"new_password": "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน"}}
	}
	hash, err := s.auth.HashPassword(in.NewPassword)
	if err != nil {
		return err
	}
	if err := s.users.SetPassword(ctx, u.ID, hash, s.Now().UTC()); err != nil {
		return err
	}
	n, err := s.sessions.DeleteByUserExcept(ctx, u.ID, sessionID)
	if err != nil {
		return err
	}
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditPasswordChange,
		TargetType: domain.TargetUser, TargetID: u.ID, Metadata: map[string]any{"sessions_revoked": n}})
	return nil
}

// Sessions lists the user's unexpired sessions, newest first.
func (s *AccountService) Sessions(ctx context.Context, userID string) ([]domain.Session, error) {
	return s.sessions.ListByUser(ctx, userID, s.Now().UTC())
}

// SignOutOthers deletes every session of the user except the current one.
func (s *AccountService) SignOutOthers(ctx context.Context, actor domain.Actor, sessionID string) (int64, error) {
	n, err := s.sessions.DeleteByUserExcept(ctx, actor.ID, sessionID)
	if err != nil {
		return 0, err
	}
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditSessionsRevoke,
		TargetType: domain.TargetUser, TargetID: actor.ID, Metadata: map[string]any{"revoked": n}})
	return n, nil
}
