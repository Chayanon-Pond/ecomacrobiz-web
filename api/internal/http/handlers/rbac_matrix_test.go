package handlers

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// The expected matrix below is written by hand from the permission tables in
// api/README.md ("Admin API v2" identity, content and SEO sections). It is
// deliberately NOT derived from domain.RolePermissions or the route
// definitions: if either drifts from the documented contract, this fails.
//
// Documented role summary: owner = everything; editor = posts (incl.
// publish) + media; sales = leads (read, write, export); viewer = read-only
// posts, media and leads.

const (
	rOwner  = "owner"
	rEditor = "editor"
	rSales  = "sales"
	rViewer = "viewer"
)

var matrixRoles = []string{rOwner, rEditor, rSales, rViewer}

type matrixRoute struct {
	public  bool     // no session required
	allowed []string // roles allowed (admin routes only)
}

func roles(rs ...string) matrixRoute { return matrixRoute{allowed: rs} }

var (
	mAnyAuth     = roles(rOwner, rEditor, rSales, rViewer)
	mOwnerOnly   = roles(rOwner)
	mPostsRead   = roles(rOwner, rEditor, rViewer)
	mPostsWrite  = roles(rOwner, rEditor)
	mPostsPub    = roles(rOwner, rEditor)
	mMediaRead   = roles(rOwner, rEditor, rViewer)
	mMediaWrite  = roles(rOwner, rEditor)
	mLeadsRead   = roles(rOwner, rSales, rViewer)
	mLeadsWrite  = roles(rOwner, rSales)
	mLeadsExport = roles(rOwner, rSales)
	mPublic      = matrixRoute{public: true}
)

// expectedMatrix: every route the router registers, "METHOD /path" as Gin
// reports it. A route missing here fails TestRBACMatrixCoversAllRoutes.
var expectedMatrix = map[string]matrixRoute{
	// public
	"GET /healthz":                           mPublic,
	"GET /media/*filepath":                   mPublic,
	"HEAD /media/*filepath":                  mPublic,
	"GET /api/v1/categories":                 mPublic,
	"GET /api/v1/posts":                      mPublic,
	"GET /api/v1/posts/:slug":                mPublic,
	"GET /api/v1/redirects":                  mPublic,
	"POST /api/v1/contact":                   mPublic,
	"POST /api/v1/admin/auth/login":          mPublic,
	"POST /api/v1/admin/auth/tokens/inspect": mPublic,
	"POST /api/v1/admin/auth/tokens/accept":  mPublic,

	// identity (README "Admin API v2" auth table)
	"POST /api/v1/admin/auth/logout":               mAnyAuth,
	"GET /api/v1/admin/auth/me":                    mAnyAuth,
	"PUT /api/v1/admin/account/profile":            mAnyAuth,
	"PUT /api/v1/admin/account/password":           mAnyAuth,
	"GET /api/v1/admin/account/sessions":           mAnyAuth,
	"DELETE /api/v1/admin/account/sessions/others": mAnyAuth,
	"GET /api/v1/admin/users":                      mOwnerOnly, // users:read
	"PATCH /api/v1/admin/users/:id":                mOwnerOnly, // users:manage
	"DELETE /api/v1/admin/users/:id":               mOwnerOnly,
	"POST /api/v1/admin/users/:id/reset-link":      mOwnerOnly,
	"GET /api/v1/admin/invites":                    mOwnerOnly, // users:read
	"POST /api/v1/admin/invites":                   mOwnerOnly,
	"POST /api/v1/admin/invites/:id/resend":        mOwnerOnly,
	"DELETE /api/v1/admin/invites/:id":             mOwnerOnly,
	"GET /api/v1/admin/audit":                      mOwnerOnly, // audit:read
	"GET /api/v1/admin/settings/overview":          mOwnerOnly, // settings:manage

	// content (README "Admin API v2 — content")
	"GET /api/v1/admin/dashboard":              mAnyAuth, // posts:read OR leads:read
	"GET /api/v1/admin/categories":             mPostsRead,
	"GET /api/v1/admin/posts":                  mPostsRead,
	"GET /api/v1/admin/posts/slug-check":       mPostsRead,
	"GET /api/v1/admin/posts/link-suggestions": mPostsRead,
	"GET /api/v1/admin/posts/:id":              mPostsRead,
	"POST /api/v1/admin/posts":                 mPostsWrite,
	"POST /api/v1/admin/posts/bulk":            mPostsPub,
	"PUT /api/v1/admin/posts/:id":              mPostsWrite,
	"DELETE /api/v1/admin/posts/:id":           mPostsWrite,
	"GET /api/v1/admin/media":                  mMediaRead,
	"GET /api/v1/admin/media/:id":              mMediaRead,
	"POST /api/v1/admin/media":                 mMediaWrite,
	"PATCH /api/v1/admin/media/:id":            mMediaWrite,
	"DELETE /api/v1/admin/media/:id":           mMediaWrite,
	"GET /api/v1/admin/leads":                  mLeadsRead,
	"GET /api/v1/admin/leads/board":            mLeadsRead,
	"GET /api/v1/admin/leads/assignees":        mLeadsRead,
	"GET /api/v1/admin/leads/export.csv":       mLeadsExport,
	"GET /api/v1/admin/leads/:id":              mLeadsRead,
	"PATCH /api/v1/admin/leads/:id":            mLeadsWrite,
	"GET /api/v1/admin/leads/:id/activity":     mLeadsRead,
	"POST /api/v1/admin/leads/:id/notes":       mLeadsWrite,

	// SEO (README "Admin API v2 — SEO & redirects")
	"GET /api/v1/admin/redirects":        mPostsRead,
	"POST /api/v1/admin/redirects":       mPostsPub,
	"PUT /api/v1/admin/redirects/:id":    mPostsPub,
	"DELETE /api/v1/admin/redirects/:id": mPostsPub,
}

