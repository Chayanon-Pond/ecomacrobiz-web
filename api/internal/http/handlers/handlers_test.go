package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"github.com/ecomacrobiz/escoma/api/internal/config"
	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
	"github.com/ecomacrobiz/escoma/api/internal/ratelimit"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
	"github.com/ecomacrobiz/escoma/api/internal/service"
	"github.com/ecomacrobiz/escoma/api/internal/storage"
)

var discard = slog.New(slog.NewTextHandler(io.Discard, nil))

const (
	webOrigin  = "http://localhost:3100"
	adminEmail = "admin@example.com"
	adminPass  = "correct-horse-battery"
	proxyIP    = "10.0.0.1"
)

type pinger struct{ err error }

func (p pinger) Ping(context.Context) error { return p.err }

type recRev struct {
	mu   sync.Mutex
	tags [][]string
}

func (r *recRev) Revalidate(tags ...string) {
	r.mu.Lock()
	r.tags = append(r.tags, tags)
	r.mu.Unlock()
}

type env struct {
	t     *testing.T
	r     *gin.Engine
	store *fake.Store
	rv    *recRev
	cfg   *config.Config
	db    *pinger
}

func newEnv(t *testing.T) *env {
	t.Helper()
	cfg, err := config.LoadFrom(func(k string) string {
		return map[string]string{
			"CORS_ALLOWED_ORIGINS": webOrigin, "TRUSTED_PROXIES": proxyIP, "COOKIE_SECURE": "true",
			"PUBLIC_BASE_URL": "http://api.test", "CONTACT_RATE_LIMIT": "3/10m", "LOGIN_RATE_LIMIT": "4/15m",
		}[k]
	})
	if err != nil {
		t.Fatal(err)
	}
	store := fake.New()
	rv := &recRev{}
	disk, err := storage.NewLocalDisk(t.TempDir(), cfg.PublicBaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = disk.Close() })
	auth := service.NewAuthService(store.AdminUsersRepo(), store.SessionsRepo(), time.Hour, bcrypt.MinCost, discard)
	if _, err := auth.EnsureAdmin(context.Background(), adminEmail, adminPass, "Admin", false); err != nil {
		t.Fatal(err)
	}
	db := &pinger{}
	r, err := NewRouter(Deps{
		Config: cfg, Log: discard, DB: db,
		Posts:   service.NewPostService(store.PostsRepo(), store.CategoriesRepo(), store.MediaRepo(), rv, discard),
		Contact: service.NewContactService(store.LeadsRepo(), nil, discard),
		Auth:    auth, Leads: service.NewLeadService(store.LeadsRepo(), discard),
		Media:             service.NewMediaService(store.MediaRepo(), disk, 1<<20, discard),
		MediaFiles:        disk,
		ContactLimiter:    ratelimit.New(cfg.ContactRateLimit.Events, cfg.ContactRateLimit.Per),
		LoginIPLimiter:    ratelimit.New(cfg.LoginRateLimit.Events, cfg.LoginRateLimit.Per),
		LoginEmailLimiter: ratelimit.New(cfg.LoginRateLimit.Events, cfg.LoginRateLimit.Per),
	})
	if err != nil {
		t.Fatal(err)
	}
	return &env{t: t, r: r, store: store, rv: rv, cfg: cfg, db: db}
}

type reqOpt func(*http.Request)

func withHeader(k, v string) reqOpt { return func(r *http.Request) { r.Header.Set(k, v) } }
func withRemote(ip string) reqOpt   { return func(r *http.Request) { r.RemoteAddr = ip + ":40000" } }
func withCookie(c *http.Cookie) reqOpt {
	return func(r *http.Request) {
		if c != nil {
			r.AddCookie(c)
		}
	}
}

