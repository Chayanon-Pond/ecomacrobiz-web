package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/storage"
	"github.com/ecomacrobiz/escoma/api/internal/vault"
)

// MemberCrypto bundles the member-data keys and the password hasher.
type MemberCrypto struct {
	Keys   *vault.Keyring
	Index  *vault.Index
	Hasher *vault.Hasher
}

// HumanVerifier checks a Turnstile token (nil = Turnstile off).
type HumanVerifier interface {
	Verify(ctx context.Context, token, ip string) bool
}

type MemberServiceConfig struct {
	SessionTTL      time.Duration
	WebBaseURL      string
	MailEnabled     bool // e-mail transport + WEB_BASE_URL
	RequireVerified bool
	AvatarMaxBytes  int64
}

const (
	verifyEmailTTL   = 48 * time.Hour
	changeEmailTTL   = 24 * time.Hour
	resetPasswordTTL = time.Hour
	linkGoogleTTL    = 15 * time.Minute
	// loginFailuresBeforeTurnstile: per IP, within loginFailureWindow.
	loginFailuresBeforeTurnstile = 3
	loginFailureWindow           = 15 * time.Minute
)

// MemberService: community accounts (register, login, sessions, e-mail
// verification, password reset, profile, avatar, account deletion) and the
// admin member management.
type MemberService struct {
	members  repository.Members
	sessions repository.MemberSessions
	tokens   repository.MemberTokens
	comments repository.Comments
	crypto   MemberCrypto
	store    storage.MediaStore
	mailer   LinkMailer
	human    HumanVerifier
	rv       Revalidator
	audit    Auditor
	cfg      MemberServiceConfig
	log      *slog.Logger
	failures *failureCounter
	bg       sync.WaitGroup
	Now      func() time.Time
}

func NewMemberService(members repository.Members, sessions repository.MemberSessions, tokens repository.MemberTokens,
	comments repository.Comments, crypto MemberCrypto, store storage.MediaStore, mailer LinkMailer, human HumanVerifier,
	rv Revalidator, audit Auditor, cfg MemberServiceConfig, log *slog.Logger) *MemberService {
	if audit == nil {
		audit = NopAuditor{}
	}
	if cfg.SessionTTL <= 0 {
		cfg.SessionTTL = 720 * time.Hour
	}
	if cfg.AvatarMaxBytes <= 0 {
		cfg.AvatarMaxBytes = 5 << 20
	}
	cfg.WebBaseURL = strings.TrimRight(cfg.WebBaseURL, "/")
	if mailer == nil || cfg.WebBaseURL == "" {
		cfg.MailEnabled = false
	}
	return &MemberService{members: members, sessions: sessions, tokens: tokens, comments: comments, crypto: crypto,
		store: store, mailer: mailer, human: human, rv: rv, audit: audit, cfg: cfg, log: log,
		failures: newFailureCounter(loginFailureWindow), Now: time.Now}
}

func (s *MemberService) SessionTTL() time.Duration { return s.cfg.SessionTTL }
func (s *MemberService) MailEnabled() bool         { return s.cfg.MailEnabled }
func (s *MemberService) RequireVerified() bool     { return s.cfg.RequireVerified }
func (s *MemberService) TurnstileEnabled() bool    { return s.human != nil }
func (s *MemberService) AvatarMaxBytes() int64     { return s.cfg.AvatarMaxBytes }

// KeyIDs lists the loaded MEMBER_DATA_KEY ids (primary first; no secrets).
func (s *MemberService) KeyIDs() []int16 { return s.crypto.Keys.KeyIDs() }

// AvatarURL is the public URL of an avatar key ("" -> "").
func (s *MemberService) AvatarURL(key string) string {
	if key == "" {
		return ""
	}
	return s.store.URL(key)
}

