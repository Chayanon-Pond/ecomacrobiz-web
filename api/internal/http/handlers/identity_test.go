package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
)

var loginIP atomic.Int32

// addUser stores an active user with the role (password adminPass).
func (e *env) addUser(email string, role domain.Role) domain.AdminUser {
	e.t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte(adminPass), bcrypt.MinCost)
	u := domain.AdminUser{Email: email, Name: string(role) + " user", PasswordHash: string(hash), Role: role}
	if err := e.store.AdminUsersRepo().Create(context.Background(), &u); err != nil {
		e.t.Fatal(err)
	}
	return u
}

// loginAs logs in from a fresh IP (the login limiter is 4/15m per IP).
func (e *env) loginAs(email, password string) (session, meDTOWire) {
	e.t.Helper()
	ip := fmt.Sprintf("198.18.%d.%d", loginIP.Add(1)/250, loginIP.Load()%250+1)
	w := e.do("POST", "/api/v1/admin/auth/login", map[string]string{"email": email, "password": password},
		withHeader("Origin", webOrigin), withRemote(ip))
	env := expect(e.t, w, 200)
	return sessionFrom(e.t, w, env)
}

type meDTOWire struct {
	User struct {
		ID, Email, Name, Role string
		IsActive              bool    `json:"is_active"`
		LastLoginAt           *string `json:"last_login_at"`
		CreatedAt             string  `json:"created_at"`
	} `json:"user"`
	Permissions []string `json:"permissions"`
	CSRF        string   `json:"csrf_token"`
}

func sessionFrom(t *testing.T, w interface{ Result() *http.Response }, env envelope) (session, meDTOWire) {
	t.Helper()
	var me meDTOWire
	if err := json.Unmarshal(env.Data, &me); err != nil || me.CSRF == "" {
		t.Fatalf("me body: %s %v", env.Data, err)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == middleware.SessionCookie && c.Value != "" {
			return session{cookie: &http.Cookie{Name: c.Name, Value: c.Value}, csrf: me.CSRF}, me
		}
	}
	t.Fatal("no session cookie")
	return session{}, me
}

func TestMeDTO(t *testing.T) {
	e := newEnv(t)
	s, me := e.loginAs(adminEmail, adminPass)
	if me.User.Role != "owner" || !me.User.IsActive || me.User.LastLoginAt == nil || me.User.CreatedAt == "" ||
		len(me.Permissions) != len(domain.AllPermissions) {
		t.Fatalf("login me: %+v", me)
	}
	e.addUser("sales@example.com", domain.RoleSales)
	_, me = e.loginAs("sales@example.com", adminPass)
	if me.User.Role != "sales" || strings.Join(me.Permissions, ",") != "leads:read,leads:write,leads:export" {
		t.Fatalf("sales me: %+v", me)
	}
	env := expect(t, e.do("GET", "/api/v1/admin/auth/me", nil, withCookie(s.cookie)), 200)
	if !strings.Contains(string(env.Data), `"permissions":["posts:read"`) || !strings.Contains(string(env.Data), `"role":"owner"`) {
		t.Fatalf("me: %s", env.Data)
	}
}

// Every identity route: owner allowed, other roles 403 (self-service routes
// open to everyone).
func TestIdentityRoutePermissions(t *testing.T) {
	e := newEnv(t)
	owner, _ := e.loginAs(adminEmail, adminPass)
	roles := map[domain.Role]session{}
	for _, r := range []domain.Role{domain.RoleEditor, domain.RoleSales, domain.RoleViewer} {
		e.addUser(string(r)+"@example.com", r)
		roles[r], _ = e.loginAs(string(r)+"@example.com", adminPass)
	}
	ownerOnly := []struct{ method, path string }{
		{"GET", "/api/v1/admin/users"},
		{"PATCH", "/api/v1/admin/users/00000000-0000-0000-0000-000000000000"},
		{"DELETE", "/api/v1/admin/users/00000000-0000-0000-0000-000000000000"},
		{"POST", "/api/v1/admin/users/00000000-0000-0000-0000-000000000000/reset-link"},
		{"GET", "/api/v1/admin/invites"},
		{"POST", "/api/v1/admin/invites"},
		{"POST", "/api/v1/admin/invites/00000000-0000-0000-0000-000000000000/resend"},
		{"DELETE", "/api/v1/admin/invites/00000000-0000-0000-0000-000000000000"},
		{"GET", "/api/v1/admin/audit"},
		{"GET", "/api/v1/admin/settings/overview"},
	}
	for _, rt := range ownerOnly {
		for r, s := range roles {
			env := expect(t, e.do(rt.method, rt.path, map[string]any{}, s.opts()...), 403)
			if env.Error.Code != "forbidden" || env.Error.Message != domain.MsgNoPermission {
				t.Fatalf("%s %s as %s: %+v", rt.method, rt.path, r, env.Error)
			}
		}
		if w := e.do(rt.method, rt.path, map[string]any{}, owner.opts()...); w.Code == 403 || w.Code == 401 {
			t.Fatalf("%s %s as owner: %d %s", rt.method, rt.path, w.Code, w.Body)
		}
		expect(t, e.do(rt.method, rt.path, nil), 401)
	}
	for r, s := range roles {
		expect(t, e.do("GET", "/api/v1/admin/account/sessions", nil, s.opts()...), 200)
		expect(t, e.do("PUT", "/api/v1/admin/account/profile", map[string]string{"name": "ชื่อใหม่ " + string(r)},
			s.opts()...), 200)
	}
}