func (e *env) do(method, path string, body any, opts ...reqOpt) *httptest.ResponseRecorder {
	e.t.Helper()
	var rd io.Reader
	isJSON := false
	switch b := body.(type) {
	case nil:
	case string:
		rd, isJSON = strings.NewReader(b), true
	case []byte:
		rd = bytes.NewReader(b)
	default:
		buf, _ := json.Marshal(b)
		rd, isJSON = bytes.NewReader(buf), true
	}
	req := httptest.NewRequest(method, path, rd)
	req.RemoteAddr = "203.0.113.50:40000"
	if isJSON {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, o := range opts {
		o(req)
	}
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	return w
}

type envelope struct {
	Data  json.RawMessage `json:"data"`
	Meta  map[string]int  `json:"meta"`
	Error struct {
		Code    string            `json:"code"`
		Message string            `json:"message"`
		Fields  map[string]string `json:"fields"`
	} `json:"error"`
}

func decode(t *testing.T, w *httptest.ResponseRecorder) envelope {
	t.Helper()
	var e envelope
	if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	return e
}

func expect(t *testing.T, w *httptest.ResponseRecorder, status int) envelope {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d want %d: %s", w.Code, status, w.Body.String())
	}
	if w.Body.Len() == 0 {
		return envelope{}
	}
	return decode(t, w)
}

func validContact() map[string]any {
	return map[string]any{"first_name": "สมชาย", "phone": "081-234-5678", "email": "somchai@example.com",
		"preferred_channel": "phone", "consent": true, "source_page": "/contact"}
}

// ---- public ----