// Wait blocks until background avatar downloads finish or ctx is done.
func (s *MemberService) Wait(ctx context.Context) {
	done := make(chan struct{})
	go func() { s.bg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

func emailAAD(memberID string) string { return "member-email:" + memberID }

func (s *MemberService) sealEmail(memberID, email string) (repository.EmailUpdate, error) {
	ct, kid, err := s.crypto.Keys.Encrypt([]byte(email), emailAAD(memberID))
	if err != nil {
		return repository.EmailUpdate{}, err
	}
	return repository.EmailUpdate{Ciphertext: ct, KeyID: kid, Index: s.crypto.Index.Email(email)}, nil
}

// open decrypts m.Email in place.
func (s *MemberService) open(m *domain.Member) error {
	pt, err := s.crypto.Keys.Decrypt(m.EmailCiphertext, m.EmailKeyID, emailAAD(m.ID))
	if err != nil {
		return fmt.Errorf("member %s: %w", m.ID, err)
	}
	m.Email = string(pt)
	return nil
}

// openSoft decrypts and only logs a failure (e.g. ephemeral dev keys).
func (s *MemberService) openSoft(m *domain.Member) {
	if err := s.open(m); err != nil {
		s.log.Warn("member e-mail unreadable (MEMBER_DATA_KEY changed?)", "member_id", m.ID)
	}
}

// MemberAuth is a signed-in member plus the raw session secrets for the cookie.
type MemberAuth struct {
	Member     domain.Member
	Identities []domain.MemberIdentity
	Token      string
	CSRFToken  string
	ExpiresAt  time.Time
}

func (s *MemberService) startSession(ctx context.Context, m domain.Member, meta RequestMeta) (MemberAuth, error) {
	token, err := RandomToken()
	if err != nil {
		return MemberAuth{}, err
	}
	csrf, err := RandomToken()
	if err != nil {
		return MemberAuth{}, err
	}
	now := s.Now().UTC()
	sess := domain.MemberSession{MemberID: m.ID, TokenHash: HashToken(token), CSRFToken: csrf, IP: meta.IP,
		UserAgent: truncateRunes(cleanLine(meta.UserAgent), 500), CreatedAt: now, ExpiresAt: now.Add(s.cfg.SessionTTL)}
	if err := s.sessions.Create(ctx, &sess); err != nil {
		return MemberAuth{}, err
	}
	if err := s.members.TouchLogin(ctx, m.ID, now); err != nil {
		s.log.Warn("member touch login failed", "member_id", m.ID, "err", err)
	} else {
		m.LastLoginAt = &now
	}
	ids, err := s.members.Identities(ctx, m.ID)
	if err != nil {
		return MemberAuth{}, err
	}
	return MemberAuth{Member: m, Identities: ids, Token: token, CSRFToken: csrf, ExpiresAt: sess.ExpiresAt}, nil
}

func passwordError(field string, p vault.PasswordProblem) error {
	msg := ""
	switch p {
	case vault.PasswordOK:
		return nil
	case vault.PasswordTooShort:
		msg = fmt.Sprintf("รหัสผ่านต้องมีอย่างน้อย %d ตัวอักษร", vault.MinPasswordRunes)
	case vault.PasswordTooLong:
		msg = fmt.Sprintf("รหัสผ่านต้องไม่เกิน %d ตัวอักษร", vault.MaxPasswordRunes)
	case vault.PasswordCommon:
		msg = "รหัสผ่านนี้ถูกใช้บ่อยเกินไปและเดาได้ง่าย กรุณาตั้งรหัสผ่านอื่น"
	case vault.PasswordPersonal:
		msg = "รหัสผ่านต้องไม่เหมือนอีเมลหรือชื่อที่แสดง"
	}
	return &domain.ValidationError{Message: domain.MsgValidationFailed, Fields: map[string]string{field: msg}}
}

func (s *MemberService) checkHuman(ctx context.Context, token, ip string) error {
	if s.human == nil || s.human.Verify(ctx, token, ip) {
		return nil
	}
	return &domain.ValidationError{Message: domain.MsgTurnstileFailed,
		Fields: map[string]string{"turnstile_token": domain.MsgTurnstileFailed}}
}

type RegisterInput struct {
	DisplayName    string `json:"display_name"`
	Email          string `json:"email"`
	Password       string `json:"password"`
	AcceptTerms    bool   `json:"accept_terms"`
	ConsentVersion string `json:"consent_version"`
	Website        string `json:"website"`
	TurnstileToken string `json:"turnstile_token"`
}

// Register creates a password account and signs it in.
func (s *MemberService) Register(ctx context.Context, in RegisterInput, meta RequestMeta) (MemberAuth, error) {
	if strings.TrimSpace(in.Website) != "" {
		// Honeypot: answer like a validation failure without saying why.
		return MemberAuth{}, &domain.ValidationError{Message: domain.MsgValidationFailed}
	}
	var v domain.Validator
	name := CleanDisplayName(in.DisplayName)
	if msg := DisplayNameProblem(name); msg != "" {
		v.Add("display_name", msg)
	}
	email := vault.NormalizeEmail(in.Email)
	if !ValidEmail(email) {
		v.Add("email", "รูปแบบอีเมลไม่ถูกต้อง")
	}
	if err := passwordError("password", vault.CheckPassword(in.Password, email, name)); err != nil {
		v.Add("password", err.(*domain.ValidationError).Fields["password"])
	}
	if !in.AcceptTerms || in.ConsentVersion != domain.ConsentVersion {
		v.Add("accept_terms", "กรุณายอมรับข้อตกลงการใช้งานและนโยบายความเป็นส่วนตัว")
	}
	if err := v.Err(); err != nil {
		return MemberAuth{}, err
	}
	if err := s.checkHuman(ctx, in.TurnstileToken, meta.IP); err != nil {
		return MemberAuth{}, err
	}
	if _, err := s.members.GetByEmailIndex(ctx, s.crypto.Index.Email(email)); err == nil {
		return MemberAuth{}, domain.ErrEmailTaken
	} else if !errors.Is(err, domain.ErrNotFound) {
		return MemberAuth{}, err
	}
	hash, err := s.crypto.Hasher.Hash(ctx, in.Password)
	if err != nil {
		return MemberAuth{}, err
	}
	now := s.Now().UTC()
	m := domain.Member{ID: uuid.NewString(), DisplayName: name, PasswordHash: hash, PasswordChangedAt: &now,
		Role: domain.MemberRoleMember, TermsVersion: domain.ConsentVersion, ConsentedAt: now}
	upd, err := s.sealEmail(m.ID, email)
	if err != nil {
		return MemberAuth{}, err
	}
	m.EmailCiphertext, m.EmailKeyID, m.EmailIndex = upd.Ciphertext, upd.KeyID, upd.Index
	if err := s.members.Create(ctx, &m, nil); err != nil {
		if errors.Is(err, domain.ErrConflict) {
			return MemberAuth{}, domain.ErrEmailTaken
		}
		return MemberAuth{}, err
	}
	m.Email = email
	s.log.Info("member registered", "member_id", m.ID)
	if s.cfg.MailEnabled {
		if err := s.sendVerification(ctx, m); err != nil {
			s.log.Warn("verification mail not queued", "member_id", m.ID, "err", err)
		}
	}
	return s.startSession(ctx, m, meta)
}

// Login authenticates by e-mail + password. Unknown e-mail, Google-only
// account and wrong password all return ErrInvalidCredentials.
func (s *MemberService) Login(ctx context.Context, email, password, turnstileToken string, meta RequestMeta) (MemberAuth, error) {
	email = vault.NormalizeEmail(email)
	var v domain.Validator
	if email == "" {
		v.Add("email", "กรุณากรอกอีเมล")
	}
	if password == "" {
		v.Add("password", "กรุณากรอกรหัสผ่าน")
	}
	if err := v.Err(); err != nil {
		return MemberAuth{}, err
	}
	now := s.Now()
	if s.human != nil && s.failures.count(meta.IP, now) >= loginFailuresBeforeTurnstile {
		if err := s.checkHuman(ctx, turnstileToken, meta.IP); err != nil {
			return MemberAuth{}, err
		}
	}
	m, err := s.members.GetByEmailIndex(ctx, s.crypto.Index.Email(email))
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return MemberAuth{}, err
	}
	if err != nil || !m.HasPassword() || len(password) > 4*vault.MaxPasswordRunes {
		s.crypto.Hasher.DummyVerify(ctx, password)
		s.failures.add(meta.IP, now)
		return MemberAuth{}, domain.ErrInvalidCredentials
	}
	ok, err := s.crypto.Hasher.Verify(ctx, m.PasswordHash, password)
	if err != nil && !errors.Is(err, vault.ErrBadHash) {
		return MemberAuth{}, err
	}
	if !ok {
		s.failures.add(meta.IP, now)
		s.log.Warn("member login failed", "member_id", m.ID)
		return MemberAuth{}, domain.ErrInvalidCredentials
	}
	if m.Banned() {
		return MemberAuth{}, domain.ErrMemberBanned
	}
	s.failures.reset(meta.IP)
	s.openSoft(&m)
	s.log.Info("member login", "member_id", m.ID)
	return s.startSession(ctx, m, meta)
}

// Authenticate resolves a member session cookie. Banned members still
// resolve (the UI explains); writes are refused by the services.
func (s *MemberService) Authenticate(ctx context.Context, token string) (domain.MemberSession, domain.Member, error) {
	if token == "" || len(token) > 256 {
		return domain.MemberSession{}, domain.Member{}, domain.ErrUnauthorized
	}
	now := s.Now().UTC()
	sess, m, err := s.sessions.GetValid(ctx, HashToken(token), now)
	if errors.Is(err, domain.ErrNotFound) {
		return sess, m, domain.ErrUnauthorized
	}
	if err != nil {
		return sess, m, err
	}
	if sess.LastSeenAt == nil || now.Sub(*sess.LastSeenAt) >= time.Minute {
		if err := s.sessions.Touch(ctx, sess.ID, now); err != nil {
			s.log.Warn("touch member session failed", "session_id", sess.ID, "err", err)
		}
	}
	s.openSoft(&m)
	return sess, m, nil
}

func (s *MemberService) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.sessions.DeleteByTokenHash(ctx, HashToken(token))
}

