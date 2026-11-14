package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

// LinkMailer sends one e-mail in the background and reports whether it was
// queued (false when e-mail is not configured). Implemented by notify.Mailer.
type LinkMailer interface {
	Send(to, subject, body string) bool
}

type UserServiceConfig struct {
	InviteTTL  time.Duration // invitation and reset link lifetime
	WebBaseURL string        // "" = never e-mail links (the owner copies them)
}

// UserService: user management, invitations and reset links (owner), plus
// the public token inspect/accept flow.
type UserService struct {
	users    repository.AdminUsers
	sessions repository.Sessions
	tokens   repository.UserTokens
	auth     *AuthService
	audit    Auditor
	mailer   LinkMailer
	cfg      UserServiceConfig
	log      *slog.Logger
	Now      func() time.Time
}

func NewUserService(users repository.AdminUsers, sessions repository.Sessions, tokens repository.UserTokens,
	auth *AuthService, audit Auditor, mailer LinkMailer, cfg UserServiceConfig, log *slog.Logger) *UserService {
	if audit == nil {
		audit = NopAuditor{}
	}
	if cfg.InviteTTL <= 0 {
		cfg.InviteTTL = 72 * time.Hour
	}
	cfg.WebBaseURL = strings.TrimRight(cfg.WebBaseURL, "/")
	return &UserService{users: users, sessions: sessions, tokens: tokens, auth: auth, audit: audit, mailer: mailer,
		cfg: cfg, log: log, Now: time.Now}
}

// ---- users ----

func (s *UserService) List(ctx context.Context) ([]domain.AdminUser, error) { return s.users.List(ctx) }

type UserPatch struct {
	Role     *string `json:"role"`
	IsActive *bool   `json:"is_active"`
}

func parseRole(v *domain.Validator, field, raw string) domain.Role {
	r := domain.Role(strings.TrimSpace(raw))
	if !r.Valid() {
		v.Add(field, "บทบาทต้องเป็น owner, editor, sales หรือ viewer")
	}
	return r
}

// canGrant: nobody can hand out permissions they do not hold (only owners
// reach the users routes today, so this is defence in depth).
func canGrant(actor domain.Actor, r domain.Role) error {
	if !actor.Role.Has(domain.PermUsersManage) || domain.Elevates(actor.Role, r) {
		return domain.ErrForbidden
	}
	return nil
}

// Update changes a user's role and/or active flag. Last-owner protection is
// enforced by the repository under row locks; deactivation deletes the
// user's sessions in the same transaction and revokes open reset links.
func (s *UserService) Update(ctx context.Context, actor domain.Actor, id string, in UserPatch) (domain.AdminUser, error) {
	var v domain.Validator
	var role *domain.Role
	if in.Role == nil && in.IsActive == nil {
		v.Add("role", "กรุณาระบุบทบาทหรือสถานะที่ต้องการเปลี่ยน")
	}
	if in.Role != nil {
		r := parseRole(&v, "role", *in.Role)
		role = &r
	}
	if err := v.Err(); err != nil {
		return domain.AdminUser{}, err
	}
	if role != nil {
		if id == actor.ID && domain.Elevates(actor.Role, *role) {
			return domain.AdminUser{}, domain.ErrSelfElevation
		}
		if err := canGrant(actor, *role); err != nil {
			return domain.AdminUser{}, err
		}
	} else if !actor.Role.Has(domain.PermUsersManage) {
		return domain.AdminUser{}, domain.ErrForbidden
	}
	before, after, err := s.users.UpdateAccess(ctx, id, role, in.IsActive)
	if err != nil {
		return domain.AdminUser{}, err
	}
	ev := func(action string, meta map[string]any) {
		s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: action, TargetType: domain.TargetUser,
			TargetID: after.ID, Metadata: meta})
	}
	if before.Role != after.Role {
		ev(domain.AuditUserRoleChange, map[string]any{"email": after.Email, "from": string(before.Role),
			"to": string(after.Role)})
	}
	switch {
	case before.IsActive && !after.IsActive:
		if err := s.tokens.RevokeOpenResetsFor(ctx, after.ID, s.Now().UTC()); err != nil {
			s.log.Warn("revoke reset links on deactivate failed", "user_id", after.ID, "err", err)
		}
		ev(domain.AuditUserDeactivate, map[string]any{"email": after.Email})
	case !before.IsActive && after.IsActive:
		ev(domain.AuditUserReactivate, map[string]any{"email": after.Email})
	}
	return after, nil
}

