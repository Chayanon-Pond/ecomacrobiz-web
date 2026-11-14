package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
	"github.com/ecomacrobiz/escoma/api/internal/storage"
	"github.com/ecomacrobiz/escoma/api/internal/vault"
)

// fakeOIDC stands in for Google: it records the nonce of the last
// authorization URL and returns claims (with that nonce unless set).
type fakeOIDC struct {
	claims   OIDCClaims
	err      error
	nonce    string
	verifier string
}

func (f *fakeOIDC) AuthCodeURL(state, nonce, verifier string) (string, error) {
	f.nonce, f.verifier = nonce, verifier
	return "https://accounts.example/auth?state=" + url.QueryEscape(state), nil
}

func (f *fakeOIDC) Exchange(_ context.Context, code, verifier string) (OIDCClaims, error) {
	if verifier != f.verifier || code == "" {
		return OIDCClaims{}, errors.New("bad verifier")
	}
	c := f.claims
	if c.Nonce == "" {
		c.Nonce = f.nonce
	}
	return c, f.err
}

type commEnv struct {
	t        *testing.T
	ctx      context.Context
	store    *fake.Store
	disk     *storage.LocalDisk
	mail     *recMailer
	rv       *recRevalidator
	audit    *recAuditor
	members  *MemberService
	comments *CommentService
	eng      *EngagementService
	google   *GoogleService
	oidc     *fakeOIDC
	post     domain.Post
}

type commOpts struct {
	mail, requireVerified, holdFirst bool
}

var testMeta = RequestMeta{IP: "203.0.113.9", UserAgent: "Mozilla/5.0 test"}