func (s *MemberService) Identities(ctx context.Context, memberID string) ([]domain.MemberIdentity, error) {
	return s.members.Identities(ctx, memberID)
}

// ---- tokens and e-mail ----

func (s *MemberService) issueToken(ctx context.Context, memberID string, purpose domain.MemberTokenPurpose,
	ttl time.Duration, payload []byte) (string, error) {
	raw, err := RandomToken()
	if err != nil {
		return "", err
	}
	now := s.Now().UTC()
	t := domain.MemberToken{ID: uuid.NewString(), MemberID: &memberID, Purpose: purpose, TokenHash: HashToken(raw),
		CreatedAt: now, ExpiresAt: now.Add(ttl)}
	if payload != nil {
		ct, kid, err := s.crypto.Keys.Encrypt(payload, tokenAAD(t.ID))
		if err != nil {
			return "", err
		}
		t.PayloadCiphertext, t.PayloadKeyID = ct, &kid
	}
	if err := s.tokens.Create(ctx, &t); err != nil {
		return "", err
	}
	return raw, nil
}

func tokenAAD(id string) string { return "token-payload:" + id }

func (s *MemberService) tokenPayload(t domain.MemberToken) ([]byte, error) {
	if t.PayloadCiphertext == nil || t.PayloadKeyID == nil {
		return nil, domain.ErrTokenInvalid
	}
	pt, err := s.crypto.Keys.Decrypt(t.PayloadCiphertext, *t.PayloadKeyID, tokenAAD(t.ID))
	if err != nil {
		return nil, domain.ErrTokenInvalid
	}
	return pt, nil
}