func matrixPath(p string) string {
	p = strings.ReplaceAll(p, ":id", zeroID)
	p = strings.ReplaceAll(p, ":slug", "no-such-post")
	return strings.ReplaceAll(p, "*filepath", "no-such-file.png")
}

func isUnsafe(method string) bool { return method != "GET" && method != "HEAD" && method != "OPTIONS" }

func sortedRouteKeys(e *env) []string {
	var keys []string
	for _, ri := range e.r.Routes() {
		keys = append(keys, ri.Method+" "+ri.Path)
	}
	sort.Strings(keys)
	return keys
}

// A new route (public or admin) must be added to expectedMatrix, so an
// ungated route cannot slip in unnoticed; stale entries fail too.
func TestRBACMatrixCoversAllRoutes(t *testing.T) {
	e := newEnv(t)
	seen := map[string]bool{}
	for _, k := range sortedRouteKeys(e) {
		seen[k] = true
		if _, ok := expectedMatrix[k]; !ok {
			t.Errorf("route %s is not in the expected RBAC matrix (document its permission and add it)", k)
		}
	}
	for k := range expectedMatrix {
		if !seen[k] {
			t.Errorf("expected route %s is not registered", k)
		}
	}
}

func TestRBACMatrix(t *testing.T) {
	e := newEnv(t)
	rs := e.roleSessions(t)
	sess := map[string]session{}
	for r, s := range rs {
		sess[string(r)] = s
	}
	checked := 0
	for _, key := range sortedRouteKeys(e) {
		m, ok := expectedMatrix[key]
		if !ok || m.public {
			continue // coverage asserted by TestRBACMatrixCoversAllRoutes; public below
		}
		method, pattern, _ := strings.Cut(key, " ")
		if !strings.HasPrefix(pattern, "/api/v1/admin/") {
			t.Errorf("%s: non-admin route marked as session-gated", key)
			continue
		}
		path := matrixPath(pattern)
		for _, role := range matrixRoles {
			s := sess[role]
			if method == "POST" && pattern == "/api/v1/admin/auth/logout" {
				// logging out would kill the shared session: use a throwaway one
				email := fmt.Sprintf("logout-%s@example.com", role)
				e.addUser(email, domain.Role(role))
				s, _ = e.loginAs(email, adminPass)
			}
			w := e.do(method, path, map[string]any{}, s.opts()...)
			checked++
			allowed := false
			for _, a := range m.allowed {
				allowed = allowed || a == role
			}
			if allowed {
				// The handler may 400/404/409/422 on dummy input, but must
				// never answer 401/403 for a role the contract allows.
				if w.Code == 401 || w.Code == 403 {
					t.Errorf("%s as %s: want allowed, got %d %s", key, role, w.Code, w.Body)
				}
				continue
			}
			if w.Code != 403 {
				t.Errorf("%s as %s: want 403, got %d %s", key, role, w.Code, w.Body)
				continue
			}
			env := decode(t, w)
			if env.Error.Code != "forbidden" || env.Error.Message != domain.MsgNoPermission {
				t.Errorf("%s as %s: want RBAC 403 (%q), got %+v", key, role, domain.MsgNoPermission, env.Error)
			}
		}

		// unauthenticated
		w := e.do(method, path, map[string]any{}, withHeader("Origin", webOrigin))
		checked++
		if w.Code != 401 {
			t.Errorf("%s unauthenticated: want 401, got %d %s", key, w.Code, w.Body)
		} else if env := decode(t, w); env.Error.Code != "unauthorized" {
			t.Errorf("%s unauthenticated: %+v", key, env.Error)
		}

		// CSRF: an unsafe method with a valid session but no token is
		// rejected with the CSRF message, which differs from the RBAC one.
		if isUnsafe(method) {
			s := sess[rOwner]
			w := e.do(method, path, map[string]any{}, withCookie(s.cookie), withHeader("Origin", webOrigin))
			if w.Code != 403 {
				t.Errorf("%s without CSRF: want 403, got %d %s", key, w.Code, w.Body)
			} else if env := decode(t, w); env.Error.Message != domain.MsgForbidden ||
				env.Error.Message == domain.MsgNoPermission {
				t.Errorf("%s without CSRF: want CSRF message %q, got %+v", key, domain.MsgForbidden, env.Error)
			}
			// a foreign Origin with a valid token is rejected too
			w = e.do(method, path, map[string]any{}, withCookie(s.cookie), withHeader("X-CSRF-Token", s.csrf),
				withHeader("Origin", "https://evil.example"))
			if w.Code != 403 {
				t.Errorf("%s foreign origin: want 403, got %d", key, w.Code)
			}
		}
	}
	if checked == 0 {
		t.Fatal("matrix checked nothing")
	}
	t.Logf("RBAC matrix: %d requests checked", checked)
}