func newCommEnv(t *testing.T, o commOpts) *commEnv {
	t.Helper()
	store := fake.New()
	disk, err := storage.NewLocalDisk(t.TempDir(), "http://api.test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = disk.Close() })
	keys, _ := vault.NewKeyring([]int16{1}, map[int16][]byte{1: vault.RandomKey()})
	crypto := MemberCrypto{Keys: keys, Index: vault.NewIndex(vault.RandomKey()),
		Hasher: vault.NewHasher(vault.Argon2Params{MemoryKiB: 64, Time: 1, Threads: 1})}
	e := &commEnv{t: t, ctx: context.Background(), store: store, disk: disk, mail: &recMailer{}, rv: &recRevalidator{},
		audit: &recAuditor{}, oidc: &fakeOIDC{}}
	var mailer LinkMailer
	if o.mail {
		mailer = e.mail
	}
	e.members = NewMemberService(store.MembersRepo(), store.MemberSessionsRepo(), store.MemberTokensRepo(),
		store.CommentsRepo(), crypto, disk, mailer, nil, e.rv, e.audit, MemberServiceConfig{SessionTTL: time.Hour,
			WebBaseURL: "https://www.example.test", MailEnabled: o.mail, RequireVerified: o.requireVerified}, discard)
	ccfg := CommentServiceConfig{HoldFirstComment: o.holdFirst, RequireVerified: o.requireVerified}
	e.comments = NewCommentService(store.CommentsRepo(), store.PostsRepo(), store.MembersRepo(), store.EngagementRepo(),
		disk, e.rv, e.audit, ccfg, discard)
	e.eng = NewEngagementService(store.EngagementRepo(), store.PostsRepo(), ccfg, discard)
	e.google = NewGoogleService(e.oidc, store.OAuthStatesRepo(), store.MembersRepo(), store.MemberTokensRepo(), e.members,
		GoogleServiceConfig{WebBaseURL: "https://www.example.test"}, discard)
	posts := NewPostService(store.PostsRepo(), store.CategoriesRepo(), store.MediaRepo(), nil, &recRevalidator{},
		NopAuditor{}, discard)
	pub := time.Now().Add(-time.Hour)
	p, err := posts.Create(e.ctx, PostInput{Slug: "hello-world", Title: "สวัสดี", BodyMarkdown: "x", Status: "published",
		Categories: []string{"brand-insight"}, PublishedAt: &pub}, domain.Actor{Role: domain.RoleOwner})
	if err != nil {
		t.Fatal(err)
	}
	e.post = p
	return e
}

func (e *commEnv) register(name, email string) MemberAuth {
	e.t.Helper()
	a, err := e.members.Register(e.ctx, RegisterInput{DisplayName: name, Email: email, Password: "tangerine-orbit-42",
		AcceptTerms: true, ConsentVersion: domain.ConsentVersion}, testMeta)
	if err != nil {
		e.t.Fatalf("register %s: %v", email, err)
	}
	return a
}

// aged makes a member older than 24 h and verified (publishes directly).
func (e *commEnv) seasoned(name, email string) domain.Member {
	e.t.Helper()
	a := e.register(name, email)
	e.members.Now = func() time.Time { return time.Now() }
	_ = e.store.MembersRepo().MarkVerified(e.ctx, a.Member.ID, time.Now())
	m, _ := e.store.MembersRepo().GetByID(e.ctx, a.Member.ID)
	m.CreatedAt = time.Now().Add(-72 * time.Hour)
	m.Email = email
	return m
}

var tokenRe = regexp.MustCompile(`#token=([A-Za-z0-9_-]+)`)

func (e *commEnv) lastToken() (to, token string) {
	e.t.Helper()
	e.mail.mu.Lock()
	defer e.mail.mu.Unlock()
	if len(e.mail.sent) == 0 {
		e.t.Fatal("no mail sent")
	}
	last := e.mail.sent[len(e.mail.sent)-1]
	m := tokenRe.FindStringSubmatch(last.body)
	if m == nil {
		e.t.Fatalf("no token in %q", last.body)
	}
	return last.to, m[1]
}

func fieldOf(err error, field string) string {
	var ve *domain.ValidationError
	if errors.As(err, &ve) {
		return ve.Fields[field]
	}
	return ""
}

func TestMemberRegisterLoginLogout(t *testing.T) {
	e := newCommEnv(t, commOpts{})
	bad := []struct {
		in    RegisterInput
		field string
	}{
		{RegisterInput{DisplayName: "x", Email: "a@b.co", Password: "tangerine-orbit-42", AcceptTerms: true,
			ConsentVersion: domain.ConsentVersion}, "display_name"},
		{RegisterInput{DisplayName: "สมชาย", Email: "nope", Password: "tangerine-orbit-42", AcceptTerms: true,
			ConsentVersion: domain.ConsentVersion}, "email"},
		{RegisterInput{DisplayName: "สมชาย", Email: "a@b.co", Password: "short", AcceptTerms: true,
			ConsentVersion: domain.ConsentVersion}, "password"},
		{RegisterInput{DisplayName: "สมชาย", Email: "a@b.co", Password: "password123", AcceptTerms: true,
			ConsentVersion: domain.ConsentVersion}, "password"},
		{RegisterInput{DisplayName: "สมชาย", Email: "a@b.co", Password: "tangerine-orbit-42", AcceptTerms: false,
			ConsentVersion: domain.ConsentVersion}, "accept_terms"},
		{RegisterInput{DisplayName: "สมชาย", Email: "a@b.co", Password: "tangerine-orbit-42", AcceptTerms: true,
			ConsentVersion: "old-version"}, "accept_terms"},
	}
	for i, c := range bad {
		if _, err := e.members.Register(e.ctx, c.in, testMeta); fieldOf(err, c.field) == "" {
			t.Errorf("case %d: want field %s, got %v", i, c.field, err)
		}
	}
	a := e.register("สมชาย ใจดี", "Somchai@Example.com")
	if a.Member.Email != "somchai@example.com" || a.Member.EmailVerified() || !a.Member.HasPassword() ||
		a.Member.TermsVersion != domain.ConsentVersion || a.Token == "" || a.CSRFToken == "" {
		t.Fatalf("register: %+v", a.Member)
	}
	stored, _ := e.store.MembersRepo().GetByID(e.ctx, a.Member.ID)
	if strings.Contains(string(stored.EmailCiphertext), "somchai") || !strings.HasPrefix(stored.PasswordHash, "$argon2id$") {
		t.Fatal("e-mail must be stored encrypted and the password as argon2id")
	}
	if _, err := e.members.Register(e.ctx, RegisterInput{DisplayName: "Other", Email: " SOMCHAI@example.com ",
		Password: "tangerine-orbit-43", AcceptTerms: true, ConsentVersion: domain.ConsentVersion}, testMeta); !errors.Is(err, domain.ErrEmailTaken) {
		t.Fatalf("duplicate: %v", err)
	}
	_, m, err := e.members.Authenticate(e.ctx, a.Token)
	if err != nil || m.ID != a.Member.ID || m.Email != "somchai@example.com" {
		t.Fatalf("authenticate: %v %+v", err, m)
	}
	for _, pw := range []string{"wrong-password-1", ""} {
		if _, err := e.members.Login(e.ctx, "somchai@example.com", pw, "", testMeta); err == nil {
			t.Fatal("wrong password accepted")
		}
	}
	if _, err := e.members.Login(e.ctx, "nobody@example.com", "tangerine-orbit-42", "", testMeta); !errors.Is(err, domain.ErrInvalidCredentials) {
		t.Fatalf("unknown e-mail: %v", err)
	}
	b, err := e.members.Login(e.ctx, "SOMCHAI@example.com", "tangerine-orbit-42", "", testMeta)
	if err != nil || b.Member.ID != a.Member.ID {
		t.Fatalf("login: %v", err)
	}
	if err := e.members.Logout(e.ctx, b.Token); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.members.Authenticate(e.ctx, b.Token); !errors.Is(err, domain.ErrUnauthorized) {
		t.Fatalf("after logout: %v", err)
	}
	if _, _, err := e.members.Authenticate(e.ctx, a.Token); err != nil {
		t.Fatal("other session must survive logout")
	}
	// honeypot
	if _, err := e.members.Register(e.ctx, RegisterInput{DisplayName: "Bot", Email: "bot@example.com",
		Password: "tangerine-orbit-42", AcceptTerms: true, ConsentVersion: domain.ConsentVersion, Website: "x"}, testMeta); err == nil {
		t.Fatal("honeypot accepted")
	}
	// banned members cannot log in
	_, _, _ = e.store.MembersRepo().SetRole(e.ctx, a.Member.ID, domain.MemberRoleBanned, "spam", time.Now())
	if _, err := e.members.Login(e.ctx, "somchai@example.com", "tangerine-orbit-42", "", testMeta); !errors.Is(err, domain.ErrMemberBanned) {
		t.Fatalf("banned login: %v", err)
	}
	if _, _, err := e.members.Authenticate(e.ctx, a.Token); err == nil {
		t.Fatal("ban must revoke sessions")
	}
}

type denyHuman struct{ calls int }

func (d *denyHuman) Verify(_ context.Context, token, _ string) bool { d.calls++; return token == "ok" }

func TestMemberLoginTurnstileAfterFailures(t *testing.T) {
	e := newCommEnv(t, commOpts{})
	e.register("สมชาย", "a@example.com")
	h := &denyHuman{}
	e.members.human = h
	for i := 0; i < 3; i++ {
		if _, err := e.members.Login(e.ctx, "a@example.com", "wrong-password-x", "", testMeta); !errors.Is(err, domain.ErrInvalidCredentials) {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	if h.calls != 0 {
		t.Fatal("turnstile must not be asked before 3 failures")
	}
	if _, err := e.members.Login(e.ctx, "a@example.com", "tangerine-orbit-42", "", testMeta); fieldOf(err, "turnstile_token") == "" {
		t.Fatalf("4th attempt without token: %v", err)
	}
	if _, err := e.members.Login(e.ctx, "a@example.com", "tangerine-orbit-42", "ok", testMeta); err != nil {
		t.Fatalf("with token: %v", err)
	}
	if _, err := e.members.Register(e.ctx, RegisterInput{DisplayName: "Bee", Email: "b@example.com",
		Password: "tangerine-orbit-42", AcceptTerms: true, ConsentVersion: domain.ConsentVersion}, testMeta); fieldOf(err, "turnstile_token") == "" {
		t.Fatalf("register must require turnstile when enabled: %v", err)
	}
}

func TestMemberVerificationMailOnOff(t *testing.T) {
	// transport configured
	e := newCommEnv(t, commOpts{mail: true})
	a := e.register("สมชาย", "a@example.com")
	to, tok := e.lastToken()
	if to != "a@example.com" || !strings.Contains(e.mail.sent[0].body, "https://www.example.test/account/verify-email#token=") {
		t.Fatalf("mail: %+v", e.mail.sent)
	}
	kind, err := e.members.VerifyEmail(e.ctx, tok)
	if err != nil || kind != "verify" {
		t.Fatalf("verify: %q %v", kind, err)
	}
	if m, _ := e.store.MembersRepo().GetByID(e.ctx, a.Member.ID); !m.EmailVerified() {
		t.Fatal("not verified")
	}
	if _, err := e.members.VerifyEmail(e.ctx, tok); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("token reuse: %v", err)
	}
	if _, err := e.members.VerifyEmail(e.ctx, "bogus"); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("bogus: %v", err)
	}
	n := len(e.mail.sent)
	m, _ := e.store.MembersRepo().GetByID(e.ctx, a.Member.ID)
	m.Email = "a@example.com"
	_ = e.members.ResendVerification(e.ctx, m)
	if len(e.mail.sent) != n {
		t.Fatal("resend must be a no-op once verified")
	}

	// no transport
	e2 := newCommEnv(t, commOpts{})
	b := e2.register("สมหญิง", "b@example.com")
	if len(e2.mail.sent) != 0 || b.Member.EmailVerified() || e2.members.MailEnabled() {
		t.Fatal("no mail without transport")
	}
	if err := e2.members.ResendVerification(e2.ctx, b.Member); err != nil || len(e2.mail.sent) != 0 {
		t.Fatal("resend without transport must be a no-op")
	}
}

func TestRequireVerifiedGate(t *testing.T) {
	e := newCommEnv(t, commOpts{mail: true, requireVerified: true})
	a := e.register("สมชาย", "a@example.com")
	in := CreateCommentInput{Body: "สวัสดีครับ", ElapsedMS: 5000}
	if _, err := e.comments.Create(e.ctx, a.Member, e.post.Slug, in); !errors.Is(err, domain.ErrEmailUnverified) {
		t.Fatalf("comment: %v", err)
	}
	if _, _, err := e.eng.LikePost(e.ctx, a.Member, e.post.Slug, true); !errors.Is(err, domain.ErrEmailUnverified) {
		t.Fatalf("like: %v", err)
	}
	if _, err := e.comments.UploadImage(e.ctx, a.Member, []byte("x")); !errors.Is(err, domain.ErrEmailUnverified) {
		t.Fatalf("upload: %v", err)
	}
	_, tok := e.lastToken()
	if _, err := e.members.VerifyEmail(e.ctx, tok); err != nil {
		t.Fatal(err)
	}
	_, m, _ := e.members.Authenticate(e.ctx, a.Token)
	if _, err := e.comments.Create(e.ctx, m, e.post.Slug, in); err != nil {
		t.Fatalf("verified comment: %v", err)
	}
	if liked, n, err := e.eng.LikePost(e.ctx, m, e.post.Slug, true); err != nil || !liked || n != 1 {
		t.Fatalf("verified like: %v %v %d", liked, err, n)
	}
}

func TestChangeEmailBothModes(t *testing.T) {
	// with transport: link to the new address, swap on verify
	e := newCommEnv(t, commOpts{mail: true})
	a := e.register("สมชาย", "old@example.com")
	e.register("Taken", "taken@example.com")
	if _, _, err := e.members.ChangeEmail(e.ctx, a.Member, "new@example.com", "wrong-password-9"); fieldOf(err, "current_password") == "" {
		t.Fatalf("wrong password: %v", err)
	}
	if _, _, err := e.members.ChangeEmail(e.ctx, a.Member, "taken@example.com", "tangerine-orbit-42"); !errors.Is(err, domain.ErrEmailTaken) {
		t.Fatalf("taken: %v", err)
	}
	m, sent, err := e.members.ChangeEmail(e.ctx, a.Member, "New@Example.com", "tangerine-orbit-42")
	if err != nil || !sent || m.Email != "old@example.com" {
		t.Fatalf("change: %v %v %s", err, sent, m.Email)
	}
	to, tok := e.lastToken()
	if to != "new@example.com" {
		t.Fatalf("mail must go to the new address, got %s", to)
	}
	kind, err := e.members.VerifyEmail(e.ctx, tok)
	if err != nil || kind != "change_email" {
		t.Fatalf("verify change: %q %v", kind, err)
	}
	_, cur, _ := e.members.Authenticate(e.ctx, a.Token)
	if cur.Email != "new@example.com" || !cur.EmailVerified() {
		t.Fatalf("after change: %s verified=%v", cur.Email, cur.EmailVerified())
	}
	if _, err := e.members.Login(e.ctx, "new@example.com", "tangerine-orbit-42", "", testMeta); err != nil {
		t.Fatalf("login with new e-mail: %v", err)
	}
	if _, err := e.members.Login(e.ctx, "old@example.com", "tangerine-orbit-42", "", testMeta); err == nil {
		t.Fatal("old e-mail still logs in")
	}

	// without transport: swap now, unverified
	e2 := newCommEnv(t, commOpts{})
	b := e2.register("สมหญิง", "b@example.com")
	_ = e2.store.MembersRepo().MarkVerified(e2.ctx, b.Member.ID, time.Now())
	_, mb, _ := e2.members.Authenticate(e2.ctx, b.Token)
	m2, sent, err := e2.members.ChangeEmail(e2.ctx, mb, "b2@example.com", "tangerine-orbit-42")
	if err != nil || sent || m2.Email != "b2@example.com" || m2.EmailVerified() {
		t.Fatalf("swap now: %v %v %+v", err, sent, m2)
	}
}

// googleMember signs a new member in through the callback.
func (e *commEnv) googleCallback(next string, consent bool, claims OIDCClaims) GoogleOutcome {
	e.t.Helper()
	start, err := e.google.Start(e.ctx, next, consent)
	if err != nil {
		e.t.Fatal(err)
	}
	u, _ := url.Parse(start.RedirectURL)
	e.oidc.claims = claims
	return e.google.Callback(e.ctx, GoogleCallbackInput{Code: "code-1", State: u.Query().Get("state"),
		Binding: start.Binding}, testMeta)
}

func TestPasswordForGoogleOnlyAndUnlink(t *testing.T) {
	e := newCommEnv(t, commOpts{})
	out := e.googleCallback("/knowledge/x", true, OIDCClaims{Subject: "g-1", Email: "g@gmail.com", EmailVerified: true,
		Name: "Google User"})
	if out.Auth == nil {
		t.Fatalf("callback: %+v", out)
	}
	m := out.Auth.Member
	if m.HasPassword() || !m.EmailVerified() || m.DisplayName != "Google User" {
		t.Fatalf("google member: %+v", m)
	}
	if err := e.members.UnlinkGoogle(e.ctx, m); !errors.Is(err, domain.ErrLastLoginMethod) {
		t.Fatalf("unlink last method: %v", err)
	}
	if _, _, err := e.members.ChangeEmail(e.ctx, m, "x@example.com", ""); fieldOf(err, "current_password") != domain.MsgSetPasswordFirst {
		t.Fatalf("change e-mail without password: %v", err)
	}
	other := e.googleCallback("/", true, OIDCClaims{Subject: "g-1", Email: "g@gmail.com", EmailVerified: true})
	if err := e.members.ChangePassword(e.ctx, m, out.Auth.Member.ID, MemberPasswordChange{NewPassword: "short"}); fieldOf(err, "new_password") == "" {
		t.Fatalf("policy: %v", err)
	}
	sessions, _ := e.members.Sessions(e.ctx, m.ID)
	var keep string
	for _, s := range sessions {
		if s.TokenHash != nil && string(s.TokenHash) == string(HashToken(out.Auth.Token)) {
			keep = s.ID
		}
	}
	if err := e.members.ChangePassword(e.ctx, m, keep, MemberPasswordChange{NewPassword: "tangerine-orbit-42"}); err != nil {
		t.Fatalf("set password: %v", err)
	}
	if _, _, err := e.members.Authenticate(e.ctx, other.Auth.Token); err == nil {
		t.Fatal("other sessions must be revoked")
	}
	_, m, err := e.members.Authenticate(e.ctx, out.Auth.Token)
	if err != nil || !m.HasPassword() {
		t.Fatalf("current session must survive: %v", err)
	}
	if err := e.members.ChangePassword(e.ctx, m, keep, MemberPasswordChange{NewPassword: "another-pass-77"}); fieldOf(err, "current_password") == "" {
		t.Fatalf("current password now required: %v", err)
	}
	if err := e.members.UnlinkGoogle(e.ctx, m); err != nil {
		t.Fatalf("unlink: %v", err)
	}
	if ids, _ := e.members.Identities(e.ctx, m.ID); len(ids) != 0 {
		t.Fatal("identity not removed")
	}
}

func TestGoogleResolution(t *testing.T) {
	e := newCommEnv(t, commOpts{})
	claims := func(sub, email string) OIDCClaims {
		return OIDCClaims{Subject: sub, Email: email, EmailVerified: true, Name: "N " + sub}
	}

	// 3. new account needs consent
	if out := e.googleCallback("/a", false, claims("s1", "new@gmail.com")); out.Code != "error-consent" ||
		out.Location != "https://www.example.test/a#community=error-consent" {
		t.Fatalf("no consent: %+v", out)
	}
	out := e.googleCallback("/a?x=1", true, claims("s1", "new@gmail.com"))
	if out.Code != "signed-in" || out.Location != "https://www.example.test/a?x=1#community=signed-in" || out.Auth == nil {
		t.Fatalf("new: %+v", out)
	}
	newID := out.Auth.Member.ID
	// 1. known identity (even without consent, e-mail changed at Google)
	out = e.googleCallback("/", false, claims("s1", "changed@gmail.com"))
	if out.Code != "signed-in" || out.Auth.Member.ID != newID {
		t.Fatalf("identity: %+v", out)
	}

	// 2a. verified password account -> auto link
	pa := e.register("Verified", "v@example.com")
	_ = e.store.MembersRepo().MarkVerified(e.ctx, pa.Member.ID, time.Now())
	out = e.googleCallback("/", false, claims("s2", "V@example.com"))
	if out.Code != "signed-in" || out.Auth.Member.ID != pa.Member.ID {
		t.Fatalf("auto link: %+v", out)
	}
	if ids, _ := e.members.Identities(e.ctx, pa.Member.ID); len(ids) != 1 {
		t.Fatal("identity not linked")
	}

	// 2b. unverified password account -> link-required, then password
	ua := e.register("Unverified", "u@example.com")
	out = e.googleCallback("/", true, claims("s3", "u@example.com"))
	if out.Code != "link-required" || out.Auth != nil ||
		!strings.HasPrefix(out.Location, "https://www.example.test/account/link-google#token=") {
		t.Fatalf("link required: %+v", out)
	}
	tok := strings.TrimPrefix(out.Location, "https://www.example.test/account/link-google#token=")
	if _, err := e.members.LinkGoogle(e.ctx, tok, "wrong-password-0", testMeta); !errors.Is(err, domain.ErrInvalidCredentials) {
		t.Fatalf("wrong password: %v", err)
	}
	la, err := e.members.LinkGoogle(e.ctx, tok, "tangerine-orbit-42", testMeta)
	if err != nil || la.Member.ID != ua.Member.ID || !la.Member.EmailVerified() || len(la.Identities) != 1 {
		t.Fatalf("link: %v %+v", err, la.Member)
	}
	if _, err := e.members.LinkGoogle(e.ctx, tok, "tangerine-orbit-42", testMeta); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("link token reuse: %v", err)
	}
	if out = e.googleCallback("/", false, claims("s3", "u@example.com")); out.Auth == nil || out.Auth.Member.ID != ua.Member.ID {
		t.Fatalf("linked identity sign-in: %+v", out)
	}

	// banned
	_, _, _ = e.store.MembersRepo().SetRole(e.ctx, newID, domain.MemberRoleBanned, "", time.Now())
	if out = e.googleCallback("/", true, claims("s1", "new@gmail.com")); out.Code != "error-banned" || out.Auth != nil {
		t.Fatalf("banned: %+v", out)
	}

	// email_verified=false, nonce mismatch
	c := claims("s9", "x@gmail.com")
	c.EmailVerified = false
	if out = e.googleCallback("/", true, c); out.Code != "error-unverified" {
		t.Fatalf("unverified: %+v", out)
	}
	c = claims("s9", "x@gmail.com")
	c.Nonce = "other"
	if out = e.googleCallback("/", true, c); out.Code != "error-token" {
		t.Fatalf("nonce: %+v", out)
	}

	// state binding, reuse, expiry, denial
	start, _ := e.google.Start(e.ctx, "/b", true)
	st := mustQuery(t, start.RedirectURL, "state")
	e.oidc.claims = claims("s10", "s10@gmail.com")
	if out = e.google.Callback(e.ctx, GoogleCallbackInput{Code: "c", State: st, Binding: "other-browser"}, testMeta); out.Code != "error-state" {
		t.Fatalf("binding: %+v", out)
	}
	if out = e.google.Callback(e.ctx, GoogleCallbackInput{Code: "c", State: st, Binding: start.Binding}, testMeta); out.Code != "error-state" {
		t.Fatalf("state must be single use: %+v", out)
	}
	start, _ = e.google.Start(e.ctx, "/b", true)
	e.google.Now = func() time.Time { return time.Now().Add(11 * time.Minute) }
	if out = e.google.Callback(e.ctx, GoogleCallbackInput{Code: "c", State: mustQuery(t, start.RedirectURL, "state"),
		Binding: start.Binding}, testMeta); out.Code != "error-state" {
		t.Fatalf("expired: %+v", out)
	}
	e.google.Now = time.Now
	start, _ = e.google.Start(e.ctx, "//evil.com", true)
	if out = e.google.Callback(e.ctx, GoogleCallbackInput{Error: "access_denied", State: mustQuery(t, start.RedirectURL, "state"),
		Binding: start.Binding}, testMeta); out.Location != "https://www.example.test/#community=error-denied" {
		t.Fatalf("denied / next sanitised: %+v", out)
	}
}