// Delete removes a user (never oneself, never the last active owner).
func (s *UserService) Delete(ctx context.Context, actor domain.Actor, id string) error {
	if id == actor.ID {
		return &domain.ValidationError{Message: domain.MsgCannotDeleteSelf}
	}
	if !actor.Role.Has(domain.PermUsersManage) {
		return domain.ErrForbidden
	}
	u, err := s.users.Delete(ctx, id)
	if err != nil {
		return err
	}
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditUserDelete, TargetType: domain.TargetUser,
		TargetID: u.ID, Metadata: map[string]any{"email": u.Email, "role": string(u.Role)}})
	return nil
}

// ---- links ----

// TokenIssue is returned to the owner only: the raw token never leaves the
// API anywhere else. EmailSent = the link e-mail was queued (WEB_BASE_URL and
// an e-mail transport configured); delivery itself is asynchronous and a
// failure is only logged.
type TokenIssue struct {
	Token     string
	ExpiresAt time.Time
	EmailSent bool
}

func newRawToken() (string, []byte, error) {
	raw, err := RandomToken()
	if err != nil {
		return "", nil, err
	}
	return raw, HashToken(raw), nil
}

var roleLabelTH = map[domain.Role]string{
	domain.RoleOwner:  "เจ้าของระบบ (Owner)",
	domain.RoleEditor: "บรรณาธิการ (Editor)",
	domain.RoleSales:  "ฝ่ายขาย (Sales)",
	domain.RoleViewer: "ผู้ชม (Viewer)",
}

func actorLabel(a domain.Actor) string {
	if a.Name != "" {
		return a.Name
	}
	if a.Email != "" {
		return a.Email
	}
	return "ผู้ดูแลระบบ"
}

// InviteLink is the accept URL; the token is in the fragment so it is never
// sent to servers, logs or Referer headers.
func (s *UserService) InviteLink(token string) string {
	return s.cfg.WebBaseURL + "/admin/invite#token=" + token
}

func (s *UserService) sendLink(purpose domain.TokenPurpose, to, token string, role domain.Role, expires time.Time,
	actor domain.Actor) bool {
	if s.cfg.WebBaseURL == "" || s.mailer == nil {
		return false
	}
	link := s.InviteLink(token)
	until := expires.In(bangkok).Format("2006-01-02 15:04")
	var subject, body string
	if purpose == domain.TokenInvite {
		subject = "คำเชิญเข้าใช้งานระบบหลังบ้าน ECOMACROBIZ"
		body = fmt.Sprintf("สวัสดี\n\n%s เชิญคุณเข้าใช้งานระบบหลังบ้านของเว็บไซต์ ECOMACROBIZ ในบทบาท %s\n\n"+
			"ตั้งชื่อและรหัสผ่านเพื่อเริ่มใช้งานได้ที่ลิงก์นี้:\n%s\n\n"+
			"ลิงก์นี้ใช้ได้ครั้งเดียว และหมดอายุ %s (เวลาไทย)\n"+
			"หากคุณไม่ได้คาดว่าจะได้รับอีเมลนี้ สามารถละเว้นได้\n", actorLabel(actor), roleLabelTH[role], link, until)
	} else {
		subject = "ตั้งรหัสผ่านใหม่ ระบบหลังบ้าน ECOMACROBIZ"
		body = fmt.Sprintf("สวัสดี\n\n%s สร้างลิงก์สำหรับตั้งรหัสผ่านใหม่ของบัญชีคุณในระบบหลังบ้าน ECOMACROBIZ\n\n"+
			"ตั้งรหัสผ่านใหม่ได้ที่ลิงก์นี้:\n%s\n\n"+
			"ลิงก์นี้ใช้ได้ครั้งเดียว และหมดอายุ %s (เวลาไทย)\n"+
			"เมื่อตั้งรหัสผ่านใหม่แล้ว ทุกอุปกรณ์ที่เข้าสู่ระบบไว้จะถูกออกจากระบบ\n"+
			"หากคุณไม่ได้ร้องขอ กรุณาแจ้งเจ้าของระบบทันที\n", actorLabel(actor), link, until)
	}
	return s.mailer.Send(to, subject, body)
}