// Public routes answer without any session or CSRF token.
func TestRBACPublicRoutesNeedNoSession(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)
	cases := []struct {
		method, path string
		body         any
		want         int
		opts         []reqOpt
	}{
		{"GET", "/healthz", nil, 200, nil},
		{"GET", "/api/v1/categories", nil, 200, nil},
		{"GET", "/api/v1/posts", nil, 200, nil},
		{"GET", "/api/v1/posts/no-such-post", nil, 404, nil},
		{"GET", "/api/v1/redirects", nil, 200, nil},
		{"GET", "/media/no-such-file.png", nil, 404, nil},
		{"HEAD", "/media/no-such-file.png", nil, 404, nil},
		{"POST", "/api/v1/contact", validContact(), 201, nil},
		{"POST", "/api/v1/admin/auth/tokens/inspect", map[string]string{"token": "bogus"}, 404,
			[]reqOpt{withHeader("Origin", webOrigin)}},
		{"POST", "/api/v1/admin/auth/tokens/accept",
			map[string]string{"token": "bogus", "name": "x", "password": "long-enough-password"}, 404,
			[]reqOpt{withHeader("Origin", webOrigin)}},
		{"POST", "/api/v1/admin/auth/login", map[string]string{"email": adminEmail, "password": adminPass}, 200,
			[]reqOpt{withHeader("Origin", webOrigin)}},
	}
	covered := map[string]bool{}
	for _, c := range cases {
		w := e.do(c.method, c.path, c.body, c.opts...)
		if w.Code != c.want {
			t.Errorf("%s %s without session: want %d, got %d %s", c.method, c.path, c.want, w.Code, w.Body)
		}
		for k, m := range expectedMatrix {
			method, pattern, _ := strings.Cut(k, " ")
			if m.public && method == c.method && matrixPath(pattern) == c.path {
				covered[k] = true
			}
		}
	}
	for k, m := range expectedMatrix {
		if m.public && !covered[k] {
			t.Errorf("public route %s has no no-session check", k)
		}
	}
	// token endpoints must report the token as invalid, not as "unauthorized"
	w := e.do("POST", "/api/v1/admin/auth/tokens/inspect", map[string]string{"token": "bogus"},
		withHeader("Origin", webOrigin))
	if env := decode(t, w); env.Error.Code != "token_invalid" {
		t.Errorf("inspect bogus token: %+v", env.Error)
	}
}
