package handlers

import (
	"testing"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// PUT /account/password: 5 attempts per user per 15 minutes, then 429.
func TestChangePasswordRateLimitedPerUser(t *testing.T) {
	e := newEnv(t)
	owner, _ := e.loginAs(adminEmail, adminPass)
	e.addUser("ed@example.com", domain.RoleEditor)
	ed, _ := e.loginAs("ed@example.com", adminPass)
	body := map[string]string{"current_password": "wrong-password-1", "new_password": "a-new-password-1"}
	for i := 0; i < 5; i++ {
		expect(t, e.do("PUT", "/api/v1/admin/account/password", body, owner.opts()...), 422)
	}
	w := e.do("PUT", "/api/v1/admin/account/password", body, owner.opts()...)
	env := expect(t, w, 429)
	if env.Error.Message != domain.MsgRateLimited || w.Header().Get("Retry-After") == "" {
		t.Fatalf("429: %+v %v", env.Error, w.Header())
	}
	// A fresh session of the same user shares the budget; another user does not.
	again, _ := e.loginAs(adminEmail, adminPass)
	expect(t, e.do("PUT", "/api/v1/admin/account/password", body, again.opts()...), 429)
	expect(t, e.do("PUT", "/api/v1/admin/account/password", body, ed.opts()...), 422)
}