// IssueReset creates a password-reset link for an active user, revoking the
// user's previous open reset links.
func (s *UserService) IssueReset(ctx context.Context, actor domain.Actor, id string) (TokenIssue, error) {
	if !actor.Role.Has(domain.PermUsersManage) {
		return TokenIssue{}, domain.ErrForbidden
	}
	u, err := s.users.GetByID(ctx, id)
	if err != nil {
		return TokenIssue{}, err
	}
	if !u.IsActive {
		return TokenIssue{}, &domain.ValidationError{
			Message: "บัญชีนี้ถูกปิดการใช้งานอยู่ กรุณาเปิดใช้งานก่อนสร้างลิงก์ตั้งรหัสผ่านใหม่"}
	}
	now := s.Now().UTC()
	if err := s.tokens.RevokeOpenResetsFor(ctx, u.ID, now); err != nil {
		return TokenIssue{}, err
	}
	raw, hash, err := newRawToken()
	if err != nil {
		return TokenIssue{}, err
	}
	uid := u.ID
	t := domain.UserToken{Purpose: domain.TokenReset, TokenHash: hash, Email: u.Email, UserID: &uid,
		CreatedBy: &domain.UserRef{ID: actor.ID}, ExpiresAt: now.Add(s.cfg.InviteTTL)}
	if err := s.tokens.Create(ctx, &t); err != nil {
		return TokenIssue{}, err
	}
	sent := s.sendLink(domain.TokenReset, u.Email, raw, "", t.ExpiresAt, actor)
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditUserResetIssue,
		TargetType: domain.TargetUser, TargetID: u.ID, Metadata: map[string]any{"email": u.Email, "email_sent": sent}})
	return TokenIssue{Token: raw, ExpiresAt: t.ExpiresAt, EmailSent: sent}, nil
}

// ---- invites ----

type InviteView struct {
	domain.UserToken
	Expired bool
}

type InviteResult struct {
	Invite    InviteView
	Token     string
	EmailSent bool
}

func (s *UserService) view(t domain.UserToken) InviteView {
	return InviteView{UserToken: t, Expired: !t.ExpiresAt.After(s.Now())}
}

// ListInvites returns open (unused, unrevoked) invites, incl. expired ones.
func (s *UserService) ListInvites(ctx context.Context) ([]InviteView, error) {
	ts, err := s.tokens.ListOpenInvites(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]InviteView, 0, len(ts))
	for _, t := range ts {
		out = append(out, s.view(t))
	}
	return out, nil
}

type InviteInput struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (s *UserService) emailTaken(ctx context.Context, email string) error {
	_, err := s.users.GetByEmail(ctx, email)
	switch {
	case err == nil:
		return domain.ErrEmailTaken
	case errors.Is(err, domain.ErrNotFound):
		return nil
	}
	return err
}

