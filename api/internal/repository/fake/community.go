package fake

import (
	"bytes"
	"context"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

type likeKey struct{ target, member string }

type communityTables struct {
	members    []*domain.Member
	identities []domain.MemberIdentity
	sessions   []domain.MemberSession
	tokens     []domain.MemberToken
	states     []domain.OAuthState
	comments   []*domain.Comment // stored fields only; decorate() fills joins
	edits      map[string][]domain.CommentEdit
	moderators map[string]repository.CommentModerator // comment id -> last moderator
	images     []*domain.CommentImage
	reports    []domain.CommentReport
	clikes     map[likeKey]time.Time
	plikes     map[likeKey]time.Time
	stats      map[string]*domain.CommunityStats
	salts      map[string][]byte
	dedupe     map[string]bool
}

func (t *communityTables) init() {
	if t.edits == nil {
		t.edits = map[string][]domain.CommentEdit{}
		t.moderators = map[string]repository.CommentModerator{}
		t.clikes = map[likeKey]time.Time{}
		t.plikes = map[likeKey]time.Time{}
		t.stats = map[string]*domain.CommunityStats{}
		t.salts = map[string][]byte{}
		t.dedupe = map[string]bool{}
	}
}

type fMembers struct{ *Store }
type fMemberSessions struct{ *Store }
type fMemberTokens struct{ *Store }
type fOAuthStates struct{ *Store }
type fComments struct{ *Store }
type fEngagement struct{ *Store }

func (s *Store) MembersRepo() repository.Members               { return fMembers{s} }
func (s *Store) MemberSessionsRepo() repository.MemberSessions { return fMemberSessions{s} }
func (s *Store) MemberTokensRepo() repository.MemberTokens     { return fMemberTokens{s} }
func (s *Store) OAuthStatesRepo() repository.OAuthStates       { return fOAuthStates{s} }
func (s *Store) CommentsRepo() repository.Comments             { return fComments{s} }
func (s *Store) EngagementRepo() repository.Engagement         { return fEngagement{s} }

func (s *Store) ct() *communityTables {
	s.community.init()
	return &s.community
}

func (s *Store) memberByID(id string) *domain.Member {
	for _, m := range s.ct().members {
		if m.ID == id {
			return m
		}
	}
	return nil
}

func cloneMember(m *domain.Member) domain.Member {
	c := *m
	c.Email = ""
	c.EmailCiphertext = slices.Clone(m.EmailCiphertext)
	c.EmailIndex = slices.Clone(m.EmailIndex)
	return c
}

func (s *Store) postByID(id string) *postRow {
	for _, p := range s.posts {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func (s *Store) bumpStats(postID string, f func(st *domain.CommunityStats)) {
	t := s.ct()
	st := t.stats[postID]
	if st == nil {
		st = &domain.CommunityStats{}
		t.stats[postID] = st
	}
	f(st)
	st.Likes = max(st.Likes, 0)
	st.Comments = max(st.Comments, 0)
}

// ---- members ----

func (r fMembers) Create(_ context.Context, m *domain.Member, ident *domain.MemberIdentity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	for _, x := range t.members {
		if bytes.Equal(x.EmailIndex, m.EmailIndex) || x.ID == m.ID {
			return domain.ErrConflict
		}
	}
	if ident != nil {
		for _, i := range t.identities {
			if i.Provider == ident.Provider && bytes.Equal(i.SubjectHash, ident.SubjectHash) {
				return domain.ErrConflict
			}
		}
	}
	c := cloneMember(m)
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	if c.Role == "" {
		c.Role = domain.MemberRoleMember
	}
	now := r.Now().UTC()
	c.CreatedAt, c.UpdatedAt = now, now
	t.members = append(t.members, &c)
	if ident != nil {
		ident.MemberID = c.ID
		ident.ID = uuid.NewString()
		ident.CreatedAt = now
		t.identities = append(t.identities, *ident)
	}
	*m = cloneMember(&c)
	return nil
}

func (r fMembers) GetByID(_ context.Context, id string) (domain.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if m := r.memberByID(id); m != nil {
		return cloneMember(m), nil
	}
	return domain.Member{}, domain.ErrNotFound
}

func (r fMembers) GetByEmailIndex(_ context.Context, idx []byte) (domain.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.ct().members {
		if bytes.Equal(m.EmailIndex, idx) {
			return cloneMember(m), nil
		}
	}
	return domain.Member{}, domain.ErrNotFound
}

func (r fMembers) GetByIdentity(_ context.Context, provider string, subjectHash []byte) (domain.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, i := range r.ct().identities {
		if i.Provider == provider && bytes.Equal(i.SubjectHash, subjectHash) {
			if m := r.memberByID(i.MemberID); m != nil {
				return cloneMember(m), nil
			}
		}
	}
	return domain.Member{}, domain.ErrNotFound
}

func (r fMembers) Identities(_ context.Context, memberID string) ([]domain.MemberIdentity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.MemberIdentity
	for _, i := range r.ct().identities {
		if i.MemberID == memberID {
			out = append(out, i)
		}
	}
	return out, nil
}

func (s *Store) addIdentity(ident *domain.MemberIdentity) error {
	t := s.ct()
	for _, i := range t.identities {
		if (i.Provider == ident.Provider && bytes.Equal(i.SubjectHash, ident.SubjectHash)) ||
			(i.MemberID == ident.MemberID && i.Provider == ident.Provider) {
			return domain.ErrConflict
		}
	}
	if s.memberByID(ident.MemberID) == nil {
		return domain.ErrNotFound
	}
	ident.ID = uuid.NewString()
	ident.CreatedAt = s.Now().UTC()
	t.identities = append(t.identities, *ident)
	return nil
}

func (r fMembers) AddIdentity(_ context.Context, ident *domain.MemberIdentity, verifiedAt *time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.addIdentity(ident); err != nil {
		return err
	}
	if m := r.memberByID(ident.MemberID); verifiedAt != nil && m.EmailVerifiedAt == nil {
		v := *verifiedAt
		m.EmailVerifiedAt = &v
	}
	return nil
}

func (r fMembers) TouchIdentity(_ context.Context, provider string, subjectHash []byte, at time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.ct().identities {
		id := &r.ct().identities[i]
		if id.Provider == provider && bytes.Equal(id.SubjectHash, subjectHash) {
			id.LastUsedAt = &at
		}
	}
	return nil
}

func (r fMembers) DeleteIdentity(_ context.Context, memberID, provider string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	n := len(t.identities)
	t.identities = slices.DeleteFunc(t.identities, func(i domain.MemberIdentity) bool {
		return i.MemberID == memberID && i.Provider == provider
	})
	if len(t.identities) == n {
		return domain.ErrNotFound
	}
	return nil
}

func (r fMembers) UpdateDisplayName(_ context.Context, id, name string) (domain.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.memberByID(id)
	if m == nil {
		return domain.Member{}, domain.ErrNotFound
	}
	m.DisplayName = name
	return cloneMember(m), nil
}

func (r fMembers) SetAvatar(_ context.Context, id, key string, onlyIfNone bool) (string, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.memberByID(id)
	if m == nil {
		return "", false, domain.ErrNotFound
	}
	prev := m.AvatarKey
	if onlyIfNone && prev != "" {
		return prev, false, nil
	}
	m.AvatarKey = key
	return prev, true, nil
}

func (s *Store) updateEmail(id string, upd repository.EmailUpdate, verifiedAt *time.Time) error {
	for _, x := range s.ct().members {
		if x.ID != id && bytes.Equal(x.EmailIndex, upd.Index) {
			return domain.ErrConflict
		}
	}
	m := s.memberByID(id)
	if m == nil {
		return domain.ErrNotFound
	}
	m.EmailCiphertext, m.EmailKeyID, m.EmailIndex = slices.Clone(upd.Ciphertext), upd.KeyID, slices.Clone(upd.Index)
	m.EmailVerifiedAt = verifiedAt
	return nil
}

func (r fMembers) UpdateEmail(_ context.Context, id string, upd repository.EmailUpdate, verifiedAt *time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.updateEmail(id, upd, verifiedAt)
}

func (s *Store) setPassword(id, hash string, at time.Time, keep string) error {
	m := s.memberByID(id)
	if m == nil {
		return domain.ErrNotFound
	}
	m.PasswordHash, m.PasswordChangedAt = hash, &at
	t := s.ct()
	t.sessions = slices.DeleteFunc(t.sessions, func(x domain.MemberSession) bool {
		return x.MemberID == id && (keep == "" || x.ID != keep)
	})
	for i := range t.tokens {
		tk := &t.tokens[i]
		if tk.MemberID != nil && *tk.MemberID == id && tk.Purpose == domain.TokenResetPassword && tk.UsedAt == nil {
			tk.UsedAt = &at
		}
	}
	return nil
}

func (r fMembers) SetPassword(_ context.Context, id, hash string, at time.Time, keep string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.setPassword(id, hash, at, keep)
}

func (r fMembers) MarkVerified(_ context.Context, id string, at time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if m := r.memberByID(id); m != nil && m.EmailVerifiedAt == nil {
		m.EmailVerifiedAt = &at
	}
	return nil
}

func (r fMembers) TouchLogin(_ context.Context, id string, at time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if m := r.memberByID(id); m != nil {
		m.LastLoginAt = &at
	}
	return nil
}

func (r fMembers) HasPublishedComment(_ context.Context, id string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.ct().comments {
		if c.MemberID != nil && *c.MemberID == id && c.Status == domain.CommentPublished {
			return true, nil
		}
	}
	return false, nil
}

func (r fMembers) Delete(_ context.Context, id string) (repository.DeletedMember, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	m := r.memberByID(id)
	if m == nil {
		return repository.DeletedMember{}, domain.ErrNotFound
	}
	out := repository.DeletedMember{AvatarKey: m.AvatarKey}
	seen := map[string]bool{}
	for _, c := range t.comments {
		if c.MemberID != nil && *c.MemberID == id && c.Status == domain.CommentPublished {
			if p := r.postByID(c.PostID); p != nil && !seen[p.Slug] {
				seen[p.Slug] = true
				out.AffectedSlugs = append(out.AffectedSlugs, p.Slug)
			}
		}
	}
	sort.Strings(out.AffectedSlugs)
	for k := range t.plikes {
		if k.member == id {
			r.bumpStats(k.target, func(st *domain.CommunityStats) { st.Likes-- })
			delete(t.plikes, k)
		}
	}
	for k := range t.clikes {
		if k.member == id {
			if c := r.commentByID(k.target); c != nil {
				c.LikeCount = max(c.LikeCount-1, 0)
			}
			delete(t.clikes, k)
		}
	}
	t.reports = slices.DeleteFunc(t.reports, func(rp domain.CommentReport) bool {
		if rp.MemberID != id {
			return false
		}
		if c := r.commentByID(rp.CommentID); c != nil {
			c.ReportCount = max(c.ReportCount-1, 0)
		}
		return true
	})
	t.images = slices.DeleteFunc(t.images, func(img *domain.CommentImage) bool {
		if img.MemberID == id {
			out.ImageKeys = append(out.ImageKeys, img.StorageKey)
			return true
		}
		return false
	})
	for _, c := range t.comments {
		if c.MemberID != nil && *c.MemberID == id {
			c.MemberID = nil
		}
		if mod := t.moderators[c.ID]; mod.MemberID == id {
			mod.MemberID = ""
			t.moderators[c.ID] = mod
		}
	}
	t.sessions = slices.DeleteFunc(t.sessions, func(s domain.MemberSession) bool { return s.MemberID == id })
	t.tokens = slices.DeleteFunc(t.tokens, func(tk domain.MemberToken) bool { return tk.MemberID != nil && *tk.MemberID == id })
	t.identities = slices.DeleteFunc(t.identities, func(i domain.MemberIdentity) bool { return i.MemberID == id })
	t.members = slices.DeleteFunc(t.members, func(x *domain.Member) bool { return x.ID == id })
	return out, nil
}

func (r fMembers) Export(_ context.Context, id string) (repository.MemberExport, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	var out repository.MemberExport
	for _, i := range t.identities {
		if i.MemberID == id {
			out.Identities = append(out.Identities, i)
		}
	}
	for _, c := range t.comments {
		if c.MemberID != nil && *c.MemberID == id {
			slug := ""
			if p := r.postByID(c.PostID); p != nil {
				slug = p.Slug
			}
			out.Comments = append(out.Comments, repository.ExportComment{PostSlug: slug, Body: c.Body, Status: c.Status,
				CreatedAt: c.CreatedAt, EditedAt: c.EditedAt})
		}
	}
	for k := range t.plikes {
		if k.member == id {
			if p := r.postByID(k.target); p != nil {
				out.LikedPosts = append(out.LikedPosts, p.Slug)
			}
		}
	}
	for k := range t.clikes {
		if k.member == id {
			out.LikedComments = append(out.LikedComments, k.target)
		}
	}
	sort.Strings(out.LikedPosts)
	sort.Strings(out.LikedComments)
	return out, nil
}

func (s *Store) adminRow(m *domain.Member) repository.MemberAdminRow {
	row := repository.MemberAdminRow{Member: cloneMember(m)}
	for _, i := range s.ct().identities {
		if i.MemberID == m.ID && i.Provider == domain.ProviderGoogle {
			row.HasGoogle = true
		}
	}
	for _, c := range s.ct().comments {
		if c.MemberID != nil && *c.MemberID == m.ID && c.Status != domain.CommentDeleted {
			row.CommentCount++
		}
	}
	return row
}

func (r fMembers) AdminList(_ context.Context, f repository.MemberFilter) ([]repository.MemberAdminRow, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []repository.MemberAdminRow
	for _, m := range r.ct().members {
		if f.EmailIndex != nil && !bytes.Equal(m.EmailIndex, f.EmailIndex) {
			continue
		}
		if f.Name != "" && !strings.Contains(strings.ToLower(m.DisplayName), strings.ToLower(f.Name)) {
			continue
		}
		if f.Role != "" && string(m.Role) != f.Role {
			continue
		}
		out = append(out, r.adminRow(m))
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Member.CreatedAt.After(out[j].Member.CreatedAt) })
	return page(out, f.Page), len(out), nil
}

func (r fMembers) AdminGet(_ context.Context, id string) (repository.MemberAdminRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.memberByID(id)
	if m == nil {
		return repository.MemberAdminRow{}, domain.ErrNotFound
	}
	return r.adminRow(m), nil
}

func (r fMembers) SetRole(_ context.Context, id string, role domain.MemberRole, reason string, now time.Time) (domain.Member, domain.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.memberByID(id)
	if m == nil {
		return domain.Member{}, domain.Member{}, domain.ErrNotFound
	}
	before := cloneMember(m)
	m.Role = role
	if role == domain.MemberRoleBanned {
		if m.BannedAt == nil {
			m.BannedAt = &now
		}
		m.BannedReason = reason
		t := r.ct()
		t.sessions = slices.DeleteFunc(t.sessions, func(s domain.MemberSession) bool { return s.MemberID == id })
	} else {
		m.BannedAt, m.BannedReason = nil, ""
	}
	return before, cloneMember(m), nil
}

// ---- sessions ----

func (r fMemberSessions) Create(_ context.Context, s *domain.MemberSession) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	s.ID = uuid.NewString()
	r.ct().sessions = append(r.ct().sessions, *s)
	return nil
}

func (r fMemberSessions) GetValid(_ context.Context, hash []byte, now time.Time) (domain.MemberSession, domain.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.ct().sessions {
		if bytes.Equal(s.TokenHash, hash) && s.ExpiresAt.After(now) {
			if m := r.memberByID(s.MemberID); m != nil {
				return s, cloneMember(m), nil
			}
		}
	}
	return domain.MemberSession{}, domain.Member{}, domain.ErrNotFound
}

func (r fMemberSessions) Touch(_ context.Context, id string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.ct().sessions {
		if s := &r.ct().sessions[i]; s.ID == id {
			s.LastSeenAt = &now
		}
	}
	return nil
}

func (r fMemberSessions) DeleteByTokenHash(_ context.Context, hash []byte) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	t.sessions = slices.DeleteFunc(t.sessions, func(s domain.MemberSession) bool { return bytes.Equal(s.TokenHash, hash) })
	return nil
}

