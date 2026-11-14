package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/config"
	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
	"github.com/ecomacrobiz/escoma/api/internal/ratelimit"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
	"github.com/ecomacrobiz/escoma/api/internal/service"
	"github.com/ecomacrobiz/escoma/api/internal/storage"
	"github.com/ecomacrobiz/escoma/api/internal/vault"
)

// testOIDC fakes Google: the nonce of the last authorization URL is echoed
// in the claims; the PKCE verifier must match.
type testOIDC struct {
	nonce, verifier string
	claims          service.OIDCClaims
}

func (f *testOIDC) AuthCodeURL(state, nonce, verifier string) (string, error) {
	f.nonce, f.verifier = nonce, verifier
	return "https://accounts.example/o/auth?state=" + url.QueryEscape(state), nil
}

func (f *testOIDC) Exchange(_ context.Context, code, verifier string) (service.OIDCClaims, error) {
	if verifier != f.verifier || code == "" {
		return service.OIDCClaims{}, errors.New("bad verifier")
	}
	c := f.claims
	c.Nonce = f.nonce
	return c, nil
}

type communityDeps struct {
	members    *service.MemberService
	google     *service.GoogleService
	comments   *service.CommentService
	engagement *service.EngagementService
	limits     CommunityLimiters
	oidc       *testOIDC
}

func newCommunityDeps(t *testing.T, cfg *config.Config, store *fake.Store, disk *storage.LocalDisk, rv service.Revalidator,
	audit service.Auditor) communityDeps {
	t.Helper()
	keys, err := vault.NewKeyring([]int16{1}, map[int16][]byte{1: vault.RandomKey()})
	if err != nil {
		t.Fatal(err)
	}
	crypto := service.MemberCrypto{Keys: keys, Index: vault.NewIndex(vault.RandomKey()),
		Hasher: vault.NewHasher(vault.Argon2Params{MemoryKiB: 64, Time: 1, Threads: 1})}
	mc := cfg.Members
	members := service.NewMemberService(store.MembersRepo(), store.MemberSessionsRepo(), store.MemberTokensRepo(),
		store.CommentsRepo(), crypto, disk, nil, nil, rv, audit, service.MemberServiceConfig{SessionTTL: mc.SessionTTL,
			WebBaseURL: cfg.WebBaseURL, RequireVerified: mc.RequireVerifiedEmail, AvatarMaxBytes: mc.AvatarMaxBytes}, discard)
	ccfg := service.CommentServiceConfig{HoldFirstComment: mc.HoldFirstComment, RequireVerified: mc.RequireVerifiedEmail,
		ImageMaxBytes: mc.CommentImageMaxBytes}
	oidc := &testOIDC{}
	rl := func(r config.RateLimit) *ratelimit.Limiter { return ratelimit.New(r.Events, r.Per) }
	return communityDeps{
		members:    members,
		comments:   service.NewCommentService(store.CommentsRepo(), store.PostsRepo(), store.MembersRepo(), store.EngagementRepo(), disk, rv, audit, ccfg, discard),
		engagement: service.NewEngagementService(store.EngagementRepo(), store.PostsRepo(), ccfg, discard),
		google: service.NewGoogleService(oidc, store.OAuthStatesRepo(), store.MembersRepo(), store.MemberTokensRepo(), members,
			service.GoogleServiceConfig{WebBaseURL: cfg.WebBaseURL}, discard),
		oidc: oidc,
		limits: CommunityLimiters{Register: rl(mc.RegisterRateLimit), LoginIP: rl(mc.LoginRateLimit),
			LoginEmail: rl(mc.LoginRateLimit), Token: ratelimit.New(20, 10*time.Minute), Forgot: ratelimit.New(5, time.Hour),
			Resend: ratelimit.New(3, time.Hour), GoogleStart: ratelimit.New(20, 10*time.Minute),
			GoogleLink: ratelimit.New(10, 15*time.Minute), Avatar: ratelimit.New(10, time.Hour),
			Password: ratelimit.New(5, 15*time.Minute), Views: ratelimit.New(60, 10*time.Minute),
			Likes: ratelimit.New(60, time.Minute), Comment: rl(mc.CommentRateLimit), CommentIP: rl(mc.CommentIPRateLimit),
			Report: ratelimit.New(20, time.Hour), Upload: ratelimit.New(10, time.Hour)},
	}
}