func mustQuery(t *testing.T, raw, key string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get(key)
}

func TestPasswordResetFlow(t *testing.T) {
	e := newCommEnv(t, commOpts{mail: true})
	a := e.register("สมชาย", "a@example.com")
	if err := e.members.ForgotPassword(e.ctx, "nobody@example.com"); err != nil || len(e.mail.sent) != 1 {
		t.Fatal("unknown e-mail must send nothing")
	}
	if err := e.members.ForgotPassword(e.ctx, "A@example.com"); err != nil {
		t.Fatal(err)
	}
	_, tok := e.lastToken()
	if !strings.Contains(e.mail.sent[len(e.mail.sent)-1].body, "/account/reset-password#token=") {
		t.Fatal("reset link path")
	}
	if err := e.members.ResetPassword(e.ctx, tok, "password123"); fieldOf(err, "password") == "" {
		t.Fatalf("policy on reset: %v", err)
	}
	if err := e.members.ResetPassword(e.ctx, tok, "brand-new-pass-1"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.members.Authenticate(e.ctx, a.Token); err == nil {
		t.Fatal("reset must revoke all sessions")
	}
	b, err := e.members.Login(e.ctx, "a@example.com", "brand-new-pass-1", "", testMeta)
	if err != nil || !b.Member.EmailVerified() {
		t.Fatalf("login after reset: %v verified=%v", err, b.Member.EmailVerified())
	}
	if err := e.members.ResetPassword(e.ctx, tok, "brand-new-pass-2"); !errors.Is(err, domain.ErrTokenInvalid) {
		t.Fatalf("reuse: %v", err)
	}
}

func TestCommentCreateRules(t *testing.T) {
	e := newCommEnv(t, commOpts{holdFirst: true})
	newbie := e.register("มือใหม่", "n@example.com").Member
	pro := e.seasoned("ขาประจำ", "p@example.com")
	ok := CreateCommentInput{Body: "เนื้อหาที่ดีมาก", ElapsedMS: 3000}

	if _, err := e.comments.Create(e.ctx, pro, e.post.Slug, CreateCommentInput{Body: "x", ElapsedMS: 100}); fieldOf(err, "body") == "" {
		t.Fatalf("too fast: %v", err)
	}
	if _, err := e.comments.Create(e.ctx, pro, e.post.Slug, CreateCommentInput{Body: "   ", ElapsedMS: 3000}); fieldOf(err, "body") == "" {
		t.Fatalf("empty: %v", err)
	}
	if _, err := e.comments.Create(e.ctx, pro, e.post.Slug, CreateCommentInput{Body: strings.Repeat("ก", 2001), ElapsedMS: 3000}); fieldOf(err, "body") == "" {
		t.Fatalf("too long: %v", err)
	}
	if _, err := e.comments.Create(e.ctx, pro, e.post.Slug, CreateCommentInput{Body: "a.com b.com https://c.com", ElapsedMS: 3000}); fieldOf(err, "body") != "ใส่ลิงก์ได้ไม่เกิน 2 ลิงก์" {
		t.Fatalf("links: %v", err)
	}
	if _, err := e.comments.Create(e.ctx, pro, "no-such-post", ok); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown post: %v", err)
	}
	hp, err := e.comments.Create(e.ctx, pro, e.post.Slug, CreateCommentInput{Body: "spam", ElapsedMS: 0, Website: "x"})
	if err != nil || hp.Status != domain.CommentPending {
		t.Fatalf("honeypot: %v %+v", err, hp)
	}

	top, err := e.comments.Create(e.ctx, pro, e.post.Slug, ok)
	if err != nil || top.Status != domain.CommentPublished || top.PostSlug != e.post.Slug {
		t.Fatalf("seasoned: %v %+v", err, top)
	}
	if _, err := e.comments.Create(e.ctx, pro, e.post.Slug, CreateCommentInput{Body: "  เนื้อหาที่ดีมาก ", ElapsedMS: 3000}); !errors.Is(err, domain.ErrDuplicateComment) {
		t.Fatalf("duplicate: %v", err)
	}
	if n := len(e.rv.tags); n != 1 || e.rv.tags[0][0] != "comments:hello-world" {
		t.Fatalf("revalidate: %v", e.rv.tags)
	}

	held, err := e.comments.Create(e.ctx, newbie, e.post.Slug, CreateCommentInput{Body: "คอมเมนต์แรก", ElapsedMS: 3000,
		ParentID: &top.ID})
	if err != nil || held.Status != domain.CommentPending || *held.ParentID != top.ID {
		t.Fatalf("first comment held: %v %+v", err, held)
	}
	if len(e.rv.tags) != 1 {
		t.Fatal("pending comments must not revalidate")
	}
	// reply to a reply: parent becomes the root, reply_to the reply
	r1, _ := e.comments.Create(e.ctx, pro, e.post.Slug, CreateCommentInput{Body: "ตอบหนึ่ง", ElapsedMS: 3000, ParentID: &top.ID})
	r2, err := e.comments.Create(e.ctx, pro, e.post.Slug, CreateCommentInput{Body: "ตอบสอง", ElapsedMS: 3000, ParentID: &r1.ID})
	if err != nil || *r2.ParentID != top.ID || r2.ReplyToID == nil || *r2.ReplyToID != r1.ID || r2.ReplyTo.DisplayName != "ขาประจำ" {
		t.Fatalf("depth 2: %v %+v", err, r2)
	}
	other := "00000000-0000-0000-0000-000000000000"
	if _, err := e.comments.Create(e.ctx, pro, e.post.Slug, CreateCommentInput{Body: "x y", ElapsedMS: 3000, ParentID: &top.ID,
		ReplyToID: &other}); fieldOf(err, "reply_to_id") == "" {
		t.Fatalf("reply_to outside thread: %v", err)
	}

	// visibility: anonymous sees 2 published replies, the author also sees the held one
	anon, err := e.comments.List(e.ctx, e.post.Slug, nil, CommentQuery{RepliesPreview: 10})
	if err != nil || anon.Total != 1 || anon.Comments[0].ReplyCount != 2 || len(anon.Comments[0].Replies) != 2 ||
		anon.CommentCount != 3 {
		t.Fatalf("anon list: %v %+v", err, anon)
	}
	mine, _ := e.comments.List(e.ctx, e.post.Slug, &newbie, CommentQuery{RepliesPreview: 10})
	if mine.Comments[0].ReplyCount != 3 {
		t.Fatalf("author must see own pending: %+v", mine.Comments[0])
	}
	// deleting the top-level comment keeps a placeholder while replies exist
	if err := e.comments.Delete(e.ctx, newbie, top.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("non-author delete: %v", err)
	}
	if err := e.comments.Delete(e.ctx, pro, top.ID); err != nil {
		t.Fatal(err)
	}
	anon, _ = e.comments.List(e.ctx, e.post.Slug, nil, CommentQuery{RepliesPreview: 2})
	if anon.Total != 1 || anon.Comments[0].Status != domain.CommentDeleted || anon.Comments[0].Body != "" || anon.CommentCount != 2 {
		t.Fatalf("placeholder: %+v", anon)
	}
	// edit history
	ed, err := e.comments.Edit(e.ctx, pro, r1.ID, "ตอบหนึ่ง (แก้ไข)")
	if err != nil || ed.EditedAt == nil || ed.Body != "ตอบหนึ่ง (แก้ไข)" {
		t.Fatalf("edit: %v %+v", err, ed)
	}
	if h, _ := e.comments.History(e.ctx, r1.ID); len(h) != 1 || h[0].Body != "ตอบหนึ่ง" {
		t.Fatalf("history: %+v", h)
	}
}