func TestInviteAcceptHTTP(t *testing.T) {
	e := newEnv(t)
	owner, _ := e.loginAs(adminEmail, adminPass)

	env := expect(t, e.do("POST", "/api/v1/admin/invites", map[string]string{"email": "new@example.com", "role": "editor"},
		owner.opts()...), 201)
	var created struct {
		Invite struct {
			ID, Email, Role string
			Expired         bool
			InvitedBy       *struct{ ID, Name, Email string } `json:"invited_by"`
			ExpiresAt       string                            `json:"expires_at"`
		} `json:"invite"`
		Token     string `json:"token"`
		EmailSent bool   `json:"email_sent"`
	}
	_ = json.Unmarshal(env.Data, &created)
	if created.Token == "" || !created.EmailSent || created.Invite.Role != "editor" || created.Invite.InvitedBy == nil ||
		created.Invite.InvitedBy.Email != adminEmail || created.Invite.Expired {
		t.Fatalf("created: %s", env.Data)
	}
	if len(e.mail.sent) != 1 || e.mail.sent[0] != "new@example.com" {
		t.Fatalf("mail: %v", e.mail.sent)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/invites", nil, owner.opts()...), 200)
	if strings.Contains(string(env.Data), created.Token) || !strings.Contains(string(env.Data), `"expired":false`) {
		t.Fatalf("list must not expose tokens: %s", env.Data)
	}
	expect(t, e.do("POST", "/api/v1/admin/invites", map[string]string{"email": adminEmail, "role": "viewer"},
		owner.opts()...), 409)
	env = expect(t, e.do("POST", "/api/v1/admin/invites", map[string]string{"email": "x", "role": "god"}, owner.opts()...), 422)
	if env.Error.Fields["email"] == "" || env.Error.Fields["role"] == "" {
		t.Fatalf("validation: %+v", env.Error)
	}

	tok := map[string]string{"token": created.Token}
	expect(t, e.do("POST", "/api/v1/admin/auth/tokens/inspect", tok, withHeader("Origin", "https://evil.example")), 403)
	env = expect(t, e.do("POST", "/api/v1/admin/auth/tokens/inspect", tok, withHeader("Origin", webOrigin)), 200)
	if !strings.Contains(string(env.Data), `"purpose":"invite"`) || !strings.Contains(string(env.Data), `"role":"editor"`) {
		t.Fatalf("inspect: %s", env.Data)
	}
	env = expect(t, e.do("POST", "/api/v1/admin/auth/tokens/accept", map[string]string{"token": created.Token,
		"name": "", "password": "short"}), 422)
	if env.Error.Fields["name"] == "" || env.Error.Fields["password"] == "" {
		t.Fatalf("accept validation: %+v", env.Error)
	}
	w := e.do("POST", "/api/v1/admin/auth/tokens/accept", map[string]string{"token": created.Token,
		"name": "บรรณาธิการ", "password": "a-strong-password"})
	env = expect(t, w, 200)
	s, me := sessionFrom(t, w, env)
	if me.User.Email != "new@example.com" || me.User.Role != "editor" || len(me.Permissions) != 5 {
		t.Fatalf("accept me: %+v", me)
	}
	expect(t, e.do("GET", "/api/v1/admin/posts", nil, withCookie(s.cookie)), 200)
	env = expect(t, e.do("POST", "/api/v1/admin/auth/tokens/accept", map[string]string{"token": created.Token,
		"name": "x", "password": "a-strong-password"}), 404)
	if env.Error.Code != "token_invalid" || env.Error.Message != domain.MsgTokenInvalid {
		t.Fatalf("reuse: %+v", env.Error)
	}
	expect(t, e.do("POST", "/api/v1/admin/auth/tokens/inspect", `{"token":`), 400)
}

func TestTokenEndpointsRateLimited(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 20; i++ {
		expect(t, e.do("POST", "/api/v1/admin/auth/tokens/inspect", map[string]string{"token": "nope"}), 404)
	}
	w := e.do("POST", "/api/v1/admin/auth/tokens/accept", map[string]string{"token": "nope"})
	if expect(t, w, 429); w.Header().Get("Retry-After") == "" {
		t.Fatal("Retry-After missing")
	}
	expect(t, e.do("POST", "/api/v1/admin/auth/tokens/inspect", map[string]string{"token": "nope"},
		withRemote("198.51.100.77")), 404)
}

func TestUsersHTTP(t *testing.T) {
	e := newEnv(t)
	owner, me := e.loginAs(adminEmail, adminPass)
	ownerID := me.User.ID
	ed := e.addUser("ed@example.com", domain.RoleEditor)
	edSess, _ := e.loginAs("ed@example.com", adminPass)

	env := expect(t, e.do("GET", "/api/v1/admin/users", nil, owner.opts()...), 200)
	var users []map[string]any
	_ = json.Unmarshal(env.Data, &users)
	if len(users) != 2 || users[0]["role"] != "owner" || users[1]["is_active"] != true {
		t.Fatalf("users: %s", env.Data)
	}

	env = expect(t, e.do("PATCH", "/api/v1/admin/users/"+ownerID, map[string]string{"role": "viewer"}, owner.opts()...), 409)
	if env.Error.Code != "last_owner" || env.Error.Message != domain.MsgLastOwner {
		t.Fatalf("last owner: %+v", env.Error)
	}
	expect(t, e.do("PATCH", "/api/v1/admin/users/"+ownerID, map[string]any{"is_active": false}, owner.opts()...), 409)
	env = expect(t, e.do("DELETE", "/api/v1/admin/users/"+ownerID, nil, owner.opts()...), 422)
	if env.Error.Message != domain.MsgCannotDeleteSelf {
		t.Fatalf("self delete: %+v", env.Error)
	}
	expect(t, e.do("PATCH", "/api/v1/admin/users/not-a-uuid", map[string]string{"role": "viewer"}, owner.opts()...), 404)

	// deactivation kills the editor's session immediately
	env = expect(t, e.do("PATCH", "/api/v1/admin/users/"+ed.ID, map[string]any{"is_active": false}, owner.opts()...), 200)
	if !strings.Contains(string(env.Data), `"is_active":false`) {
		t.Fatalf("patch: %s", env.Data)
	}
	expect(t, e.do("GET", "/api/v1/admin/auth/me", nil, withCookie(edSess.cookie)), 401)
	env = expect(t, e.do("POST", "/api/v1/admin/users/"+ed.ID+"/reset-link", nil, owner.opts()...), 422)
	expect(t, e.do("PATCH", "/api/v1/admin/users/"+ed.ID, map[string]any{"is_active": true, "role": "owner"},
		owner.opts()...), 200)

	env = expect(t, e.do("POST", "/api/v1/admin/users/"+ed.ID+"/reset-link", nil, owner.opts()...), 200)
	var link struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
		EmailSent bool   `json:"email_sent"`
	}
	_ = json.Unmarshal(env.Data, &link)
	if link.Token == "" || link.ExpiresAt == "" || !link.EmailSent {
		t.Fatalf("reset link: %s", env.Data)
	}
	// now two owners: demoting myself is allowed, then I lose access
	expect(t, e.do("PATCH", "/api/v1/admin/users/"+ownerID, map[string]string{"role": "viewer"}, owner.opts()...), 200)
	expect(t, e.do("GET", "/api/v1/admin/users", nil, owner.opts()...), 403)
	edOwner, _ := e.loginAs("ed@example.com", adminPass)
	expect(t, e.do("DELETE", "/api/v1/admin/users/"+ownerID, nil, edOwner.opts()...), 204)
	expect(t, e.do("GET", "/api/v1/admin/auth/me", nil, withCookie(owner.cookie)), 401)
}