// memberRoutes classifies every /api/v1/community route:
//
//	public    no session needed
//	origin    pre-session unsafe route: allowlisted Origin when present
//	signed-in GET that needs a member session
//	auth      member session + X-CSRF-Token + allowlisted Origin
var memberRoutes = map[string]string{
	"GET /api/v1/community/config":                       "public",
	"GET /api/v1/community/stats":                        "public",
	"GET /api/v1/community/auth/me":                      "public",
	"POST /api/v1/community/auth/register":               "origin",
	"POST /api/v1/community/auth/login":                  "origin",
	"POST /api/v1/community/auth/logout":                 "auth",
	"POST /api/v1/community/auth/verify-email":           "origin",
	"POST /api/v1/community/auth/verify-email/resend":    "auth",
	"POST /api/v1/community/auth/password/forgot":        "origin",
	"POST /api/v1/community/auth/password/reset":         "origin",
	"GET /api/v1/community/auth/google/start":            "public",
	"GET /api/v1/community/auth/google/callback":         "public",
	"POST /api/v1/community/auth/google/link":            "origin",
	"PUT /api/v1/community/account/profile":              "auth",
	"POST /api/v1/community/account/avatar":              "auth",
	"DELETE /api/v1/community/account/avatar":            "auth",
	"PUT /api/v1/community/account/email":                "auth",
	"PUT /api/v1/community/account/password":             "auth",
	"GET /api/v1/community/account/sessions":             "signed-in",
	"DELETE /api/v1/community/account/sessions/others":   "auth",
	"DELETE /api/v1/community/account/identities/google": "auth",
	"GET /api/v1/community/account/export":               "signed-in",
	"DELETE /api/v1/community/account":                   "auth",
	"GET /api/v1/community/posts/:slug/stats":            "public",
	"POST /api/v1/community/posts/:slug/views":           "origin",
	"PUT /api/v1/community/posts/:slug/like":             "auth",
	"DELETE /api/v1/community/posts/:slug/like":          "auth",
	"GET /api/v1/community/posts/:slug/comments":         "public",
	"POST /api/v1/community/posts/:slug/comments":        "auth",
	"GET /api/v1/community/comments/:id/replies":         "public",
	"PATCH /api/v1/community/comments/:id":               "auth",
	"DELETE /api/v1/community/comments/:id":              "auth",
	"PUT /api/v1/community/comments/:id/like":            "auth",
	"DELETE /api/v1/community/comments/:id/like":         "auth",
	"POST /api/v1/community/comments/:id/report":         "auth",
	"POST /api/v1/community/comments/:id/moderate":       "auth",
	"POST /api/v1/community/uploads/comment-image":       "auth",
}

type msession struct {
	cookie *http.Cookie
	csrf   string
	id     string
}

func (s msession) opts(extra ...reqOpt) []reqOpt {
	return append([]reqOpt{withCookie(s.cookie), withHeader(middleware.CSRFHeader, s.csrf),
		withHeader("Origin", webOrigin)}, extra...)
}

// member creates a member through the service (no IP budget used) and
// returns its session.
func (e *env) member(name, email string, role domain.MemberRole) msession {
	e.t.Helper()
	a, err := e.comm.members.Register(context.Background(), service.RegisterInput{DisplayName: name, Email: email,
		Password: "tangerine-orbit-42", AcceptTerms: true, ConsentVersion: domain.ConsentVersion},
		service.RequestMeta{IP: "198.51.100.1"})
	if err != nil {
		e.t.Fatal(err)
	}
	if role != domain.MemberRoleMember {
		if _, _, err := e.store.MembersRepo().SetRole(context.Background(), a.Member.ID, role, "", time.Now()); err != nil {
			e.t.Fatal(err)
		}
		if role == domain.MemberRoleBanned {
			return msession{id: a.Member.ID}
		}
	}
	return msession{cookie: &http.Cookie{Name: middleware.MemberCookie, Value: a.Token}, csrf: a.CSRFToken, id: a.Member.ID}
}