func (r fMemberSessions) ListByMember(_ context.Context, memberID string, now time.Time) ([]domain.MemberSession, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.MemberSession
	for _, s := range r.ct().sessions {
		if s.MemberID == memberID && s.ExpiresAt.After(now) {
			out = append(out, s)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (r fMemberSessions) DeleteByMemberExcept(_ context.Context, memberID, keepID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	n := len(t.sessions)
	t.sessions = slices.DeleteFunc(t.sessions, func(s domain.MemberSession) bool {
		return s.MemberID == memberID && (keepID == "" || s.ID != keepID)
	})
	return int64(n - len(t.sessions)), nil
}

// ---- tokens ----

func (r fMemberTokens) Create(_ context.Context, tk *domain.MemberToken) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if tk.ID == "" {
		tk.ID = uuid.NewString()
	}
	r.ct().tokens = append(r.ct().tokens, *tk)
	return nil
}

func (r fMemberTokens) GetUsable(_ context.Context, hash []byte, purposes []domain.MemberTokenPurpose, now time.Time) (domain.MemberToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, tk := range r.ct().tokens {
		if bytes.Equal(tk.TokenHash, hash) && slices.Contains(purposes, tk.Purpose) && tk.UsedAt == nil &&
			tk.ExpiresAt.After(now) {
			return tk, nil
		}
	}
	return domain.MemberToken{}, domain.ErrTokenInvalid
}

func (s *Store) burn(id string, now time.Time) error {
	for i := range s.ct().tokens {
		tk := &s.ct().tokens[i]
		if tk.ID == id {
			if tk.UsedAt != nil || !tk.ExpiresAt.After(now) {
				return domain.ErrTokenInvalid
			}
			tk.UsedAt = &now
			return nil
		}
	}
	return domain.ErrTokenInvalid
}

func (s *Store) unburn(id string) {
	for i := range s.ct().tokens {
		if s.ct().tokens[i].ID == id {
			s.ct().tokens[i].UsedAt = nil
		}
	}
}

func (r fMemberTokens) ConsumeVerify(_ context.Context, tokenID, memberID string, email *repository.EmailUpdate, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.burn(tokenID, now); err != nil {
		return err
	}
	if email != nil {
		if err := r.updateEmail(memberID, *email, &now); err != nil {
			r.unburn(tokenID)
			return err
		}
		return nil
	}
	if m := r.memberByID(memberID); m != nil && m.EmailVerifiedAt == nil {
		m.EmailVerifiedAt = &now
	}
	return nil
}

func (r fMemberTokens) ConsumeReset(_ context.Context, tokenID, memberID, hash string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.burn(tokenID, now); err != nil {
		return err
	}
	if err := r.setPassword(memberID, hash, now, ""); err != nil {
		return err
	}
	if m := r.memberByID(memberID); m.EmailVerifiedAt == nil {
		m.EmailVerifiedAt = &now
	}
	return nil
}

func (r fMemberTokens) ConsumeLink(_ context.Context, tokenID string, ident *domain.MemberIdentity, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.burn(tokenID, now); err != nil {
		return err
	}
	if err := r.addIdentity(ident); err != nil {
		r.unburn(tokenID)
		return err
	}
	if m := r.memberByID(ident.MemberID); m.EmailVerifiedAt == nil {
		m.EmailVerifiedAt = &now
	}
	return nil
}

func (r fMemberTokens) RevokeOpen(_ context.Context, memberID string, purpose domain.MemberTokenPurpose, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.ct().tokens {
		tk := &r.ct().tokens[i]
		if tk.MemberID != nil && *tk.MemberID == memberID && tk.Purpose == purpose && tk.UsedAt == nil {
			tk.UsedAt = &now
		}
	}
	return nil
}

// ---- oauth states ----

func (r fOAuthStates) Create(_ context.Context, st *domain.OAuthState) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ct().states = append(r.ct().states, *st)
	return nil
}

func (r fOAuthStates) Take(_ context.Context, hash []byte) (domain.OAuthState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	for i, st := range t.states {
		if bytes.Equal(st.StateHash, hash) {
			t.states = slices.Delete(t.states, i, i+1)
			return st, nil
		}
	}
	return domain.OAuthState{}, domain.ErrNotFound
}

// ---- comments ----

func (s *Store) commentByID(id string) *domain.Comment {
	for _, c := range s.ct().comments {
		if c.ID == id {
			return c
		}
	}
	return nil
}

func isVisible(c *domain.Comment, v repository.CommentViewer) bool {
	switch c.Status {
	case domain.CommentPublished:
		return true
	case domain.CommentPending:
		return v.Moderator || (c.MemberID != nil && *c.MemberID == v.MemberID)
	case domain.CommentHidden:
		return v.Moderator
	}
	return false
}

func (s *Store) memberRef(id *string) *domain.MemberRef {
	if id == nil {
		return nil
	}
	m := s.memberByID(*id)
	if m == nil {
		return nil
	}
	return &domain.MemberRef{ID: m.ID, DisplayName: m.DisplayName, AvatarKey: m.AvatarKey, Role: m.Role}
}

// decorate returns a copy of c with the joined fields filled for viewer v.
func (s *Store) decorate(c *domain.Comment, v repository.CommentViewer) domain.Comment {
	out := *c
	out.Replies = nil
	out.Reports = nil
	if p := s.postByID(c.PostID); p != nil {
		out.PostSlug, out.PostTitle = p.Slug, p.Title
	}
	out.Author = s.memberRef(c.MemberID)
	out.ReplyTo = nil
	if c.ReplyToID != nil {
		if rt := s.commentByID(*c.ReplyToID); rt != nil {
			out.ReplyTo = &domain.MemberRef{}
			if ref := s.memberRef(rt.MemberID); ref != nil {
				out.ReplyTo = ref
			}
		}
	}
	out.Image = nil
	for _, img := range s.ct().images {
		if img.CommentID != nil && *img.CommentID == c.ID {
			cp := *img
			out.Image = &cp
		}
	}
	out.ReplyCount = 0
	if c.ParentID == nil {
		for _, r := range s.ct().comments {
			if r.ParentID != nil && *r.ParentID == c.ID && isVisible(r, v) {
				out.ReplyCount++
			}
		}
	}
	_, out.LikedByMe = s.ct().clikes[likeKey{c.ID, v.MemberID}]
	out.ModeratedByKind, out.ModeratedByName = "", ""
	switch mod := s.ct().moderators[c.ID]; {
	case mod.AdminID != "":
		out.ModeratedByKind = "admin"
		for _, u := range s.users {
			if u.ID == mod.AdminID {
				out.ModeratedByName = u.Name
			}
		}
	case mod.MemberID != "":
		out.ModeratedByKind = "member"
		if m := s.memberByID(mod.MemberID); m != nil {
			out.ModeratedByName = m.DisplayName
		}
	}
	return out
}

func (r fComments) ListTop(_ context.Context, f repository.CommentListFilter) ([]domain.Comment, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var top []*domain.Comment
	for _, c := range r.ct().comments {
		if c.PostID != f.PostID || c.ParentID != nil {
			continue
		}
		ok := isVisible(c, f.Viewer)
		if !ok && c.Status == domain.CommentDeleted {
			for _, x := range r.ct().comments {
				if x.ParentID != nil && *x.ParentID == c.ID && isVisible(x, f.Viewer) {
					ok = true
					break
				}
			}
		}
		if ok {
			top = append(top, c)
		}
	}
	sort.SliceStable(top, func(i, j int) bool {
		if f.Sort == "top" && top[i].LikeCount != top[j].LikeCount {
			return top[i].LikeCount > top[j].LikeCount
		}
		return top[i].CreatedAt.After(top[j].CreatedAt)
	})
	var out []domain.Comment
	for _, c := range page(top, f.Page) {
		d := r.decorate(c, f.Viewer)
		if f.RepliesPreview > 0 {
			for _, rp := range r.replies(c.ID, f.Viewer) {
				if len(d.Replies) >= f.RepliesPreview {
					break
				}
				d.Replies = append(d.Replies, r.decorate(rp, f.Viewer))
			}
		}
		out = append(out, d)
	}
	return out, len(top), nil
}

func (s *Store) replies(parentID string, v repository.CommentViewer) []*domain.Comment {
	var out []*domain.Comment
	for _, c := range s.ct().comments {
		if c.ParentID != nil && *c.ParentID == parentID && isVisible(c, v) {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

func (r fComments) ListReplies(_ context.Context, parentID string, v repository.CommentViewer, p domain.Page) ([]domain.Comment, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	all := r.replies(parentID, v)
	var out []domain.Comment
	for _, c := range page(all, p) {
		out = append(out, r.decorate(c, v))
	}
	return out, len(all), nil
}

func (r fComments) Get(_ context.Context, id string, v repository.CommentViewer) (domain.Comment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.commentByID(id)
	if c == nil {
		return domain.Comment{}, domain.ErrNotFound
	}
	return r.decorate(c, v), nil
}

func (r fComments) Create(_ context.Context, c *domain.Comment, imageID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	var img *domain.CommentImage
	if imageID != "" {
		for _, x := range t.images {
			if x.ID == imageID && c.MemberID != nil && x.MemberID == *c.MemberID && x.CommentID == nil {
				img = x
			}
		}
		if img == nil {
			return repository.ErrImageUnavailable
		}
	}
	c.ID = uuid.NewString()
	c.UpdatedAt = c.CreatedAt
	stored := *c
	stored.Author, stored.ReplyTo, stored.Image, stored.Replies = nil, nil, nil, nil
	t.comments = append(t.comments, &stored)
	if img != nil {
		id := c.ID
		img.CommentID = &id
	}
	if c.Status == domain.CommentPublished {
		r.bumpStats(c.PostID, func(st *domain.CommunityStats) { st.Comments++ })
	}
	return nil
}

func (r fComments) Edit(_ context.Context, id, body string, hash []byte, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.commentByID(id)
	if c == nil {
		return domain.ErrNotFound
	}
	t := r.ct()
	t.edits[id] = append(t.edits[id], domain.CommentEdit{Body: c.Body, EditedAt: now})
	c.Body, c.ContentHash, c.EditedAt = body, slices.Clone(hash), &now
	return nil
}

func statusDelta(from, to domain.CommentStatus) int {
	d := 0
	if from == domain.CommentPublished {
		d--
	}
	if to == domain.CommentPublished {
		d++
	}
	return d
}

func (r fComments) SetStatus(_ context.Context, id string, to domain.CommentStatus, by repository.CommentModerator, now time.Time) (repository.StatusChange, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.commentByID(id)
	if c == nil {
		return repository.StatusChange{}, domain.ErrNotFound
	}
	out := repository.StatusChange{From: c.Status, To: to}
	if p := r.postByID(c.PostID); p != nil {
		out.PostSlug = p.Slug
	}
	if c.Status == to {
		return out, nil
	}
	moderated := by.AdminID != "" || by.MemberID != ""
	if moderated || to != domain.CommentDeleted {
		c.ModeratedAt = &now
		r.ct().moderators[id] = by
	}
	if to == domain.CommentDeleted {
		c.Body, c.DeletedAt = "", &now
		t := r.ct()
		delete(t.edits, id)
		t.images = slices.DeleteFunc(t.images, func(img *domain.CommentImage) bool {
			if img.CommentID != nil && *img.CommentID == id {
				out.ImageKey = img.StorageKey
				return true
			}
			return false
		})
	}
	d := statusDelta(c.Status, to)
	c.Status = to
	r.bumpStats(c.PostID, func(st *domain.CommunityStats) { st.Comments += d })
	return out, nil
}

func (r fComments) Like(_ context.Context, commentID, memberID string, like bool, now time.Time) (bool, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.commentByID(commentID)
	if c == nil || c.Status != domain.CommentPublished {
		return false, 0, domain.ErrNotFound
	}
	k := likeKey{commentID, memberID}
	_, has := r.ct().clikes[k]
	switch {
	case like && !has:
		r.ct().clikes[k] = now
		c.LikeCount++
	case !like && has:
		delete(r.ct().clikes, k)
		c.LikeCount = max(c.LikeCount-1, 0)
	}
	return like, c.LikeCount, nil
}

func (r fComments) Report(_ context.Context, rep domain.CommentReport, threshold int) (bool, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	c := r.commentByID(rep.CommentID)
	if c == nil || c.Status != domain.CommentPublished {
		return false, "", domain.ErrNotFound
	}
	slug := ""
	if p := r.postByID(c.PostID); p != nil {
		slug = p.Slug
	}
	for i := range t.reports {
		if t.reports[i].CommentID == rep.CommentID && t.reports[i].MemberID == rep.MemberID {
			t.reports[i].Reason, t.reports[i].Note = rep.Reason, rep.Note
			return false, slug, nil
		}
	}
	t.reports = append(t.reports, rep)
	c.ReportCount++
	author := r.memberRef(c.MemberID)
	trusted := author != nil && author.Role.PublishesDirectly()
	if c.ReportCount >= threshold && !trusted {
		c.Status = domain.CommentPending
		r.bumpStats(c.PostID, func(st *domain.CommunityStats) { st.Comments-- })
		return true, slug, nil
	}
	return false, slug, nil
}

func (r fComments) HasRecentDuplicate(_ context.Context, memberID string, hash []byte, since time.Time, excludeID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.ct().comments {
		if c.MemberID != nil && *c.MemberID == memberID && bytes.Equal(c.ContentHash, hash) &&
			!c.CreatedAt.Before(since) && c.Status != domain.CommentDeleted && c.ID != excludeID {
			return true, nil
		}
	}
	return false, nil
}

func (r fComments) History(_ context.Context, id string) ([]domain.CommentEdit, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := slices.Clone(r.ct().edits[id])
	slices.Reverse(out)
	return out, nil
}

func (r fComments) AdminList(_ context.Context, f repository.AdminCommentFilter) ([]domain.Comment, int, repository.AdminCommentCounts, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	var counts repository.AdminCommentCounts
	reported := func(c *domain.Comment) bool {
		return c.ReportCount > 0 && (c.Status == domain.CommentPublished || c.Status == domain.CommentPending)
	}
	var sel []*domain.Comment
	for _, c := range t.comments {
		if c.Status == domain.CommentPending {
			counts.Pending++
		}
		if reported(c) {
			counts.Reported++
		}
		switch f.Status {
		case "", "all":
		case "reported":
			if !reported(c) {
				continue
			}
		default:
			if string(c.Status) != f.Status {
				continue
			}
		}
		if f.Query != "" && !strings.Contains(strings.ToLower(c.Body), strings.ToLower(f.Query)) {
			continue
		}
		if p := r.postByID(c.PostID); f.PostSlug != "" && (p == nil || p.Slug != f.PostSlug) {
			continue
		}
		if f.MemberID != "" && (c.MemberID == nil || *c.MemberID != f.MemberID) {
			continue
		}
		sel = append(sel, c)
	}
	sort.SliceStable(sel, func(i, j int) bool { return sel[i].CreatedAt.After(sel[j].CreatedAt) })
	v := repository.CommentViewer{Moderator: true}
	var out []domain.Comment
	for _, c := range page(sel, f.Page) {
		d := r.decorate(c, v)
		for i := len(t.reports) - 1; i >= 0 && len(d.Reports) < 10; i-- {
			if t.reports[i].CommentID == c.ID {
				d.Reports = append(d.Reports, t.reports[i])
			}
		}
		out = append(out, d)
	}
	return out, len(sel), counts, nil
}

func (r fComments) HidePublishedBy(_ context.Context, memberID, adminID string, now time.Time) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	seen := map[string]bool{}
	var slugs []string
	for _, c := range r.ct().comments {
		if c.MemberID != nil && *c.MemberID == memberID && c.Status == domain.CommentPublished {
			c.Status, c.ModeratedAt = domain.CommentHidden, &now
			r.ct().moderators[c.ID] = repository.CommentModerator{AdminID: adminID}
			r.bumpStats(c.PostID, func(st *domain.CommunityStats) { st.Comments-- })
			if p := r.postByID(c.PostID); p != nil && !seen[p.Slug] {
				seen[p.Slug] = true
				slugs = append(slugs, p.Slug)
			}
		}
	}
	return slugs, nil
}

func (r fComments) CreateImage(_ context.Context, img *domain.CommentImage) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	img.ID = uuid.NewString()
	cp := *img
	r.ct().images = append(r.ct().images, &cp)
	return nil
}

func (r fComments) TakeStaleImages(_ context.Context, before time.Time, limit int) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var keys []string
	t := r.ct()
	t.images = slices.DeleteFunc(t.images, func(img *domain.CommentImage) bool {
		if img.CommentID == nil && img.CreatedAt.Before(before) && len(keys) < limit {
			keys = append(keys, img.StorageKey)
			return true
		}
		return false
	})
	return keys, nil
}

// ImageCount reports stored comment-image rows (tests).
func (s *Store) ImageCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.ct().images)
}