func (s *MemberService) link(path, token string) string {
	return s.cfg.WebBaseURL + path + "#token=" + token
}

func (s *MemberService) until(t time.Duration) string {
	return s.Now().Add(t).In(bangkok).Format("2006-01-02 15:04")
}

func (s *MemberService) sendVerification(ctx context.Context, m domain.Member) error {
	if err := s.tokens.RevokeOpen(ctx, m.ID, domain.TokenVerifyEmail, s.Now().UTC()); err != nil {
		return err
	}
	tok, err := s.issueToken(ctx, m.ID, domain.TokenVerifyEmail, verifyEmailTTL, nil)
	if err != nil {
		return err
	}
	body := fmt.Sprintf("สวัสดีคุณ %s\n\nกรุณายืนยันอีเมลของบัญชีชุมชน ECOMACROBIZ ที่ลิงก์นี้:\n%s\n\n"+
		"ลิงก์นี้ใช้ได้ครั้งเดียว และหมดอายุ %s (เวลาไทย)\n"+
		"หากคุณไม่ได้สมัครสมาชิก สามารถละเว้นอีเมลนี้ได้\n", m.DisplayName,
		s.link("/account/verify-email", tok), s.until(verifyEmailTTL))
	s.mailer.Send(m.Email, "ยืนยันอีเมลของคุณ - ECOMACROBIZ", body)
	return nil
}

// ResendVerification: no-op when verified or when e-mail is off.
func (s *MemberService) ResendVerification(ctx context.Context, m domain.Member) error {
	if m.EmailVerified() || !s.cfg.MailEnabled || m.Email == "" {
		return nil
	}
	return s.sendVerification(ctx, m)
}