func memberPath(p string) string {
	p = strings.ReplaceAll(p, ":id", zeroID)
	return strings.ReplaceAll(p, ":slug", "one")
}

func TestMemberRoutesCovered(t *testing.T) {
	e := newEnv(t)
	seen := map[string]bool{}
	for _, ri := range e.r.Routes() {
		k := ri.Method + " " + ri.Path
		if strings.HasPrefix(ri.Path, "/api/v1/community") {
			seen[k] = true
			if _, ok := memberRoutes[k]; !ok {
				t.Errorf("community route %s is not classified in memberRoutes", k)
			}
		}
	}
	for k := range memberRoutes {
		if !seen[k] {
			t.Errorf("classified route %s is not registered", k)
		}
	}
}

// Every unsafe member route needs the member's CSRF token and an allowed
// Origin; the admin cookie never authenticates a member route.
func TestMemberCSRFMatrix(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)
	admin := e.login(t)
	mod := e.member("ผู้ดูแล", "mod@example.com", domain.MemberRoleModerator)
	var keys []string
	for k := range memberRoutes {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	checked := 0
	for _, k := range keys {
		kind := memberRoutes[k]
		method, pattern, _ := strings.Cut(k, " ")
		path := memberPath(pattern)
		body := map[string]any{}
		if method == "GET" {
			body = nil
		}
		switch kind {
		case "auth":
			if w := e.do(method, path, body, withHeader("Origin", webOrigin)); w.Code != 401 {
				t.Errorf("%s anonymous: want 401, got %d %s", k, w.Code, w.Body)
			}
			if w := e.do(method, path, body, admin.opts()...); w.Code != 401 {
				t.Errorf("%s with the ADMIN cookie: want 401, got %d %s", k, w.Code, w.Body)
			}
			w := e.do(method, path, body, withCookie(mod.cookie), withHeader("Origin", webOrigin))
			if env := decode(t, w); w.Code != 403 || env.Error.Message != domain.MsgForbidden {
				t.Errorf("%s without CSRF: want 403 CSRF, got %d %s", k, w.Code, w.Body)
			}
			w = e.do(method, path, body, withCookie(mod.cookie), withHeader(middleware.CSRFHeader, "wrong"),
				withHeader("Origin", webOrigin))
			if w.Code != 403 {
				t.Errorf("%s wrong CSRF: want 403, got %d", k, w.Code)
			}
			w = e.do(method, path, body, withCookie(mod.cookie), withHeader(middleware.CSRFHeader, mod.csrf),
				withHeader("Origin", "https://evil.example"))
			if w.Code != 403 {
				t.Errorf("%s foreign origin: want 403, got %d", k, w.Code)
			}
			s := mod
			if k == "POST /api/v1/community/auth/logout" || strings.HasPrefix(k, "DELETE /api/v1/community/account") {
				s = e.member("ชั่วคราว"+fmt.Sprint(checked), fmt.Sprintf("tmp%d@example.com", checked), domain.MemberRoleModerator)
			}
			w = e.do(method, path, body, s.opts()...)
			if w.Code == 401 || (w.Code == 403 && decode(t, w).Error.Message == domain.MsgForbidden) {
				t.Errorf("%s with session + CSRF: got %d %s", k, w.Code, w.Body)
			}
		case "signed-in":
			if w := e.do(method, path, nil); w.Code != 401 {
				t.Errorf("%s anonymous: want 401, got %d", k, w.Code)
			}
			if w := e.do(method, path, nil, admin.opts()...); w.Code != 401 {
				t.Errorf("%s with the ADMIN cookie: want 401, got %d", k, w.Code)
			}
			if w := e.do(method, path, nil, withCookie(mod.cookie)); w.Code != 200 {
				t.Errorf("%s member: want 200, got %d %s", k, w.Code, w.Body)
			}
		case "origin":
			if w := e.do(method, path, body, withHeader("Origin", "https://evil.example")); w.Code != 403 {
				t.Errorf("%s foreign origin: want 403, got %d %s", k, w.Code, w.Body)
			}
		case "public":
			if w := e.do(method, path, body); w.Code == 401 || w.Code == 403 {
				t.Errorf("%s public: got %d %s", k, w.Code, w.Body)
			}
		default:
			t.Errorf("%s: unknown kind %q", k, kind)
		}
		checked++
	}
	t.Logf("member CSRF matrix: %d routes checked", checked)
}