func TestReportThreshold(t *testing.T) {
	e := newCommEnv(t, commOpts{})
	author := e.seasoned("ผู้เขียน", "author@example.com")
	c, err := e.comments.Create(e.ctx, author, e.post.Slug, CreateCommentInput{Body: "ข้อความ", ElapsedMS: 3000})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.comments.Report(e.ctx, author, c.ID, ReportInput{Reason: "spam"}); err == nil {
		t.Fatal("self report accepted")
	}
	if err := e.comments.Report(e.ctx, author, c.ID, ReportInput{Reason: "nope"}); fieldOf(err, "reason") == "" {
		t.Fatal("bad reason accepted")
	}
	var reporters []domain.Member
	for i, em := range []string{"r1@example.com", "r2@example.com", "r3@example.com"} {
		reporters = append(reporters, e.seasoned("ผู้รายงาน"+string(rune('ก'+i)), em))
	}
	for i := 0; i < 3; i++ { // the same reporter thrice counts once
		if err := e.comments.Report(e.ctx, reporters[0], c.ID, ReportInput{Reason: "spam"}); err != nil {
			t.Fatal(err)
		}
	}
	_ = e.comments.Report(e.ctx, reporters[1], c.ID, ReportInput{Reason: "harassment", Note: "หยาบคาย"})
	got, _ := e.comments.adminGet(e.ctx, c.ID)
	if got.Status != domain.CommentPublished || got.ReportCount != 2 {
		t.Fatalf("after 2 reporters: %+v", got)
	}
	_ = e.comments.Report(e.ctx, reporters[2], c.ID, ReportInput{Reason: "other"})
	got, _ = e.comments.adminGet(e.ctx, c.ID)
	if got.Status != domain.CommentPending || got.ReportCount != 3 {
		t.Fatalf("after 3 reporters: %+v", got)
	}
	if st, _, _ := e.eng.PostStats(e.ctx, e.post.Slug, nil); st.Comments != 0 {
		t.Fatalf("held comment still counted: %+v", st)
	}

	// trusted authors are not held automatically
	_, _, _ = e.store.MembersRepo().SetRole(e.ctx, author.ID, domain.MemberRoleTrusted, "", time.Now())
	author.Role = domain.MemberRoleTrusted
	c2, _ := e.comments.Create(e.ctx, author, e.post.Slug, CreateCommentInput{Body: "อีกข้อความ", ElapsedMS: 3000})
	for _, r := range reporters {
		_ = e.comments.Report(e.ctx, r, c2.ID, ReportInput{Reason: "spam"})
	}
	if got, _ = e.comments.adminGet(e.ctx, c2.ID); got.Status != domain.CommentPublished {
		t.Fatalf("trusted author held: %+v", got)
	}
}

