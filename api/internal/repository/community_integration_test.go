package repository_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/migrations"
)

func sum(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}

func livePost(t *testing.T, store *repository.Store, slug string) domain.Post {
	t.Helper()
	pub := time.Now().Add(-time.Hour)
	p := domain.Post{Slug: slug, Title: "T " + slug, BodyMarkdown: "x", Status: domain.PostPublished, PublishedAt: &pub}
	if err := store.Posts.Create(context.Background(), &p, nil, nil); err != nil {
		t.Fatal(err)
	}
	return p
}

func newMember(t *testing.T, store *repository.Store, name string, role domain.MemberRole) domain.Member {
	t.Helper()
	now := time.Now().UTC()
	m := domain.Member{ID: uuid.NewString(), DisplayName: name, EmailCiphertext: []byte("ct-" + name), EmailKeyID: 1,
		EmailIndex: sum("email:" + name), PasswordHash: "$argon2id$x", Role: role, TermsVersion: domain.ConsentVersion,
		ConsentedAt: now}
	if err := store.Members.Create(context.Background(), &m, nil); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestMembersSessionsTokensIdentities(t *testing.T) {
	store, _ := setup(t)
	ctx := context.Background()
	now := time.Now().UTC()
	m := newMember(t, store, "สมชาย", domain.MemberRoleMember)
	if m.Role != domain.MemberRoleMember || m.EmailVerified() || m.CreatedAt.IsZero() {
		t.Fatalf("create: %+v", m)
	}
	dup := domain.Member{ID: uuid.NewString(), DisplayName: "dup", EmailCiphertext: []byte("x"), EmailKeyID: 1,
		EmailIndex: m.EmailIndex, TermsVersion: "v", ConsentedAt: now}
	if err := store.Members.Create(ctx, &dup, nil); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("duplicate e-mail index: %v", err)
	}
	got, err := store.Members.GetByEmailIndex(ctx, m.EmailIndex)
	if err != nil || got.ID != m.ID || !bytes.Equal(got.EmailCiphertext, m.EmailCiphertext) {
		t.Fatalf("by index: %v", err)
	}
	if _, err := store.Members.GetByID(ctx, "not-a-uuid"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("bad id: %v", err)
	}

	// Google-only member created with its identity in one transaction
	g := domain.Member{ID: uuid.NewString(), DisplayName: "Google", EmailCiphertext: []byte("g"), EmailKeyID: 1,
		EmailIndex: sum("g"), EmailVerifiedAt: &now, TermsVersion: "v", ConsentedAt: now}
	ident := domain.MemberIdentity{Provider: "google", SubjectHash: sum("sub-1"), LastUsedAt: &now}
	if err := store.Members.Create(ctx, &g, &ident); err != nil || g.HasPassword() || ident.ID == "" {
		t.Fatalf("create with identity: %v %+v", err, g)
	}
	if got, err := store.Members.GetByIdentity(ctx, "google", sum("sub-1")); err != nil || got.ID != g.ID {
		t.Fatalf("by identity: %v", err)
	}
	if err := store.Members.AddIdentity(ctx, &domain.MemberIdentity{MemberID: m.ID, Provider: "google",
		SubjectHash: sum("sub-1")}, nil); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("identity already linked elsewhere: %v", err)
	}
	if err := store.Members.AddIdentity(ctx, &domain.MemberIdentity{MemberID: m.ID, Provider: "google",
		SubjectHash: sum("sub-2")}, &now); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.Members.GetByID(ctx, m.ID); !got.EmailVerified() {
		t.Fatal("AddIdentity must mark verified")
	}
	if err := store.Members.DeleteIdentity(ctx, m.ID, "google"); err != nil {
		t.Fatal(err)
	}
	if err := store.Members.DeleteIdentity(ctx, m.ID, "google"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}

	// sessions
	s1 := domain.MemberSession{MemberID: m.ID, TokenHash: sum("tok1"), CSRFToken: "c1", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	s2 := domain.MemberSession{MemberID: m.ID, TokenHash: sum("tok2"), CSRFToken: "c2", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	old := domain.MemberSession{MemberID: m.ID, TokenHash: sum("tok3"), CSRFToken: "c3", CreatedAt: now.Add(-2 * time.Hour),
		ExpiresAt: now.Add(-time.Hour)}
	for _, s := range []*domain.MemberSession{&s1, &s2, &old} {
		if err := store.MemberSessions.Create(ctx, s); err != nil {
			t.Fatal(err)
		}
	}
	sess, mem, err := store.MemberSessions.GetValid(ctx, sum("tok1"), now)
	if err != nil || sess.ID != s1.ID || mem.ID != m.ID || sess.CSRFToken != "c1" {
		t.Fatalf("get valid: %v", err)
	}
	if _, _, err := store.MemberSessions.GetValid(ctx, sum("tok3"), now); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expired session: %v", err)
	}
	if err := store.MemberSessions.Touch(ctx, s1.ID, now); err != nil {
		t.Fatal(err)
	}
	if list, _ := store.MemberSessions.ListByMember(ctx, m.ID, now); len(list) != 2 {
		t.Fatalf("list: %d", len(list))
	}
	if n, _ := store.MemberSessions.DeleteByMemberExcept(ctx, m.ID, s1.ID); n != 2 {
		t.Fatalf("delete others: %d", n)
	}

	// password change revokes other sessions and open reset tokens
	s2.TokenHash = sum("tok2b")
	_ = store.MemberSessions.Create(ctx, &s2)
	reset := domain.MemberToken{ID: uuid.NewString(), MemberID: &m.ID, Purpose: domain.TokenResetPassword,
		TokenHash: sum("reset-1"), CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	if err := store.MemberTokens.Create(ctx, &reset); err != nil {
		t.Fatal(err)
	}
	if err := store.Members.SetPassword(ctx, m.ID, "$argon2id$new", now, s1.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := store.MemberSessions.ListByMember(ctx, m.ID, now); len(list) != 1 || list[0].ID != s1.ID {
		t.Fatalf("after password change: %+v", list)
	}
	if _, err := store.MemberTokens.GetUsable(ctx, sum("reset-1"), []domain.MemberTokenPurpose{domain.TokenResetPassword}, now); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("reset token must be burnt: %v", err)
	}

	// tokens: verify, change e-mail (conflict keeps the token), reset, link
	kid := int16(1)
	verify := domain.MemberToken{MemberID: &m.ID, Purpose: domain.TokenVerifyEmail, TokenHash: sum("v1"), CreatedAt: now,
		ExpiresAt: now.Add(time.Hour)}
	change := domain.MemberToken{ID: uuid.NewString(), MemberID: &m.ID, Purpose: domain.TokenChangeEmail, TokenHash: sum("c1"),
		PayloadCiphertext: []byte("enc"), PayloadKeyID: &kid, CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	for _, tk := range []*domain.MemberToken{&verify, &change} {
		if err := store.MemberTokens.Create(ctx, tk); err != nil || tk.ID == "" {
			t.Fatal(err)
		}
	}
	tk, err := store.MemberTokens.GetUsable(ctx, sum("c1"), []domain.MemberTokenPurpose{domain.TokenVerifyEmail, domain.TokenChangeEmail}, now)
	if err != nil || tk.ID != change.ID || string(tk.PayloadCiphertext) != "enc" || *tk.PayloadKeyID != 1 {
		t.Fatalf("get usable: %v %+v", err, tk)
	}
	if err := store.MemberTokens.ConsumeVerify(ctx, change.ID, m.ID, &repository.EmailUpdate{Ciphertext: []byte("x"), KeyID: 1,
		Index: g.EmailIndex}, now); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("taken e-mail: %v", err)
	}
	if _, err := store.MemberTokens.GetUsable(ctx, sum("c1"), []domain.MemberTokenPurpose{domain.TokenChangeEmail}, now); err != nil {
		t.Fatal("a failed swap must roll the token back")
	}
	if err := store.MemberTokens.ConsumeVerify(ctx, change.ID, m.ID, &repository.EmailUpdate{Ciphertext: []byte("new"),
		KeyID: 2, Index: sum("new")}, now); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.Members.GetByEmailIndex(ctx, sum("new")); got.ID != m.ID || got.EmailKeyID != 2 {
		t.Fatal("e-mail not swapped")
	}
	if err := store.MemberTokens.ConsumeVerify(ctx, change.ID, m.ID, nil, now); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("reuse: %v", err)
	}
	reset2 := domain.MemberToken{MemberID: &m.ID, Purpose: domain.TokenResetPassword, TokenHash: sum("r2"), CreatedAt: now,
		ExpiresAt: now.Add(time.Hour)}
	_ = store.MemberTokens.Create(ctx, &reset2)
	if err := store.MemberTokens.ConsumeReset(ctx, reset2.ID, m.ID, "$argon2id$reset", now); err != nil {
		t.Fatal(err)
	}
	if list, _ := store.MemberSessions.ListByMember(ctx, m.ID, now); len(list) != 0 {
		t.Fatal("reset must delete all sessions")
	}
	link := domain.MemberToken{MemberID: &m.ID, Purpose: domain.TokenLinkGoogle, TokenHash: sum("l1"), CreatedAt: now,
		ExpiresAt: now.Add(time.Minute)}
	_ = store.MemberTokens.Create(ctx, &link)
	if err := store.MemberTokens.ConsumeLink(ctx, link.ID, &domain.MemberIdentity{MemberID: m.ID, Provider: "google",
		SubjectHash: sum("sub-3")}, now); err != nil {
		t.Fatal(err)
	}
	if ids, _ := store.Members.Identities(ctx, m.ID); len(ids) != 1 {
		t.Fatal("link identity")
	}

	// oauth states
	st := domain.OAuthState{StateHash: sum("state"), BindingHash: sum("bind"), Nonce: "n", VerifierCiphertext: []byte("v"),
		KeyID: 1, NextPath: "/x", ConsentVersion: domain.ConsentVersion, CreatedAt: now, ExpiresAt: now.Add(10 * time.Minute)}
	if err := store.OAuthStates.Create(ctx, &st); err != nil {
		t.Fatal(err)
	}
	if got, err := store.OAuthStates.Take(ctx, sum("state")); err != nil || got.NextPath != "/x" || !bytes.Equal(got.BindingHash, sum("bind")) {
		t.Fatalf("take: %v", err)
	}
	if _, err := store.OAuthStates.Take(ctx, sum("state")); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("take twice: %v", err)
	}

	// admin list / role
	rows, total, err := store.Members.AdminList(ctx, repository.MemberFilter{Page: domain.Page{Page: 1, PerPage: 10}, Name: "สม"})
	if err != nil || total != 1 || rows[0].Member.ID != m.ID || !rows[0].HasGoogle {
		t.Fatalf("admin list: %v %d", err, total)
	}
	s3 := domain.MemberSession{MemberID: m.ID, TokenHash: sum("tok4"), CSRFToken: "c", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	_ = store.MemberSessions.Create(ctx, &s3)
	before, after, err := store.Members.SetRole(ctx, m.ID, domain.MemberRoleBanned, "spam", now)
	if err != nil || before.Role != domain.MemberRoleMember || after.BannedAt == nil || after.BannedReason != "spam" {
		t.Fatalf("ban: %v %+v", err, after)
	}
	if list, _ := store.MemberSessions.ListByMember(ctx, m.ID, now); len(list) != 0 {
		t.Fatal("ban must delete sessions")
	}
	if _, after, _ = store.Members.SetRole(ctx, m.ID, domain.MemberRoleTrusted, "", now); after.BannedAt != nil || after.BannedReason != "" {
		t.Fatal("unban must clear")
	}
}