func TestHealthz(t *testing.T) {
	e := newEnv(t)
	w := e.do("GET", "/healthz", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"db":"ok"`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	e.db.err = errors.New("down")
	if w := e.do("GET", "/healthz", nil); w.Code != 503 {
		t.Fatalf("db down: %d", w.Code)
	}
}

func TestSecurityHeadersAndNotFound(t *testing.T) {
	e := newEnv(t)
	w := e.do("GET", "/nope", nil)
	env := expect(t, w, 404)
	if env.Error.Code != "not_found" || env.Error.Message == "" {
		t.Fatalf("%+v", env.Error)
	}
	h := w.Header()
	for k, v := range map[string]string{
		"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
		"Referrer-Policy": "strict-origin-when-cross-origin", "Content-Security-Policy": middleware.APICSP,
	} {
		if h.Get(k) != v {
			t.Errorf("%s = %q", k, h.Get(k))
		}
	}
	if h.Get("X-Request-ID") == "" || h.Get("Strict-Transport-Security") != "" {
		t.Error("request id missing or HSTS set while disabled")
	}
	if got := e.do("GET", "/nope", nil, withHeader("X-Request-ID", "abc-123")).Header().Get("X-Request-ID"); got != "abc-123" {
		t.Errorf("inbound request id not echoed: %q", got)
	}
}

func TestCORS(t *testing.T) {
	e := newEnv(t)
	w := e.do("OPTIONS", "/api/v1/contact", nil, withHeader("Origin", webOrigin),
		withHeader("Access-Control-Request-Method", "POST"))
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != webOrigin ||
		w.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("preflight: %d %v", w.Code, w.Header())
	}
	w = e.do("OPTIONS", "/api/v1/contact", nil, withHeader("Origin", "https://evil.example"),
		withHeader("Access-Control-Request-Method", "POST"))
	if w.Code != 403 || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("evil preflight: %d", w.Code)
	}
	w = e.do("GET", "/api/v1/categories", nil, withHeader("Origin", "https://evil.example"))
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("evil origin echoed")
	}
}

func seedPosts(t *testing.T, e *env) {
	t.Helper()
	svc := service.NewPostService(e.store.PostsRepo(), e.store.CategoriesRepo(), e.store.MediaRepo(), e.rv, discard)
	legacy := []string{"แบรนด์ดิ้ง-กับ-การตลาด"}
	for i, slug := range []string{"one", "two", "three"} {
		in := service.PostInput{Slug: slug, Title: "บทความ " + slug, BodyMarkdown: "เนื้อหา", Status: "published",
			Categories: []string{"brand-insight"}}
		if i == 0 {
			in.LegacySlugs = &legacy
			in.Cover = &service.CoverInput{URL: "/images/knowledge/one/cover.webp", Alt: "ปก", Width: 1600, Height: 900}
			in.Categories = []string{"business-growth"}
		}
		pt := time.Now().Add(-time.Duration(3-i) * time.Hour)
		in.PublishedAt = &pt
		if _, err := svc.Create(context.Background(), in, ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.Create(context.Background(), service.PostInput{Slug: "draft", Title: "ร่าง", Status: "draft"}, ""); err != nil {
		t.Fatal(err)
	}
}

func TestPublicPosts(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)

	env := expect(t, e.do("GET", "/api/v1/categories", nil), 200)
	var cats []map[string]any
	_ = json.Unmarshal(env.Data, &cats)
	if len(cats) != 4 || cats[0]["slug"] != "business-growth" || cats[0]["post_count"].(float64) != 1 ||
		cats[0]["name_th"] == nil {
		t.Fatalf("categories: %v", cats)
	}

	w := e.do("GET", "/api/v1/posts?per_page=2", nil)
	env = expect(t, w, 200)
	var list []map[string]any
	_ = json.Unmarshal(env.Data, &list)
	if len(list) != 2 || list[0]["slug"] != "three" || env.Meta["total"] != 3 || env.Meta["total_pages"] != 2 ||
		env.Meta["per_page"] != 2 || env.Meta["page"] != 1 {
		t.Fatalf("list: %v %v", list, env.Meta)
	}
	if _, has := list[0]["body_markdown"]; has {
		t.Error("summary must not include body_markdown")
	}
	if _, has := list[0]["status"]; has {
		t.Error("public summary must not include status")
	}
	if !strings.Contains(w.Header().Get("Cache-Control"), "public") {
		t.Error("public cache header missing")
	}

	env = expect(t, e.do("GET", "/api/v1/posts?category=business-growth&per_page=500", nil), 200)
	_ = json.Unmarshal(env.Data, &list)
	if len(list) != 1 || env.Meta["per_page"] != 50 {
		t.Fatalf("category filter: %v %v", list, env.Meta)
	}
	cover := list[0]["cover"].(map[string]any)
	if cover["url"] != "/images/knowledge/one/cover.webp" || cover["width"].(float64) != 1600 {
		t.Fatalf("cover: %v", cover)
	}

	env = expect(t, e.do("GET", "/api/v1/posts/one", nil), 200)
	var post map[string]any
	_ = json.Unmarshal(env.Data, &post)
	if post["body_markdown"] != "เนื้อหา" || post["legacy_slugs"].([]any)[0] != "แบรนด์ดิ้ง-กับ-การตลาด" {
		t.Fatalf("post: %v", post)
	}

	enc := "/api/v1/posts/" + url.PathEscape("แบรนด์ดิ้ง-กับ-การตลาด")
	env = expect(t, e.do("GET", enc, nil), 200)
	_ = json.Unmarshal(env.Data, &post)
	if post["slug"] != "one" {
		t.Fatalf("legacy lookup: %v", post["slug"])
	}

	env = expect(t, e.do("GET", "/api/v1/posts/draft", nil), 404)
	if env.Error.Code != "not_found" {
		t.Fatal(env.Error)
	}
}

func TestContact(t *testing.T) {
	e := newEnv(t)
	w := e.do("POST", "/api/v1/contact", validContact(), withHeader("User-Agent", "test-agent"))
	env := expect(t, w, 201)
	var data map[string]string
	_ = json.Unmarshal(env.Data, &data)
	leads := e.store.Leads()
	if len(leads) != 1 || leads[0].ID != data["id"] || leads[0].Phone != "0812345678" ||
		leads[0].IP != "203.0.113.50" || leads[0].UserAgent != "test-agent" {
		t.Fatalf("lead: %+v data=%v", leads, data)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Error("contact must be no-store")
	}

	bad := validContact()
	bad["phone"], bad["email"], bad["consent"], bad["first_name"] = "123", "x@", false, ""
	env = expect(t, e.do("POST", "/api/v1/contact", bad, withRemote("198.51.100.1")), 422)
	if env.Error.Code != "validation_failed" || env.Error.Fields["phone"] != "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง" ||
		env.Error.Fields["email"] != "รูปแบบอีเมลไม่ถูกต้อง" || env.Error.Fields["first_name"] != "กรุณากรอกชื่อ" ||
		env.Error.Fields["consent"] != "กรุณายินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล" {
		t.Fatalf("fields: %+v", env.Error)
	}

	hp := validContact()
	hp["website"] = "http://spam"
	env = expect(t, e.do("POST", "/api/v1/contact", hp, withRemote("198.51.100.2")), 201)
	_ = json.Unmarshal(env.Data, &data)
	if data["id"] == "" || len(e.store.Leads()) != 1 {
		t.Fatal("honeypot must return an id and store nothing")
	}

	expect(t, e.do("POST", "/api/v1/contact", `{"first_name":`, withRemote("198.51.100.3")), 400)
	env = expect(t, e.do("POST", "/api/v1/contact", `{"consent":"yes"}`, withRemote("198.51.100.3")), 422)
	if env.Error.Fields["consent"] == "" {
		t.Fatalf("type error field: %+v", env.Error)
	}
	expect(t, e.do("POST", "/api/v1/contact", []byte(`first_name=x`), withRemote("198.51.100.3"),
		withHeader("Content-Type", "application/x-www-form-urlencoded")), 422)

	big := validContact()
	big["message"] = strings.Repeat("ก", 6000) // ~18 KB in UTF-8
	env = expect(t, e.do("POST", "/api/v1/contact", big, withRemote("198.51.100.4")), 413)
	if env.Error.Code != "payload_too_large" {
		t.Fatal(env.Error)
	}
}

func TestContactRateLimit(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 3; i++ {
		expect(t, e.do("POST", "/api/v1/contact", validContact()), 201)
	}
	w := e.do("POST", "/api/v1/contact", validContact())
	env := expect(t, w, 429)
	if env.Error.Code != "rate_limited" || w.Header().Get("Retry-After") == "" {
		t.Fatalf("%+v %v", env.Error, w.Header())
	}
	// another IP is unaffected
	expect(t, e.do("POST", "/api/v1/contact", validContact(), withRemote("198.51.100.9")), 201)
}

func TestTrustedProxyClientIP(t *testing.T) {
	e := newEnv(t)
	expect(t, e.do("POST", "/api/v1/contact", validContact(), withRemote(proxyIP),
		withHeader("X-Forwarded-For", "1.1.1.1, 203.0.113.77")), 201)
	expect(t, e.do("POST", "/api/v1/contact", validContact(), withRemote("198.51.100.20"),
		withHeader("X-Forwarded-For", "9.9.9.9")), 201)
	leads := e.store.Leads()
	if leads[0].IP != "203.0.113.77" {
		t.Errorf("trusted proxy: ip = %s", leads[0].IP)
	}
	if leads[1].IP != "198.51.100.20" {
		t.Errorf("untrusted XFF must be ignored: ip = %s", leads[1].IP)
	}
}

func TestMediaServingRejectsTraversal(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/media/../go.mod", "/media/%2e%2e/secret.png", "/media/x.svg", "/media/missing.png"} {
		if w := e.do("GET", p, nil); w.Code != 404 {
			t.Errorf("%s -> %d", p, w.Code)
		}
	}
}

// ---- admin ----

type session struct {
	cookie *http.Cookie
	csrf   string
}

func (e *env) login(t *testing.T) session {
	t.Helper()
	w := e.do("POST", "/api/v1/admin/auth/login", map[string]string{"email": adminEmail, "password": adminPass},
		withHeader("Origin", webOrigin))
	env := expect(t, w, 200)
	var data struct {
		User struct{ ID, Email, Name string } `json:"user"`
		CSRF string                           `json:"csrf_token"`
	}
	_ = json.Unmarshal(env.Data, &data)
	if data.CSRF == "" || data.User.Email != adminEmail {
		t.Fatalf("login body: %s", w.Body)
	}
	var ck *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == middleware.SessionCookie {
			ck = c
		}
	}
	if ck == nil || !ck.HttpOnly || !ck.Secure || ck.SameSite != http.SameSiteStrictMode || ck.Path != "/" ||
		ck.MaxAge != 3600 {
		t.Fatalf("cookie: %+v", ck)
	}
	return session{cookie: &http.Cookie{Name: ck.Name, Value: ck.Value}, csrf: data.CSRF}
}

func (s session) opts(extra ...reqOpt) []reqOpt {
	return append([]reqOpt{withCookie(s.cookie), withHeader(middleware.CSRFHeader, s.csrf),
		withHeader("Origin", webOrigin)}, extra...)
}

func TestAdminAuthFlow(t *testing.T) {
	e := newEnv(t)
	env := expect(t, e.do("GET", "/api/v1/admin/auth/me", nil), 401)
	if env.Error.Code != "unauthorized" {
		t.Fatal(env.Error)
	}
	env = expect(t, e.do("POST", "/api/v1/admin/auth/login",
		map[string]string{"email": adminEmail, "password": "wrong-password-xx"}), 401)
	if env.Error.Message != "อีเมลหรือรหัสผ่านไม่ถูกต้อง" {
		t.Fatalf("generic message: %q", env.Error.Message)
	}
	env = expect(t, e.do("POST", "/api/v1/admin/auth/login",
		map[string]string{"email": "nobody@example.com", "password": adminPass}), 401)
	if env.Error.Message != "อีเมลหรือรหัสผ่านไม่ถูกต้อง" {
		t.Fatal("unknown user must get the same message")
	}
	expect(t, e.do("POST", "/api/v1/admin/auth/login", map[string]string{"email": adminEmail, "password": adminPass},
		withHeader("Origin", "https://evil.example")), 403)

	s := e.login(t)
	w := e.do("GET", "/api/v1/admin/auth/me", nil, withCookie(s.cookie))
	env = expect(t, w, 200)
	if !strings.Contains(string(env.Data), s.csrf) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("me: %s", env.Data)
	}

	// CSRF: missing, wrong, bad origin
	body := map[string]any{"slug": "x", "title": "x", "status": "draft"}
	expect(t, e.do("POST", "/api/v1/admin/posts", body, withCookie(s.cookie)), 403)
	expect(t, e.do("POST", "/api/v1/admin/posts", body, withCookie(s.cookie),
		withHeader(middleware.CSRFHeader, s.csrf+"x")), 403)
	expect(t, e.do("POST", "/api/v1/admin/posts", body, withCookie(s.cookie),
		withHeader(middleware.CSRFHeader, s.csrf), withHeader("Origin", "https://evil.example")), 403)
	// header present without Origin (server-to-server via the Next proxy) is fine
	expect(t, e.do("POST", "/api/v1/admin/posts", body, withCookie(s.cookie),
		withHeader(middleware.CSRFHeader, s.csrf)), 201)

	w = e.do("POST", "/api/v1/admin/auth/logout", nil, s.opts()...)
	expect(t, w, 204)
	if c := w.Result().Cookies(); len(c) != 1 || c[0].MaxAge >= 0 {
		t.Fatalf("logout cookie: %+v", c)
	}
	expect(t, e.do("GET", "/api/v1/admin/auth/me", nil, withCookie(s.cookie)), 401)
}

func TestLoginRateLimit(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 4; i++ {
		expect(t, e.do("POST", "/api/v1/admin/auth/login",
			map[string]string{"email": adminEmail, "password": "wrong-password-xx"}, withRemote("198.51.100.30")), 401)
	}
	w := e.do("POST", "/api/v1/admin/auth/login",
		map[string]string{"email": adminEmail, "password": adminPass}, withRemote("198.51.100.30"))
	expect(t, w, 429)
	// same email from another IP is also limited (per-email bucket)
	expect(t, e.do("POST", "/api/v1/admin/auth/login",
		map[string]string{"email": adminEmail, "password": adminPass}, withRemote("198.51.100.31")), 429)
}

func TestAdminPostsCRUD(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)
	s := e.login(t)
	e.rv.tags = nil

	env := expect(t, e.do("GET", "/api/v1/admin/posts?status=all", nil, withCookie(s.cookie)), 200)
	if env.Meta["total"] != 4 || !strings.Contains(string(env.Data), `"status":"draft"`) {
		t.Fatalf("admin list: %v %s", env.Meta, env.Data)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/posts?status=draft", nil, withCookie(s.cookie)), 200)
	if env.Meta["total"] != 1 {
		t.Fatalf("draft filter: %v", env.Meta)
	}
	expect(t, e.do("GET", "/api/v1/admin/posts?status=bogus", nil, withCookie(s.cookie)), 422)

	in := map[string]any{"slug": "new-post", "title": "บทความใหม่", "excerpt": "สั้น", "body_markdown": "## หัวข้อ",
		"categories": []string{"learning-hub"}, "author": "ทีมงาน", "status": "published", "featured": true,
		"cover": map[string]any{"url": "/images/x.webp", "alt": "ปก", "width": 1200, "height": 630}}
	env = expect(t, e.do("POST", "/api/v1/admin/posts", in, s.opts()...), 201)
	var p map[string]any
	_ = json.Unmarshal(env.Data, &p)
	id := p["id"].(string)
	if p["status"] != "published" || p["published_at"] == nil || p["featured"] != true {
		t.Fatalf("created: %v", p)
	}
	if len(e.rv.tags) != 1 || e.rv.tags[0][1] != "post:new-post" {
		t.Fatalf("revalidate: %v", e.rv.tags)
	}

	env = expect(t, e.do("POST", "/api/v1/admin/posts", in, s.opts()...), 422)
	if env.Error.Fields["slug"] == "" {
		t.Fatal("duplicate slug not reported on slug field")
	}
	bad := map[string]any{"slug": "Bad Slug", "title": "", "status": "x"}
	env = expect(t, e.do("POST", "/api/v1/admin/posts", bad, s.opts()...), 422)
	if env.Error.Fields["slug"] == "" || env.Error.Fields["title"] == "" || env.Error.Fields["status"] == "" {
		t.Fatalf("validation: %+v", env.Error.Fields)
	}

	in["title"] = "แก้ไขแล้ว"
	in["status"] = "draft"
	env = expect(t, e.do("PUT", "/api/v1/admin/posts/"+id, in, s.opts()...), 200)
	_ = json.Unmarshal(env.Data, &p)
	if p["title"] != "แก้ไขแล้ว" || p["status"] != "draft" {
		t.Fatalf("updated: %v", p)
	}
	expect(t, e.do("GET", "/api/v1/posts/new-post", nil), 404) // draft is hidden publicly
	env = expect(t, e.do("GET", "/api/v1/admin/posts/"+id, nil, withCookie(s.cookie)), 200)
	if !strings.Contains(string(env.Data), `"body_markdown":"## หัวข้อ"`) {
		t.Fatalf("admin get: %s", env.Data)
	}
	expect(t, e.do("PUT", "/api/v1/admin/posts/00000000-0000-0000-0000-000000000000", in, s.opts()...), 404)

	expect(t, e.do("DELETE", "/api/v1/admin/posts/"+id, nil, s.opts()...), 204)
	expect(t, e.do("GET", "/api/v1/admin/posts/"+id, nil, withCookie(s.cookie)), 404)
	expect(t, e.do("DELETE", "/api/v1/admin/posts/"+id, nil, s.opts()...), 404)
	if len(e.rv.tags) != 3 {
		t.Fatalf("revalidate calls: %v", e.rv.tags)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/categories", nil, withCookie(s.cookie)), 200)
	if !strings.Contains(string(env.Data), "learning-hub") {
		t.Fatal("admin categories")
	}
}

func multipartBody(t *testing.T, field, name string, data []byte) ([]byte, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile(field, name)
	_, _ = fw.Write(data)
	_ = mw.Close()
	return buf.Bytes(), mw.FormDataContentType()
}

func TestAdminMedia(t *testing.T) {
	e := newEnv(t)
	s := e.login(t)
	var img bytes.Buffer
	_ = png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 4, 3)))

	body, ct := multipartBody(t, "file", "photo.png", img.Bytes())
	expect(t, e.do("POST", "/api/v1/admin/media", body, withCookie(s.cookie), withHeader("Content-Type", ct)), 403)
	env := expect(t, e.do("POST", "/api/v1/admin/media", body, s.opts(withHeader("Content-Type", ct))...), 201)
	var m struct {
		ID, URL, Mime string
		Width, Height int
		Size          int64
	}
	_ = json.Unmarshal(env.Data, &m)
	if m.Mime != "image/png" || m.Width != 4 || m.Height != 3 || !strings.HasPrefix(m.URL, "http://api.test/media/") {
		t.Fatalf("media: %+v", m)
	}
	path := strings.TrimPrefix(m.URL, "http://api.test")
	w := e.do("GET", path, nil)
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" || !bytes.Equal(w.Body.Bytes(), img.Bytes()) ||
		!strings.Contains(w.Header().Get("Cache-Control"), "immutable") ||
		w.Header().Get("X-Content-Type-Options") != "nosniff" ||
		w.Header().Get("Cross-Origin-Resource-Policy") != "cross-origin" {
		t.Fatalf("serve: %d %v", w.Code, w.Header())
	}

	// cover_media_id resolves to the media URL and dimensions
	in := map[string]any{"slug": "with-media", "title": "t", "status": "draft", "cover_media_id": m.ID,
		"cover": map[string]any{"alt": "คำอธิบาย"}}
	env = expect(t, e.do("POST", "/api/v1/admin/posts", in, s.opts()...), 201)
	if !strings.Contains(string(env.Data), m.URL) || !strings.Contains(string(env.Data), `"alt":"คำอธิบาย"`) {
		t.Fatalf("cover from media: %s", env.Data)
	}

	svg, ct := multipartBody(t, "file", "x.png", []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`))
	env = expect(t, e.do("POST", "/api/v1/admin/media", svg, s.opts(withHeader("Content-Type", ct))...), 422)
	if env.Error.Fields["file"] == "" {
		t.Fatal(env.Error)
	}
	none, ct := multipartBody(t, "other", "x.png", img.Bytes())
	expect(t, e.do("POST", "/api/v1/admin/media", none, s.opts(withHeader("Content-Type", ct))...), 422)
	huge, ct := multipartBody(t, "file", "x.png", append(img.Bytes(), make([]byte, 3<<20)...))
	expect(t, e.do("POST", "/api/v1/admin/media", huge, s.opts(withHeader("Content-Type", ct))...), 413)
}