// The member cookie (and its CSRF token) never authenticates the admin API.
func TestMemberCookieNeverAuthenticatesAdmin(t *testing.T) {
	e := newEnv(t)
	m := e.member("สมชาย", "m@example.com", domain.MemberRoleModerator)
	n := 0
	for k, r := range expectedMatrix {
		if r.public || r.member {
			continue
		}
		method, pattern, _ := strings.Cut(k, " ")
		w := e.do(method, matrixPath(pattern), map[string]any{}, m.opts()...)
		if w.Code != 401 {
			t.Errorf("%s with the MEMBER cookie: want 401, got %d %s", k, w.Code, w.Body)
		}
		n++
	}
	// and a cookie value that is a valid member token under the admin name
	adm := &http.Cookie{Name: middleware.SessionCookie, Value: m.cookie.Value}
	if w := e.do("GET", "/api/v1/admin/auth/me", nil, withCookie(adm)); w.Code != 401 {
		t.Errorf("member token in escoma_admin: %d", w.Code)
	}
	if n < 40 {
		t.Fatalf("only %d admin routes checked", n)
	}
}

func cookieNamed(w interface{ Result() *http.Response }, name string) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func registerBody(email string) map[string]any {
	return map[string]any{"display_name": "สมชาย ใจดี", "email": email, "password": "tangerine-orbit-42",
		"accept_terms": true, "consent_version": domain.ConsentVersion, "website": ""}
}

func TestMemberCookieAttributes(t *testing.T) {
	for _, secure := range []bool{true, false} {
		e := newEnvWith(t, map[string]string{"COOKIE_SECURE": fmt.Sprint(secure)})
		w := e.do("POST", "/api/v1/community/auth/register", registerBody("a@example.com"), withHeader("Origin", webOrigin))
		expect(t, w, 201)
		ck := cookieNamed(w, middleware.MemberCookie)
		if ck == nil || !ck.HttpOnly || ck.Secure != secure || ck.SameSite != http.SameSiteLaxMode || ck.Path != "/" ||
			ck.MaxAge != int((720*time.Hour).Seconds()) {
			t.Fatalf("secure=%v member cookie: %+v", secure, ck)
		}
		if cookieNamed(w, middleware.SessionCookie) != nil {
			t.Fatal("member login must not set the admin cookie")
		}
		w = e.do("GET", "/api/v1/community/auth/google/start?next=/knowledge/one&consent=1", nil)
		ock := cookieNamed(w, middleware.OAuthCookie)
		if w.Code != 302 || ock == nil || !ock.HttpOnly || ock.Secure != secure || ock.SameSite != http.SameSiteLaxMode ||
			ock.Path != "/api/community/auth/google" || ock.MaxAge != 600 {
			t.Fatalf("secure=%v oauth cookie: %d %+v", secure, w.Code, ock)
		}
		// logout clears the cookie
		var me struct {
			CSRF string `json:"csrf_token"`
		}
		_ = json.Unmarshal(decode(t, e.do("GET", "/api/v1/community/auth/me", nil, withCookie(ck))).Data, &me)
		w = e.do("POST", "/api/v1/community/auth/logout", nil, msession{cookie: ck, csrf: me.CSRF}.opts()...)
		if w.Code != 204 || cookieNamed(w, middleware.MemberCookie).MaxAge >= 0 {
			t.Fatalf("logout: %d", w.Code)
		}
		if env := expect(t, e.do("GET", "/api/v1/community/auth/me", nil, withCookie(ck)), 200); string(env.Data) != "null" {
			t.Fatalf("me after logout: %s", env.Data)
		}
	}
}

