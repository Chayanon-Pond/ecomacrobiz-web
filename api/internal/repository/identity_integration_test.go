package repository_test

// Postgres integration tests for the identity repositories (users, sessions,
// user_tokens, audit_logs). Same TEST_DATABASE_URL gate as integration_test.go.

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

func mkUser(t *testing.T, s *repository.Store, email string, role domain.Role) domain.AdminUser {
	t.Helper()
	u := domain.AdminUser{Email: email, Name: "N " + email, PasswordHash: "$2a$10$x", Role: role}
	if err := s.AdminUsers.Create(context.Background(), &u); err != nil {
		t.Fatal(err)
	}
	return u
}

func mkSession(t *testing.T, s *repository.Store, userID, hash string, created time.Time) domain.Session {
	t.Helper()
	sess := domain.Session{AdminUserID: userID, TokenHash: []byte(hash), CSRFToken: "c", IP: "1.2.3.4",
		UserAgent: "ua", CreatedAt: created, ExpiresAt: created.Add(time.Hour)}
	if err := s.Sessions.Create(context.Background(), &sess); err != nil {
		t.Fatal(err)
	}
	return sess
}

func ptr[T any](v T) *T { return &v }

func TestAdminUsersV2(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	a := mkUser(t, store, "a@example.com", domain.RoleOwner)
	b := mkUser(t, store, "B@example.com", domain.RoleEditor)
	if a.Role != domain.RoleOwner || b.Role != domain.RoleEditor || b.Email != "b@example.com" || !b.IsActive {
		t.Fatalf("create: %+v %+v", a, b)
	}
	def := domain.AdminUser{Email: "d@example.com", PasswordHash: "x"}
	if err := store.AdminUsers.Create(ctx, &def); err != nil || def.Role != domain.RoleViewer {
		t.Fatalf("default role: %+v %v", def, err)
	}
	inv := domain.AdminUser{Email: "i@example.com", PasswordHash: "x", Role: domain.RoleSales, InvitedBy: &a.ID}
	if err := store.AdminUsers.Create(ctx, &inv); err != nil || inv.InvitedBy == nil || *inv.InvitedBy != a.ID {
		t.Fatalf("invited_by: %+v %v", inv, err)
	}

	list, err := store.AdminUsers.List(ctx)
	if err != nil || len(list) != 4 || list[0].ID != a.ID {
		t.Fatalf("list: %+v %v", list, err)
	}

	now := time.Now().UTC().Truncate(time.Microsecond)
	if err := store.AdminUsers.SetPassword(ctx, b.ID, "$2a$new", now); err != nil {
		t.Fatal(err)
	}
	got, _ := store.AdminUsers.GetByID(ctx, b.ID)
	if got.PasswordHash != "$2a$new" || got.PasswordChangedAt == nil || !got.PasswordChangedAt.Equal(now) {
		t.Fatalf("set password: %+v", got)
	}

	// last active owner
	_, _, err = store.AdminUsers.UpdateAccess(ctx, a.ID, ptr(domain.RoleEditor), nil)
	if !errors.Is(err, domain.ErrLastOwner) {
		t.Fatalf("demote last owner: %v", err)
	}
	_, _, err = store.AdminUsers.UpdateAccess(ctx, a.ID, nil, ptr(false))
	if !errors.Is(err, domain.ErrLastOwner) {
		t.Fatalf("deactivate last owner: %v", err)
	}
	if _, err := store.AdminUsers.Delete(ctx, a.ID); !errors.Is(err, domain.ErrLastOwner) {
		t.Fatalf("delete last owner: %v", err)
	}
	if _, _, err := store.AdminUsers.UpdateAccess(ctx, "nope", nil, ptr(false)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("bad id: %v", err)
	}
	if _, err := store.AdminUsers.Delete(ctx, "00000000-0000-0000-0000-000000000000"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("missing id: %v", err)
	}

	// deactivation deletes the user's sessions in the same transaction
	mkSession(t, store, b.ID, "hb1", now)
	mkSession(t, store, b.ID, "hb2", now)
	mkSession(t, store, a.ID, "ha1", now)
	before, after, err := store.AdminUsers.UpdateAccess(ctx, b.ID, nil, ptr(false))
	if err != nil || !before.IsActive || after.IsActive {
		t.Fatalf("deactivate: %v", err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM sessions WHERE admin_user_id = $1`, b.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("sessions left: %d", n)
	}
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM sessions`).Scan(&n)
	if n != 1 {
		t.Fatalf("other sessions must survive: %d", n)
	}

	// promote b (inactive owner does not count), reactivate, then two owners
	if _, _, err := store.AdminUsers.UpdateAccess(ctx, b.ID, ptr(domain.RoleOwner), nil); err != nil {
		t.Fatal(err)
	}
	if c, _ := store.AdminUsers.CountActiveOwners(ctx); c != 1 {
		t.Fatalf("inactive owner counted: %d", c)
	}
	if _, _, err := store.AdminUsers.UpdateAccess(ctx, a.ID, ptr(domain.RoleViewer), nil); !errors.Is(err, domain.ErrLastOwner) {
		t.Fatalf("inactive owner must not satisfy the rule: %v", err)
	}
	if _, _, err := store.AdminUsers.UpdateAccess(ctx, b.ID, nil, ptr(true)); err != nil {
		t.Fatal(err)
	}

	// two concurrent demotions of the two owners: exactly one wins
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, id := range []string{a.ID, b.ID} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, errs[i] = store.AdminUsers.UpdateAccess(ctx, id, ptr(domain.RoleEditor), nil)
		}()
	}
	wg.Wait()
	ok, last := 0, 0
	for _, e := range errs {
		switch {
		case e == nil:
			ok++
		case errors.Is(e, domain.ErrLastOwner):
			last++
		default:
			t.Fatalf("concurrent demote: %v", e)
		}
	}
	if ok != 1 || last != 1 {
		t.Fatalf("concurrent demotions: ok=%d last=%d", ok, last)
	}
	if c, _ := store.AdminUsers.CountActiveOwners(ctx); c != 1 {
		t.Fatalf("owners after race: %d", c)
	}

	// break-glass + delete
	if err := store.AdminUsers.RestoreOwner(ctx, def.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.AdminUsers.GetByID(ctx, def.ID); got.Role != domain.RoleOwner || !got.IsActive {
		t.Fatalf("restore owner: %+v", got)
	}
	del, err := store.AdminUsers.Delete(ctx, inv.ID)
	if err != nil || del.Email != "i@example.com" {
		t.Fatalf("delete: %+v %v", del, err)
	}
	// deleting the inviter keeps the invitee (invited_by SET NULL); def is an
	// active owner now, so a is never the last one
	inv2 := domain.AdminUser{Email: "i2@example.com", PasswordHash: "x", InvitedBy: &a.ID}
	if err := store.AdminUsers.Create(ctx, &inv2); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AdminUsers.Delete(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	if got, err := store.AdminUsers.GetByID(ctx, inv2.ID); err != nil || got.InvitedBy != nil {
		t.Fatalf("invitee after inviter delete: %+v %v", got, err)
	}
}

func TestSessionsV2(t *testing.T) {
	store, _ := setup(t)
	ctx := context.Background()
	u := mkUser(t, store, "s@example.com", domain.RoleSales)
	now := time.Now().UTC().Truncate(time.Microsecond)
	s1 := mkSession(t, store, u.ID, "h1", now.Add(-2*time.Minute))
	s2 := mkSession(t, store, u.ID, "h2", now.Add(-time.Minute))
	s3 := mkSession(t, store, u.ID, "h3", now)

	sess, user, err := store.Sessions.GetValid(ctx, []byte("h1"), now)
	if err != nil || user.Role != domain.RoleSales || sess.LastSeenAt != nil {
		t.Fatalf("get valid: %+v %+v %v", sess, user, err)
	}
	list, err := store.Sessions.ListByUser(ctx, u.ID, now)
	if err != nil || len(list) != 3 || list[0].ID != s3.ID || list[2].ID != s1.ID {
		t.Fatalf("list: %+v %v", list, err)
	}

	if err := store.Sessions.Touch(ctx, s1.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := store.Sessions.Touch(ctx, s1.ID, now.Add(30*time.Second)); err != nil {
		t.Fatal(err)
	}
	sess, _, _ = store.Sessions.GetValid(ctx, []byte("h1"), now)
	if sess.LastSeenAt == nil || !sess.LastSeenAt.Equal(now) {
		t.Fatalf("touch throttle: %v", sess.LastSeenAt)
	}
	_ = store.Sessions.Touch(ctx, s1.ID, now.Add(61*time.Second))
	sess, _, _ = store.Sessions.GetValid(ctx, []byte("h1"), now)
	if !sess.LastSeenAt.Equal(now.Add(61 * time.Second)) {
		t.Fatalf("touch after a minute: %v", sess.LastSeenAt)
	}

	n, err := store.Sessions.DeleteByUserExcept(ctx, u.ID, s2.ID)
	if err != nil || n != 2 {
		t.Fatalf("delete others: %d %v", n, err)
	}
	if list, _ := store.Sessions.ListByUser(ctx, u.ID, now); len(list) != 1 || list[0].ID != s2.ID {
		t.Fatalf("after delete others: %+v", list)
	}
	if _, _, err := store.AdminUsers.UpdateAccess(ctx, u.ID, nil, ptr(false)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Sessions.GetValid(ctx, []byte("h2"), now); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("inactive user session: %v", err)
	}
}

func TestUserTokens(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	owner := mkUser(t, store, "owner@example.com", domain.RoleOwner)
	now := time.Now().UTC().Truncate(time.Microsecond)
	role := domain.RoleEditor
	newInvite := func(email, hash string, exp time.Time) domain.UserToken {
		t.Helper()
		tk := domain.UserToken{Purpose: domain.TokenInvite, TokenHash: []byte(hash), Email: email, Role: &role,
			CreatedBy: &domain.UserRef{ID: owner.ID}, ExpiresAt: exp}
		if err := store.Tokens.Create(ctx, &tk); err != nil {
			t.Fatalf("create %s: %v", email, err)
		}
		return tk
	}
	inv := newInvite("New@Example.com", "i1", now.Add(time.Hour))
	if inv.ID == "" || inv.Email != "new@example.com" || inv.CreatedBy == nil || inv.CreatedBy.Email != "owner@example.com" ||
		inv.CreatedBy.Name != owner.Name || *inv.Role != domain.RoleEditor || !inv.Open() {
		t.Fatalf("created: %+v", inv)
	}
	dup := domain.UserToken{Purpose: domain.TokenInvite, TokenHash: []byte("i2"), Email: "new@example.com", Role: &role,
		ExpiresAt: now.Add(time.Hour)}
	if err := store.Tokens.Create(ctx, &dup); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("second open invite for the same email: %v", err)
	}
	got, err := store.Tokens.GetByHash(ctx, []byte("i1"))
	if err != nil || got.ID != inv.ID {
		t.Fatalf("by hash: %v", err)
	}
	if _, err := store.Tokens.GetByHash(ctx, []byte("zz")); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown hash: %v", err)
	}

	// rotate: the old hash stops resolving
	rot, err := store.Tokens.RotateInvite(ctx, inv.ID, []byte("i1b"), now.Add(2*time.Hour))
	if err != nil || string(rot.TokenHash) != "i1b" || !rot.ExpiresAt.Equal(now.Add(2*time.Hour)) {
		t.Fatalf("rotate: %+v %v", rot, err)
	}
	if _, err := store.Tokens.GetByHash(ctx, []byte("i1")); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("old hash must be gone")
	}

	// atomic single use under concurrency: exactly one accept wins
	const racers = 8
	var wg sync.WaitGroup
	results := make([]error, racers)
	for i := range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u := domain.AdminUser{Name: "racer", PasswordHash: "$2a$h"}
			_, results[i] = store.Tokens.AcceptInvite(ctx, []byte("i1b"), now, &u)
		}()
	}
	wg.Wait()
	wins := 0
	for _, e := range results {
		switch {
		case e == nil:
			wins++
		case errors.Is(e, domain.ErrTokenInvalid):
		default:
			t.Fatalf("accept race: %v", e)
		}
	}
	if wins != 1 {
		t.Fatalf("accept winners = %d", wins)
	}
	created, err := store.AdminUsers.GetByEmail(ctx, "new@example.com")
	if err != nil || created.Role != domain.RoleEditor || created.InvitedBy == nil || *created.InvitedBy != owner.ID ||
		created.PasswordChangedAt == nil {
		t.Fatalf("accepted user: %+v %v", created, err)
	}
	used, _ := store.Tokens.Get(ctx, inv.ID)
	if used.UsedAt == nil || used.UserID == nil || *used.UserID != created.ID {
		t.Fatalf("used token: %+v", used)
	}

	// expired / revoked are not consumable; conflict rolls back the consume
	exp := newInvite("late@example.com", "i3", now.Add(-time.Second))
	if _, err := store.Tokens.AcceptInvite(ctx, []byte("i3"), now, &domain.AdminUser{PasswordHash: "x"}); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("expired: %v", err)
	}
	if open, _ := store.Tokens.ListOpenInvites(ctx); len(open) != 1 || open[0].ID != exp.ID {
		t.Fatalf("open invites (expired included): %+v", open)
	}
	if _, err := store.Tokens.RevokeInvite(ctx, exp.ID, now); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Tokens.RevokeInvite(ctx, exp.ID, now); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("revoke twice: %v", err)
	}
	newInvite("owner@example.com", "i4", now.Add(time.Hour))
	if _, err := store.Tokens.AcceptInvite(ctx, []byte("i4"), now, &domain.AdminUser{Name: "x", PasswordHash: "x"}); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("existing email: %v", err)
	}
	if tk, _ := store.Tokens.GetByHash(ctx, []byte("i4")); tk.UsedAt != nil {
		t.Fatal("conflict must roll back the consume")
	}
	if err := store.Tokens.RevokeOpenInvitesFor(ctx, "OWNER@example.com", now); err != nil {
		t.Fatal(err)
	}
	if open, _ := store.Tokens.ListOpenInvites(ctx); len(open) != 0 {
		t.Fatalf("revoke for email: %+v", open)
	}

	// reset
	target := mkUser(t, store, "t@example.com", domain.RoleViewer)
	mkSession(t, store, target.ID, "ts1", now)
	mkSession(t, store, target.ID, "ts2", now)
	mkSession(t, store, owner.ID, "os1", now)
	newReset := func(hash string) {
		tk := domain.UserToken{Purpose: domain.TokenReset, TokenHash: []byte(hash), Email: target.Email,
			UserID: &target.ID, CreatedBy: &domain.UserRef{ID: owner.ID}, ExpiresAt: now.Add(time.Hour)}
		if err := store.Tokens.Create(ctx, &tk); err != nil {
			t.Fatal(err)
		}
	}
	newReset("r1")
	newReset("r2")
	if err := store.Tokens.RevokeOpenResetsFor(ctx, target.ID, now); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Tokens.ConsumeReset(ctx, []byte("r1"), now, "$2a$reset"); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("revoked reset: %v", err)
	}
	newReset("r3")
	u, err := store.Tokens.ConsumeReset(ctx, []byte("r3"), now, "$2a$reset")
	if err != nil || u.ID != target.ID || u.PasswordHash != "$2a$reset" || !u.PasswordChangedAt.Equal(now) {
		t.Fatalf("consume reset: %+v %v", u, err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM sessions WHERE admin_user_id = $1`, target.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("reset must delete all sessions, %d left", n)
	}
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM sessions`).Scan(&n)
	if n != 1 {
		t.Fatalf("other users' sessions: %d", n)
	}
	if _, err := store.Tokens.ConsumeReset(ctx, []byte("r3"), now, "x"); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("reset reuse: %v", err)
	}
	// inactive user: rejected and not consumed
	newReset("r4")
	if _, _, err := store.AdminUsers.UpdateAccess(ctx, target.ID, nil, ptr(false)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Tokens.ConsumeReset(ctx, []byte("r4"), now, "x"); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("inactive reset: %v", err)
	}
	if tk, _ := store.Tokens.GetByHash(ctx, []byte("r4")); tk.UsedAt != nil {
		t.Fatal("rejected reset must roll back")
	}
	// deleting the target cascades its tokens; deleting the creator keeps them
	if _, err := store.AdminUsers.Delete(ctx, target.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Tokens.GetByHash(ctx, []byte("r4")); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("cascade: %v", err)
	}
}