func TestCommentsLikesStatsAndViews(t *testing.T) {
	store, _ := setup(t)
	ctx := context.Background()
	now := time.Now().UTC()
	p := livePost(t, store, "post-a")
	a := newMember(t, store, "Alice", domain.MemberRoleMember)
	b := newMember(t, store, "Bob", domain.MemberRoleModerator)
	mk := func(m domain.Member, body string, status domain.CommentStatus, parent, replyTo *string) domain.Comment {
		t.Helper()
		c := domain.Comment{PostID: p.ID, ParentID: parent, ReplyToID: replyTo, MemberID: &m.ID, Body: body, Status: status,
			ContentHash: sum(body), CreatedAt: now}
		if err := store.Comments.Create(ctx, &c, ""); err != nil {
			t.Fatal(err)
		}
		now = now.Add(time.Second)
		return c
	}
	top := mk(a, "top", domain.CommentPublished, nil, nil)
	r1 := mk(b, "reply 1", domain.CommentPublished, &top.ID, nil)
	r2 := mk(a, "reply 2", domain.CommentPending, &top.ID, &r1.ID)
	hidden := mk(a, "hidden top", domain.CommentPublished, nil, nil)
	if _, err := store.Comments.SetStatus(ctx, hidden.ID, domain.CommentHidden, repository.CommentModerator{MemberID: b.ID}, now); err != nil {
		t.Fatal(err)
	}
	st, _, _ := store.Engagement.PostStats(ctx, p.ID, "")
	if st.Comments != 2 {
		t.Fatalf("comment_count = %d, want 2 (published, not hidden/pending)", st.Comments)
	}
	page := domain.Page{Page: 1, PerPage: 10}
	anon, total, err := store.Comments.ListTop(ctx, repository.CommentListFilter{Page: page, PostID: p.ID, RepliesPreview: 5})
	if err != nil || total != 1 || anon[0].ReplyCount != 1 || len(anon[0].Replies) != 1 || anon[0].Author.DisplayName != "Alice" {
		t.Fatalf("anon list: %v %d %+v", err, total, anon)
	}
	own, _, _ := store.Comments.ListTop(ctx, repository.CommentListFilter{Page: page, PostID: p.ID, RepliesPreview: 5,
		Viewer: repository.CommentViewer{MemberID: a.ID}})
	if own[0].ReplyCount != 2 || own[0].Replies[1].ID != r2.ID || own[0].Replies[1].ReplyTo.DisplayName != "Bob" {
		t.Fatalf("author list: %+v", own[0])
	}
	mod, total, _ := store.Comments.ListTop(ctx, repository.CommentListFilter{Page: page, PostID: p.ID,
		Viewer: repository.CommentViewer{MemberID: b.ID, Moderator: true}})
	if total != 2 || mod[0].ID != hidden.ID || mod[0].ModeratedByKind != "member" || mod[0].ModeratedByName != "Bob" {
		t.Fatalf("moderator list: %d %+v", total, mod)
	}
	replies, n, err := store.Comments.ListReplies(ctx, top.ID, repository.CommentViewer{}, page)
	if err != nil || n != 1 || replies[0].ID != r1.ID {
		t.Fatalf("replies: %v %d", err, n)
	}

	// edit history
	if err := store.Comments.Edit(ctx, r1.ID, "reply 1 edited", sum("reply 1 edited"), now); err != nil {
		t.Fatal(err)
	}
	if h, _ := store.Comments.History(ctx, r1.ID); len(h) != 1 || h[0].Body != "reply 1" {
		t.Fatalf("history: %+v", h)
	}
	if dup, _ := store.Comments.HasRecentDuplicate(ctx, a.ID, sum("top"), now.Add(-time.Hour), ""); !dup {
		t.Fatal("duplicate not found")
	}
	if dup, _ := store.Comments.HasRecentDuplicate(ctx, a.ID, sum("top"), now.Add(-time.Hour), top.ID); dup {
		t.Fatal("exclude id ignored")
	}

	// images: attach on create, unavailable when foreign/attached
	img := domain.CommentImage{MemberID: a.ID, StorageKey: "c-0123456789abcdef.jpg", Width: 10, Height: 5, SizeBytes: 99,
		CreatedAt: now}
	if err := store.Comments.CreateImage(ctx, &img); err != nil {
		t.Fatal(err)
	}
	withImg := domain.Comment{PostID: p.ID, MemberID: &b.ID, Body: "", Status: domain.CommentPublished, ContentHash: sum(""), CreatedAt: now}
	if err := store.Comments.Create(ctx, &withImg, img.ID); !errors.Is(err, repository.ErrImageUnavailable) {
		t.Fatalf("foreign image: %v", err)
	}
	withImg = domain.Comment{PostID: p.ID, MemberID: &a.ID, Body: "", Status: domain.CommentPublished, ContentHash: sum(""), CreatedAt: now}
	if err := store.Comments.Create(ctx, &withImg, img.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.Comments.Edit(ctx, withImg.ID, "caption", sum("caption"), now); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Comments.Get(ctx, withImg.ID, repository.CommentViewer{})
	if got.Image == nil || got.Image.StorageKey != img.StorageKey || got.Image.Width != 10 {
		t.Fatalf("image join: %+v", got.Image)
	}
	ch, err := store.Comments.SetStatus(ctx, withImg.ID, domain.CommentDeleted, repository.CommentModerator{}, now)
	if err != nil || ch.ImageKey != img.StorageKey || ch.From != domain.CommentPublished {
		t.Fatalf("delete with image: %v %+v", err, ch)
	}
	got, _ = store.Comments.Get(ctx, withImg.ID, repository.CommentViewer{})
	if got.Status != domain.CommentDeleted || got.Body != "" || got.Image != nil || got.DeletedAt == nil || got.ModeratedAt != nil {
		t.Fatalf("soft delete: %+v", got)
	}
	if h, _ := store.Comments.History(ctx, withImg.ID); len(h) != 0 {
		t.Fatalf("edit history survived delete: %+v", h)
	}

	// report threshold
	reporters := []domain.Member{newMember(t, store, "R1", domain.MemberRoleMember), newMember(t, store, "R2", domain.MemberRoleMember),
		newMember(t, store, "R3", domain.MemberRoleMember)}
	for i, r := range reporters {
		held, slug, err := store.Comments.Report(ctx, domain.CommentReport{CommentID: top.ID, MemberID: r.ID, Reason: "spam",
			CreatedAt: now}, 3)
		if err != nil || held != (i == 2) || slug != "post-a" {
			t.Fatalf("report %d: %v %v", i, held, err)
		}
		if i == 0 { // repeat: upsert, no recount
			if held, _, _ := store.Comments.Report(ctx, domain.CommentReport{CommentID: top.ID, MemberID: r.ID, Reason: "other",
				Note: "n", CreatedAt: now}, 3); held {
				t.Fatal("repeat report counted")
			}
		}
	}
	list, _, counts, err := store.Comments.AdminList(ctx, repository.AdminCommentFilter{Page: page, Status: "reported"})
	if err != nil || len(list) != 1 || list[0].ReportCount != 3 || len(list[0].Reports) != 3 || counts.Pending != 2 ||
		list[0].Status != domain.CommentPending || list[0].PostTitle != "T post-a" {
		t.Fatalf("admin reported: %v %+v %+v", err, list, counts)
	}
	if st, _, _ := store.Engagement.PostStats(ctx, p.ID, ""); st.Comments != 1 {
		t.Fatalf("held comment still counted: %d", st.Comments)
	}
	list, total, _, err = store.Comments.AdminList(ctx, repository.AdminCommentFilter{Page: page, Query: "REPLY 1",
		PostSlug: "post-a", MemberID: b.ID})
	if err != nil || total != 1 || list[0].ID != r1.ID {
		t.Fatalf("admin search: %v %d", err, total)
	}
	pct := mk(b, "ลด 50% วันนี้", domain.CommentPublished, nil, nil)
	if list, total, _, _ = store.Comments.AdminList(ctx, repository.AdminCommentFilter{Page: page, Query: "%"}); total != 1 ||
		list[0].ID != pct.ID {
		t.Fatalf("LIKE metacharacters must be escaped: %d", total)
	}

	// likes: idempotent, published only
	if _, _, err := store.Comments.Like(ctx, r2.ID, b.ID, true, now); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("like pending: %v", err)
	}
	for i := 0; i < 2; i++ {
		if liked, n, err := store.Comments.Like(ctx, r1.ID, a.ID, true, now); err != nil || !liked || n != 1 {
			t.Fatalf("like: %v %d", err, n)
		}
	}
	if _, n, _ := store.Comments.Like(ctx, r1.ID, a.ID, false, now); n != 0 {
		t.Fatalf("unlike: %d", n)
	}
	for i := 0; i < 2; i++ {
		if liked, n, err := store.Engagement.LikePost(ctx, p.ID, a.ID, true, now); err != nil || !liked || n != 1 {
			t.Fatalf("post like: %v %d", err, n)
		}
	}
	if _, liked, _ := store.Engagement.PostStats(ctx, p.ID, a.ID); !liked {
		t.Fatal("liked_by_me")
	}

	// stats by slug (unknown omitted, post without row = zeros)
	livePost(t, store, "post-b")
	stats, err := store.Engagement.StatsBySlugs(ctx, []string{"post-a", "post-b", "nope"}, time.Now())
	if err != nil || len(stats) != 2 || stats["post-a"].Likes != 1 || stats["post-b"] != (domain.CommunityStats{}) {
		t.Fatalf("stats: %v %+v", err, stats)
	}

	// views: dedupe per (day, post, visitor); purge
	day := time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)
	salt, err := store.Engagement.DaySalt(ctx, day, []byte("salt-1"))
	if err != nil || string(salt) != "salt-1" {
		t.Fatal(err)
	}
	if salt, _ = store.Engagement.DaySalt(ctx, day, []byte("salt-2")); string(salt) != "salt-1" {
		t.Fatal("salt must be stable for the day")
	}
	for i, want := range []bool{true, false} {
		if ok, err := store.Engagement.RecordView(ctx, day, p.ID, sum("visitor")); err != nil || ok != want {
			t.Fatalf("view %d: %v %v", i, ok, err)
		}
	}
	_, _ = store.Engagement.RecordView(ctx, day.AddDate(0, 0, -3), p.ID, sum("visitor"))
	_, _ = store.Engagement.DaySalt(ctx, day.AddDate(0, 0, -3), []byte("old"))
	if st, _, _ := store.Engagement.PostStats(ctx, p.ID, ""); st.Views != 2 {
		t.Fatalf("views: %d", st.Views)
	}
	res, err := store.Engagement.PurgeExpired(ctx, time.Now(), day.AddDate(0, 0, -1))
	if err != nil || res.Dedupe != 1 || res.Salts != 1 {
		t.Fatalf("purge: %v %+v", err, res)
	}
	stale := domain.CommentImage{MemberID: a.ID, StorageKey: "c-aaaaaaaaaaaaaaaa.jpg", Width: 1, Height: 1, SizeBytes: 1,
		CreatedAt: now.Add(-48 * time.Hour)}
	_ = store.Comments.CreateImage(ctx, &stale)
	keys, err := store.Comments.TakeStaleImages(ctx, time.Now().Add(-24*time.Hour), 10)
	if err != nil || len(keys) != 1 || keys[0] != stale.StorageKey {
		t.Fatalf("stale images: %v %v", err, keys)
	}
	slugs, err := store.Comments.HidePublishedBy(ctx, b.ID, "", now)
	if err != nil || len(slugs) != 1 || slugs[0] != "post-a" {
		t.Fatalf("hide published: %v %v", err, slugs)
	}
}