func TestMemberRateLimits(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)
	check := func(name string, w interface {
		Result() *http.Response
	}, code int) {
		t.Helper()
		res := w.Result()
		if res.StatusCode != 429 || res.Header.Get("Retry-After") == "" {
			t.Fatalf("%s: want 429 + Retry-After, got %d %q", name, res.StatusCode, res.Header.Get("Retry-After"))
		}
	}
	// login: 5 per IP (MEMBER_LOGIN_RATE_LIMIT=5/15m in the test env)
	var w interface{ Result() *http.Response }
	for i := 0; i < 6; i++ {
		w = e.do("POST", "/api/v1/community/auth/login", map[string]string{"email": fmt.Sprintf("x%d@example.com", i),
			"password": "whatever-pass"}, withHeader("Origin", webOrigin))
		if i < 5 && w.Result().StatusCode != 401 {
			t.Fatalf("login %d: %d", i, w.Result().StatusCode)
		}
	}
	check("login", w, 429)
	// register: 5/1h per IP
	for i := 0; i < 6; i++ {
		w = e.do("POST", "/api/v1/community/auth/register", registerBody(fmt.Sprintf("r%d@example.com", i)),
			withHeader("Origin", webOrigin), withRemote("198.51.100.77"))
	}
	check("register", w, 429)
	// comments: 4/1m per member (COMMENT_RATE_LIMIT in the test env)
	m := e.member("ขาประจำ", "c@example.com", domain.MemberRoleTrusted)
	for i := 0; i < 5; i++ {
		w = e.do("POST", "/api/v1/community/posts/one/comments", map[string]any{"body": fmt.Sprintf("ความเห็นที่ %d", i),
			"elapsed_ms": 4000}, m.opts()...)
		if i < 4 && w.Result().StatusCode != 201 {
			t.Fatalf("comment %d: %d", i, w.Result().StatusCode)
		}
	}
	check("comments", w, 429)
	// views: 60/10m per IP, always 204 before that
	for i := 0; i < 61; i++ {
		w = e.do("POST", "/api/v1/community/posts/one/views", nil, withHeader("User-Agent", "Mozilla/5.0 Chrome"),
			withRemote("198.51.100.88"))
		if i < 60 && w.Result().StatusCode != 204 {
			t.Fatalf("view %d: %d", i, w.Result().StatusCode)
		}
	}
	check("views", w, 429)
}

func keysOf(t *testing.T, raw json.RawMessage) []string {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	var out []string
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func pngFile(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: 10, G: uint8(x), B: uint8(y), A: 255})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func multipartFile(t *testing.T, data []byte) ([]byte, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "photo.png")
	_, _ = fw.Write(data)
	_ = mw.Close()
	return buf.Bytes(), mw.FormDataContentType()
}