func TestAuditLogs(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	u := mkUser(t, store, "a@example.com", domain.RoleOwner)
	actor := domain.Actor{ID: u.ID, Email: u.Email, IP: "1.2.3.4", UserAgent: "ua"}
	for _, ev := range []domain.AuditEvent{
		{Action: domain.AuditLoginFailed, Actor: domain.Actor{IP: "9.9.9.9"}, Metadata: map[string]any{"email": "x@y.z"}},
		{Action: domain.AuditLoginSuccess, Actor: actor, TargetType: domain.TargetUser, TargetID: u.ID},
		{Action: domain.AuditUserInvite, Actor: actor, TargetType: domain.TargetInvite, TargetID: "inv-1",
			Metadata: map[string]any{"email": "n@example.com", "role": "viewer", "email_sent": true}},
	} {
		if err := store.Audit.Insert(ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Audit.Insert(ctx, domain.AuditEvent{Action: "Bad Action"}); err == nil {
		t.Fatal("action format CHECK must reject")
	}
	// backdate the failed login by two days
	if _, err := pool.Exec(ctx, `UPDATE audit_logs SET created_at = now() - interval '2 days' WHERE action = $1`,
		domain.AuditLoginFailed); err != nil {
		t.Fatal(err)
	}

	all, total, err := store.Audit.List(ctx, repository.AuditFilter{Page: domain.Page{Page: 1, PerPage: 2}})
	if err != nil || total != 3 || len(all) != 2 || all[0].Action != domain.AuditUserInvite ||
		all[0].ActorName != u.Name || all[0].Metadata["email_sent"] != true || all[0].Metadata["role"] != "viewer" {
		t.Fatalf("list: %d %+v %v", total, all, err)
	}
	f := repository.AuditFilter{Page: domain.Page{Page: 1, PerPage: 50}, ActorID: u.ID}
	if _, total, _ := store.Audit.List(ctx, f); total != 2 {
		t.Fatalf("actor filter: %d", total)
	}
	f = repository.AuditFilter{Page: domain.Page{Page: 1, PerPage: 50}, TargetType: domain.TargetInvite, TargetID: "inv-1"}
	if _, total, _ := store.Audit.List(ctx, f); total != 1 {
		t.Fatalf("target filter: %d", total)
	}
	from := time.Now().Add(-24 * time.Hour)
	f = repository.AuditFilter{Page: domain.Page{Page: 1, PerPage: 50}, From: &from}
	if _, total, _ := store.Audit.List(ctx, f); total != 2 {
		t.Fatalf("from filter: %d", total)
	}
	f = repository.AuditFilter{Page: domain.Page{Page: 1, PerPage: 50}, To: &from, Action: domain.AuditLoginFailed}
	rows, total, _ := store.Audit.List(ctx, f)
	if total != 1 || rows[0].ActorID != nil || rows[0].ActorEmail != "" || rows[0].IP != "9.9.9.9" ||
		rows[0].Metadata["email"] != "x@y.z" {
		t.Fatalf("to+action filter: %+v", rows)
	}
	// actor deleted: entries survive with the email snapshot, name gone
	mkUser(t, store, "b@example.com", domain.RoleOwner) // so u is not the last owner
	if _, err := store.AdminUsers.Delete(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	rows, total, _ = store.Audit.List(ctx, repository.AuditFilter{Page: domain.Page{Page: 1, PerPage: 50},
		Action: domain.AuditLoginSuccess})
	if total != 1 || rows[0].ActorID != nil || rows[0].ActorEmail != "a@example.com" || rows[0].ActorName != "" {
		t.Fatalf("after actor delete: %+v", rows)
	}
}