func TestDeleteAccountAnonymizes(t *testing.T) {
	e := newCommEnv(t, commOpts{})
	gone := e.seasoned("จะลบ", "gone@example.com")
	stay := e.seasoned("อยู่ต่อ", "stay@example.com")
	c, _ := e.comments.Create(e.ctx, gone, e.post.Slug, CreateCommentInput{Body: "คอมเมนต์ที่จะคงอยู่", ElapsedMS: 3000})
	sc, _ := e.comments.Create(e.ctx, stay, e.post.Slug, CreateCommentInput{Body: "ของคนอื่น", ElapsedMS: 3000})
	_, _, _ = e.eng.LikePost(e.ctx, gone, e.post.Slug, true)
	_, _, _ = e.comments.Like(e.ctx, gone, sc.ID, true)
	_ = e.comments.Report(e.ctx, gone, sc.ID, ReportInput{Reason: "spam"})
	if _, err := e.members.SetAvatar(e.ctx, gone, pngBytes(t, 64, 64)); err != nil {
		t.Fatal(err)
	}
	gm, _ := e.store.MembersRepo().GetByID(e.ctx, gone.ID)
	if gm.AvatarKey == "" {
		t.Fatal("avatar not stored")
	}
	if _, err := e.comments.UploadImage(e.ctx, gone, pngBytes(t, 32, 32)); err != nil {
		t.Fatal(err)
	}
	gm.Email = "gone@example.com"
	if err := e.members.DeleteAccount(e.ctx, gm, DeleteAccountInput{CurrentPassword: "tangerine-orbit-42", Confirm: "ลบ"}); fieldOf(err, "confirm") == "" {
		t.Fatalf("confirm word: %v", err)
	}
	if err := e.members.DeleteAccount(e.ctx, gm, DeleteAccountInput{CurrentPassword: "wrong-pass-99", Confirm: "ลบบัญชี"}); fieldOf(err, "current_password") == "" {
		t.Fatalf("password: %v", err)
	}
	e.rv.tags = nil
	if err := e.members.DeleteAccount(e.ctx, gm, DeleteAccountInput{CurrentPassword: "tangerine-orbit-42", Confirm: "ลบบัญชี"}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.store.MembersRepo().GetByID(e.ctx, gone.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("member row kept")
	}
	kept, err := e.comments.adminGet(e.ctx, c.ID)
	if err != nil || kept.Author != nil || kept.MemberID != nil || kept.Body != "คอมเมนต์ที่จะคงอยู่" {
		t.Fatalf("comment must stay anonymised: %v %+v", err, kept)
	}
	other, _ := e.comments.adminGet(e.ctx, sc.ID)
	if other.LikeCount != 0 || other.ReportCount != 0 {
		t.Fatalf("counters not fixed: likes %d reports %d", other.LikeCount, other.ReportCount)
	}
	if st, _, _ := e.eng.PostStats(e.ctx, e.post.Slug, nil); st.Likes != 0 || st.Comments != 2 {
		t.Fatalf("post stats: %+v", st)
	}
	if _, err := e.disk.Open(gm.AvatarKey); err == nil {
		t.Fatal("avatar file not deleted")
	}
	if e.store.ImageCount() != 0 {
		t.Fatal("image rows not deleted")
	}
	if len(e.rv.tags) != 1 || e.rv.tags[0][0] != "comments:hello-world" {
		t.Fatalf("revalidate: %v", e.rv.tags)
	}
	if _, err := e.members.Login(e.ctx, "gone@example.com", "tangerine-orbit-42", "", testMeta); err == nil {
		t.Fatal("deleted account still logs in")
	}
}

func TestModerationAndAdmin(t *testing.T) {
	e := newCommEnv(t, commOpts{holdFirst: true})
	newbie := e.register("ใหม่", "n@example.com").Member
	mod := e.seasoned("ผู้ดูแล", "mod@example.com")
	_, _, _ = e.store.MembersRepo().SetRole(e.ctx, mod.ID, domain.MemberRoleModerator, "", time.Now())
	mod.Role = domain.MemberRoleModerator
	c, _ := e.comments.Create(e.ctx, newbie, e.post.Slug, CreateCommentInput{Body: "รออนุมัติ", ElapsedMS: 3000})
	if c.Status != domain.CommentPending {
		t.Fatal("must be held")
	}
	if _, err := e.comments.Moderate(e.ctx, newbie, c.ID, "approve"); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-moderator: %v", err)
	}
	got, err := e.comments.Moderate(e.ctx, mod, c.ID, "approve")
	if err != nil || got.Status != domain.CommentPublished || got.ModeratedByKind != "member" {
		t.Fatalf("approve: %v %+v", err, got)
	}
	admin := domain.Actor{ID: "admin-1", Role: domain.RoleEditor}
	if got, err = e.comments.AdminSetStatus(e.ctx, admin, c.ID, "hidden"); err != nil || got.Status != domain.CommentHidden {
		t.Fatalf("admin hide: %v", err)
	}
	res, err := e.comments.AdminBulk(e.ctx, admin, BulkCommentInput{Action: "delete", IDs: []string{c.ID, "bad-id"}})
	if err != nil || len(res.Succeeded) != 1 || len(res.Failed) != 1 {
		t.Fatalf("bulk: %v %+v", err, res)
	}
	acts := e.audit.actions()
	if !slicesContains(acts, domain.AuditCommentHide) || !slicesContains(acts, domain.AuditCommentDelete) {
		t.Fatalf("audit: %v", acts)
	}
	for _, ev := range e.audit.events {
		for k, v := range ev.Metadata {
			if s, ok := v.(string); ok && strings.Contains(s, "@") {
				t.Fatalf("audit metadata %s leaks an e-mail: %v", k, v)
			}
		}
	}

	// ban with hide_comments
	seasoned := e.seasoned("ปกติ", "s@example.com")
	sc, _ := e.comments.Create(e.ctx, seasoned, e.post.Slug, CreateCommentInput{Body: "ปกติ", ElapsedMS: 3000})
	role, hide := "banned", true
	row, err := e.members.AdminUpdate(e.ctx, admin, seasoned.ID, MemberPatch{Role: &role, HideComments: &hide})
	if err != nil || row.Member.Role != domain.MemberRoleBanned || row.Member.BannedAt == nil {
		t.Fatalf("ban: %v %+v", err, row)
	}
	if got, _ := e.comments.adminGet(e.ctx, sc.ID); got.Status != domain.CommentHidden {
		t.Fatal("hide_comments")
	}
	if _, err := e.comments.Create(e.ctx, row.Member, e.post.Slug, CreateCommentInput{Body: "อีก", ElapsedMS: 3000}); !errors.Is(err, domain.ErrMemberBanned) {
		t.Fatalf("banned write: %v", err)
	}
	rows, _, total, err := e.members.AdminList(e.ctx, AdminMemberQuery{Q: "S@EXAMPLE.com"})
	if err != nil || total != 1 || rows[0].Member.ID != seasoned.ID || rows[0].Member.Email != "s@example.com" {
		t.Fatalf("e-mail search: %v %d", err, total)
	}
	role = "member"
	if row, _ = e.members.AdminUpdate(e.ctx, admin, seasoned.ID, MemberPatch{Role: &role}); row.Member.BannedAt != nil {
		t.Fatal("unban must clear banned_at")
	}
	acts = e.audit.actions()
	for _, a := range []string{domain.AuditMemberBan, domain.AuditMemberUnban, domain.AuditMemberRoleChange} {
		if !slicesContains(acts, a) {
			t.Fatalf("audit %s missing: %v", a, acts)
		}
	}
}