// VerifyEmail redeems a verify_email or change_email token and returns the
// kind ("verify" or "change_email").
func (s *MemberService) VerifyEmail(ctx context.Context, token string) (string, error) {
	if token == "" || len(token) > 256 {
		return "", domain.ErrTokenInvalid
	}
	t, err := s.tokens.GetUsable(ctx, HashToken(token), []domain.MemberTokenPurpose{domain.TokenVerifyEmail,
		domain.TokenChangeEmail}, s.Now().UTC())
	if err != nil {
		return "", err
	}
	if t.MemberID == nil {
		return "", domain.ErrTokenInvalid
	}
	if t.Purpose == domain.TokenVerifyEmail {
		return "verify", s.tokens.ConsumeVerify(ctx, t.ID, *t.MemberID, nil, s.Now().UTC())
	}
	pt, err := s.tokenPayload(t)
	if err != nil {
		return "", err
	}
	email := string(pt)
	if other, err := s.members.GetByEmailIndex(ctx, s.crypto.Index.Email(email)); err == nil && other.ID != *t.MemberID {
		return "", domain.ErrEmailTaken
	}
	upd, err := s.sealEmail(*t.MemberID, email)
	if err != nil {
		return "", err
	}
	if err := s.tokens.ConsumeVerify(ctx, t.ID, *t.MemberID, &upd, s.Now().UTC()); err != nil {
		if errors.Is(err, domain.ErrConflict) {
			return "", domain.ErrEmailTaken
		}
		return "", err
	}
	s.log.Info("member e-mail changed", "member_id", *t.MemberID)
	return "change_email", nil
}

// ForgotPassword mails a reset link when the account exists (silently does
// nothing otherwise).
func (s *MemberService) ForgotPassword(ctx context.Context, email string) error {
	email = vault.NormalizeEmail(email)
	if !ValidEmail(email) || !s.cfg.MailEnabled {
		return nil
	}
	m, err := s.members.GetByEmailIndex(ctx, s.crypto.Index.Email(email))
	if errors.Is(err, domain.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := s.tokens.RevokeOpen(ctx, m.ID, domain.TokenResetPassword, s.Now().UTC()); err != nil {
		return err
	}
	tok, err := s.issueToken(ctx, m.ID, domain.TokenResetPassword, resetPasswordTTL, nil)
	if err != nil {
		return err
	}
	body := fmt.Sprintf("สวัสดีคุณ %s\n\nมีการขอตั้งรหัสผ่านใหม่สำหรับบัญชีชุมชน ECOMACROBIZ ของคุณ\n\n"+
		"ตั้งรหัสผ่านใหม่ได้ที่ลิงก์นี้:\n%s\n\n"+
		"ลิงก์นี้ใช้ได้ครั้งเดียว และหมดอายุ %s (เวลาไทย)\n"+
		"เมื่อตั้งรหัสผ่านใหม่แล้ว ทุกอุปกรณ์ที่เข้าสู่ระบบไว้จะถูกออกจากระบบ\n"+
		"หากคุณไม่ได้ร้องขอ สามารถละเว้นอีเมลนี้ได้\n", m.DisplayName,
		s.link("/account/reset-password", tok), s.until(resetPasswordTTL))
	s.mailer.Send(email, "ตั้งรหัสผ่านใหม่ - ECOMACROBIZ", body)
	s.log.Info("member reset link sent", "member_id", m.ID)
	return nil
}

// ResetPassword redeems a reset token: new password, e-mail verified, all
// sessions revoked.
func (s *MemberService) ResetPassword(ctx context.Context, token, password string) error {
	if token == "" || len(token) > 256 {
		return domain.ErrTokenInvalid
	}
	t, err := s.tokens.GetUsable(ctx, HashToken(token), []domain.MemberTokenPurpose{domain.TokenResetPassword},
		s.Now().UTC())
	if err != nil {
		return err
	}
	if t.MemberID == nil {
		return domain.ErrTokenInvalid
	}
	m, err := s.members.GetByID(ctx, *t.MemberID)
	if err != nil {
		return domain.ErrTokenInvalid
	}
	s.openSoft(&m)
	if err := passwordError("password", vault.CheckPassword(password, m.Email, m.DisplayName)); err != nil {
		return err
	}
	hash, err := s.crypto.Hasher.Hash(ctx, password)
	if err != nil {
		return err
	}
	if err := s.tokens.ConsumeReset(ctx, t.ID, m.ID, hash, s.Now().UTC()); err != nil {
		return err
	}
	s.log.Info("member password reset", "member_id", m.ID)
	return nil
}

// ---- self-service ----

func (s *MemberService) reload(ctx context.Context, id string) (domain.Member, error) {
	m, err := s.members.GetByID(ctx, id)
	if err != nil {
		return m, err
	}
	s.openSoft(&m)
	return m, nil
}

func (s *MemberService) UpdateProfile(ctx context.Context, m domain.Member, displayName string) (domain.Member, error) {
	if m.Banned() {
		return m, domain.ErrMemberBanned
	}
	name := CleanDisplayName(displayName)
	if msg := DisplayNameProblem(name); msg != "" {
		return m, &domain.ValidationError{Message: domain.MsgValidationFailed, Fields: map[string]string{"display_name": msg}}
	}
	if _, err := s.members.UpdateDisplayName(ctx, m.ID, name); err != nil {
		return m, err
	}
	return s.reload(ctx, m.ID)
}

func (s *MemberService) storeAvatar(ctx context.Context, memberID string, data []byte, onlyIfNone bool) (bool, error) {
	out, _, err := ProcessAvatar(data)
	if err != nil {
		return false, err
	}
	var key string
	for attempt := 0; ; attempt++ {
		key = communityKey("a", "jpg")
		err := s.store.Put(ctx, key, bytes.NewReader(out), "image/jpeg")
		if errors.Is(err, storage.ErrKeyExists) && attempt < 4 {
			continue
		}
		if err != nil {
			return false, fmt.Errorf("store avatar: %w", err)
		}
		break
	}
	prev, applied, err := s.members.SetAvatar(ctx, memberID, key, onlyIfNone)
	if err != nil || !applied {
		s.deleteFile(key)
		return false, err
	}
	s.deleteFile(prev)
	return true, nil
}

func (s *MemberService) deleteFile(key string) {
	if key == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.store.Delete(ctx, key); err != nil {
		s.log.Error("delete community file", "key", key, "err", err)
	}
}

// SetAvatar processes an uploaded image (see community_image.go).
func (s *MemberService) SetAvatar(ctx context.Context, m domain.Member, data []byte) (domain.Member, error) {
	if m.Banned() {
		return m, domain.ErrMemberBanned
	}
	if int64(len(data)) > s.cfg.AvatarMaxBytes {
		return m, domain.ErrTooLarge
	}
	if _, err := s.storeAvatar(ctx, m.ID, data, false); err != nil {
		return m, err
	}
	return s.reload(ctx, m.ID)
}

func (s *MemberService) RemoveAvatar(ctx context.Context, m domain.Member) (domain.Member, error) {
	prev, _, err := s.members.SetAvatar(ctx, m.ID, "", false)
	if err != nil {
		return m, err
	}
	s.deleteFile(prev)
	return s.reload(ctx, m.ID)
}

// verifyCurrent checks the current password (field current_password).
func (s *MemberService) verifyCurrent(ctx context.Context, m domain.Member, current string) error {
	if !m.HasPassword() {
		return &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"current_password": domain.MsgSetPasswordFirst}}
	}
	ok := false
	if current != "" && len(current) <= 4*vault.MaxPasswordRunes {
		var err error
		ok, err = s.crypto.Hasher.Verify(ctx, m.PasswordHash, current)
		if err != nil && !errors.Is(err, vault.ErrBadHash) {
			return err
		}
	}
	if !ok {
		return &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"current_password": domain.MsgWrongCurrentPass}}
	}
	return nil
}

