package repository_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

func mkToken(t *testing.T, s *repository.Store, purpose domain.TokenPurpose, hash, email string, role *domain.Role,
	by, userID *string) domain.UserToken {
	t.Helper()
	tk := domain.UserToken{Purpose: purpose, TokenHash: []byte(hash), Email: email, Role: role, UserID: userID,
		ExpiresAt: time.Now().Add(time.Hour)}
	if by != nil {
		tk.CreatedBy = &domain.UserRef{ID: *by}
	}
	if err := s.Tokens.Create(context.Background(), &tk); err != nil {
		t.Fatalf("create token %s: %v", hash, err)
	}
	return tk
}

func isOpen(t *testing.T, s *repository.Store, id string) bool {
	t.Helper()
	tk, err := s.Tokens.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return tk.Open()
}

// The accept transaction re-checks the inviter even when no revocation ran
// (simulated by changing the inviter's row directly).
func TestAcceptInviteRechecksInviter(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	o1 := mkUser(t, store, "o1@example.com", domain.RoleOwner)
	mkUser(t, store, "o2@example.com", domain.RoleOwner)
	editor := domain.RoleEditor
	accept := func(hash string) error {
		u := domain.AdminUser{Name: "x", PasswordHash: "$2a$h"}
		_, err := store.Tokens.AcceptInvite(ctx, []byte(hash), time.Now(), &u)
		return err
	}
	inv := mkToken(t, store, domain.TokenInvite, "h-demoted", "a@example.com", &editor, &o1.ID, nil)
	if _, err := pool.Exec(ctx, `UPDATE admin_users SET role = 'viewer' WHERE id = $1`, o1.ID); err != nil {
		t.Fatal(err)
	}
	if err := accept("h-demoted"); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("demoted inviter: %v", err)
	}
	if !isOpen(t, store, inv.ID) {
		t.Fatal("rejected accept must roll back (token untouched)")
	}
	if _, err := store.AdminUsers.GetByEmail(ctx, "a@example.com"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("user created despite invalid inviter")
	}
	_, _ = pool.Exec(ctx, `UPDATE admin_users SET role = 'owner', is_active = false WHERE id = $1`, o1.ID)
	if err := accept("h-demoted"); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("inactive inviter: %v", err)
	}
	_, _ = pool.Exec(ctx, `UPDATE admin_users SET is_active = true WHERE id = $1`, o1.ID)
	if err := accept("h-demoted"); err != nil {
		t.Fatalf("valid inviter again: %v", err)
	}
	// Inviter gone (created_by SET NULL) => invalid.
	mkToken(t, store, domain.TokenInvite, "h-orphan", "b@example.com", &editor, nil, nil)
	if err := accept("h-orphan"); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("no inviter: %v", err)
	}
}

func TestIdentityRevocationsInTx(t *testing.T) {
	store, _ := setup(t)
	ctx := context.Background()
	o1 := mkUser(t, store, "o1@example.com", domain.RoleOwner)
	o2 := mkUser(t, store, "o2@example.com", domain.RoleOwner)
	ed := mkUser(t, store, "ed@example.com", domain.RoleEditor)
	editor, owner := domain.RoleEditor, domain.RoleOwner

	// Demotion revokes the inviter's open invites; other inviters' stay open.
	i1 := mkToken(t, store, domain.TokenInvite, "i1", "x1@example.com", &editor, &o1.ID, nil)
	i2 := mkToken(t, store, domain.TokenInvite, "i2", "x2@example.com", &owner, &o2.ID, nil)
	if _, _, err := store.AdminUsers.UpdateAccess(ctx, o1.ID, ptr(domain.RoleEditor), nil); err != nil {
		t.Fatal(err)
	}
	if isOpen(t, store, i1.ID) || !isOpen(t, store, i2.ID) {
		t.Fatal("demotion: inviter's invite must be revoked, others kept")
	}
	// A no-op role change keeps the invites.
	if _, _, err := store.AdminUsers.UpdateAccess(ctx, o2.ID, ptr(domain.RoleOwner), nil); err != nil || !isOpen(t, store, i2.ID) {
		t.Fatalf("owner->owner revoked invites: %v", err)
	}

	// Deactivation revokes the user's reset links and invites in the same tx.
	r1 := mkToken(t, store, domain.TokenReset, "r1", ed.Email, nil, &o2.ID, &ed.ID)
	_, _, _ = store.AdminUsers.UpdateAccess(ctx, o1.ID, ptr(domain.RoleOwner), nil)
	i3 := mkToken(t, store, domain.TokenInvite, "i3", "x3@example.com", &editor, &o1.ID, nil)
	if _, _, err := store.AdminUsers.UpdateAccess(ctx, ed.ID, nil, ptr(false)); err != nil || isOpen(t, store, r1.ID) {
		t.Fatalf("deactivate: reset link still open (%v)", err)
	}
	if _, _, err := store.AdminUsers.UpdateAccess(ctx, o1.ID, nil, ptr(false)); err != nil || isOpen(t, store, i3.ID) {
		t.Fatalf("deactivated inviter's invite still open (%v)", err)
	}

	// Delete revokes the deleted user's invites before created_by is nulled.
	if err := store.Tokens.RevokeOpenInvitesFor(ctx, "x2@example.com", time.Now()); err != nil {
		t.Fatal(err)
	}
	i4 := mkToken(t, store, domain.TokenInvite, "i4", "x4@example.com", &editor, &o2.ID, nil)
	_, _, _ = store.AdminUsers.UpdateAccess(ctx, o1.ID, nil, ptr(true))
	if _, err := store.AdminUsers.Delete(ctx, o2.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.Tokens.Get(ctx, i4.ID); got.Open() || got.RevokedAt == nil {
		t.Fatalf("deleted inviter's invite: %+v", got)
	}

	// SetPassword revokes open reset links in the same tx.
	_, _, _ = store.AdminUsers.UpdateAccess(ctx, ed.ID, nil, ptr(true))
	r2 := mkToken(t, store, domain.TokenReset, "r2", ed.Email, nil, &o1.ID, &ed.ID)
	if err := store.AdminUsers.SetPassword(ctx, ed.ID, "$2a$new", time.Now()); err != nil || isOpen(t, store, r2.ID) {
		t.Fatalf("set password: reset link still open (%v)", err)
	}
}
