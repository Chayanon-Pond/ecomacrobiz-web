package service

import (
	"testing"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// An open invite carries its inviter's authority: demoting, deactivating or
// deleting the inviter revokes it, and accept re-checks the inviter.
func TestInviteDiesWithInviterAuthority(t *testing.T) {
	e := newIdentity(t)
	owner := actorOf(e.owner)
	o2, _ := e.addUser("o2@example.com", domain.RoleOwner)
	o3, _ := e.addUser("o3@example.com", domain.RoleOwner)
	invite := func(by domain.AdminUser, email string) InviteResult {
		t.Helper()
		inv, err := e.users.Invite(e.ctx, actorOf(by), InviteInput{Email: email, Role: "editor"})
		if err != nil {
			t.Fatal(err)
		}
		e.secrets = append(e.secrets, inv.Token)
		return inv
	}
	byO2, byOwner := invite(o2, "a@example.com"), invite(e.owner, "b@example.com")

	if _, err := e.users.Update(e.ctx, owner, o2.ID, UserPatch{Role: ptr("editor")}); err != nil {
		t.Fatal(err)
	}
	_, err := e.users.InspectToken(e.ctx, byO2.Token)
	wantErr(t, err, domain.ErrTokenInvalid)
	_, err = e.users.AcceptToken(e.ctx, AcceptInput{Token: byO2.Token, Name: "A", Password: testPassword}, reqMeta)
	wantErr(t, err, domain.ErrTokenInvalid)
	if _, err := e.users.InspectToken(e.ctx, byOwner.Token); err != nil {
		t.Fatalf("other inviter's invite revoked: %v", err)
	}

	byO3 := invite(o3, "c@example.com")
	if _, err := e.users.Update(e.ctx, owner, o3.ID, UserPatch{IsActive: ptr(false)}); err != nil {
		t.Fatal(err)
	}
	_, err = e.users.InspectToken(e.ctx, byO3.Token)
	wantErr(t, err, domain.ErrTokenInvalid)

	_, _ = e.users.Update(e.ctx, owner, o3.ID, UserPatch{IsActive: ptr(true)})
	byO3b := invite(o3, "d@example.com")
	if err := e.users.Delete(e.ctx, owner, o3.ID); err != nil {
		t.Fatal(err)
	}
	_, err = e.users.AcceptToken(e.ctx, AcceptInput{Token: byO3b.Token, Name: "D", Password: testPassword}, reqMeta)
	wantErr(t, err, domain.ErrTokenInvalid)

	if _, err := e.users.AcceptToken(e.ctx, AcceptInput{Token: byOwner.Token, Name: "B", Password: testPassword},
		reqMeta); err != nil {
		t.Fatalf("valid invite: %v", err)
	}
}

func TestFailedLoginAuditOnlyValidEmail(t *testing.T) {
	e := newIdentity(t)
	const typed = "Hunter2-secret-pw" // a password typed into the email field
	e.secrets = append(e.secrets, "hunter2-secret-pw", "wrong-password-zz")
	if _, err := e.auth.Login(e.ctx, typed, "wrong-password-zz", reqMeta); err == nil {
		t.Fatal("login with a non-email succeeded")
	}
	a := e.lastAudit(domain.AuditLoginFailed)
	if _, has := a.Metadata["email"]; has || a.Metadata["email_valid"] != false {
		t.Fatalf("invalid email recorded: %+v", a.Metadata)
	}
	if _, err := e.auth.Login(e.ctx, "ghost@example.com", "wrong-password-zz", reqMeta); err == nil {
		t.Fatal("unknown user")
	}
	if a = e.lastAudit(domain.AuditLoginFailed); a.Metadata["email"] != "ghost@example.com" {
		t.Fatalf("valid email not recorded: %+v", a.Metadata)
	}
	e.assertNoSecretsInAudit()
}

func TestPasswordChangeAndDeactivationRevokeResetLinks(t *testing.T) {
	e := newIdentity(t)
	owner := actorOf(e.owner)
	ed, s := e.addUser("ed@example.com", domain.RoleEditor)
	reset, err := e.users.IssueReset(e.ctx, owner, ed.ID)
	if err != nil {
		t.Fatal(err)
	}
	e.secrets = append(e.secrets, reset.Token, "ed-new-password-1")
	sess, _, _ := e.auth.Authenticate(e.ctx, s.Token)
	if err := e.acct.ChangePassword(e.ctx, actorOf(ed), sess.ID, PasswordChange{CurrentPassword: testPassword,
		NewPassword: "ed-new-password-1"}); err != nil {
		t.Fatal(err)
	}
	_, err = e.users.InspectToken(e.ctx, reset.Token)
	wantErr(t, err, domain.ErrTokenInvalid)

	again, _ := e.users.IssueReset(e.ctx, owner, ed.ID)
	e.secrets = append(e.secrets, again.Token)
	if _, err := e.users.Update(e.ctx, owner, ed.ID, UserPatch{IsActive: ptr(false)}); err != nil {
		t.Fatal(err)
	}
	for _, tk := range e.store.Tokens() {
		if tk.Purpose == domain.TokenReset && tk.Open() {
			t.Fatalf("open reset link after deactivation: %+v", tk)
		}
	}
}