// Invite creates an invitation (revoking any open invite for the email).
func (s *UserService) Invite(ctx context.Context, actor domain.Actor, in InviteInput) (InviteResult, error) {
	var v domain.Validator
	email := NormalizeEmail(in.Email)
	if !ValidEmail(email) {
		v.Add("email", "รูปแบบอีเมลไม่ถูกต้อง")
	}
	role := parseRole(&v, "role", in.Role)
	if err := v.Err(); err != nil {
		return InviteResult{}, err
	}
	if err := canGrant(actor, role); err != nil {
		return InviteResult{}, err
	}
	if err := s.emailTaken(ctx, email); err != nil {
		return InviteResult{}, err
	}
	now := s.Now().UTC()
	if err := s.tokens.RevokeOpenInvitesFor(ctx, email, now); err != nil {
		return InviteResult{}, err
	}
	raw, hash, err := newRawToken()
	if err != nil {
		return InviteResult{}, err
	}
	t := domain.UserToken{Purpose: domain.TokenInvite, TokenHash: hash, Email: email, Role: &role,
		CreatedBy: &domain.UserRef{ID: actor.ID}, ExpiresAt: now.Add(s.cfg.InviteTTL)}
	if err := s.tokens.Create(ctx, &t); err != nil {
		return InviteResult{}, err // ErrConflict: a concurrent invite for the same email won
	}
	sent := s.sendLink(domain.TokenInvite, email, raw, role, t.ExpiresAt, actor)
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditUserInvite, TargetType: domain.TargetInvite,
		TargetID: t.ID, Metadata: map[string]any{"email": email, "role": string(role), "email_sent": sent}})
	return InviteResult{Invite: s.view(t), Token: raw, EmailSent: sent}, nil
}

// ResendInvite rotates the invite's token (the old link stops working) and
// renews its expiry.
func (s *UserService) ResendInvite(ctx context.Context, actor domain.Actor, id string) (InviteResult, error) {
	if !actor.Role.Has(domain.PermUsersManage) {
		return InviteResult{}, domain.ErrForbidden
	}
	t, err := s.tokens.Get(ctx, id)
	if err != nil {
		return InviteResult{}, err
	}
	if t.Purpose != domain.TokenInvite || !t.Open() {
		return InviteResult{}, domain.ErrNotFound
	}
	if err := s.emailTaken(ctx, t.Email); err != nil {
		return InviteResult{}, err
	}
	raw, hash, err := newRawToken()
	if err != nil {
		return InviteResult{}, err
	}
	t, err = s.tokens.RotateInvite(ctx, id, hash, s.Now().UTC().Add(s.cfg.InviteTTL))
	if err != nil {
		return InviteResult{}, err
	}
	sent := s.sendLink(domain.TokenInvite, t.Email, raw, *t.Role, t.ExpiresAt, actor)
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditUserInviteResend,
		TargetType: domain.TargetInvite, TargetID: t.ID, Metadata: map[string]any{"email": t.Email, "email_sent": sent}})
	return InviteResult{Invite: s.view(t), Token: raw, EmailSent: sent}, nil
}

func (s *UserService) RevokeInvite(ctx context.Context, actor domain.Actor, id string) error {
	if !actor.Role.Has(domain.PermUsersManage) {
		return domain.ErrForbidden
	}
	t, err := s.tokens.RevokeInvite(ctx, id, s.Now().UTC())
	if err != nil {
		return err
	}
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditUserInviteRevoke,
		TargetType: domain.TargetInvite, TargetID: t.ID, Metadata: map[string]any{"email": t.Email}})
	return nil
}

// ---- public token flow ----

type TokenInfo struct {
	Purpose   domain.TokenPurpose
	Email     string
	Role      *domain.Role
	Name      string
	ExpiresAt time.Time
}

// lookup resolves a raw token to a usable token; every failure is
// ErrTokenInvalid so callers cannot tell unknown/used/revoked/expired apart.
func (s *UserService) lookup(ctx context.Context, raw string) (domain.UserToken, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 256 {
		return domain.UserToken{}, domain.ErrTokenInvalid
	}
	t, err := s.tokens.GetByHash(ctx, HashToken(raw))
	if errors.Is(err, domain.ErrNotFound) || (err == nil && !t.Usable(s.Now())) {
		return domain.UserToken{}, domain.ErrTokenInvalid
	}
	return t, err
}

