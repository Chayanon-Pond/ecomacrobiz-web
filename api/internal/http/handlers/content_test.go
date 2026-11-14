package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"strings"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// seedActor creates fixture posts in seedPosts (owner role, no user row).
var seedActor = domain.Actor{Role: domain.RoleOwner}

type roleSessions map[domain.Role]session

func (e *env) roleSessions(t *testing.T) roleSessions {
	t.Helper()
	out := roleSessions{}
	out[domain.RoleOwner], _ = e.loginAs(adminEmail, adminPass)
	for _, r := range []domain.Role{domain.RoleEditor, domain.RoleSales, domain.RoleViewer} {
		e.addUser(string(r)+"@example.com", r)
		out[r], _ = e.loginAs(string(r)+"@example.com", adminPass)
	}
	return out
}

const zeroID = "00000000-0000-0000-0000-000000000000"

// Static segments must win over their :id siblings (Gin 1.12 tree).
func TestContentRouting(t *testing.T) {
	e := newEnv(t)
	s := e.login(t)
	env := expect(t, e.do("GET", "/api/v1/admin/posts/slug-check?slug=hello", nil, withCookie(s.cookie)), 200)
	if !strings.Contains(string(env.Data), `"suggestion":"hello"`) {
		t.Fatalf("slug-check routed wrong: %s", env.Data)
	}
	env = expect(t, e.do("POST", "/api/v1/admin/posts/bulk", map[string]any{"action": "publish"}, s.opts()...), 422)
	if env.Error.Fields["ids"] == "" {
		t.Fatalf("bulk routed wrong: %+v", env.Error)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/leads/board", nil, withCookie(s.cookie)), 200)
	if !strings.Contains(string(env.Data), `"columns"`) {
		t.Fatalf("board routed wrong: %s", env.Data)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/leads/assignees", nil, withCookie(s.cookie)), 200)
	if !strings.HasPrefix(string(env.Data), "[") {
		t.Fatalf("assignees routed wrong: %s", env.Data)
	}
	if w := e.do("GET", "/api/v1/admin/leads/export.csv", nil, withCookie(s.cookie)); w.Code != 200 ||
		!strings.HasPrefix(w.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("export.csv routed wrong: %d", w.Code)
	}
	for _, p := range []string{"/api/v1/admin/posts/" + zeroID, "/api/v1/admin/leads/" + zeroID,
		"/api/v1/admin/media/" + zeroID, "/api/v1/admin/leads/" + zeroID + "/activity", "/api/v1/admin/posts/slug"} {
		expect(t, e.do("GET", p, nil, withCookie(s.cookie)), 404)
	}
}

func TestContentRoutePermissions(t *testing.T) {
	e := newEnv(t)
	rs := e.roleSessions(t)
	type rt struct {
		method, path string
		allowed      []domain.Role
	}
	all := []domain.Role{domain.RoleOwner, domain.RoleEditor, domain.RoleSales, domain.RoleViewer}
	content := []domain.Role{domain.RoleOwner, domain.RoleEditor}
	contentRead := []domain.Role{domain.RoleOwner, domain.RoleEditor, domain.RoleViewer}
	leadsRead := []domain.Role{domain.RoleOwner, domain.RoleSales, domain.RoleViewer}
	leadsWrite := []domain.Role{domain.RoleOwner, domain.RoleSales}
	routes := []rt{
		{"GET", "/dashboard", all},
		{"GET", "/categories", contentRead},
		{"GET", "/posts", contentRead},
		{"GET", "/posts/slug-check?slug=a", contentRead},
		{"GET", "/posts/" + zeroID, contentRead},
		{"POST", "/posts", content},
		{"POST", "/posts/bulk", content},
		{"PUT", "/posts/" + zeroID, content},
		{"DELETE", "/posts/" + zeroID, content},
		{"GET", "/media", contentRead},
		{"GET", "/media/" + zeroID, contentRead},
		{"POST", "/media", content},
		{"PATCH", "/media/" + zeroID, content},
		{"DELETE", "/media/" + zeroID, content},
		{"GET", "/leads", leadsRead},
		{"GET", "/leads/board", leadsRead},
		{"GET", "/leads/assignees", leadsRead},
		{"GET", "/leads/export.csv", leadsWrite},
		{"GET", "/leads/" + zeroID, leadsRead},
		{"PATCH", "/leads/" + zeroID, leadsWrite},
		{"GET", "/leads/" + zeroID + "/activity", leadsRead},
		{"POST", "/leads/" + zeroID + "/notes", leadsWrite},
	}
	for _, r := range routes {
		for role, s := range rs {
			w := e.do(r.method, "/api/v1/admin"+r.path, map[string]any{}, s.opts()...)
			allowed := false
			for _, a := range r.allowed {
				allowed = allowed || a == role
			}
			if allowed && (w.Code == 403 || w.Code == 401) {
				t.Errorf("%s %s as %s: %d %s", r.method, r.path, role, w.Code, w.Body)
			}
			if !allowed {
				env := expect(t, w, 403)
				if env.Error.Code != "forbidden" || env.Error.Message != domain.MsgNoPermission {
					t.Errorf("%s %s as %s: %+v", r.method, r.path, role, env.Error)
				}
			}
		}
		expect(t, e.do(r.method, "/api/v1/admin"+r.path, nil), 401)
	}
}

func TestDashboardSections(t *testing.T) {
	e := newEnv(t)
	seedPosts(t, e)
	expect(t, e.do("POST", "/api/v1/contact", validContact()), 201)
	rs := e.roleSessions(t)
	var d struct {
		Leads *struct {
			Today    int            `json:"today"`
			ByStatus map[string]int `json:"by_status"`
			Daily    []struct {
				Date  string `json:"date"`
				Count int    `json:"count"`
			} `json:"daily"`
			Recent []map[string]any `json:"recent"`
		} `json:"leads"`
		Posts *struct {
			Published, Drafts, Scheduled int
			NextScheduledAt              *string          `json:"next_scheduled_at"`
			Recent                       []map[string]any `json:"recent"`
		} `json:"posts"`
	}
	env := expect(t, e.do("GET", "/api/v1/admin/dashboard", nil, withCookie(rs[domain.RoleOwner].cookie)), 200)
	if err := json.Unmarshal(env.Data, &d); err != nil {
		t.Fatal(err)
	}
	if d.Leads == nil || d.Posts == nil || d.Leads.Today != 1 || len(d.Leads.Daily) != 30 ||
		d.Leads.ByStatus["new"] != 1 || len(d.Leads.ByStatus) != 5 || len(d.Leads.Recent) != 1 ||
		d.Posts.Published != 3 || d.Posts.Drafts != 1 || d.Posts.NextScheduledAt != nil || len(d.Posts.Recent) != 4 {
		t.Fatalf("owner dashboard: %s", env.Data)
	}
	if _, ok := d.Posts.Recent[0]["created_by"]; !ok {
		t.Fatal("admin post summary must carry created_by")
	}
	env = expect(t, e.do("GET", "/api/v1/admin/dashboard", nil, withCookie(rs[domain.RoleSales].cookie)), 200)
	if !strings.Contains(string(env.Data), `"posts":null`) || strings.Contains(string(env.Data), `"leads":null`) {
		t.Fatalf("sales dashboard: %s", env.Data)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/dashboard", nil, withCookie(rs[domain.RoleEditor].cookie)), 200)
	if !strings.Contains(string(env.Data), `"leads":null`) || strings.Contains(string(env.Data), `"posts":null`) {
		t.Fatalf("editor dashboard: %s", env.Data)
	}
}

func TestAdminScheduledAndBulk(t *testing.T) {
	e := newEnv(t)
	s := e.login(t)
	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	future := time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)
	in := map[string]any{"slug": "later", "title": "ตั้งเวลา", "body_markdown": "x", "status": "scheduled",
		"published_at": past}
	env := expect(t, e.do("POST", "/api/v1/admin/posts", in, s.opts()...), 422)
	if env.Error.Fields["published_at"] != "เวลาเผยแพร่ต้องอยู่ในอนาคต" {
		t.Fatalf("past schedule: %+v", env.Error)
	}
	in["published_at"] = future
	env = expect(t, e.do("POST", "/api/v1/admin/posts", in, s.opts()...), 201)
	var p struct {
		ID, Status string
		CreatedBy  *struct{ ID, Email string } `json:"created_by"`
	}
	_ = json.Unmarshal(env.Data, &p)
	if p.Status != "scheduled" || p.CreatedBy == nil || p.CreatedBy.Email != adminEmail {
		t.Fatalf("scheduled post: %s", env.Data)
	}
	expect(t, e.do("GET", "/api/v1/posts/later", nil), 404)
	env = expect(t, e.do("GET", "/api/v1/admin/posts?status=scheduled&sort=published_desc", nil, withCookie(s.cookie)), 200)
	if env.Meta["total"] != 1 {
		t.Fatalf("scheduled filter: %v", env.Meta)
	}
	expect(t, e.do("GET", "/api/v1/admin/posts?sort=random", nil, withCookie(s.cookie)), 422)

	env = expect(t, e.do("GET", "/api/v1/admin/posts/slug-check?slug=later&exclude_id=", nil, withCookie(s.cookie)), 200)
	if !strings.Contains(string(env.Data), `"available":false`) || !strings.Contains(string(env.Data), `"suggestion":"later-2"`) {
		t.Fatalf("slug-check: %s", env.Data)
	}

	e.rv.tags = nil
	env = expect(t, e.do("POST", "/api/v1/admin/posts/bulk", map[string]any{"action": "publish",
		"ids": []string{p.ID, zeroID}}, s.opts()...), 200)
	var res struct {
		Succeeded []string
		Failed    []struct{ ID, Message string }
	}
	_ = json.Unmarshal(env.Data, &res)
	if len(res.Succeeded) != 1 || len(res.Failed) != 1 || res.Failed[0].Message != "ไม่พบบทความ" {
		t.Fatalf("bulk: %s", env.Data)
	}
	if len(e.rv.tags) != 1 {
		t.Fatalf("bulk revalidate calls: %v", e.rv.tags)
	}
	expect(t, e.do("GET", "/api/v1/posts/later", nil), 200)
	audit := e.store.AuditEntries()
	found := false
	for _, a := range audit {
		found = found || (a.Action == domain.AuditPostPublish && a.TargetID == p.ID)
	}
	if !found {
		t.Fatalf("bulk publish not audited: %+v", audit)
	}
}

func multipartFields(t *testing.T, fields [][2]string, fileName string, data []byte) ([]byte, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", fileName)
	_, _ = fw.Write(data)
	for _, f := range fields { // after the file on purpose
		_ = mw.WriteField(f[0], f[1])
	}
	_ = mw.Close()
	return buf.Bytes(), mw.FormDataContentType()
}

func TestMediaLibraryHTTP(t *testing.T) {
	e := newEnv(t)
	s := e.login(t)
	var img bytes.Buffer
	_ = png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 4, 3)))
	body, ct := multipartFields(t, [][2]string{{"alt", "โลโก้บริษัท"}}, "logo.png", img.Bytes())
	env := expect(t, e.do("POST", "/api/v1/admin/media", body, s.opts(withHeader("Content-Type", ct))...), 201)
	var m struct {
		ID, URL, Alt string
		OriginalName string                  `json:"original_name"`
		UsageCount   int                     `json:"usage_count"`
		UploadedBy   *struct{ Email string } `json:"uploaded_by"`
	}
	_ = json.Unmarshal(env.Data, &m)
	if m.Alt != "โลโก้บริษัท" || m.OriginalName != "logo.png" || m.UploadedBy == nil || m.UploadedBy.Email != adminEmail {
		t.Fatalf("upload: %s", env.Data)
	}

	post := map[string]any{"slug": "uses-media", "title": "t", "status": "draft", "cover_media_id": m.ID}
	env = expect(t, e.do("POST", "/api/v1/admin/posts", post, s.opts()...), 201)
	var p struct{ ID string }
	_ = json.Unmarshal(env.Data, &p)

	env = expect(t, e.do("GET", "/api/v1/admin/media?q=โลโก้&type=image/png", nil, withCookie(s.cookie)), 200)
	if env.Meta["total"] != 1 || !strings.Contains(string(env.Data), `"usage_count":1`) {
		t.Fatalf("list: %s", env.Data)
	}
	expect(t, e.do("GET", "/api/v1/admin/media?type=text/html", nil, withCookie(s.cookie)), 422)
	env = expect(t, e.do("GET", "/api/v1/admin/media/"+m.ID, nil, withCookie(s.cookie)), 200)
	if !strings.Contains(string(env.Data), `"kind":"cover"`) || !strings.Contains(string(env.Data), p.ID) {
		t.Fatalf("detail: %s", env.Data)
	}
	env = expect(t, e.do("PATCH", "/api/v1/admin/media/"+m.ID, map[string]string{"alt": "ใหม่"}, s.opts()...), 200)
	if !strings.Contains(string(env.Data), `"alt":"ใหม่"`) {
		t.Fatalf("patch: %s", env.Data)
	}
	expect(t, e.do("PATCH", "/api/v1/admin/media/"+m.ID, map[string]string{"alt": strings.Repeat("ก", 301)},
		s.opts()...), 422)

	env = expect(t, e.do("DELETE", "/api/v1/admin/media/"+m.ID, nil, s.opts()...), 409)
	if env.Error.Code != "in_use" || env.Error.Message != "ไฟล์นี้ถูกใช้งานอยู่ใน 1 บทความ" || env.Error.Fields != nil {
		t.Fatalf("in use: %+v", env.Error)
	}
	expect(t, e.do("DELETE", "/api/v1/admin/posts/"+p.ID, nil, s.opts()...), 204)
	expect(t, e.do("DELETE", "/api/v1/admin/media/"+m.ID, nil, s.opts()...), 204)
	expect(t, e.do("GET", "/api/v1/admin/media/"+m.ID, nil, withCookie(s.cookie)), 404)
	expect(t, e.do("GET", strings.TrimPrefix(m.URL, "http://api.test"), nil), 404)
}

