package service

import (
	"context"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
)

type recIndexer struct {
	mu   sync.Mutex
	urls [][]string
}

func (r *recIndexer) Submit(urls ...string) {
	r.mu.Lock()
	r.urls = append(r.urls, urls)
	r.mu.Unlock()
}

func (r *recIndexer) all() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for _, u := range r.urls {
		out = append(out, u...)
	}
	return out
}

type seoEnv struct {
	store *fake.Store
	posts *PostService
	rs    *RedirectService
	rv    *recRevalidator
	au    *recAuditor
	idx   *recIndexer
	ctx   context.Context
}

func newSEOEnv(t *testing.T) *seoEnv {
	t.Helper()
	store := fake.New()
	rv, au, idx := &recRevalidator{}, &recAuditor{}, &recIndexer{}
	rs := NewRedirectService(store.RedirectsRepo(), store.PostsRepo(), rv, au, discard)
	rs.SetSiteBaseURL("https://www.example.com")
	ps := NewPostService(store.PostsRepo(), store.CategoriesRepo(), store.MediaRepo(), rs, rv, au, discard)
	ps.SetIndexer(idx)
	return &seoEnv{store: store, posts: ps, rs: rs, rv: rv, au: au, idx: idx, ctx: context.Background()}
}

func (e *seoEnv) post(t *testing.T, slug, status string, legacy ...string) domain.Post {
	t.Helper()
	in := validPost()
	in.Slug, in.Status = slug, status
	if legacy != nil {
		in.LegacySlugs = &legacy
	}
	p, err := e.posts.Create(e.ctx, in, testOwner)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func (e *seoEnv) redirect(t *testing.T, from string, to *string, status int) domain.Redirect {
	t.Helper()
	d, _, err := e.rs.Create(e.ctx, RedirectInput{From: from, To: to, Status: status}, testOwner)
	if err != nil {
		t.Fatalf("create %s: %v", from, err)
	}
	return d
}

// publicMap renders the public map as "from>to|status" entries.
func (e *seoEnv) publicMap(t *testing.T) map[string]string {
	t.Helper()
	rs, err := e.rs.Public(e.ctx)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for i, r := range rs {
		if i > 0 && rs[i-1].From > r.From {
			t.Fatalf("public map not sorted: %v", rs)
		}
		v := "410"
		if r.To != nil {
			v = *r.To
		}
		out[r.From] = v
	}
	return out
}

func sp(s string) *string { return &s }

func TestNormalizePath(t *testing.T) {
	ok := map[string]string{
		"/":            "/",
		"/old/":        "/old",
		"//a///b//":    "/a/b",
		" /blog/post ": "/blog/post",
		"/post/%E0%B8%AA%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%87": "/post/สร้าง",
		"/post/สร้าง/":                                        "/post/สร้าง",
		"/caf%C3%A9":                                          "/café",
		"/cafe\u0301":                                         "/café", // NFD -> NFC
		"/a%2Fb":                                              "/a/b",
		"/Mixed-Case_ok.html":                                 "/Mixed-Case_ok.html",
	}
	for in, want := range ok {
		if got, err := domain.NormalizePath(in); err != nil || got != want {
			t.Errorf("NormalizePath(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "old", "https://x.com/a", "/a?b=1", "/a#x", "/a/../b", "/./a", "/a%ZZ",
		"/a b", "/a%20b", `/a\b`, "/%E0%B8", "/" + strings.Repeat("a", 2001)} {
		if got, err := domain.NormalizePath(in); err == nil {
			t.Errorf("NormalizePath(%q) = %q, want error", in, got)
		}
	}
	if got := domain.KnowledgePath("ทำไมธุรกิจ-b2b"); got != "/knowledge/ทำไมธุรกิจ-b2b" {
		t.Errorf("KnowledgePath: %q", got)
	}
}

func TestRedirectRules(t *testing.T) {
	e := newSEOEnv(t)
	e.post(t, "live-post", "published", "old-live")
	ctx := e.ctx

	a := e.redirect(t, "/a/", sp("/b"), 301)
	if a.From != "/a" || *a.To != "/b" || a.Kind != domain.RedirectManual || a.CreatedBy != nil {
		t.Fatalf("created: %+v", a)
	}
	cases := []struct {
		in    RedirectInput
		field string
		msg   string
	}{
		{RedirectInput{From: "/c", To: sp("/a"), Status: 301}, "to", MsgRedirectChain}, // chain
		{RedirectInput{From: "/b", To: sp("/a"), Status: 301}, "to", MsgRedirectChain}, // loop
		{RedirectInput{From: "/d", To: sp("/d/"), Status: 301}, "to", MsgRedirectSelf}, // self
		{RedirectInput{From: "/a", To: sp("/z"), Status: 301}, "from", MsgRedirectDup},
		{RedirectInput{From: "/knowledge/live-post", Status: 410}, "from", MsgRedirectLivePost},
		{RedirectInput{From: "/knowledge/old-live/", Status: 410}, "from", MsgRedirectLivePost},
		{RedirectInput{From: "/contact", To: sp("/x"), Status: 301}, "from", MsgRedirectCorePage},
		{RedirectInput{From: "/", Status: 410}, "from", MsgRedirectCorePage},
		{RedirectInput{From: "/admin/posts", Status: 410}, "from", MsgRedirectCorePage},
		{RedirectInput{From: "/e", To: sp("http://insecure.example.com/"), Status: 301}, "to", MsgRedirectTarget},
		{RedirectInput{From: "/e", Status: 301}, "to", "กรุณากรอกปลายทาง"},
		{RedirectInput{From: "/e", Status: 302}, "status", "สถานะต้องเป็น 301 หรือ 410"},
		{RedirectInput{From: "e", Status: 410}, "from", "path ต้องขึ้นต้นด้วย /"},
		{RedirectInput{From: "/self", To: sp("https://WWW.example.com/self/"), Status: 301}, "to", MsgRedirectSelf},
	}
	for _, c := range cases {
		_, _, err := e.rs.Create(ctx, c.in, testOwner)
		if got := fieldErrs(t, err)[c.field]; got != c.msg {
			t.Errorf("%+v: field %s = %q (err %v), want %q", c.in, c.field, got, err, c.msg)
		}
	}

	// Flatten: /a -> /b exists; /b -> /c re-points /a to /c.
	b, n, err := e.rs.Create(ctx, RedirectInput{From: "/b", To: sp("/c"), Status: 301, Note: "ย้าย"}, testOwner)
	if err != nil || n != 1 || b.Note != "ย้าย" {
		t.Fatalf("flatten create: %+v %d %v", b, n, err)
	}
	if got, _ := e.store.RedirectsRepo().Get(ctx, a.ID); *got.To != "/c" {
		t.Fatalf("/a not flattened: %+v", got)
	}
	// Own-host absolute URL is stored as a path; external https kept as-is.
	own := e.redirect(t, "/own", sp("https://www.example.com/knowledge/live-post/"), 301)
	if *own.To != "/knowledge/live-post" {
		t.Fatalf("own host: %q", *own.To)
	}
	ext := e.redirect(t, "/ext", sp("https://other.example.org/x?y=1"), 301)
	if *ext.To != "https://other.example.org/x?y=1" {
		t.Fatalf("external: %q", *ext.To)
	}
	// A target that is a live legacy URL resolves to the canonical URL.
	leg := e.redirect(t, "/leg", sp("/knowledge/old-live"), 301)
	if *leg.To != "/knowledge/live-post" {
		t.Fatalf("legacy target: %q", *leg.To)
	}
	// 410 ignores a target.
	gone := e.redirect(t, "/gone", sp("/whatever"), 410)
	if gone.To != nil || gone.Status != 410 {
		t.Fatalf("410: %+v", gone)
	}
	// Update: its own row is not a chain; it becomes manual; audit + revalidate.
	upd, _, err := e.rs.Update(ctx, b.ID, RedirectInput{From: "/b", To: sp("/c2"), Status: 301}, testOwner)
	if err != nil || *upd.To != "/c2" {
		t.Fatalf("update: %+v %v", upd, err)
	}
	if _, _, err := e.rs.Update(ctx, b.ID, RedirectInput{From: "/a", To: sp("/c2"), Status: 301}, testOwner); fieldErrs(t, err)["from"] != MsgRedirectDup {
		t.Fatalf("update to a taken from: %v", err)
	}
	if err := e.rs.Delete(ctx, gone.ID, testOwner); err != nil {
		t.Fatal(err)
	}
	if err := e.rs.Delete(ctx, gone.ID, testOwner); err != domain.ErrNotFound {
		t.Fatalf("delete twice: %v", err)
	}
	acts := e.au.actions()
	for _, want := range []string{domain.AuditRedirectCreate, domain.AuditRedirectUpdate, domain.AuditRedirectDelete} {
		if !slices.Contains(acts, want) {
			t.Fatalf("audit %s missing: %v", want, acts)
		}
	}
	for _, tags := range e.rv.tags[1:] { // [0] is the post create
		if !slices.Contains(tags, "redirects") {
			t.Fatalf("redirect change without redirects tag: %v", e.rv.tags)
		}
	}
	list, total, err := e.rs.List(ctx, repository.RedirectFilter{Page: domain.Page{Page: 1, PerPage: 10}, Status: 301})
	if err != nil || total != 5 || list[0].From != "/a" {
		t.Fatalf("list 301: %d %v", total, err)
	}
	if _, _, err := e.rs.List(ctx, repository.RedirectFilter{Kind: "x"}); fieldErrs(t, err)["kind"] == "" {
		t.Fatal("bad kind accepted")
	}
}

func TestPostAutoRedirects(t *testing.T) {
	e := newSEOEnv(t)
	ctx := e.ctx
	target := e.post(t, "target", "published")
	p := e.post(t, "first-slug", "published", "wix-old")
	manual := e.redirect(t, "/old-campaign", sp("/knowledge/first-slug"), 301)

	// Slug change of a published post: legacy slug + public map + flatten.
	in := validPost()
	in.Slug, in.Status = "second-slug", "published"
	p, err := e.posts.Update(ctx, p.ID, in, testOwner)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(p.LegacySlugs, ",") != "wix-old,first-slug" {
		t.Fatalf("legacy: %v", p.LegacySlugs)
	}
	pm := e.publicMap(t)
	if pm["/knowledge/first-slug"] != "/knowledge/second-slug" || pm["/knowledge/wix-old"] != "/knowledge/second-slug" {
		t.Fatalf("public map after slug change: %v", pm)
	}
	if got, _ := e.store.RedirectsRepo().Get(ctx, manual.ID); *got.To != "/knowledge/second-slug" {
		t.Fatalf("manual 301 not re-pointed: %q", *got.To)
	}
	// Changing back drops the new slug from the legacy list.
	in.Slug = "first-slug"
	if p, err = e.posts.Update(ctx, p.ID, in, testOwner); err != nil ||
		strings.Join(p.LegacySlugs, ",") != "wix-old,second-slug" {
		t.Fatalf("slug back: %v %v", p.LegacySlugs, err)
	}
	in.Slug = "second-slug"
	p, _ = e.posts.Update(ctx, p.ID, in, testOwner)

	// Unpublish without target => 410 for slug + every legacy slug.
	in.Status = "draft"
	if p, err = e.posts.Update(ctx, p.ID, in, testOwner); err != nil {
		t.Fatal(err)
	}
	pm = e.publicMap(t)
	for _, path := range []string{"/knowledge/second-slug", "/knowledge/first-slug", "/knowledge/wix-old"} {
		if pm[path] != "410" {
			t.Fatalf("%s after unpublish: %q (%v)", path, pm[path], pm)
		}
	}
	last := e.rv.tags[len(e.rv.tags)-1]
	if !slices.Contains(last, "redirects") || e.au.last().Action != domain.AuditPostUnpublish {
		t.Fatalf("unpublish tags/audit: %v %v", last, e.au.last())
	}

	// Republish removes the rows.
	in.Status = "published"
	if p, err = e.posts.Update(ctx, p.ID, in, testOwner); err != nil {
		t.Fatal(err)
	}
	pm = e.publicMap(t)
	if _, ok := pm["/knowledge/second-slug"]; ok || pm["/knowledge/wix-old"] != "/knowledge/second-slug" {
		t.Fatalf("after republish: %v", pm)
	}

	// Unpublish with a chained target is rejected; nothing changes.
	e.redirect(t, "/moved", sp("/elsewhere"), 301)
	in.Status, in.RedirectTo = "draft", sp("/moved")
	if _, err := e.posts.Update(ctx, p.ID, in, testOwner); fieldErrs(t, err)["redirect_to"] != MsgRedirectChain {
		t.Fatalf("chain target: %v", err)
	}
	in.RedirectTo = sp("/knowledge/wix-old")
	if _, err := e.posts.Update(ctx, p.ID, in, testOwner); fieldErrs(t, err)["redirect_to"] != MsgRedirectOwnPath {
		t.Fatalf("own path target: %v", err)
	}
	if got, _ := e.posts.Get(ctx, p.ID); got.Status != domain.PostPublished {
		t.Fatal("rejected unpublish changed the post")
	}
	// Unpublish with target => 301 for all its URLs; the manual row follows.
	in.RedirectTo = sp("https://www.example.com/knowledge/target")
	if p, err = e.posts.Update(ctx, p.ID, in, testOwner); err != nil {
		t.Fatal(err)
	}
	pm = e.publicMap(t)
	for _, path := range []string{"/knowledge/second-slug", "/knowledge/wix-old", "/old-campaign"} {
		if pm[path] != "/knowledge/target" {
			t.Fatalf("%s after unpublish->target: %q", path, pm[path])
		}
	}
	if e.au.last().Metadata["redirect_to"] != "/knowledge/target" {
		t.Fatalf("audit redirect_to: %+v", e.au.last().Metadata)
	}
	if u := e.idx.all(); !slices.Contains(u, "/knowledge/second-slug") || !slices.Contains(u, "/knowledge/target") ||
		!slices.Contains(u, "/knowledge") {
		t.Fatalf("indexnow: %v", u)
	}

	// Delete of a published post with redirect_to; delete of a draft adds nothing.
	d := e.post(t, "to-delete", "published")
	if err := e.posts.Delete(ctx, d.ID, sp("/knowledge/target/"), testOwner); err != nil {
		t.Fatal(err)
	}
	if e.publicMap(t)["/knowledge/to-delete"] != "/knowledge/target" {
		t.Fatal("delete with redirect_to")
	}
	d2 := e.post(t, "draft-delete", "draft")
	if err := e.posts.Delete(ctx, d2.ID, nil, testOwner); err != nil {
		t.Fatal(err)
	}
	if _, ok := e.publicMap(t)["/knowledge/draft-delete"]; ok {
		t.Fatal("deleting a draft created a redirect")
	}
	_ = target
}

func TestBulkAndSchedulerRedirects(t *testing.T) {
	e := newSEOEnv(t)
	ctx := e.ctx
	a := e.post(t, "bulk-a", "published", "bulk-a-old")
	b := e.post(t, "bulk-b", "published")
	if _, err := e.posts.Bulk(ctx, BulkInput{Action: "unpublish", IDs: []string{a.ID}}, testOwner); err != nil {
		t.Fatal(err)
	}
	if _, err := e.posts.Bulk(ctx, BulkInput{Action: "delete", IDs: []string{b.ID}}, testOwner); err != nil {
		t.Fatal(err)
	}
	pm := e.publicMap(t)
	if pm["/knowledge/bulk-a"] != "410" || pm["/knowledge/bulk-a-old"] != "410" || pm["/knowledge/bulk-b"] != "410" {
		t.Fatalf("bulk => 410: %v", pm)
	}
	if last := e.rv.tags[len(e.rv.tags)-1]; !slices.Contains(last, "redirects") {
		t.Fatalf("bulk tags: %v", last)
	}
	// Bulk publish removes them again.
	if _, err := e.posts.Bulk(ctx, BulkInput{Action: "publish", IDs: []string{a.ID}}, testOwner); err != nil {
		t.Fatal(err)
	}
	if pm = e.publicMap(t); pm["/knowledge/bulk-a"] != "" || pm["/knowledge/bulk-a-old"] != "/knowledge/bulk-a" {
		t.Fatalf("bulk publish: %v", pm)
	}

	// Scheduler publish removes rows for the post's URLs.
	now := time.Now().UTC()
	e.redirect(t, "/knowledge/soon", nil, 410)
	in := validPost()
	in.Slug, in.Status = "soon", "scheduled"
	at := now.Add(time.Hour)
	in.PublishedAt = &at
	if _, err := e.posts.Create(ctx, in, testOwner); err != nil {
		t.Fatal(err)
	}
	sch := NewPostScheduler(e.store.PostsRepo(), NopAuditor{}, e.rv, discard)
	idx := &recIndexer{}
	sch.SetIndexer(idx)
	sch.Now = func() time.Time { return now.Add(2 * time.Hour) }
	if n, err := sch.RunOnce(ctx); n != 1 || err != nil {
		t.Fatalf("scheduler: %d %v", n, err)
	}
	if _, ok := e.publicMap(t)["/knowledge/soon"]; ok {
		t.Fatal("scheduler publish kept the 410 row")
	}
	if u := idx.all(); !slices.Contains(u, "/knowledge/soon") || !slices.Contains(u, "/knowledge") {
		t.Fatalf("scheduler indexnow: %v", u)
	}
}

func TestPostSEOFields(t *testing.T) {
	e := newSEOEnv(t)
	ctx := e.ctx
	in := validPost()
	in.FocusKeyword = strings.Repeat("ก", 101)
	in.CanonicalURL = "http://example.com/x"
	in.OGImage = &CoverInput{URL: "https://cdn.example.com/og.jpg"}
	errs := fieldErrs(t, func() error { _, err := e.posts.Create(ctx, in, testOwner); return err }())
	if errs["focus_keyword"] == "" || errs["canonical_url"] == "" || errs["og_image.width"] == "" {
		t.Fatalf("seo validation: %v", errs)
	}
	in.FocusKeyword = " branding "
	in.CanonicalURL = "https://partner.example.com/original"
	in.NoIndex = true
	in.OGImage = &CoverInput{URL: "https://cdn.example.com/og.jpg", Alt: "ภาพ OG", Width: 1200, Height: 630}
	p, err := e.posts.Create(ctx, in, testOwner)
	if err != nil {
		t.Fatal(err)
	}
	if p.FocusKeyword != "branding" || p.CanonicalURL != in.CanonicalURL || !p.NoIndex || p.OGImage == nil ||
		p.OGImage.Width != 1200 || p.OGImage.Alt != "ภาพ OG" {
		t.Fatalf("seo fields: %+v %+v", p, p.OGImage)
	}
	// From media: url + dims from the media row, alt falls back to media alt.
	m := domain.Media{StorageKey: "og-abcdef12.png", URL: "https://api.example.com/media/og-abcdef12.png",
		Mime: "image/png", Width: 1200, Height: 630, Alt: "alt จากคลัง"}
	if err := e.store.MediaRepo().Create(ctx, &m); err != nil {
		t.Fatal(err)
	}
	in.OGImage = &CoverInput{URL: "ignored"}
	in.OGMediaID = &m.ID
	if p, err = e.posts.Update(ctx, p.ID, in, testOwner); err != nil {
		t.Fatal(err)
	}
	if p.OGImage == nil || p.OGImage.URL != m.URL || p.OGImage.Alt != m.Alt || p.OGImage.Height != 630 ||
		p.OGMediaID == nil {
		t.Fatalf("og from media: %+v", p.OGImage)
	}
	if usage, _ := e.store.MediaRepo().Usage(ctx, m.ID); len(usage) != 1 || usage[0].Kind != "og" {
		t.Fatalf("og usage: %+v", usage)
	}
	missing := "00000000-0000-0000-0000-000000000099"
	in.OGMediaID = &missing
	if _, err := e.posts.Update(ctx, p.ID, in, testOwner); fieldErrs(t, err)["og_media_id"] == "" {
		t.Fatal("unknown og media accepted")
	}
}

func TestLinkSuggestions(t *testing.T) {
	e := newSEOEnv(t)
	ctx := e.ctx
	mk := func(slug, title, status string, cats ...string) domain.Post {
		in := validPost()
		in.Slug, in.Title, in.Status, in.Categories = slug, title, status, cats
		p, err := e.posts.Create(ctx, in, testOwner)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	src := mk("src", "ต้นทาง", "draft", "brand-insight")
	mk("same-cat", "แบรนด์", "published", "brand-insight")
	mk("other-cat", "SEO สำหรับ B2B", "published", "business-growth")
	mk("draft-cat", "ร่าง", "draft", "brand-insight")
	got, err := e.posts.LinkSuggestions(ctx, src.ID, "seo")
	if err != nil || len(got) != 2 || got[0].Slug != "same-cat" || got[1].Slug != "other-cat" {
		t.Fatalf("suggestions: %+v %v", got, err)
	}
	if got, _ := e.posts.LinkSuggestions(ctx, "", ""); len(got) != 0 {
		t.Fatalf("empty query: %+v", got)
	}
	if got, _ := e.posts.LinkSuggestions(ctx, "bad-id", "แบรนด์"); len(got) != 1 {
		t.Fatalf("keyword only: %+v", got)
	}
}

func TestMediaKey(t *testing.T) {
	re := regexp.MustCompile(`^[a-z0-9-]+-[0-9a-f]{8}\.webp$`)
	cases := map[[2]string]string{
		{"Coca-Cola Brand Recognition!", "x.jpg"}: "coca-cola-brand-recognition-",
		{"ภาพปก", "Team Photo 2026.PNG"}:          "team-photo-2026-",
		{"", `C:\fakepath\ภาพ.jpg`}:               "image-",
		{"", ""}:                                  "image-",
		{strings.Repeat("ab ", 40), ""}:           strings.Repeat("ab-", 20)[:59] + "-",
	}
	for in, prefix := range cases {
		k := MediaKey(in[0], in[1], "webp")
		if !strings.HasPrefix(k, prefix) || !re.MatchString(k) || len(k) > 60+1+8+5 {
			t.Errorf("MediaKey(%q, %q) = %q, want prefix %q", in[0], in[1], k, prefix)
		}
	}
	if MediaKey("a", "", "png") == MediaKey("a", "", "png") {
		t.Error("keys must be random")
	}
}