// ---- engagement ----

func (r fEngagement) StatsBySlugs(_ context.Context, slugs []string, now time.Time) (map[string]domain.CommunityStats, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]domain.CommunityStats{}
	for _, p := range r.posts {
		if visible(p, now) && slices.Contains(slugs, p.Slug) {
			st := domain.CommunityStats{}
			if x := r.ct().stats[p.ID]; x != nil {
				st = *x
			}
			out[p.Slug] = st
		}
	}
	return out, nil
}

func (r fEngagement) PostStats(_ context.Context, postID, memberID string) (domain.CommunityStats, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	st := domain.CommunityStats{}
	if x := r.ct().stats[postID]; x != nil {
		st = *x
	}
	_, liked := r.ct().plikes[likeKey{postID, memberID}]
	return st, liked && memberID != "", nil
}

func (r fEngagement) LikePost(_ context.Context, postID, memberID string, like bool, now time.Time) (bool, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := likeKey{postID, memberID}
	_, has := r.ct().plikes[k]
	switch {
	case like && !has:
		r.ct().plikes[k] = now
		r.bumpStats(postID, func(st *domain.CommunityStats) { st.Likes++ })
	case !like && has:
		delete(r.ct().plikes, k)
		r.bumpStats(postID, func(st *domain.CommunityStats) { st.Likes-- })
	default:
		r.bumpStats(postID, func(*domain.CommunityStats) {})
	}
	return like, r.ct().stats[postID].Likes, nil
}