func TestAccountHTTP(t *testing.T) {
	e := newEnv(t)
	a, _ := e.loginAs(adminEmail, adminPass)
	b, _ := e.loginAs(adminEmail, adminPass)

	env := expect(t, e.do("GET", "/api/v1/admin/account/sessions", nil, a.opts()...), 200)
	var list []map[string]any
	_ = json.Unmarshal(env.Data, &list)
	cur := 0
	for _, s := range list {
		if s["current"] == true {
			cur++
		}
		if _, ok := s["last_seen_at"]; !ok {
			t.Fatal("last_seen_at missing")
		}
	}
	if len(list) != 2 || cur != 1 {
		t.Fatalf("sessions: %s", env.Data)
	}

	env = expect(t, e.do("PUT", "/api/v1/admin/account/password", map[string]string{"current_password": "nope-nope-nope",
		"new_password": "another-password-1"}, a.opts()...), 422)
	if env.Error.Fields["current_password"] != domain.MsgWrongCurrentPass {
		t.Fatalf("wrong current: %+v", env.Error)
	}
	expect(t, e.do("PUT", "/api/v1/admin/account/password", map[string]string{"current_password": adminPass,
		"new_password": "another-password-1"}, a.opts()...), 204)
	expect(t, e.do("GET", "/api/v1/admin/auth/me", nil, withCookie(a.cookie)), 200)
	expect(t, e.do("GET", "/api/v1/admin/auth/me", nil, withCookie(b.cookie)), 401)

	c, _ := e.loginAs(adminEmail, "another-password-1")
	env = expect(t, e.do("DELETE", "/api/v1/admin/account/sessions/others", nil, c.opts()...), 200)
	if string(env.Data) != `{"revoked":1}` {
		t.Fatalf("revoke others: %s", env.Data)
	}
	expect(t, e.do("GET", "/api/v1/admin/auth/me", nil, withCookie(a.cookie)), 401)

	env = expect(t, e.do("PUT", "/api/v1/admin/account/profile", map[string]string{"name": "เจ้าของ"}, c.opts()...), 200)
	if !strings.Contains(string(env.Data), `"name":"เจ้าของ"`) || !strings.Contains(string(env.Data), `"role":"owner"`) {
		t.Fatalf("profile: %s", env.Data)
	}
	expect(t, e.do("PUT", "/api/v1/admin/account/profile", map[string]string{"name": ""}, c.opts()...), 422)
	expect(t, e.do("PUT", "/api/v1/admin/account/profile", map[string]string{"name": "x"}, withCookie(c.cookie)), 403)
}

