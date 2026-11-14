package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
)

type sentMail struct{ to, subject, body string }

type recMailer struct {
	mu   sync.Mutex
	sent []sentMail
}

func (m *recMailer) Send(to, subject, body string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, sentMail{to, subject, body})
	return true
}

type idEnv struct {
	t     *testing.T
	ctx   context.Context
	store *fake.Store
	auth  *AuthService
	users *UserService
	acct  *AccountService
	audit *AuditService
	mail  *recMailer
	owner domain.AdminUser
	now   time.Time
	// secrets seen during the test; none may appear in audit metadata
	secrets []string
}

var reqMeta = RequestMeta{IP: "203.0.113.9", UserAgent: "test-agent"}

func newIdentity(t *testing.T) *idEnv {
	t.Helper()
	store := fake.New()
	e := &idEnv{t: t, ctx: context.Background(), store: store, mail: &recMailer{},
		now: time.Date(2026, 11, 14, 3, 0, 0, 0, time.UTC)}
	clock := func() time.Time { return e.now }
	store.Now = clock
	e.audit = NewAuditService(store.AuditRepo(), discard)
	e.auth = NewAuthService(store.AdminUsersRepo(), store.SessionsRepo(), 24*time.Hour, bcrypt.MinCost, discard)
	e.auth.SetAuditor(e.audit)
	e.auth.Now = clock
	e.users = NewUserService(store.AdminUsersRepo(), store.SessionsRepo(), store.TokensRepo(), e.auth, e.audit, e.mail,
		UserServiceConfig{InviteTTL: 72 * time.Hour, WebBaseURL: "https://www.example.com/"}, discard)
	e.users.Now = clock
	e.acct = NewAccountService(store.AdminUsersRepo(), store.SessionsRepo(), e.auth, e.audit, discard)
	e.acct.Now = clock
	if out, err := e.auth.EnsureAdmin(e.ctx, "owner@example.com", testPassword, "Owner", false); err != nil ||
		out != "created" {
		t.Fatalf("bootstrap: %s %v", out, err)
	}
	e.owner = e.user("owner@example.com")
	e.secrets = []string{testPassword}
	return e
}

func (e *idEnv) user(email string) domain.AdminUser {
	e.t.Helper()
	u, err := e.store.AdminUsersRepo().GetByEmail(e.ctx, email)
	if err != nil {
		e.t.Fatalf("user %s: %v", email, err)
	}
	return u
}

func actorOf(u domain.AdminUser) domain.Actor { return UserActor(u, reqMeta) }

// addUser creates a user with the role through the real invite flow.
func (e *idEnv) addUser(email string, role domain.Role) (domain.AdminUser, LoginResult) {
	e.t.Helper()
	inv, err := e.users.Invite(e.ctx, actorOf(e.owner), InviteInput{Email: email, Role: string(role)})
	if err != nil {
		e.t.Fatal(err)
	}
	e.secrets = append(e.secrets, inv.Token)
	res, err := e.users.AcceptToken(e.ctx, AcceptInput{Token: inv.Token, Name: "ผู้ใช้ " + string(role),
		Password: testPassword}, reqMeta)
	if err != nil {
		e.t.Fatal(err)
	}
	e.secrets = append(e.secrets, res.Token, res.CSRFToken)
	return res.User, res
}

func (e *idEnv) login(email string) LoginResult {
	e.t.Helper()
	res, err := e.auth.Login(e.ctx, email, testPassword, reqMeta)
	if err != nil {
		e.t.Fatalf("login %s: %v", email, err)
	}
	e.secrets = append(e.secrets, res.Token, res.CSRFToken)
	return res
}

func (e *idEnv) valid(token string) bool {
	_, _, err := e.auth.Authenticate(e.ctx, token)
	return err == nil
}

func (e *idEnv) actions() []string {
	var out []string
	for _, a := range e.store.AuditEntries() {
		out = append(out, a.Action)
	}
	return out
}

func (e *idEnv) lastAudit(action string) domain.AuditEntry {
	e.t.Helper()
	es := e.store.AuditEntries()
	for i := len(es) - 1; i >= 0; i-- {
		if es[i].Action == action {
			return es[i]
		}
	}
	e.t.Fatalf("no audit %q in %v", action, e.actions())
	return domain.AuditEntry{}
}