// Concurrent like/unlike toggles by many members leave like_count equal to
// the number of like rows.
func TestConcurrentLikeCounters(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	p := livePost(t, store, "busy")
	author := newMember(t, store, "Author", domain.MemberRoleMember)
	c := domain.Comment{PostID: p.ID, MemberID: &author.ID, Body: "x", Status: domain.CommentPublished, ContentHash: sum("x"),
		CreatedAt: time.Now()}
	if err := store.Comments.Create(ctx, &c, ""); err != nil {
		t.Fatal(err)
	}
	var members []domain.Member
	for i := 0; i < 12; i++ {
		members = append(members, newMember(t, store, fmt.Sprintf("M%02d", i), domain.MemberRoleMember))
	}
	var wg sync.WaitGroup
	errs := make(chan error, 1000)
	for _, m := range members {
		for k := 0; k < 4; k++ {
			wg.Add(1)
			go func(m domain.Member, k int) {
				defer wg.Done()
				for i := 0; i < 5; i++ {
					like := (i+k)%2 == 0
					if _, _, err := store.Comments.Like(ctx, c.ID, m.ID, like, time.Now()); err != nil {
						errs <- err
					}
					if _, _, err := store.Engagement.LikePost(ctx, p.ID, m.ID, like, time.Now()); err != nil {
						errs <- err
					}
				}
			}(m, k)
		}
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	var rows, counter, prow, pcounter int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM comment_likes WHERE comment_id = $1`, c.ID).Scan(&rows)
	_ = pool.QueryRow(ctx, `SELECT like_count FROM comments WHERE id = $1`, c.ID).Scan(&counter)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM post_likes WHERE post_id = $1`, p.ID).Scan(&prow)
	_ = pool.QueryRow(ctx, `SELECT like_count FROM post_stats WHERE post_id = $1`, p.ID).Scan(&pcounter)
	if rows != counter || prow != pcounter {
		t.Fatalf("counters drifted: comment rows=%d counter=%d, post rows=%d counter=%d", rows, counter, prow, pcounter)
	}
	t.Logf("after 480 concurrent toggles: comment likes %d, post likes %d (consistent)", rows, prow)
}