func TestAuditAndSettingsHTTP(t *testing.T) {
	e := newEnv(t)
	e.cfg.SMTPHost, e.cfg.SMTPFrom, e.cfg.SMTPTo = "smtp.example.com", "Site <no-reply@example.com>", []string{"ops@example.com"}
	e.cfg.SMTPPassword, e.cfg.RevalidateSecret = "smtp-secret-value", "revalidate-secret-value"
	expect(t, e.do("POST", "/api/v1/admin/auth/login", map[string]string{"email": adminEmail, "password": "wrong-password-1"},
		withRemote("198.51.100.90")), 401)
	owner, me := e.loginAs(adminEmail, adminPass)
	expect(t, e.do("POST", "/api/v1/admin/invites", map[string]string{"email": "n@example.com", "role": "viewer"},
		owner.opts()...), 201)

	env := expect(t, e.do("GET", "/api/v1/admin/audit?per_page=2", nil, owner.opts()...), 200)
	var rows []struct {
		ID    int64 `json:"id"`
		Actor struct {
			ID    *string `json:"id"`
			Email string  `json:"email"`
			Name  string  `json:"name"`
		} `json:"actor"`
		Action   string         `json:"action"`
		Metadata map[string]any `json:"metadata"`
		IP       string         `json:"ip"`
	}
	_ = json.Unmarshal(env.Data, &rows)
	if env.Meta["total"] != 3 || len(rows) != 2 || rows[0].Action != domain.AuditUserInvite ||
		rows[0].Actor.ID == nil || *rows[0].Actor.ID != me.User.ID || rows[0].Actor.Name != "Admin" ||
		rows[1].Action != domain.AuditLoginSuccess {
		t.Fatalf("audit: %v %s", env.Meta, env.Data)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/audit?action=auth.login_failed", nil, owner.opts()...), 200)
	if !strings.Contains(string(env.Data), `"id":null`) || !strings.Contains(string(env.Data), `"email":"`+adminEmail+`"`) {
		t.Fatalf("failed login row: %s", env.Data)
	}
	expect(t, e.do("GET", "/api/v1/admin/audit?from=2026-13-01", nil, owner.opts()...), 422)

	env = expect(t, e.do("GET", "/api/v1/admin/settings/overview", nil, owner.opts()...), 200)
	body := string(env.Data)
	for _, leak := range []string{"smtp-secret-value", "revalidate-secret-value", "ops@example.com", "no-reply@example.com"} {
		if strings.Contains(body, leak) {
			t.Fatalf("settings leaks %q: %s", leak, body)
		}
	}
	for _, want := range []string{`"provider":"smtp"`, `"recipients":1`, `"invite_ttl_hours":72`, `"session_ttl_hours":24`,
		`"web_base_url":"https://www.example.test"`, `"line":{"configured":false}`, `"scheduler_interval_seconds":60`} {
		if !strings.Contains(body, want) {
			t.Fatalf("settings missing %s: %s", want, body)
		}
	}
}