// ChangeEmail: with e-mail on, mails a change_email link to the new address
// (the address changes when it is opened); otherwise swaps it now as
// unverified. Returns the member and whether a mail was sent.
func (s *MemberService) ChangeEmail(ctx context.Context, m domain.Member, newEmail, current string) (domain.Member, bool, error) {
	email := vault.NormalizeEmail(newEmail)
	if !ValidEmail(email) {
		return m, false, &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"new_email": "รูปแบบอีเมลไม่ถูกต้อง"}}
	}
	if email == m.Email {
		return m, false, &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"new_email": "อีเมลใหม่ต้องไม่ซ้ำกับอีเมลปัจจุบัน"}}
	}
	if err := s.verifyCurrent(ctx, m, current); err != nil {
		return m, false, err
	}
	if _, err := s.members.GetByEmailIndex(ctx, s.crypto.Index.Email(email)); err == nil {
		return m, false, domain.ErrEmailTaken
	} else if !errors.Is(err, domain.ErrNotFound) {
		return m, false, err
	}
	if s.cfg.MailEnabled {
		if err := s.tokens.RevokeOpen(ctx, m.ID, domain.TokenChangeEmail, s.Now().UTC()); err != nil {
			return m, false, err
		}
		tok, err := s.issueToken(ctx, m.ID, domain.TokenChangeEmail, changeEmailTTL, []byte(email))
		if err != nil {
			return m, false, err
		}
		body := fmt.Sprintf("สวัสดีคุณ %s\n\nยืนยันการเปลี่ยนอีเมลของบัญชีชุมชน ECOMACROBIZ มาใช้อีเมลนี้ที่ลิงก์:\n%s\n\n"+
			"ลิงก์นี้ใช้ได้ครั้งเดียว และหมดอายุ %s (เวลาไทย)\n"+
			"หากคุณไม่ได้ร้องขอ สามารถละเว้นอีเมลนี้ได้ อีเมลเดิมจะยังใช้งานต่อไป\n", m.DisplayName,
			s.link("/account/verify-email", tok), s.until(changeEmailTTL))
		sent := s.mailer.Send(email, "ยืนยันอีเมลใหม่ - ECOMACROBIZ", body)
		return m, sent, nil
	}
	upd, err := s.sealEmail(m.ID, email)
	if err != nil {
		return m, false, err
	}
	if err := s.members.UpdateEmail(ctx, m.ID, upd, nil); err != nil {
		if errors.Is(err, domain.ErrConflict) {
			return m, false, domain.ErrEmailTaken
		}
		return m, false, err
	}
	s.log.Info("member e-mail changed", "member_id", m.ID)
	out, err := s.reload(ctx, m.ID)
	return out, false, err
}