// The JSON shapes match web/src/lib/community/types.ts.
func TestCommunityWireShapes(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)
	env := expect(t, e.do("GET", "/api/v1/community/config", nil), 200)
	if got := strings.Join(keysOf(t, env.Data), ","); got != "avatar_max_mb,comment_image_max_mb,comment_max_chars,consent_version,email_transport,google_enabled,require_verified_email,turnstile" {
		t.Fatalf("CommunityConfig keys: %s", got)
	}
	w := e.do("POST", "/api/v1/community/auth/register", registerBody("shape@example.com"), withHeader("Origin", webOrigin))
	env = expect(t, w, 201)
	if got := strings.Join(keysOf(t, env.Data), ","); got != "csrf_token,member" {
		t.Fatalf("Session keys: %s", got)
	}
	var sess struct {
		Member json.RawMessage `json:"member"`
		CSRF   string          `json:"csrf_token"`
	}
	_ = json.Unmarshal(env.Data, &sess)
	if got := strings.Join(keysOf(t, sess.Member), ","); got != "avatar_url,created_at,display_name,email,email_verified,has_password,id,identities,role" {
		t.Fatalf("Me keys: %s", got)
	}
	s := msession{cookie: cookieNamed(w, middleware.MemberCookie), csrf: sess.CSRF}
	trusted := e.member("ขาประจำ", "t@example.com", domain.MemberRoleTrusted)

	// upload an image, then comment with it
	body, ct := multipartFile(t, pngFile(t, 64, 48))
	env = expect(t, e.do("POST", "/api/v1/community/uploads/comment-image", body, append(trusted.opts(),
		withHeader("Content-Type", ct))...), 201)
	var img struct{ ID, URL string }
	_ = json.Unmarshal(env.Data, &img)
	if got := strings.Join(keysOf(t, env.Data), ","); got != "height,id,url,width" || !strings.HasPrefix(img.URL, "http://api.test/media/c-") {
		t.Fatalf("upload: %s", env.Data)
	}
	env = expect(t, e.do("POST", "/api/v1/community/posts/one/comments", map[string]any{"body": "**สวัสดี** <b>x</b>",
		"image_id": img.ID, "elapsed_ms": 3000, "website": ""}, trusted.opts()...), 201)
	var top struct {
		ID       string
		BodyHTML string `json:"body_html"`
		Status   string
	}
	_ = json.Unmarshal(env.Data, &top)
	if top.Status != "published" || top.BodyHTML != "<strong>สวัสดี</strong> &lt;b&gt;x&lt;/b&gt;" {
		t.Fatalf("comment: %s", env.Data)
	}
	if got := strings.Join(keysOf(t, env.Data), ","); got != "author,body,body_html,can_delete,can_edit,can_moderate,can_report,created_at,edited_at,id,image,like_count,liked_by_me,parent_id,post_slug,replies,reply_count,reply_to,status" {
		t.Fatalf("Comment keys: %s", got)
	}
	// a new member's first reply is held, then liked/listed
	env = expect(t, e.do("POST", "/api/v1/community/posts/one/comments", map[string]any{"body": "ตอบกลับ",
		"parent_id": top.ID, "elapsed_ms": 3000}, s.opts()...), 201)
	if !strings.Contains(string(env.Data), `"status":"pending"`) || !strings.Contains(string(env.Data), `"reply_to":null`) {
		t.Fatalf("held reply: %s", env.Data)
	}
	env = expect(t, e.do("PUT", "/api/v1/community/comments/"+top.ID+"/like", nil, s.opts()...), 200)
	if string(env.Data) != `{"liked":true,"likes":1}` {
		t.Fatalf("like: %s", env.Data)
	}
	expect(t, e.do("PUT", "/api/v1/community/comments/"+top.ID+"/like", nil, s.opts()...), 200) // idempotent
	w = e.do("GET", "/api/v1/community/posts/one/comments?sort=top&replies_preview=2", nil, withCookie(s.cookie))
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("cache-control: %q", w.Header().Get("Cache-Control"))
	}
	var list struct {
		Data []struct {
			LikeCount  int  `json:"like_count"`
			LikedByMe  bool `json:"liked_by_me"`
			ReplyCount int  `json:"reply_count"`
			CanReport  bool `json:"can_report"`
			Replies    []struct {
				Status  string `json:"status"`
				CanEdit bool   `json:"can_edit"`
			} `json:"replies"`
			Image *struct{ URL string } `json:"image"`
		} `json:"data"`
		Meta map[string]int `json:"meta"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	if len(list.Data) != 1 || list.Data[0].LikeCount != 1 || !list.Data[0].LikedByMe || list.Data[0].ReplyCount != 1 ||
		!list.Data[0].CanReport || len(list.Data[0].Replies) != 1 || !list.Data[0].Replies[0].CanEdit ||
		list.Data[0].Image == nil || list.Meta["comment_count"] != 1 || list.Meta["total"] != 1 {
		t.Fatalf("list: %s", w.Body)
	}
	// anonymous: no pending reply, no flags
	_ = json.Unmarshal(e.do("GET", "/api/v1/community/posts/one/comments", nil).Body.Bytes(), &list)
	if list.Data[0].ReplyCount != 0 || list.Data[0].CanReport || list.Data[0].LikedByMe {
		t.Fatalf("anonymous list: %+v", list.Data[0])
	}
	// stats
	w = e.do("GET", "/api/v1/community/stats?slugs=one,two,nope", nil)
	if w.Header().Get("Cache-Control") != "public, max-age=60" ||
		!strings.Contains(w.Body.String(), `"one":{"views":0,"likes":0,"comments":1}`) || strings.Contains(w.Body.String(), "nope") {
		t.Fatalf("stats: %s %v", w.Body, w.Header())
	}
	expect(t, e.do("POST", "/api/v1/community/posts/one/views", nil, withHeader("User-Agent", "Mozilla/5.0 Chrome"),
		withHeader("Origin", webOrigin)), 204)
	expect(t, e.do("POST", "/api/v1/community/posts/one/views", nil, withHeader("User-Agent", "Googlebot")), 204)
	expect(t, e.do("POST", "/api/v1/community/posts/nope/views", nil), 204)
	env = expect(t, e.do("GET", "/api/v1/community/posts/one/stats", nil, withCookie(s.cookie)), 200)
	if string(env.Data) != `{"views":1,"likes":0,"comments":1,"liked_by_me":false}` {
		t.Fatalf("post stats: %s", env.Data)
	}
	// errors use the contract codes
	env = expect(t, e.do("POST", "/api/v1/community/auth/register", registerBody("shape@example.com"),
		withHeader("Origin", webOrigin)), 409)
	if env.Error.Code != "email_taken" || env.Error.Message != domain.MsgEmailTaken {
		t.Fatalf("email_taken: %+v", env.Error)
	}
	env = expect(t, e.do("POST", "/api/v1/community/auth/login", map[string]string{"email": "shape@example.com",
		"password": "nope-nope-nope"}, withHeader("Origin", webOrigin)), 401)
	if env.Error.Code != "invalid_credentials" {
		t.Fatalf("invalid_credentials: %+v", env.Error)
	}
	env = expect(t, e.do("DELETE", "/api/v1/community/account/identities/google", nil, s.opts()...), 204)
	// export
	w = e.do("GET", "/api/v1/community/account/export", nil, withCookie(s.cookie))
	if w.Code != 200 || w.Header().Get("Content-Disposition") != `attachment; filename="ecomacrobiz-account.json"` {
		t.Fatalf("export: %d %v", w.Code, w.Header())
	}
	if got := strings.Join(keysOf(t, w.Body.Bytes()), ","); got != "comments,identities,likes,member,sessions" {
		t.Fatalf("export keys: %s", got)
	}
}

func TestGoogleHTTPFlow(t *testing.T) {
	e := newEnv(t)
	w := e.do("GET", "/api/v1/community/auth/google/start?next=/knowledge/one&consent=1", nil)
	loc, _ := url.Parse(w.Header().Get("Location"))
	ock := cookieNamed(w, middleware.OAuthCookie)
	if w.Code != 302 || loc.Host != "accounts.example" || ock == nil {
		t.Fatalf("start: %d %s", w.Code, w.Header().Get("Location"))
	}
	state := loc.Query().Get("state")
	e.oidc.claims = service.OIDCClaims{Subject: "sub-1", Email: "g@gmail.com", EmailVerified: true, Name: "จี เมล"}
	cb := "/api/v1/community/auth/google/callback?code=abc&state=" + url.QueryEscape(state)
	// without the binding cookie the state is rejected (and consumed)
	w = e.do("GET", cb, nil)
	if w.Code != 302 || w.Header().Get("Location") != "https://www.example.test/knowledge/one#community=error-state" {
		t.Fatalf("no binding: %d %s", w.Code, w.Header().Get("Location"))
	}
	w = e.do("GET", "/api/v1/community/auth/google/start?next=/knowledge/one&consent=1", nil)
	loc, _ = url.Parse(w.Header().Get("Location"))
	ock = cookieNamed(w, middleware.OAuthCookie)
	cb = "/api/v1/community/auth/google/callback?code=abc&state=" + url.QueryEscape(loc.Query().Get("state"))
	w = e.do("GET", cb, nil, withCookie(&http.Cookie{Name: ock.Name, Value: ock.Value}))
	if w.Code != 302 || w.Header().Get("Location") != "https://www.example.test/knowledge/one#community=signed-in" {
		t.Fatalf("callback: %d %s", w.Code, w.Header().Get("Location"))
	}
	mck := cookieNamed(w, middleware.MemberCookie)
	if mck == nil || mck.Value == "" || cookieNamed(w, middleware.OAuthCookie).MaxAge >= 0 {
		t.Fatal("callback must set the member cookie and clear the oauth cookie")
	}
	env := expect(t, e.do("GET", "/api/v1/community/auth/me", nil, withCookie(mck)), 200)
	if !strings.Contains(string(env.Data), `"display_name":"จี เมล"`) || !strings.Contains(string(env.Data), `"has_password":false`) ||
		!strings.Contains(string(env.Data), `"provider":"google"`) {
		t.Fatalf("me: %s", env.Data)
	}
}

func TestAdminCommentModerationHTTP(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)
	rs := e.roleSessions(t)
	m := e.member("มือใหม่", "n@example.com", domain.MemberRoleMember)
	env := expect(t, e.do("POST", "/api/v1/community/posts/one/comments", map[string]any{"body": "รออนุมัติ",
		"elapsed_ms": 3000}, m.opts()...), 201)
	var c struct{ ID, Status string }
	_ = json.Unmarshal(env.Data, &c)
	if c.Status != "pending" {
		t.Fatalf("held: %s", env.Data)
	}
	ed := rs[domain.RoleEditor]
	w := e.do("GET", "/api/v1/admin/comments?status=pending", nil, withCookie(ed.cookie))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"counts":{"pending":1,"reported":0}`) {
		t.Fatalf("admin list: %d %s", w.Code, w.Body)
	}
	env = expect(t, e.do("PATCH", "/api/v1/admin/comments/"+c.ID, map[string]string{"status": "published"}, ed.opts()...), 200)
	if !strings.Contains(string(env.Data), `"status":"published"`) || !strings.Contains(string(env.Data), `"moderated_by":{"kind":"admin"`) {
		t.Fatalf("approve: %s", env.Data)
	}
	// members list: e-mail only for users:manage (owner), masked for editors
	w = e.do("GET", "/api/v1/admin/members?q=n@example.com", nil, withCookie(ed.cookie))
	if w.Code != 200 || strings.Contains(w.Body.String(), `"email":`) || !strings.Contains(w.Body.String(), `"email_masked":"n***@e***.com"`) {
		t.Fatalf("editor members: %s", w.Body)
	}
	w = e.do("GET", "/api/v1/admin/members?q=n@example.com", nil, withCookie(rs[domain.RoleOwner].cookie))
	if !strings.Contains(w.Body.String(), `"email":"n@example.com"`) {
		t.Fatalf("owner members: %s", w.Body)
	}
	env = expect(t, e.do("PATCH", "/api/v1/admin/members/"+m.id, map[string]any{"role": "banned", "banned_reason": "spam"},
		ed.opts()...), 200)
	if !strings.Contains(string(env.Data), `"role":"banned"`) {
		t.Fatalf("ban: %s", env.Data)
	}
	if w := e.do("GET", "/api/v1/community/account/sessions", nil, withCookie(m.cookie)); w.Code != 401 {
		t.Fatalf("ban must revoke sessions: %d", w.Code)
	}
	w = e.do("GET", "/api/v1/admin/settings/overview", nil, withCookie(rs[domain.RoleOwner].cookie))
	if !strings.Contains(w.Body.String(), `"members":{"google_enabled":true,"require_verified_email":false,"hold_first_comment":true,"turnstile_enabled":false,"data_key_ids":[1]}`) {
		t.Fatalf("settings overview: %s", w.Body)
	}
}