func dayKey(d time.Time) string { return d.UTC().Format(time.DateOnly) }

func (r fEngagement) DaySalt(_ context.Context, day time.Time, candidate []byte) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := dayKey(day)
	if s, ok := r.ct().salts[k]; ok {
		return s, nil
	}
	r.ct().salts[k] = slices.Clone(candidate)
	return r.ct().salts[k], nil
}

func (r fEngagement) RecordView(_ context.Context, day time.Time, postID string, visitorHash []byte) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := dayKey(day) + "|" + postID + "|" + string(visitorHash)
	if r.ct().dedupe[k] {
		return false, nil
	}
	r.ct().dedupe[k] = true
	r.bumpStats(postID, func(st *domain.CommunityStats) { st.Views++ })
	return true, nil
}

func (r fEngagement) PurgeExpired(_ context.Context, now time.Time, keepFrom time.Time) (repository.PurgeResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.ct()
	var res repository.PurgeResult
	n := len(t.sessions)
	t.sessions = slices.DeleteFunc(t.sessions, func(s domain.MemberSession) bool { return !s.ExpiresAt.After(now) })
	res.Sessions = int64(n - len(t.sessions))
	n = len(t.tokens)
	t.tokens = slices.DeleteFunc(t.tokens, func(tk domain.MemberToken) bool { return !tk.ExpiresAt.After(now) })
	res.Tokens = int64(n - len(t.tokens))
	n = len(t.states)
	t.states = slices.DeleteFunc(t.states, func(st domain.OAuthState) bool { return !st.ExpiresAt.After(now) })
	res.States = int64(n - len(t.states))
	cut := dayKey(keepFrom)
	for k := range t.dedupe {
		if k[:10] < cut {
			delete(t.dedupe, k)
			res.Dedupe++
		}
	}
	for k := range t.salts {
		if k < cut {
			delete(t.salts, k)
			res.Salts++
		}
	}
	return res, nil
}
