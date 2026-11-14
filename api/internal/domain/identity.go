package domain

import (
	"errors"
	"time"
)

// UserRef is the short user form embedded in other resources (created_by,
// uploaded_by, assigned_to, invited_by). Name may be "" (UI falls back to
// the email).
type UserRef struct {
	ID    string
	Name  string
	Email string
}

// TokenPurpose is the kind of a single-use user token.
type TokenPurpose string

const (
	TokenInvite TokenPurpose = "invite"
	TokenReset  TokenPurpose = "reset"
)

// UserToken is an invitation or password-reset token. Only the SHA-256 of
// the raw token is stored.
type UserToken struct {
	ID        string
	Purpose   TokenPurpose
	TokenHash []byte
	Email     string
	Role      *Role   // invite: role granted on accept; reset: nil
	UserID    *string // reset: target user; invite: set when accepted
	CreatedBy *UserRef
	CreatedAt time.Time
	ExpiresAt time.Time
	UsedAt    *time.Time
	RevokedAt *time.Time
}

// Open reports whether the token is neither used nor revoked (it may still be
// expired).
func (t UserToken) Open() bool { return t.UsedAt == nil && t.RevokedAt == nil }

// Usable reports whether the token can be redeemed at now.
func (t UserToken) Usable(now time.Time) bool { return t.Open() && t.ExpiresAt.After(now) }

// Identity error messages / sentinels.
const (
	MsgTokenInvalid      = "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว"
	MsgLastOwner         = "ต้องมีเจ้าของระบบ (Owner) ที่ใช้งานอยู่อย่างน้อย 1 คน"
	MsgEmailHasAccount   = "อีเมลนี้มีบัญชีผู้ใช้อยู่แล้ว"
	MsgCannotDeleteSelf  = "ไม่สามารถลบบัญชีของตัวเองได้"
	MsgWrongCurrentPass  = "รหัสผ่านปัจจุบันไม่ถูกต้อง"
	MsgCannotElevateSelf = "ไม่สามารถเพิ่มสิทธิ์ให้บัญชีของตัวเองได้"
)

var (
	// ErrTokenInvalid: unknown, used, revoked or expired token (404 token_invalid).
	ErrTokenInvalid = errors.New("token invalid")
	// ErrLastOwner: the change would leave zero active owners (409 last_owner).
	ErrLastOwner = errors.New("last active owner")
	// ErrEmailTaken: a user with that email already exists (409 conflict).
	ErrEmailTaken = errors.New("email already has an account")
	// ErrSelfElevation: users cannot raise their own role (403 forbidden).
	ErrSelfElevation = errors.New("cannot elevate own role")
)

// Elevates reports whether moving from role from to role to grants any
// permission from did not have.
func Elevates(from, to Role) bool {
	for _, p := range PermissionsOf(to) {
		if !from.Has(p) {
			return true
		}
	}
	return false
}

// CanGrant reports whether an inviter with role from (active or not) may
// hand out role to: it must be active, hold users:manage and not elevate.
// Checked when an invite is created and again when it is accepted.
func CanGrant(from Role, active bool, to Role) bool {
	return active && from.Has(PermUsersManage) && !Elevates(from, to)
}
