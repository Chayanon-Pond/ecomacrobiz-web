package fake

import (
	"context"
	"encoding/json"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

type tokens struct{ *Store }
type audit struct{ *Store }

func (s *Store) TokensRepo() repository.UserTokens { return tokens{s} }
func (s *Store) AuditRepo() repository.AuditLogs   { return audit{s} }

// ---- admin users (v2) ----

func (r users) List(context.Context) ([]domain.AdminUser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := slices.Clone(r.users)
	sort.SliceStable(out, func(i, j int) bool {
		oi, oj := out[i].Role == domain.RoleOwner, out[j].Role == domain.RoleOwner
		if oi != oj {
			return oi
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func (r users) SetPassword(_ context.Context, id, hash string, at time.Time) error {
	return r.update(id, func(u *domain.AdminUser) { u.PasswordHash, u.PasswordChangedAt = hash, &at })
}

func (r users) RestoreOwner(_ context.Context, id string) error {
	return r.update(id, func(u *domain.AdminUser) { u.Role, u.IsActive = domain.RoleOwner, true })
}

// activeOwnersLocked must be called with r.mu held.
func (s *Store) activeOwnersLocked() int {
	n := 0
	for _, u := range s.users {
		if u.IsActive && u.Role == domain.RoleOwner {
			n++
		}
	}
	return n
}

func (r users) CountActiveOwners(context.Context) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.activeOwnersLocked(), nil
}

func activeOwner(u domain.AdminUser) bool { return u.IsActive && u.Role == domain.RoleOwner }

func (r users) UpdateAccess(_ context.Context, id string, role *domain.Role, active *bool) (domain.AdminUser, domain.AdminUser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.users {
		if r.users[i].ID != id {
			continue
		}
		before := r.users[i]
		next := before
		if role != nil {
			next.Role = *role
		}
		if active != nil {
			next.IsActive = *active
		}
		if activeOwner(before) && !activeOwner(next) && r.activeOwnersLocked() <= 1 {
			return domain.AdminUser{}, domain.AdminUser{}, domain.ErrLastOwner
		}
		r.users[i] = next
		if before.IsActive && !next.IsActive {
			r.sessions = slices.DeleteFunc(r.sessions, func(s domain.Session) bool { return s.AdminUserID == id })
		}
		return before, next, nil
	}
	return domain.AdminUser{}, domain.AdminUser{}, domain.ErrNotFound
}

func (r users) Delete(_ context.Context, id string) (domain.AdminUser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, u := range r.users {
		if u.ID != id {
			continue
		}
		if activeOwner(u) && r.activeOwnersLocked() <= 1 {
			return domain.AdminUser{}, domain.ErrLastOwner
		}
		r.users = slices.Delete(r.users, i, i+1)
		r.sessions = slices.DeleteFunc(r.sessions, func(s domain.Session) bool { return s.AdminUserID == id })
		return u, nil
	}
	return domain.AdminUser{}, domain.ErrNotFound
}

// ---- sessions (v2) ----

func (r sessions) ListByUser(_ context.Context, userID string, now time.Time) ([]domain.Session, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.Session
	for i := len(r.sessions) - 1; i >= 0; i-- {
		s := r.sessions[i]
		if s.AdminUserID == userID && s.ExpiresAt.After(now) {
			out = append(out, s)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (r sessions) DeleteByUserExcept(_ context.Context, userID, keepID string) (int64, error) {
	return r.deleteWhere(func(s domain.Session) bool { return s.AdminUserID == userID && s.ID != keepID }), nil
}

func (r sessions) Touch(_ context.Context, id string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.sessions {
		s := &r.sessions[i]
		if s.ID == id && (s.LastSeenAt == nil || s.LastSeenAt.Before(now.Add(-time.Minute))) {
			t := now
			s.LastSeenAt = &t
			r.touches++
		}
	}
	return nil
}

// Touches counts effective last_seen_at writes (test helper).
func (s *Store) Touches() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.touches
}

// Sessions returns a snapshot of stored sessions (test helper).
func (s *Store) Sessions() []domain.Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.sessions)
}

// ---- user tokens ----

func (s *Store) userRefLocked(id *string) *domain.UserRef {
	if id == nil {
		return nil
	}
	for _, u := range s.users {
		if u.ID == *id {
			return &domain.UserRef{ID: u.ID, Name: u.Name, Email: u.Email}
		}
	}
	return nil
}

// resolve refreshes CreatedBy from the users table (nil when deleted).
func (r tokens) resolve(t domain.UserToken) domain.UserToken {
	if t.CreatedBy != nil {
		t.CreatedBy = r.userRefLocked(&t.CreatedBy.ID)
	}
	t.TokenHash = slices.Clone(t.TokenHash)
	return t
}

func (r tokens) Create(_ context.Context, t *domain.UserToken) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t.Email = strings.ToLower(t.Email)
	for _, x := range r.tokens {
		if x.Purpose == domain.TokenInvite && t.Purpose == domain.TokenInvite && x.Open() && x.Email == t.Email {
			return domain.ErrConflict
		}
		if string(x.TokenHash) == string(t.TokenHash) {
			return domain.ErrConflict
		}
	}
	t.ID = uuid.NewString()
	t.CreatedAt = r.Now().UTC()
	t.UsedAt, t.RevokedAt = nil, nil
	r.tokens = append(r.tokens, *t)
	*t = r.resolve(*t)
	return nil
}

func (r tokens) find(fn func(domain.UserToken) bool) (int, bool) {
	for i, t := range r.tokens {
		if fn(t) {
			return i, true
		}
	}
	return -1, false
}

func (r tokens) Get(_ context.Context, id string) (domain.UserToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if i, ok := r.find(func(t domain.UserToken) bool { return t.ID == id }); ok {
		return r.resolve(r.tokens[i]), nil
	}
	return domain.UserToken{}, domain.ErrNotFound
}

func (r tokens) GetByHash(_ context.Context, hash []byte) (domain.UserToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if i, ok := r.find(func(t domain.UserToken) bool { return string(t.TokenHash) == string(hash) }); ok {
		return r.resolve(r.tokens[i]), nil
	}
	return domain.UserToken{}, domain.ErrNotFound
}

func (r tokens) ListOpenInvites(context.Context) ([]domain.UserToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.UserToken
	for i := len(r.tokens) - 1; i >= 0; i-- {
		if t := r.tokens[i]; t.Purpose == domain.TokenInvite && t.Open() {
			out = append(out, r.resolve(t))
		}
	}
	return out, nil
}

func (r tokens) RevokeInvite(_ context.Context, id string, now time.Time) (domain.UserToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	i, ok := r.find(func(t domain.UserToken) bool { return t.ID == id && t.Purpose == domain.TokenInvite && t.Open() })
	if !ok {
		return domain.UserToken{}, domain.ErrNotFound
	}
	r.tokens[i].RevokedAt = &now
	return r.resolve(r.tokens[i]), nil
}

func (r tokens) revokeWhere(now time.Time, fn func(domain.UserToken) bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.tokens {
		if r.tokens[i].Open() && fn(r.tokens[i]) {
			r.tokens[i].RevokedAt = &now
		}
	}
}

func (r tokens) RevokeOpenInvitesFor(_ context.Context, email string, now time.Time) error {
	email = strings.ToLower(email)
	r.revokeWhere(now, func(t domain.UserToken) bool { return t.Purpose == domain.TokenInvite && t.Email == email })
	return nil
}

func (r tokens) RevokeOpenResetsFor(_ context.Context, userID string, now time.Time) error {
	r.revokeWhere(now, func(t domain.UserToken) bool {
		return t.Purpose == domain.TokenReset && t.UserID != nil && *t.UserID == userID
	})
	return nil
}

func (r tokens) RotateInvite(_ context.Context, id string, hash []byte, expiresAt time.Time) (domain.UserToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	i, ok := r.find(func(t domain.UserToken) bool { return t.ID == id && t.Purpose == domain.TokenInvite && t.Open() })
	if !ok {
		return domain.UserToken{}, domain.ErrNotFound
	}
	r.tokens[i].TokenHash = slices.Clone(hash)
	r.tokens[i].ExpiresAt = expiresAt
	return r.resolve(r.tokens[i]), nil
}

// consumeLocked mirrors the Postgres UPDATE ... WHERE used_at IS NULL AND
// revoked_at IS NULL AND expires_at > now.
func (r tokens) consumeLocked(purpose domain.TokenPurpose, hash []byte, now time.Time) (int, error) {
	i, ok := r.find(func(t domain.UserToken) bool {
		return string(t.TokenHash) == string(hash) && t.Purpose == purpose && t.Usable(now)
	})
	if !ok {
		return -1, domain.ErrTokenInvalid
	}
	return i, nil
}

func (r tokens) AcceptInvite(_ context.Context, hash []byte, now time.Time, u *domain.AdminUser) (domain.UserToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	i, err := r.consumeLocked(domain.TokenInvite, hash, now)
	if err != nil {
		return domain.UserToken{}, err
	}
	t := r.tokens[i]
	for _, x := range r.users {
		if strings.EqualFold(x.Email, t.Email) {
			return domain.UserToken{}, domain.ErrConflict // tx rolled back: token stays open
		}
	}
	nu := *u
	nu.ID = uuid.NewString()
	nu.Email = t.Email
	nu.Role = *t.Role
	nu.IsActive = true
	nu.CreatedAt = now
	nu.PasswordChangedAt = &now
	nu.InvitedBy = nil
	if t.CreatedBy != nil {
		id := t.CreatedBy.ID
		nu.InvitedBy = &id
	}
	r.users = append(r.users, nu)
	r.tokens[i].UsedAt = &now
	r.tokens[i].UserID = &nu.ID
	*u = nu
	return r.resolve(r.tokens[i]), nil
}

func (r tokens) ConsumeReset(_ context.Context, hash []byte, now time.Time, passwordHash string) (domain.AdminUser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	i, err := r.consumeLocked(domain.TokenReset, hash, now)
	if err != nil {
		return domain.AdminUser{}, err
	}
	uid := *r.tokens[i].UserID
	for j := range r.users {
		if r.users[j].ID == uid && r.users[j].IsActive {
			r.tokens[i].UsedAt = &now
			r.users[j].PasswordHash = passwordHash
			r.users[j].PasswordChangedAt = &now
			r.sessions = slices.DeleteFunc(r.sessions, func(s domain.Session) bool { return s.AdminUserID == uid })
			return r.users[j], nil
		}
	}
	return domain.AdminUser{}, domain.ErrTokenInvalid
}

// Tokens returns a snapshot of stored tokens (test helper).
func (s *Store) Tokens() []domain.UserToken {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.tokens)
}

// ExpireTokens moves every token's expiry to at (test helper).
func (s *Store) ExpireTokens(at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.tokens {
		s.tokens[i].ExpiresAt = at
	}
}

// ---- audit ----

func (r audit) Insert(_ context.Context, ev domain.AuditEvent) error {
	// Round-trip through JSON like the jsonb column does.
	meta := map[string]any{}
	if ev.Metadata != nil {
		b, err := json.Marshal(ev.Metadata)
		if err != nil {
			return err
		}
		if err := json.Unmarshal(b, &meta); err != nil {
			return err
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var actorID *string
	if ev.Actor.ID != "" {
		id := ev.Actor.ID
		actorID = &id
	}
	r.audit = append(r.audit, domain.AuditEntry{ID: int64(len(r.audit) + 1), CreatedAt: r.Now().UTC(),
		ActorID: actorID, ActorEmail: ev.Actor.Email, Action: ev.Action, TargetType: ev.TargetType,
		TargetID: ev.TargetID, Metadata: meta, IP: ev.Actor.IP, UserAgent: ev.Actor.UserAgent})
	return nil
}

func (r audit) List(_ context.Context, f repository.AuditFilter) ([]domain.AuditEntry, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.AuditEntry
	for i := len(r.audit) - 1; i >= 0; i-- {
		e := r.audit[i]
		switch {
		case f.ActorID != "" && (e.ActorID == nil || *e.ActorID != f.ActorID),
			f.Action != "" && e.Action != f.Action,
			f.TargetType != "" && e.TargetType != f.TargetType,
			f.TargetID != "" && e.TargetID != f.TargetID,
			f.From != nil && e.CreatedAt.Before(*f.From),
			f.To != nil && !e.CreatedAt.Before(*f.To):
			continue
		}
		if ref := r.userRefLocked(e.ActorID); ref != nil {
			e.ActorName = ref.Name
		}
		out = append(out, e)
	}
	return page(out, f.Page), len(out), nil
}

// AuditEntries returns all recorded audit entries, oldest first (test helper).
func (s *Store) AuditEntries() []domain.AuditEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.audit)
}