func (s *UserService) InspectToken(ctx context.Context, raw string) (TokenInfo, error) {
	t, err := s.lookup(ctx, raw)
	if err != nil {
		return TokenInfo{}, err
	}
	info := TokenInfo{Purpose: t.Purpose, Email: t.Email, ExpiresAt: t.ExpiresAt}
	if t.Purpose == domain.TokenInvite {
		info.Role = t.Role
		return info, nil
	}
	u, err := s.users.GetByID(ctx, *t.UserID)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && !u.IsActive) {
		return TokenInfo{}, domain.ErrTokenInvalid
	}
	if err != nil {
		return TokenInfo{}, err
	}
	info.Name = u.Name
	return info, nil
}

type AcceptInput struct {
	Token    string `json:"token"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

func validateNewPassword(v *domain.Validator, field, pw string) {
	switch {
	case pw == "":
		v.Add(field, "กรุณากรอกรหัสผ่าน")
	case len(pw) < MinPasswordLen:
		v.Add(field, fmt.Sprintf("รหัสผ่านต้องมีอย่างน้อย %d ตัวอักษร", MinPasswordLen))
	case len(pw) > MaxPasswordLen:
		v.Add(field, fmt.Sprintf("รหัสผ่านต้องไม่เกิน %d ไบต์", MaxPasswordLen))
	}
}

func validateName(v *domain.Validator, name string) {
	switch {
	case name == "":
		v.Add("name", "กรุณากรอกชื่อ")
	case runeLen(name) > 100:
		v.Add("name", "ชื่อต้องไม่เกิน 100 ตัวอักษร")
	}
}

// AcceptToken redeems an invite (creates the user) or a reset link (sets
// the password and revokes every session of the user) and logs the user in.
func (s *UserService) AcceptToken(ctx context.Context, in AcceptInput, meta RequestMeta) (LoginResult, error) {
	t, err := s.lookup(ctx, in.Token)
	if err != nil {
		return LoginResult{}, err
	}
	var v domain.Validator
	name := cleanLine(in.Name)
	if t.Purpose == domain.TokenInvite {
		validateName(&v, name)
	}
	validateNewPassword(&v, "password", in.Password)
	if err := v.Err(); err != nil {
		return LoginResult{}, err
	}
	hash, err := s.auth.HashPassword(in.Password)
	if err != nil {
		return LoginResult{}, err
	}
	now := s.Now().UTC()
	var user domain.AdminUser
	var action string
	var metadata map[string]any
	switch t.Purpose {
	case domain.TokenInvite:
		if err := s.emailTaken(ctx, t.Email); err != nil {
			return LoginResult{}, err
		}
		user = domain.AdminUser{Name: name, PasswordHash: hash}
		if _, err := s.tokens.AcceptInvite(ctx, HashToken(strings.TrimSpace(in.Token)), now, &user); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				return LoginResult{}, domain.ErrEmailTaken
			}
			return LoginResult{}, err
		}
		action, metadata = domain.AuditUserInviteAccept, map[string]any{"invite_id": t.ID, "role": string(user.Role)}
	case domain.TokenReset:
		if user, err = s.tokens.ConsumeReset(ctx, HashToken(strings.TrimSpace(in.Token)), now, hash); err != nil {
			return LoginResult{}, err
		}
		action, metadata = domain.AuditPasswordReset, map[string]any{"all_sessions_revoked": true}
	default:
		return LoginResult{}, domain.ErrTokenInvalid
	}
	res, err := s.auth.StartSession(ctx, user, meta)
	if err != nil {
		return LoginResult{}, err
	}
	s.audit.Record(ctx, domain.AuditEvent{Actor: UserActor(user, meta), Action: action, TargetType: domain.TargetUser,
		TargetID: user.ID, Metadata: metadata})
	return res, nil
}