func TestLeadsCRMHTTP(t *testing.T) {
	e := newEnv(t)
	expect(t, e.do("POST", "/api/v1/contact", validContact()), 201)
	rs := e.roleSessions(t)
	sales := rs[domain.RoleSales]
	env := expect(t, e.do("GET", "/api/v1/admin/leads", nil, withCookie(sales.cookie)), 200)
	var leads []struct{ ID string }
	_ = json.Unmarshal(env.Data, &leads)
	id := leads[0].ID

	env = expect(t, e.do("GET", "/api/v1/admin/leads/assignees", nil, withCookie(sales.cookie)), 200)
	var as []struct{ ID, Email string }
	_ = json.Unmarshal(env.Data, &as)
	var salesID, viewerID string
	for _, a := range as {
		if a.Email == "sales@example.com" {
			salesID = a.ID
		}
		if a.Email == "viewer@example.com" {
			t.Fatal("viewer listed as assignee")
		}
	}
	if salesID == "" || len(as) != 2 { // owner + sales
		t.Fatalf("assignees: %s", env.Data)
	}
	viewer, _ := e.store.AdminUsersRepo().GetByEmail(t.Context(), "viewer@example.com")
	viewerID = viewer.ID
	expect(t, e.do("PATCH", "/api/v1/admin/leads/"+id, map[string]any{"assigned_to": viewerID}, sales.opts()...), 422)

	env = expect(t, e.do("PATCH", "/api/v1/admin/leads/"+id, map[string]any{"status": "contacted",
		"assigned_to": salesID}, sales.opts()...), 200)
	if !strings.Contains(string(env.Data), `"assigned_to":{"id":"`+salesID) {
		t.Fatalf("assign: %s", env.Data)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/leads?assigned=me", nil, withCookie(sales.cookie)), 200)
	if env.Meta["total"] != 1 {
		t.Fatalf("assigned=me: %v", env.Meta)
	}
	env = expect(t, e.do("GET", "/api/v1/admin/leads?assigned=none", nil, withCookie(sales.cookie)), 200)
	if env.Meta["total"] != 0 {
		t.Fatalf("assigned=none: %v", env.Meta)
	}
	today := time.Now().In(time.FixedZone("ICT", 7*3600)).Format("2006-01-02")
	env = expect(t, e.do("GET", "/api/v1/admin/leads?from="+today+"&to="+today, nil, withCookie(sales.cookie)), 200)
	if env.Meta["total"] != 1 {
		t.Fatalf("date filter: %v", env.Meta)
	}
	expect(t, e.do("GET", "/api/v1/admin/leads?from=yesterday", nil, withCookie(sales.cookie)), 422)

	env = expect(t, e.do("POST", "/api/v1/admin/leads/"+id+"/notes", map[string]string{"body": "โทรแล้ว ลูกค้าสนใจ"},
		sales.opts()...), 201)
	if !strings.Contains(string(env.Data), `"kind":"note"`) || !strings.Contains(string(env.Data), `"actor":{`) {
		t.Fatalf("note: %s", env.Data)
	}
	expect(t, e.do("POST", "/api/v1/admin/leads/"+id+"/notes", map[string]string{"body": " "}, sales.opts()...), 422)
	env = expect(t, e.do("GET", "/api/v1/admin/leads/"+id+"/activity", nil, withCookie(rs[domain.RoleViewer].cookie)), 200)
	var acts []struct{ Kind, From, To string }
	_ = json.Unmarshal(env.Data, &acts)
	if len(acts) != 3 || acts[0].Kind != "note" || acts[2].Kind != "status" || acts[2].To != "contacted" {
		t.Fatalf("activity: %s", env.Data)
	}

	env = expect(t, e.do("GET", "/api/v1/admin/leads/board?assigned=me", nil, withCookie(sales.cookie)), 200)
	var b struct {
		Columns map[string][]map[string]any
		Counts  map[string]int
	}
	_ = json.Unmarshal(env.Data, &b)
	if len(b.Columns) != 5 || len(b.Columns["contacted"]) != 1 || b.Counts["contacted"] != 1 || b.Columns["new"] == nil {
		t.Fatalf("board: %s", env.Data)
	}

	w := e.do("GET", "/api/v1/admin/leads/export.csv", nil, withCookie(sales.cookie))
	if w.Code != 200 {
		t.Fatalf("export: %d", w.Code)
	}
	var notes, exports int
	for _, a := range e.store.AuditEntries() {
		switch a.Action {
		case domain.AuditLeadNote:
			notes++
			if len(a.Metadata) != 1 || a.Metadata["length"] == nil {
				t.Fatalf("note audit metadata: %v", a.Metadata)
			}
		case domain.AuditLeadExport:
			exports++
			if fmt.Sprint(a.Metadata["rows"]) != "1" {
				t.Fatalf("export audit: %v", a.Metadata)
			}
		}
	}
	if notes != 1 || exports != 1 {
		t.Fatalf("audit notes=%d exports=%d", notes, exports)
	}
}