// assertNoSecretsInAudit: no metadata key looks secret and no secret value
// (passwords, raw tokens, CSRF tokens, hashes) appears anywhere in a row.
func (e *idEnv) assertNoSecretsInAudit() {
	e.t.Helper()
	for _, a := range e.store.AuditEntries() {
		for k := range a.Metadata {
			if secretKey(k) {
				e.t.Errorf("%s: secret-looking metadata key %q", a.Action, k)
			}
		}
		b, _ := json.Marshal(a)
		for _, s := range e.secrets {
			if s != "" && strings.Contains(string(b), s) {
				e.t.Errorf("%s: secret value leaked into audit row %s", a.Action, b)
			}
		}
		for _, u := range []string{e.owner.PasswordHash} {
			if strings.Contains(string(b), u) {
				e.t.Errorf("%s: password hash leaked", a.Action)
			}
		}
	}
}

func wantErr(t *testing.T, err, target error) {
	t.Helper()
	if !errors.Is(err, target) {
		t.Fatalf("want %v, got %v", target, err)
	}
}

func ptr[T any](v T) *T { return &v }

// ---- last-owner protection ----

func TestLastOwnerProtection(t *testing.T) {
	e := newIdentity(t)
	owner := actorOf(e.owner)

	_, err := e.users.Update(e.ctx, owner, e.owner.ID, UserPatch{Role: ptr("editor")})
	wantErr(t, err, domain.ErrLastOwner)
	_, err = e.users.Update(e.ctx, owner, e.owner.ID, UserPatch{IsActive: ptr(false)})
	wantErr(t, err, domain.ErrLastOwner)
	var ve *domain.ValidationError
	if err := e.users.Delete(e.ctx, owner, e.owner.ID); !errors.As(err, &ve) || ve.Message != domain.MsgCannotDeleteSelf {
		t.Fatalf("self delete must be a 422: %v", err)
	}
	// the repository refuses the last owner even without the service guard
	_, err = e.store.AdminUsersRepo().Delete(e.ctx, e.owner.ID)
	wantErr(t, err, domain.ErrLastOwner)
	if u := e.user("owner@example.com"); u.Role != domain.RoleOwner || !u.IsActive {
		t.Fatalf("owner changed: %+v", u)
	}

	// with two active owners, demoting / deactivating one is fine
	b, _ := e.addUser("b@example.com", domain.RoleOwner)
	got, err := e.users.Update(e.ctx, owner, b.ID, UserPatch{IsActive: ptr(false)})
	if err != nil || got.IsActive {
		t.Fatalf("deactivate second owner: %v %+v", err, got)
	}
	// ...but now A is the last ACTIVE owner again (an inactive owner does not count)
	_, err = e.users.Update(e.ctx, owner, e.owner.ID, UserPatch{Role: ptr("viewer")})
	wantErr(t, err, domain.ErrLastOwner)
	if _, err := e.users.Update(e.ctx, owner, b.ID, UserPatch{IsActive: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	// self-demotion with another active owner is allowed
	got, err = e.users.Update(e.ctx, owner, e.owner.ID, UserPatch{Role: ptr("editor")})
	if err != nil || got.Role != domain.RoleEditor {
		t.Fatalf("self demotion: %v %+v", err, got)
	}
	// B is now the only owner: deleting B (by a still-"owner" actor snapshot) fails
	err = e.users.Delete(e.ctx, owner, b.ID)
	wantErr(t, err, domain.ErrLastOwner)
	n, _ := e.store.AdminUsersRepo().CountActiveOwners(e.ctx)
	if n != 1 {
		t.Fatalf("active owners = %d", n)
	}
}

func TestDeleteUserWithTwoOwners(t *testing.T) {
	e := newIdentity(t)
	b, res := e.addUser("b@example.com", domain.RoleOwner)
	if err := e.users.Delete(e.ctx, actorOf(e.owner), b.ID); err != nil {
		t.Fatal(err)
	}
	if e.valid(res.Token) {
		t.Fatal("deleted user's session must die")
	}
	a := e.lastAudit(domain.AuditUserDelete)
	if a.TargetID != b.ID || a.Metadata["email"] != "b@example.com" {
		t.Fatalf("audit: %+v", a)
	}
	wantErr(t, e.users.Delete(e.ctx, actorOf(e.owner), b.ID), domain.ErrNotFound)
}

func TestNoSelfElevation(t *testing.T) {
	e := newIdentity(t)
	ed, _ := e.addUser("ed@example.com", domain.RoleEditor)
	_, err := e.users.Update(e.ctx, actorOf(ed), ed.ID, UserPatch{Role: ptr("owner")})
	wantErr(t, err, domain.ErrSelfElevation)
	_, err = e.users.Update(e.ctx, actorOf(ed), ed.ID, UserPatch{Role: ptr("sales")})
	wantErr(t, err, domain.ErrSelfElevation) // sales grants leads perms an editor lacks
	_, err = e.users.Update(e.ctx, actorOf(ed), e.owner.ID, UserPatch{IsActive: ptr(false)})
	wantErr(t, err, domain.ErrForbidden)
	_, err = e.users.Invite(e.ctx, actorOf(ed), InviteInput{Email: "x@example.com", Role: "viewer"})
	wantErr(t, err, domain.ErrForbidden)
	if u := e.user("ed@example.com"); u.Role != domain.RoleEditor {
		t.Fatalf("role changed: %s", u.Role)
	}
	// invalid input
	if f := fieldErrs(t, func() error {
		_, err := e.users.Update(e.ctx, actorOf(e.owner), ed.ID, UserPatch{Role: ptr("admin")})
		return err
	}()); f["role"] == "" {
		t.Fatalf("bad role: %v", f)
	}
	if f := fieldErrs(t, func() error { _, err := e.users.Update(e.ctx, actorOf(e.owner), ed.ID, UserPatch{}); return err }()); f["role"] == "" {
		t.Fatalf("empty patch: %v", f)
	}
}

func TestRoleChangeAndDeactivationKillSessions(t *testing.T) {
	e := newIdentity(t)
	owner := actorOf(e.owner)
	ed, first := e.addUser("ed@example.com", domain.RoleEditor)
	second := e.login("ed@example.com")
	ownerSess := e.login("owner@example.com")

	got, err := e.users.Update(e.ctx, owner, ed.ID, UserPatch{Role: ptr("sales")})
	if err != nil || got.Role != domain.RoleSales {
		t.Fatal(err)
	}
	a := e.lastAudit(domain.AuditUserRoleChange)
	if a.Metadata["from"] != "editor" || a.Metadata["to"] != "sales" || a.TargetID != ed.ID || *a.ActorID != e.owner.ID {
		t.Fatalf("role audit: %+v", a)
	}
	if !e.valid(first.Token) {
		t.Fatal("a role change must not log the user out")
	}

	if _, err := e.users.IssueReset(e.ctx, owner, ed.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.users.Update(e.ctx, owner, ed.ID, UserPatch{IsActive: ptr(false)}); err != nil {
		t.Fatal(err)
	}
	if e.valid(first.Token) || e.valid(second.Token) {
		t.Fatal("deactivation must kill every session immediately")
	}
	for _, s := range e.store.Sessions() {
		if s.AdminUserID == ed.ID {
			t.Fatal("session rows of a deactivated user must be deleted")
		}
	}
	for _, tk := range e.store.Tokens() {
		if tk.Purpose == domain.TokenReset && tk.Open() {
			t.Fatal("deactivation must revoke open reset links")
		}
	}
	if !e.valid(ownerSess.Token) {
		t.Fatal("other users unaffected")
	}
	if _, err := e.auth.Login(e.ctx, "ed@example.com", testPassword, reqMeta); !errors.Is(err, domain.ErrUnauthorized) {
		t.Fatal("inactive user must not log in")
	}
	// GetValid also rejects an inactive user whose session row survived
	sneaky := e.login("owner@example.com")
	e.store.SetActive(e.owner.ID, false)
	if e.valid(sneaky.Token) {
		t.Fatal("GetValid must reject inactive users")
	}
	e.store.SetActive(e.owner.ID, true)

	if _, err := e.users.Update(e.ctx, owner, ed.ID, UserPatch{IsActive: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if e.valid(first.Token) {
		t.Fatal("reactivation must not resurrect old sessions")
	}
	for _, want := range []string{domain.AuditUserDeactivate, domain.AuditUserReactivate} {
		if a := e.lastAudit(want); a.TargetID != ed.ID {
			t.Fatalf("%s target %s", want, a.TargetID)
		}
	}
}

// ---- tokens ----

func TestInviteAcceptFlow(t *testing.T) {
	e := newIdentity(t)
	owner := actorOf(e.owner)
	inv, err := e.users.Invite(e.ctx, owner, InviteInput{Email: " New@Example.com ", Role: "sales"})
	if err != nil {
		t.Fatal(err)
	}
	e.secrets = append(e.secrets, inv.Token)
	if inv.Invite.Email != "new@example.com" || *inv.Invite.Role != domain.RoleSales || inv.Invite.Expired ||
		!inv.Invite.ExpiresAt.Equal(e.now.Add(72*time.Hour)) || inv.Invite.CreatedBy.ID != e.owner.ID || !inv.EmailSent {
		t.Fatalf("invite: %+v", inv)
	}
	if len(e.mail.sent) != 1 || e.mail.sent[0].to != "new@example.com" ||
		!strings.Contains(e.mail.sent[0].body, "https://www.example.com/admin/invite#token="+inv.Token) ||
		!strings.Contains(e.mail.sent[0].body, "ฝ่ายขาย") {
		t.Fatalf("mail: %+v", e.mail.sent)
	}
	for _, tk := range e.store.Tokens() {
		if strings.Contains(string(tk.TokenHash), inv.Token) || string(tk.TokenHash) != string(HashToken(inv.Token)) {
			t.Fatal("only the SHA-256 of the token may be stored")
		}
	}
	list, _ := e.users.ListInvites(e.ctx)
	if len(list) != 1 || list[0].CreatedBy.Email != "owner@example.com" {
		t.Fatalf("list: %+v", list)
	}

	info, err := e.users.InspectToken(e.ctx, inv.Token)
	if err != nil || info.Purpose != domain.TokenInvite || info.Email != "new@example.com" || *info.Role != domain.RoleSales {
		t.Fatalf("inspect: %+v %v", info, err)
	}

	// validation happens before anything is consumed
	f := fieldErrs(t, func() error {
		_, err := e.users.AcceptToken(e.ctx, AcceptInput{Token: inv.Token, Name: "", Password: "short"}, reqMeta)
		return err
	}())
	if f["name"] == "" || f["password"] == "" {
		t.Fatalf("fields: %v", f)
	}
	res, err := e.users.AcceptToken(e.ctx, AcceptInput{Token: inv.Token, Name: " สมหญิง ", Password: testPassword},
		reqMeta)
	if err != nil {
		t.Fatal(err)
	}
	if res.User.Role != domain.RoleSales || res.User.Name != "สมหญิง" || res.User.Email != "new@example.com" ||
		res.User.InvitedBy == nil || *res.User.InvitedBy != e.owner.ID || !res.User.IsActive {
		t.Fatalf("user: %+v", res.User)
	}
	if !e.valid(res.Token) {
		t.Fatal("accept must log the user in")
	}
	// single use
	_, err = e.users.AcceptToken(e.ctx, AcceptInput{Token: inv.Token, Name: "x", Password: testPassword}, reqMeta)
	wantErr(t, err, domain.ErrTokenInvalid)
	_, err = e.users.InspectToken(e.ctx, inv.Token)
	wantErr(t, err, domain.ErrTokenInvalid)
	if list, _ := e.users.ListInvites(e.ctx); len(list) != 0 {
		t.Fatalf("used invite still listed: %+v", list)
	}
	a := e.lastAudit(domain.AuditUserInviteAccept)
	if *a.ActorID != res.User.ID || a.Metadata["role"] != "sales" {
		t.Fatalf("accept audit: %+v", a)
	}
	// existing user -> conflict, for any casing
	_, err = e.users.Invite(e.ctx, owner, InviteInput{Email: "NEW@example.com", Role: "viewer"})
	wantErr(t, err, domain.ErrEmailTaken)
	e.assertNoSecretsInAudit()
}

func TestInviteExpiredRevokedAndBadTokens(t *testing.T) {
	e := newIdentity(t)
	owner := actorOf(e.owner)
	inv, _ := e.users.Invite(e.ctx, owner, InviteInput{Email: "late@example.com", Role: "viewer"})
	e.now = e.now.Add(72 * time.Hour) // exactly at expiry -> expired
	_, err := e.users.InspectToken(e.ctx, inv.Token)
	wantErr(t, err, domain.ErrTokenInvalid)
	_, err = e.users.AcceptToken(e.ctx, AcceptInput{Token: inv.Token, Name: "x", Password: testPassword}, reqMeta)
	wantErr(t, err, domain.ErrTokenInvalid)
	if list, _ := e.users.ListInvites(e.ctx); len(list) != 1 || !list[0].Expired {
		t.Fatalf("expired invite must be listed as expired: %+v", list)
	}

	// resend renews it and rotates the token: the old one keeps failing
	re, err := e.users.ResendInvite(e.ctx, owner, inv.Invite.ID)
	if err != nil || re.Token == inv.Token || re.Invite.Expired || re.Invite.ID != inv.Invite.ID {
		t.Fatalf("resend: %+v %v", re, err)
	}
	_, err = e.users.InspectToken(e.ctx, inv.Token)
	wantErr(t, err, domain.ErrTokenInvalid)
	if _, err := e.users.InspectToken(e.ctx, re.Token); err != nil {
		t.Fatalf("rotated token: %v", err)
	}

	// revoke
	if err := e.users.RevokeInvite(e.ctx, owner, inv.Invite.ID); err != nil {
		t.Fatal(err)
	}
	_, err = e.users.AcceptToken(e.ctx, AcceptInput{Token: re.Token, Name: "x", Password: testPassword}, reqMeta)
	wantErr(t, err, domain.ErrTokenInvalid)
	wantErr(t, e.users.RevokeInvite(e.ctx, owner, inv.Invite.ID), domain.ErrNotFound)
	_, err = e.users.ResendInvite(e.ctx, owner, inv.Invite.ID)
	wantErr(t, err, domain.ErrNotFound)

	for _, bad := range []string{"", "   ", "nope", strings.Repeat("a", 300)} {
		_, err := e.users.InspectToken(e.ctx, bad)
		wantErr(t, err, domain.ErrTokenInvalid)
	}

	// a new invite for the same email revokes the open one
	a, _ := e.users.Invite(e.ctx, owner, InviteInput{Email: "dup@example.com", Role: "viewer"})
	b, err := e.users.Invite(e.ctx, owner, InviteInput{Email: "dup@example.com", Role: "editor"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.users.InspectToken(e.ctx, a.Token)
	wantErr(t, err, domain.ErrTokenInvalid)
	if info, err := e.users.InspectToken(e.ctx, b.Token); err != nil || *info.Role != domain.RoleEditor {
		t.Fatalf("second invite: %v", err)
	}

	// someone created the account meanwhile: accept -> conflict, token stays open
	if _, err := e.auth.EnsureAdmin(e.ctx, "dup@example.com", testPassword, "x", false); err != nil {
		t.Fatal(err)
	}
	_, err = e.users.AcceptToken(e.ctx, AcceptInput{Token: b.Token, Name: "x", Password: testPassword}, reqMeta)
	wantErr(t, err, domain.ErrEmailTaken)
	_, err = e.users.ResendInvite(e.ctx, owner, b.Invite.ID)
	wantErr(t, err, domain.ErrEmailTaken)

	for _, want := range []string{domain.AuditUserInvite, domain.AuditUserInviteResend, domain.AuditUserInviteRevoke} {
		e.lastAudit(want)
	}
	e.secrets = append(e.secrets, inv.Token, re.Token, a.Token, b.Token)
	e.assertNoSecretsInAudit()
}

func TestResetLinkFlow(t *testing.T) {
	e := newIdentity(t)
	owner := actorOf(e.owner)
	ed, s1 := e.addUser("ed@example.com", domain.RoleEditor)
	s2 := e.login("ed@example.com")
	ownerSess := e.login("owner@example.com")

	first, err := e.users.IssueReset(e.ctx, owner, ed.ID)
	if err != nil || !first.EmailSent || !first.ExpiresAt.Equal(e.now.Add(72*time.Hour)) {
		t.Fatalf("issue: %+v %v", first, err)
	}
	second, _ := e.users.IssueReset(e.ctx, owner, ed.ID)
	e.secrets = append(e.secrets, first.Token, second.Token)
	_, err = e.users.InspectToken(e.ctx, first.Token)
	wantErr(t, err, domain.ErrTokenInvalid) // previous reset link revoked

	info, err := e.users.InspectToken(e.ctx, second.Token)
	if err != nil || info.Purpose != domain.TokenReset || info.Email != "ed@example.com" || info.Role != nil ||
		info.Name != ed.Name {
		t.Fatalf("inspect: %+v %v", info, err)
	}
	last := e.mail.sent[len(e.mail.sent)-1]
	if last.to != "ed@example.com" || !strings.Contains(last.body, "#token="+second.Token) {
		t.Fatalf("reset mail: %+v", last)
	}

	const newPw = "a-brand-new-password"
	e.secrets = append(e.secrets, newPw)
	res, err := e.users.AcceptToken(e.ctx, AcceptInput{Token: second.Token, Password: newPw}, reqMeta)
	if err != nil {
		t.Fatal(err)
	}
	if e.valid(s1.Token) || e.valid(s2.Token) {
		t.Fatal("reset must revoke ALL previous sessions of the user")
	}
	if !e.valid(res.Token) || !e.valid(ownerSess.Token) {
		t.Fatal("new session valid, other users unaffected")
	}
	if u := e.user("ed@example.com"); u.PasswordChangedAt == nil || !u.PasswordChangedAt.Equal(e.now) {
		t.Fatalf("password_changed_at: %+v", u.PasswordChangedAt)
	}
	if _, err := e.auth.Login(e.ctx, "ed@example.com", newPw, reqMeta); err != nil {
		t.Fatal("new password must work")
	}
	if _, err := e.auth.Login(e.ctx, "ed@example.com", testPassword, reqMeta); err == nil {
		t.Fatal("old password must not work")
	}
	_, err = e.users.AcceptToken(e.ctx, AcceptInput{Token: second.Token, Password: newPw}, reqMeta)
	wantErr(t, err, domain.ErrTokenInvalid)
	if a := e.lastAudit(domain.AuditPasswordReset); *a.ActorID != ed.ID {
		t.Fatalf("reset audit: %+v", a)
	}
	if a := e.lastAudit(domain.AuditUserResetIssue); a.TargetID != ed.ID || *a.ActorID != e.owner.ID {
		t.Fatalf("issue audit: %+v", a)
	}

	// deactivated user: no link, and an outstanding link stops working
	third, _ := e.users.IssueReset(e.ctx, owner, ed.ID)
	e.store.SetActive(ed.ID, false)
	_, err = e.users.InspectToken(e.ctx, third.Token)
	wantErr(t, err, domain.ErrTokenInvalid)
	_, err = e.users.AcceptToken(e.ctx, AcceptInput{Token: third.Token, Password: newPw}, reqMeta)
	wantErr(t, err, domain.ErrTokenInvalid)
	_, err = e.users.IssueReset(e.ctx, owner, ed.ID)
	if len(fieldErrs(t, err)) != 0 || err == nil {
		t.Fatalf("issue for inactive user must be a 422: %v", err)
	}
	_, err = e.users.IssueReset(e.ctx, owner, "00000000-0000-0000-0000-000000000000")
	wantErr(t, err, domain.ErrNotFound)
	e.secrets = append(e.secrets, third.Token)
	e.assertNoSecretsInAudit()
}

func TestLinksNotEmailedWithoutWebBaseURL(t *testing.T) {
	e := newIdentity(t)
	e.users.cfg.WebBaseURL = ""
	inv, err := e.users.Invite(e.ctx, actorOf(e.owner), InviteInput{Email: "n@example.com", Role: "viewer"})
	if err != nil || inv.EmailSent || len(e.mail.sent) != 0 {
		t.Fatalf("email_sent=%v mails=%d err=%v", inv.EmailSent, len(e.mail.sent), err)
	}
	// nil mailer (no transport) behaves the same
	e.users.cfg.WebBaseURL, e.users.mailer = "https://www.example.com", nil
	re, err := e.users.ResendInvite(e.ctx, actorOf(e.owner), inv.Invite.ID)
	if err != nil || re.EmailSent {
		t.Fatalf("resend without mailer: %+v %v", re, err)
	}
}

// ---- self-service ----

func TestChangePassword(t *testing.T) {
	e := newIdentity(t)
	cur := e.login("owner@example.com")
	other := e.login("owner@example.com")
	sess, _, _ := e.auth.Authenticate(e.ctx, cur.Token)
	owner := actorOf(e.owner)

	err := e.acct.ChangePassword(e.ctx, owner, sess.ID, PasswordChange{CurrentPassword: "wrong-password-1",
		NewPassword: "another-password-1"})
	if f := fieldErrs(t, err); f["current_password"] != domain.MsgWrongCurrentPass {
		t.Fatalf("wrong current: %v", err)
	}
	err = e.acct.ChangePassword(e.ctx, owner, sess.ID, PasswordChange{CurrentPassword: testPassword, NewPassword: "short"})
	if f := fieldErrs(t, err); f["new_password"] == "" {
		t.Fatalf("short new: %v", err)
	}
	err = e.acct.ChangePassword(e.ctx, owner, sess.ID, PasswordChange{CurrentPassword: testPassword, NewPassword: testPassword})
	if f := fieldErrs(t, err); f["new_password"] == "" {
		t.Fatalf("same password: %v", err)
	}
	if !e.valid(other.Token) {
		t.Fatal("failed attempts must not revoke sessions")
	}

	const newPw = "another-password-1"
	e.secrets = append(e.secrets, newPw)
	if err := e.acct.ChangePassword(e.ctx, owner, sess.ID, PasswordChange{CurrentPassword: testPassword,
		NewPassword: newPw}); err != nil {
		t.Fatal(err)
	}
	if !e.valid(cur.Token) || e.valid(other.Token) {
		t.Fatal("must keep the current session and revoke the others")
	}
	if _, err := e.auth.Login(e.ctx, "owner@example.com", newPw, reqMeta); err != nil {
		t.Fatal(err)
	}
	a := e.lastAudit(domain.AuditPasswordChange)
	if a.Metadata["sessions_revoked"] != float64(1) {
		t.Fatalf("audit: %+v", a.Metadata)
	}
	e.assertNoSecretsInAudit()
}

func TestProfileSessionsAndSignOutOthers(t *testing.T) {
	e := newIdentity(t)
	owner := actorOf(e.owner)
	if _, err := e.acct.UpdateProfile(e.ctx, owner, "  "); fieldErrs(t, err)["name"] == "" {
		t.Fatal("empty name must fail")
	}
	u, err := e.acct.UpdateProfile(e.ctx, owner, " เจ้าของ ")
	if err != nil || u.Name != "เจ้าของ" {
		t.Fatalf("profile: %+v %v", u, err)
	}
	e.lastAudit(domain.AuditProfileUpdate)

	a := e.login("owner@example.com")
	e.now = e.now.Add(time.Minute)
	b := e.login("owner@example.com")
	ed, _ := e.addUser("ed@example.com", domain.RoleEditor)
	sa, _, _ := e.auth.Authenticate(e.ctx, a.Token)
	list, err := e.acct.Sessions(e.ctx, e.owner.ID)
	if err != nil || len(list) != 2 || !list[0].CreatedAt.After(list[1].CreatedAt) {
		t.Fatalf("sessions: %+v %v", list, err)
	}
	n, err := e.acct.SignOutOthers(e.ctx, owner, sa.ID)
	if err != nil || n != 1 || !e.valid(a.Token) || e.valid(b.Token) {
		t.Fatalf("sign out others: n=%d err=%v", n, err)
	}
	if list, _ := e.acct.Sessions(e.ctx, ed.ID); len(list) != 1 {
		t.Fatal("other users' sessions untouched")
	}
	if got := e.lastAudit(domain.AuditSessionsRevoke); got.Metadata["revoked"] != float64(1) {
		t.Fatalf("audit: %+v", got)
	}
}

func TestSessionTouchThrottled(t *testing.T) {
	e := newIdentity(t)
	res := e.login("owner@example.com")
	base := e.store.Touches()
	for i := 0; i < 5; i++ {
		e.now = e.now.Add(5 * time.Second)
		if !e.valid(res.Token) {
			t.Fatal("session")
		}
	}
	if got := e.store.Touches() - base; got != 1 {
		t.Fatalf("touches within a minute = %d, want 1", got)
	}
	e.now = e.now.Add(61 * time.Second)
	e.valid(res.Token)
	if got := e.store.Touches() - base; got != 2 {
		t.Fatalf("touches after a minute = %d, want 2", got)
	}
	sess, _, _ := e.auth.Authenticate(e.ctx, res.Token)
	if sess.LastSeenAt == nil || !sess.LastSeenAt.Equal(e.now) {
		t.Fatalf("last_seen_at = %v", sess.LastSeenAt)
	}
}

// ---- audit ----

func TestLoginLogoutAudited(t *testing.T) {
	e := newIdentity(t)
	if _, err := e.auth.Login(e.ctx, "owner@example.com", "wrong-password-xx", reqMeta); err == nil {
		t.Fatal("bad password")
	}
	if _, err := e.auth.Login(e.ctx, "ghost@example.com", "wrong-password-yy", reqMeta); err == nil {
		t.Fatal("unknown user")
	}
	e.secrets = append(e.secrets, "wrong-password-xx", "wrong-password-yy")
	es := e.store.AuditEntries()
	if len(es) != 2 || es[0].Action != domain.AuditLoginFailed || es[0].Metadata["email"] != "owner@example.com" ||
		es[1].Metadata["email"] != "ghost@example.com" || es[0].ActorID != nil || es[0].IP != reqMeta.IP {
		t.Fatalf("failed logins: %+v", es)
	}
	res := e.login("owner@example.com")
	a := e.lastAudit(domain.AuditLoginSuccess)
	if *a.ActorID != e.owner.ID || a.ActorEmail != "owner@example.com" || a.UserAgent != "test-agent" {
		t.Fatalf("login audit: %+v", a)
	}
	if err := e.auth.Logout(e.ctx, res.Token, actorOf(e.owner)); err != nil {
		t.Fatal(err)
	}
	e.lastAudit(domain.AuditLogout)
	e.assertNoSecretsInAudit()
}

type failingAudit struct{ calls int }

func (f *failingAudit) Insert(context.Context, domain.AuditEvent) error {
	f.calls++
	return errors.New("db down")
}
func (f *failingAudit) List(context.Context, repository.AuditFilter) ([]domain.AuditEntry, int, error) {
	return nil, 0, nil
}

func TestAuditSanitizesAndSwallowsErrors(t *testing.T) {
	store := fake.New()
	svc := NewAuditService(store.AuditRepo(), discard)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // a cancelled request still gets its audit row
	svc.Record(ctx, domain.AuditEvent{Action: domain.AuditUserInvite, Metadata: map[string]any{
		"email": "a@example.com", "password": "x", "new_password": "y", "token": "t", "TokenHash": "h",
		"csrf_token": "c", "nested": map[string]any{"secret": "s", "ok": 1}}})
	es := store.AuditEntries()
	if len(es) != 1 {
		t.Fatal("not recorded")
	}
	m := es[0].Metadata
	if len(m) != 2 || m["email"] != "a@example.com" || len(m["nested"].(map[string]any)) != 1 {
		t.Fatalf("metadata: %v", m)
	}
	f := &failingAudit{}
	NewAuditService(f, discard).Record(context.Background(), domain.AuditEvent{Action: "auth.login"})
	if f.calls != 1 {
		t.Fatal("insert not attempted")
	}
}

func TestAuditList(t *testing.T) {
	e := newIdentity(t)
	e.login("owner@example.com")                            // 2026-11-14 03:00 UTC = 10:00 Bangkok
	e.now = time.Date(2026, 11, 14, 17, 30, 0, 0, time.UTC) // 2026-11-15 00:30 Bangkok
	_, _ = e.auth.Login(e.ctx, "owner@example.com", "bad-password-123", reqMeta)

	list, page, total, err := e.audit.List(e.ctx, AuditQuery{From: "2026-11-14", To: "2026-11-14"})
	if err != nil || total != 1 || list[0].Action != domain.AuditLoginSuccess || page.PerPage != 50 {
		t.Fatalf("day 14: %d %+v %v", total, list, err)
	}
	if list[0].ActorName != "Owner" {
		t.Fatalf("actor name join: %q", list[0].ActorName)
	}
	_, _, total, _ = e.audit.List(e.ctx, AuditQuery{From: "2026-11-15"})
	if total != 1 {
		t.Fatalf("day 15: %d", total)
	}
	_, _, total, _ = e.audit.List(e.ctx, AuditQuery{Action: domain.AuditLoginFailed, PerPage: 500})
	if total != 1 {
		t.Fatalf("action filter: %d", total)
	}
	_, _, total, _ = e.audit.List(e.ctx, AuditQuery{ActorID: e.owner.ID})
	if total != 1 {
		t.Fatalf("actor filter: %d", total)
	}
	_, page, _, _ = e.audit.List(e.ctx, AuditQuery{PerPage: 500})
	if page.PerPage != 100 {
		t.Fatalf("per_page cap: %d", page.PerPage)
	}
	_, _, _, err = e.audit.List(e.ctx, AuditQuery{From: "14/11/2026", To: "x", ActorID: "nope"})
	if f := fieldErrs(t, err); f["from"] == "" || f["to"] == "" || f["actor_id"] == "" {
		t.Fatalf("validation: %v", f)
	}
	_, _, _, err = e.audit.List(e.ctx, AuditQuery{From: "2026-11-15", To: "2026-11-14"})
	if f := fieldErrs(t, err); f["to"] == "" {
		t.Fatalf("range: %v", err)
	}
}

// ---- bootstrap ----

func TestEnsureAdminOwnerAndBreakGlass(t *testing.T) {
	e := newIdentity(t)
	if e.owner.Role != domain.RoleOwner {
		t.Fatalf("bootstrap role = %s", e.owner.Role)
	}
	b, _ := e.addUser("b@example.com", domain.RoleOwner)
	// the bootstrap admin gets demoted and deactivated by another owner...
	if _, err := e.users.Update(e.ctx, actorOf(b), e.owner.ID, UserPatch{Role: ptr("viewer"), IsActive: ptr(false)}); err != nil {
		t.Fatal(err)
	}
	// ...a normal boot leaves that alone
	if out, _ := e.auth.EnsureAdmin(e.ctx, "owner@example.com", testPassword, "Owner", false); out != "exists" {
		t.Fatal(out)
	}
	if u := e.user("owner@example.com"); u.Role != domain.RoleViewer || u.IsActive {
		t.Fatalf("without reset nothing changes: %+v", u)
	}
	// ADMIN_RESET_PASSWORD=true restores owner + active
	out, err := e.auth.EnsureAdmin(e.ctx, "owner@example.com", "recovered-password", "Owner", true)
	if err != nil || out != "password_reset" {
		t.Fatalf("%s %v", out, err)
	}
	if u := e.user("owner@example.com"); u.Role != domain.RoleOwner || !u.IsActive || u.PasswordChangedAt == nil {
		t.Fatalf("break-glass: %+v", u)
	}
	if _, err := e.auth.Login(e.ctx, "owner@example.com", "recovered-password", reqMeta); err != nil {
		t.Fatal(err)
	}
}