type MemberPasswordChange struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ChangePassword sets (Google-only) or changes the password; other sessions
// and open reset links are revoked.
func (s *MemberService) ChangePassword(ctx context.Context, m domain.Member, sessionID string, in MemberPasswordChange) error {
	if m.HasPassword() {
		if err := s.verifyCurrent(ctx, m, in.CurrentPassword); err != nil {
			return err
		}
	}
	if err := passwordError("new_password", vault.CheckPassword(in.NewPassword, m.Email, m.DisplayName)); err != nil {
		return err
	}
	if m.HasPassword() && in.NewPassword == in.CurrentPassword {
		return &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"new_password": "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม"}}
	}
	hash, err := s.crypto.Hasher.Hash(ctx, in.NewPassword)
	if err != nil {
		return err
	}
	if err := s.members.SetPassword(ctx, m.ID, hash, s.Now().UTC(), sessionID); err != nil {
		return err
	}
	s.log.Info("member password changed", "member_id", m.ID)
	return nil
}

func (s *MemberService) Sessions(ctx context.Context, memberID string) ([]domain.MemberSession, error) {
	return s.sessions.ListByMember(ctx, memberID, s.Now().UTC())
}

func (s *MemberService) SignOutOthers(ctx context.Context, memberID, keepID string) (int64, error) {
	return s.sessions.DeleteByMemberExcept(ctx, memberID, keepID)
}

// UnlinkGoogle removes the Google identity (idempotent); refused when it is
// the only way to sign in.
func (s *MemberService) UnlinkGoogle(ctx context.Context, m domain.Member) error {
	if !m.HasPassword() {
		return domain.ErrLastLoginMethod
	}
	if err := s.members.DeleteIdentity(ctx, m.ID, domain.ProviderGoogle); err != nil && !errors.Is(err, domain.ErrNotFound) {
		return err
	}
	return nil
}

type MemberExport struct {
	Member     domain.Member
	Identities []domain.MemberIdentity
	Data       repository.MemberExport
	Sessions   []domain.MemberSession
}

func (s *MemberService) Export(ctx context.Context, m domain.Member) (MemberExport, error) {
	data, err := s.members.Export(ctx, m.ID)
	if err != nil {
		return MemberExport{}, err
	}
	sess, err := s.Sessions(ctx, m.ID)
	if err != nil {
		return MemberExport{}, err
	}
	return MemberExport{Member: m, Identities: data.Identities, Data: data, Sessions: sess}, nil
}

type DeleteAccountInput struct {
	CurrentPassword string `json:"current_password"`
	Confirm         string `json:"confirm"`
}

// DeleteAccount removes the account (see repository.Members.Delete); files
// are deleted after the commit and the affected posts revalidated.
func (s *MemberService) DeleteAccount(ctx context.Context, m domain.Member, in DeleteAccountInput) error {
	if strings.TrimSpace(in.Confirm) != domain.DeleteAccountConfirm {
		return &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"confirm": "กรุณาพิมพ์คำว่า \"ลบบัญชี\" เพื่อยืนยัน"}}
	}
	if m.HasPassword() {
		if err := s.verifyCurrent(ctx, m, in.CurrentPassword); err != nil {
			return err
		}
	}
	res, err := s.members.Delete(ctx, m.ID)
	if err != nil {
		return err
	}
	s.deleteFile(res.AvatarKey)
	for _, k := range res.ImageKeys {
		s.deleteFile(k)
	}
	if tags := commentTags(res.AffectedSlugs...); len(tags) > 0 {
		s.rv.Revalidate(tags...)
	}
	s.log.Info("member account deleted", "member_id", m.ID, "comments_posts", len(res.AffectedSlugs))
	return nil
}