func slicesContains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func TestViewsDedupeAndJanitor(t *testing.T) {
	e := newCommEnv(t, commOpts{})
	ua := "Mozilla/5.0 (Windows NT 10.0) Chrome/130"
	e.eng.RecordView(e.ctx, e.post.Slug, "198.51.100.1", ua)
	e.eng.RecordView(e.ctx, e.post.Slug, "198.51.100.1", ua)
	e.eng.RecordView(e.ctx, e.post.Slug, "198.51.100.2", ua)
	e.eng.RecordView(e.ctx, e.post.Slug, "198.51.100.3", "curl/8")
	e.eng.RecordView(e.ctx, "no-such-post", "198.51.100.4", ua)
	st, _, _ := e.eng.PostStats(e.ctx, e.post.Slug, nil)
	if st.Views != 2 {
		t.Fatalf("views: %d", st.Views)
	}
	// next day: the same visitor counts again (new salt)
	e.eng.Now = func() time.Time { return time.Now().Add(24 * time.Hour) }
	e.eng.RecordView(e.ctx, e.post.Slug, "198.51.100.1", ua)
	if st, _, _ = e.eng.PostStats(e.ctx, e.post.Slug, nil); st.Views != 3 {
		t.Fatalf("next day: %d", st.Views)
	}
	stats, err := e.eng.Stats(e.ctx, "hello-world, unknown ,hello-world")
	if err != nil || len(stats) != 1 || stats["hello-world"].Views != 3 {
		t.Fatalf("stats: %v %+v", err, stats)
	}
	many := make([]string, 51)
	for i := range many {
		many[i] = fmt.Sprintf("s%d", i)
	}
	if _, err := e.eng.Stats(e.ctx, strings.Join(many, ",")); err == nil {
		t.Fatal(">50 slugs accepted")
	}

	m := e.seasoned("รูป", "img@example.com")
	img, err := e.comments.UploadImage(e.ctx, m, pngBytes(t, 40, 30))
	if err != nil || img.Width != 40 || !strings.HasPrefix(img.StorageKey, "c-") || !storage.ValidKey(img.StorageKey) {
		t.Fatalf("upload: %v %+v", err, img)
	}
	j := NewCommunityJanitor(e.store.EngagementRepo(), e.store.CommentsRepo(), e.disk, discard)
	j.Now = func() time.Time { return time.Now().Add(3 * 24 * time.Hour) }
	if err := j.RunOnce(e.ctx); err != nil {
		t.Fatal(err)
	}
	if e.store.ImageCount() != 0 {
		t.Fatal("stale unattached image not purged")
	}
	if _, err := e.disk.Open(img.StorageKey); err == nil {
		t.Fatal("stale image file not deleted")
	}
	var _ repository.Engagement = e.store.EngagementRepo()
}
