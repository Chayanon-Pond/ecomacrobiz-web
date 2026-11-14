package handlers

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

type redirectWire struct {
	ID        string  `json:"id"`
	From      string  `json:"from"`
	To        *string `json:"to"`
	Status    int     `json:"status"`
	Kind      string  `json:"kind"`
	Flattened int     `json:"flattened"`
}

func publicRedirectMap(t *testing.T, e *env) map[string]string {
	t.Helper()
	w := e.do("GET", "/api/v1/redirects", nil)
	env := expect(t, w, 200)
	if !strings.HasPrefix(w.Header().Get("Cache-Control"), "public") {
		t.Fatalf("public redirects cache: %q", w.Header().Get("Cache-Control"))
	}
	var rs []redirectWire
	if err := json.Unmarshal(env.Data, &rs); err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, r := range rs {
		v := "410"
		if r.To != nil {
			v = *r.To
		}
		out[r.From] = v
	}
	return out
}

// Static /posts/link-suggestions must win over /posts/:id.
func TestSEORouting(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)
	s := e.login(t)
	env := expect(t, e.do("GET", "/api/v1/admin/posts/link-suggestions?q=two", nil, withCookie(s.cookie)), 200)
	var ls []map[string]string
	_ = json.Unmarshal(env.Data, &ls)
	if len(ls) != 1 || ls[0]["slug"] != "two" || ls[0]["url"] != "/knowledge/two" || ls[0]["title"] == "" {
		t.Fatalf("link-suggestions routed wrong: %s", env.Data)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/posts/link-suggestions", nil, withCookie(s.cookie)), 200)
	if string(env.Data) != "[]" {
		t.Fatalf("empty suggestions: %s", env.Data)
	}
	expect(t, e.do("GET", "/api/v1/admin/posts/"+zeroID, nil, withCookie(s.cookie)), 404)
	expect(t, e.do("GET", "/api/v1/admin/redirects/"+zeroID, nil, withCookie(s.cookie)), 404) // no GET by id
}

func TestSEORoutePermissions(t *testing.T) {
	e := newEnv(t)
	rs := e.roleSessions(t)
	contentRead := []domain.Role{domain.RoleOwner, domain.RoleEditor, domain.RoleViewer}
	publish := []domain.Role{domain.RoleOwner, domain.RoleEditor}
	routes := []struct {
		method, path string
		allowed      []domain.Role
	}{
		{"GET", "/posts/link-suggestions?q=a", contentRead},
		{"GET", "/redirects", contentRead},
		{"POST", "/redirects", publish},
		{"PUT", "/redirects/" + zeroID, publish},
		{"DELETE", "/redirects/" + zeroID, publish},
	}
	for _, r := range routes {
		for role, s := range rs {
			w := e.do(r.method, "/api/v1/admin"+r.path, map[string]any{}, s.opts()...)
			if slices.Contains(r.allowed, role) {
				if w.Code == 403 || w.Code == 401 {
					t.Errorf("%s %s as %s: %d %s", r.method, r.path, role, w.Code, w.Body)
				}
				continue
			}
			env := expect(t, w, 403)
			if env.Error.Code != "forbidden" || env.Error.Message != domain.MsgNoPermission {
				t.Errorf("%s %s as %s: %+v", r.method, r.path, role, env.Error)
			}
		}
		expect(t, e.do(r.method, "/api/v1/admin"+r.path, nil), 401)
	}
	expect(t, e.do("GET", "/api/v1/redirects", nil), 200) // public
}