// commentTags returns comments:<slug> per distinct slug.
func commentTags(slugs ...string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range slugs {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, "comments:"+s)
		}
	}
	return out
}

// ---- Google identities (used by GoogleService) ----

// googleLinkPayload is the encrypted content of a link_google token.
type googleLinkPayload struct {
	Sub     string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

// LinkGoogle redeems a link_google token with the account password and
// signs the member in.
func (s *MemberService) LinkGoogle(ctx context.Context, token, password string, meta RequestMeta) (MemberAuth, error) {
	if token == "" || len(token) > 256 {
		return MemberAuth{}, domain.ErrTokenInvalid
	}
	t, err := s.tokens.GetUsable(ctx, HashToken(token), []domain.MemberTokenPurpose{domain.TokenLinkGoogle}, s.Now().UTC())
	if err != nil {
		return MemberAuth{}, err
	}
	pt, err := s.tokenPayload(t)
	if err != nil || t.MemberID == nil {
		return MemberAuth{}, domain.ErrTokenInvalid
	}
	var p googleLinkPayload
	if err := json.Unmarshal(pt, &p); err != nil || p.Sub == "" {
		return MemberAuth{}, domain.ErrTokenInvalid
	}
	m, err := s.members.GetByID(ctx, *t.MemberID)
	if err != nil {
		return MemberAuth{}, domain.ErrTokenInvalid
	}
	ok := false
	if m.HasPassword() && password != "" && len(password) <= 4*vault.MaxPasswordRunes {
		if ok, err = s.crypto.Hasher.Verify(ctx, m.PasswordHash, password); err != nil && !errors.Is(err, vault.ErrBadHash) {
			return MemberAuth{}, err
		}
	} else {
		s.crypto.Hasher.DummyVerify(ctx, password)
	}
	if !ok {
		s.log.Warn("member google link: wrong password", "member_id", m.ID)
		return MemberAuth{}, domain.ErrInvalidCredentials
	}
	if m.Banned() {
		return MemberAuth{}, domain.ErrMemberBanned
	}
	now := s.Now().UTC()
	ident := domain.MemberIdentity{MemberID: m.ID, Provider: domain.ProviderGoogle,
		SubjectHash: s.crypto.Index.Subject(domain.ProviderGoogle, p.Sub), LastUsedAt: &now}
	if err := s.tokens.ConsumeLink(ctx, t.ID, &ident, now); err != nil {
		if errors.Is(err, domain.ErrConflict) {
			return MemberAuth{}, domain.ErrConflict
		}
		return MemberAuth{}, err
	}
	m, err = s.reload(ctx, m.ID)
	if err != nil {
		return MemberAuth{}, err
	}
	s.log.Info("member google linked (password)", "member_id", m.ID)
	return s.startSession(ctx, m, meta)
}

// ---- login failure counter (Turnstile after 3 failures per IP) ----

type failureCounter struct {
	mu     sync.Mutex
	window time.Duration
	hits   map[string][]time.Time
}

func newFailureCounter(window time.Duration) *failureCounter {
	return &failureCounter{window: window, hits: map[string][]time.Time{}}
}

func (f *failureCounter) prune(key string, now time.Time) []time.Time {
	hs := f.hits[key]
	i := 0
	for i < len(hs) && now.Sub(hs[i]) > f.window {
		i++
	}
	hs = hs[i:]
	if len(hs) == 0 {
		delete(f.hits, key)
	} else {
		f.hits[key] = hs
	}
	return hs
}

func (f *failureCounter) add(key string, now time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	hs := f.prune(key, now)
	if len(hs) >= 32 {
		hs = hs[1:]
	}
	f.hits[key] = append(hs, now)
	if len(f.hits) > 50000 { // bound memory under a spray of IPs
		for k := range f.hits {
			f.prune(k, now)
		}
	}
}

func (f *failureCounter) count(key string, now time.Time) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.prune(key, now))
}

func (f *failureCounter) reset(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.hits, key)
}