func TestAdminLeads(t *testing.T) {
	e := newEnv(t)
	c := validContact()
	c["first_name"] = "=cmd()"
	c["last_name"] = "ใจดี"
	expect(t, e.do("POST", "/api/v1/contact", c), 201)
	expect(t, e.do("POST", "/api/v1/contact", validContact(), withRemote("198.51.100.40")), 201)
	s := e.login(t)

	expect(t, e.do("GET", "/api/v1/admin/leads", nil), 401)
	env := expect(t, e.do("GET", "/api/v1/admin/leads?status=new&q=ใจดี", nil, withCookie(s.cookie)), 200)
	var leads []map[string]any
	_ = json.Unmarshal(env.Data, &leads)
	if env.Meta["total"] != 1 || len(leads) != 1 || leads[0]["preferred_date"] != nil || leads[0]["consent_at"] == nil {
		t.Fatalf("leads: %v %v", env.Meta, leads)
	}
	id := leads[0]["id"].(string)
	expect(t, e.do("GET", "/api/v1/admin/leads?status=won", nil, withCookie(s.cookie)), 422)
	expect(t, e.do("GET", "/api/v1/admin/leads/"+id, nil, withCookie(s.cookie)), 200)
	expect(t, e.do("GET", "/api/v1/admin/leads/not-a-uuid", nil, withCookie(s.cookie)), 404)

	expect(t, e.do("PATCH", "/api/v1/admin/leads/"+id, map[string]any{"status": "contacted"}, withCookie(s.cookie)), 403)
	env = expect(t, e.do("PATCH", "/api/v1/admin/leads/"+id, map[string]any{"status": "contacted", "note": "โทรแล้ว"},
		s.opts()...), 200)
	if !strings.Contains(string(env.Data), `"status":"contacted"`) || !strings.Contains(string(env.Data), "โทรแล้ว") {
		t.Fatalf("patch: %s", env.Data)
	}
	expect(t, e.do("PATCH", "/api/v1/admin/leads/"+id, map[string]any{"status": "won"}, s.opts()...), 422)

	w := e.do("GET", "/api/v1/admin/leads/export.csv", nil, withCookie(s.cookie))
	if w.Code != 200 || w.Header().Get("Content-Type") != "text/csv; charset=utf-8" ||
		!strings.HasPrefix(w.Header().Get("Content-Disposition"), `attachment; filename="leads-`) {
		t.Fatalf("csv: %d %v", w.Code, w.Header())
	}
	b := w.Body.Bytes()
	if !bytes.HasPrefix(b, []byte{0xEF, 0xBB, 0xBF}) || !strings.Contains(string(b), "ใจดี") ||
		!strings.Contains(string(b), "'=cmd()") {
		t.Fatalf("csv body: %q", b)
	}
	w = e.do("GET", "/api/v1/admin/leads/export.csv?status=contacted", nil, withCookie(s.cookie))
	if lines := strings.Count(strings.TrimSpace(w.Body.String()), "\n"); lines != 1 {
		t.Fatalf("filtered export rows: %d", lines)
	}
	expect(t, e.do("GET", "/api/v1/admin/leads/export.csv?status=bogus", nil, withCookie(s.cookie)), 422)
	_ = domain.LeadNew
}