func TestRedirectsHTTP(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)
	s := e.login(t)

	env := expect(t, e.do("POST", "/api/v1/admin/redirects",
		map[string]any{"from": "/old-page/", "to": "/new-page", "status": 301, "note": "ย้ายหน้า"}, s.opts()...), 201)
	var a redirectWire
	_ = json.Unmarshal(env.Data, &a)
	if a.From != "/old-page" || a.Kind != "manual" || a.Flattened != 0 {
		t.Fatalf("create: %s", env.Data)
	}
	env = expect(t, e.do("POST", "/api/v1/admin/redirects",
		map[string]any{"from": "/new-page", "to": "/final", "status": 301}, s.opts()...), 201)
	var b redirectWire
	_ = json.Unmarshal(env.Data, &b)
	if b.Flattened != 1 {
		t.Fatalf("flatten: %s", env.Data)
	}
	env = expect(t, e.do("POST", "/api/v1/admin/redirects",
		map[string]any{"from": "/x", "to": "/old-page", "status": 301}, s.opts()...), 422)
	if !strings.Contains(env.Error.Fields["to"], "ห้ามทำ redirect ต่อกันเป็นทอด") {
		t.Fatalf("chain: %+v", env.Error)
	}
	env = expect(t, e.do("POST", "/api/v1/admin/redirects",
		map[string]any{"from": "/knowledge/two", "status": 410}, s.opts()...), 422)
	if env.Error.Fields["from"] == "" {
		t.Fatalf("shadowing a live post: %+v", env.Error)
	}
	env = expect(t, e.do("PUT", "/api/v1/admin/redirects/"+b.ID,
		map[string]any{"from": "/new-page", "to": nil, "status": 410}, s.opts()...), 200)
	if !strings.Contains(string(env.Data), `"to":null`) {
		t.Fatalf("update to 410: %s", env.Data)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/redirects?status=410", nil, withCookie(s.cookie)), 200)
	if env.Meta["total"] != 1 || !strings.Contains(string(env.Data), `"created_by":{`) {
		t.Fatalf("list 410: %v %s", env.Meta, env.Data)
	}
	expect(t, e.do("GET", "/api/v1/admin/redirects?kind=bogus", nil, withCookie(s.cookie)), 422)
	expect(t, e.do("DELETE", "/api/v1/admin/redirects/"+b.ID, nil, s.opts()...), 204)
	expect(t, e.do("DELETE", "/api/v1/admin/redirects/"+b.ID, nil, s.opts()...), 404)

	// Public map: table rows + legacy slugs of live posts, sorted.
	pm := publicRedirectMap(t, e)
	if pm["/old-page"] != "/final" || pm["/knowledge/แบรนด์ดิ้ง-กับ-การตลาด"] != "/knowledge/one" {
		t.Fatalf("public map: %v", pm)
	}
	var tagged bool
	for _, tags := range e.rv.tags {
		tagged = tagged || slices.Contains(tags, "redirects")
	}
	if !tagged {
		t.Fatalf("no redirects revalidation: %v", e.rv.tags)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/audit?action=redirect.create", nil, withCookie(s.cookie)), 200)
	if env.Meta["total"] != 2 {
		t.Fatalf("audit redirect.create: %v", env.Meta)
	}
}

func TestPostRedirectsHTTP(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)
	s := e.login(t)
	in := map[string]any{"slug": "seo-post", "title": "SEO", "body_markdown": "เนื้อหา", "status": "published",
		"focus_keyword": "seo", "canonical_url": "https://partner.example.com/a", "noindex": true,
		"og_image": map[string]any{"url": "https://cdn.example.com/og.jpg", "alt": "OG", "width": 1200, "height": 630}}
	env := expect(t, e.do("POST", "/api/v1/admin/posts", in, s.opts()...), 201)
	var p map[string]any
	_ = json.Unmarshal(env.Data, &p)
	id := p["id"].(string)
	if p["focus_keyword"] != "seo" || p["noindex"] != true || p["og_image"] == nil || p["og_media_id"] != nil {
		t.Fatalf("admin seo dto: %s", env.Data)
	}
	pub := string(expect(t, e.do("GET", "/api/v1/posts/seo-post", nil), 200).Data)
	if strings.Contains(pub, "focus_keyword") || strings.Contains(pub, "og_media_id") ||
		!strings.Contains(pub, `"noindex":true`) || !strings.Contains(pub, `"canonical_url":"https://partner.example.com/a"`) ||
		!strings.Contains(pub, `"og_image":{"url":"https://cdn.example.com/og.jpg"`) {
		t.Fatalf("public seo dto: %s", pub)
	}
	if list := string(expect(t, e.do("GET", "/api/v1/posts", nil), 200).Data); !strings.Contains(list, `"noindex":true`) {
		t.Fatalf("noindex post missing from public list: %s", list)
	}
	in["canonical_url"] = "not a url"
	if env = expect(t, e.do("PUT", "/api/v1/admin/posts/"+id, in, s.opts()...), 422); env.Error.Fields["canonical_url"] == "" {
		t.Fatalf("canonical: %+v", env.Error)
	}
	in["canonical_url"] = ""

	// Slug change => legacy slug listed publicly.
	in["slug"] = "seo-post-2"
	expect(t, e.do("PUT", "/api/v1/admin/posts/"+id, in, s.opts()...), 200)
	if pm := publicRedirectMap(t, e); pm["/knowledge/seo-post"] != "/knowledge/seo-post-2" {
		t.Fatalf("legacy after slug change: %v", pm)
	}
	expect(t, e.do("GET", "/api/v1/posts/seo-post", nil), 200) // legacy slug still resolves

	// Unpublish with redirect_to => 301.
	in["status"], in["redirect_to"] = "draft", "/knowledge/two"
	expect(t, e.do("PUT", "/api/v1/admin/posts/"+id, in, s.opts()...), 200)
	pm := publicRedirectMap(t, e)
	if pm["/knowledge/seo-post-2"] != "/knowledge/two" || pm["/knowledge/seo-post"] != "/knowledge/two" {
		t.Fatalf("unpublish 301: %v", pm)
	}
	// Republish removes the rows.
	in["status"], in["redirect_to"] = "published", nil
	expect(t, e.do("PUT", "/api/v1/admin/posts/"+id, in, s.opts()...), 200)
	if pm = publicRedirectMap(t, e); pm["/knowledge/seo-post-2"] != "" {
		t.Fatalf("republish: %v", pm)
	}
	// DELETE with a JSON body {redirect_to}; a bad target is 422.
	env = expect(t, e.do("DELETE", "/api/v1/admin/posts/"+id, map[string]any{"redirect_to": "ftp://x"}, s.opts()...), 422)
	if env.Error.Fields["redirect_to"] == "" {
		t.Fatalf("bad redirect_to: %+v", env.Error)
	}
	expect(t, e.do("DELETE", "/api/v1/admin/posts/"+id, `{"redirect_to":"/knowledge/three"}`, s.opts()...), 204)
	if pm = publicRedirectMap(t, e); pm["/knowledge/seo-post-2"] != "/knowledge/three" {
		t.Fatalf("delete 301: %v", pm)
	}
	// DELETE without a body => 410.
	env = expect(t, e.do("GET", "/api/v1/admin/posts?q=two", nil, withCookie(s.cookie)), 200)
	var two []map[string]any
	_ = json.Unmarshal(env.Data, &two)
	expect(t, e.do("DELETE", "/api/v1/admin/posts/"+two[0]["id"].(string), nil, s.opts()...), 204)
	if pm = publicRedirectMap(t, e); pm["/knowledge/two"] != "410" {
		t.Fatalf("delete 410: %v", pm)
	}
}