func TestMemberDeletionTransaction(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	now := time.Now().UTC()
	p := livePost(t, store, "post-d")
	gone := newMember(t, store, "Gone", domain.MemberRoleMember)
	stay := newMember(t, store, "Stay", domain.MemberRoleModerator)
	if _, _, err := store.Members.SetAvatar(ctx, gone.ID, "a-0123456789abcdef.jpg", false); err != nil {
		t.Fatal(err)
	}
	mine := domain.Comment{PostID: p.ID, MemberID: &gone.ID, Body: "keep me", Status: domain.CommentPublished, ContentHash: sum("k"), CreatedAt: now}
	theirs := domain.Comment{PostID: p.ID, MemberID: &stay.ID, Body: "theirs", Status: domain.CommentPublished, ContentHash: sum("t"), CreatedAt: now}
	_ = store.Comments.Create(ctx, &mine, "")
	_ = store.Comments.Create(ctx, &theirs, "")
	_, _ = store.Comments.SetStatus(ctx, theirs.ID, domain.CommentPublished, repository.CommentModerator{MemberID: gone.ID}, now)
	_, _, _ = store.Comments.Like(ctx, theirs.ID, gone.ID, true, now)
	_, _, _ = store.Engagement.LikePost(ctx, p.ID, gone.ID, true, now)
	_, _, _ = store.Comments.Report(ctx, domain.CommentReport{CommentID: theirs.ID, MemberID: gone.ID, Reason: "spam", CreatedAt: now}, 3)
	img := domain.CommentImage{MemberID: gone.ID, StorageKey: "c-1111111111111111.jpg", Width: 1, Height: 1, SizeBytes: 1, CreatedAt: now}
	_ = store.Comments.CreateImage(ctx, &img)
	s := domain.MemberSession{MemberID: gone.ID, TokenHash: sum("gone-tok"), CSRFToken: "c", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	_ = store.MemberSessions.Create(ctx, &s)
	_ = store.Members.AddIdentity(ctx, &domain.MemberIdentity{MemberID: gone.ID, Provider: "google", SubjectHash: sum("gs")}, nil)

	res, err := store.Members.Delete(ctx, gone.ID)
	if err != nil || res.AvatarKey != "a-0123456789abcdef.jpg" || len(res.ImageKeys) != 1 || len(res.AffectedSlugs) != 1 {
		t.Fatalf("delete: %v %+v", err, res)
	}
	c, err := store.Comments.Get(ctx, mine.ID, repository.CommentViewer{})
	if err != nil || c.MemberID != nil || c.Author != nil || c.Body != "keep me" {
		t.Fatalf("anonymised comment: %v %+v", err, c)
	}
	o, _ := store.Comments.Get(ctx, theirs.ID, repository.CommentViewer{})
	if o.LikeCount != 0 || o.ReportCount != 0 || o.ModeratedByKind != "" {
		t.Fatalf("counters / moderator: %+v", o)
	}
	var left int
	_ = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM member_sessions WHERE member_id = $1)
		+ (SELECT count(*) FROM member_identities WHERE member_id = $1)
		+ (SELECT count(*) FROM comment_images WHERE member_id = $1)
		+ (SELECT count(*) FROM post_likes WHERE member_id = $1)`, gone.ID).Scan(&left)
	if left != 0 {
		t.Fatalf("%d dependent rows left", left)
	}
	if st, _, _ := store.Engagement.PostStats(ctx, p.ID, ""); st.Likes != 0 || st.Comments != 2 {
		t.Fatalf("post stats: %+v", st)
	}
	if _, err := store.Members.Delete(ctx, gone.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
}

// 00005 is additive: down removes every community table and keeps existing
// rows; up again recreates them.
func TestMigration00005UpDownUp(t *testing.T) {
	store, pool := setup(t)
	ctx := context.Background()
	p := livePost(t, store, "kept-post")
	m := newMember(t, store, "Temp", domain.MemberRoleMember)
	c := domain.Comment{PostID: p.ID, MemberID: &m.ID, Body: "x", Status: domain.CommentPublished, ContentHash: sum("x"),
		CreatedAt: time.Now()}
	if err := store.Comments.Create(ctx, &c, ""); err != nil {
		t.Fatal(err)
	}
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	tables := []string{"members", "member_identities", "member_sessions", "member_tokens", "oauth_states", "comments",
		"comment_edits", "comment_images", "comment_reports", "comment_likes", "post_likes", "post_stats", "view_salts",
		"post_view_dedupe"}
	count := func() int {
		n := 0
		for _, tb := range tables {
			var ok bool
			if err := pool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, tb).Scan(&ok); err != nil {
				t.Fatal(err)
			}
			if ok {
				n++
			}
		}
		return n
	}
	if count() != len(tables) {
		t.Fatal("00005 not applied")
	}
	if err := migrations.Run(ctx, db, log, "down"); err != nil {
		t.Fatalf("down: %v", err)
	}
	if n := count(); n != 0 {
		t.Fatalf("00005 down left %d tables", n)
	}
	if got, err := store.Posts.GetByID(ctx, p.ID); err != nil || got.Slug != "kept-post" {
		t.Fatalf("post after down: %v", err)
	}
	if err := migrations.Run(ctx, db, log, "up"); err != nil {
		t.Fatalf("up again: %v", err)
	}
	if count() != len(tables) {
		t.Fatal("00005 up again incomplete")
	}
}
