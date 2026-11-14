package service

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

func TestRenderCommentHTML(t *testing.T) {
	cases := []struct{ in, want string }{
		{"hello", "hello"},
		{"a\nb\n\nc", "a<br>b<br><br>c"},
		{"**bold** and *it* and _it2_", "<strong>bold</strong> and <em>it</em> and <em>it2</em>"},
		{"snake_case_name stays", "snake_case_name stays"},
		{"<script>alert(1)</script>", "&lt;script&gt;alert(1)&lt;/script&gt;"},
		{"<img src=x onerror=alert(1)>", "&lt;img src=x onerror=alert(1)&gt;"},
		{"[click](javascript:alert(1))", "[click](javascript:alert(1))"},
		{"javascript:alert(1)", "javascript:alert(1)"},
		{"[x](data:text/html,hi)", "[x](data:text/html,hi)"},
		{`[x](https://a.com/"onmouseover="alert(1))`,
			`[x](<a href="https://a.com/" rel="ugc nofollow noopener" target="_blank">https://a.com/</a>&#34;onmouseover=&#34;alert(1))`},
		{`[x](https://a.com/"onmouseover="x)`,
			`<a href="https://a.com/%22onmouseover=%22x" rel="ugc nofollow noopener" target="_blank">x</a>`},
		{`https://a.com/?q="><script>`,
			`<a href="https://a.com/?q=" rel="ugc nofollow noopener" target="_blank">https://a.com/?q=</a>&#34;&gt;&lt;script&gt;`},
		{"see https://example.com/path.", `see <a href="https://example.com/path" rel="ugc nofollow noopener" target="_blank">https://example.com/path</a>.`},
		{"[docs](https://example.com/a?b=1&c=2)",
			`<a href="https://example.com/a?b=1&amp;c=2" rel="ugc nofollow noopener" target="_blank">docs</a>`},
		{"[**x**](https://e.com)", `<a href="https://e.com" rel="ugc nofollow noopener" target="_blank">**x**</a>`},
		{"**unterminated", "**unterminated"},
		{"*unterminated", "*unterminated"},
		{"**a *b** c*", "*<em>a </em>b*<em> c</em>"}, // crossing markers: still well-nested
		{"***x***", "*<strong>x</strong>*"},
		{"**<b>x</b>**", "<strong>&lt;b&gt;x&lt;/b&gt;</strong>"},
		{"a & b ' c", "a &amp; b &#39; c"},
		{"**line\nbreak**", "**line<br>break**"},
	}
	for _, c := range cases {
		if got := RenderCommentHTML(c.in); got != c.want {
			t.Errorf("RenderCommentHTML(%q)\n got %s\nwant %s", c.in, got, c.want)
		}
	}
	// Whatever the input, only the allowed tags/attributes can appear.
	tagRe := regexp.MustCompile(`<[^>]*>`)
	allowed := regexp.MustCompile(`^(<br>|<strong>|</strong>|<em>|</em>|</a>|<a href="https?://[^"<>]*" rel="ugc nofollow noopener" target="_blank">)$`)
	fuzz := []string{"<a href=\"javascript:x\">", "**[a](https://x.com/\"><svg/onload=1>)**", "_<i>_",
		"[a](https://x.com) [b](http://y.com) http://z.com/<x>", "\"onmouseover=alert(1)\"", "*_**_*", "](https://x)[",
		"[" + strings.Repeat("a", 300) + "](https://x.com)", "https://" + strings.Repeat("a", 500) + ".com"}
	for _, in := range fuzz {
		out := RenderCommentHTML(in)
		for _, tag := range tagRe.FindAllString(out, -1) {
			if !allowed.MatchString(tag) {
				t.Errorf("RenderCommentHTML(%q) produced tag %q", in, tag)
			}
		}
	}
	long := RenderCommentHTML("https://example.com/" + strings.Repeat("a", 300))
	if !strings.Contains(long, "…</a>") {
		t.Error("link text must be truncated to 200 characters")
	}
}

func TestNormalizeCommentBody(t *testing.T) {
	in := "  hi\r\nthere\x00\x07  \n\n\n\n\nend  \t "
	want := "hi\nthere\n\n\nend"
	if got := NormalizeCommentBody(in); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if NormalizeCommentBody("café") != "café" {
		t.Fatal("NFC missing")
	}
}

func TestCountLinksAndDuplicateHash(t *testing.T) {
	cases := map[string]int{
		"no links here":                         0,
		"https://a.com and http://b.org/x":      2,
		"visit example.com or www.test.co.th":   2,
		"a.com b.net c.io":                      3,
		"https://a.com https://b.com shop.xyz":  3,
		"version 1.2.3 and e.g. file":           0,
		"email me at somchai@gmail.com":         0,
		"ไปที่ shopee.co.th ได้เลย":             1,
		"[text](https://a.com) https://b.com/x": 2,
	}
	for in, want := range cases {
		if got := CountLinks(in); got != want {
			t.Errorf("CountLinks(%q) = %d, want %d", in, got, want)
		}
	}
	if string(CommentContentHash("Hello   World")) != string(CommentContentHash("hello world")) {
		t.Error("duplicate hash must ignore case and whitespace runs")
	}
	if string(CommentContentHash("hello world")) == string(CommentContentHash("hello world!")) {
		t.Error("different bodies must hash differently")
	}
}

func TestBotUA(t *testing.T) {
	bots := []string{"", "   ", "Googlebot/2.1", "Mozilla/5.0 (compatible; bingbot/2.0)", "facebookexternalhit/1.1",
		"curl/8.4.0", "python-requests/2.31", "Go-http-client/1.1", "Mozilla/5.0 HeadlessChrome/120", "axios/1.6",
		"WhatsApp/2.23", "Chrome-Lighthouse", "AhrefsBot", "node-fetch/1.0", "TelegramBot (like TwitterBot)"}
	for _, ua := range bots {
		if !IsBotUA(ua) {
			t.Errorf("%q should be a bot", ua)
		}
	}
	humans := []string{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"}
	for _, ua := range humans {
		if IsBotUA(ua) {
			t.Errorf("%q should not be a bot", ua)
		}
	}
}

func TestDisplayNameRules(t *testing.T) {
	if got := CleanDisplayName("  สม​ชาย \n  ใจดี  "); got != "สมชาย ใจดี" {
		t.Fatalf("clean: %q", got)
	}
	ok := []string{"สมชาย", "Jo", "Somchai J.", "ร้าน ABC 123"}
	for _, n := range ok {
		if p := DisplayNameProblem(CleanDisplayName(n)); p != "" {
			t.Errorf("%q rejected: %s", n, p)
		}
	}
	bad := []string{"a", strings.Repeat("ก", 41), "---", "me@example.com", "https://spam.com", "www.spam",
		"Admin", "ผู้ใช้ที่ลบบัญชี", "<b>x</b>"}
	for _, n := range bad {
		if DisplayNameProblem(CleanDisplayName(n)) == "" {
			t.Errorf("%q accepted", n)
		}
	}
	if got := NameFromGoogle("  Somchai  Jaidee ", "x@gmail.com"); got != "Somchai Jaidee" {
		t.Errorf("google name: %q", got)
	}
	if got := NameFromGoogle("", "nok.k@gmail.com"); got != "nok.k" {
		t.Errorf("fallback to local part: %q", got)
	}
	if got := NameFromGoogle("x", "a@gmail.com"); got != domain.DefaultMemberName {
		t.Errorf("fallback to default: %q", got)
	}
	if got := NameFromGoogle(strings.Repeat("ab", 30), "a@b.co"); len([]rune(got)) != 40 {
		t.Errorf("long names truncated: %q", got)
	}
}

func TestSafeNextPath(t *testing.T) {
	cases := map[string]string{
		"":                             "/",
		"/knowledge/x":                 "/knowledge/x",
		"/knowledge/x?a=1#frag":        "/knowledge/x?a=1",
		"//evil.com":                   "/",
		"/\\evil.com":                  "/",
		"https://evil.com":             "/",
		"knowledge":                    "/",
		"/a b":                         "/",
		"/a\nb":                        "/",
		"/" + strings.Repeat("a", 512): "/",
		"/ok/ภาษาไทย":                  "/ok/ภาษาไทย",
	}
	for in, want := range cases {
		if got := SafeNextPath(in); got != want {
			t.Errorf("SafeNextPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestInitialCommentStatus(t *testing.T) {
	young, old := time.Hour, 48*time.Hour
	cases := []struct {
		role                domain.MemberRole
		hold, pub, verified bool
		age                 time.Duration
		want                domain.CommentStatus
	}{
		{domain.MemberRoleTrusted, true, false, false, young, domain.CommentPublished},
		{domain.MemberRoleModerator, true, false, false, young, domain.CommentPublished},
		{domain.MemberRoleMember, false, false, false, young, domain.CommentPublished},
		{domain.MemberRoleMember, true, true, false, young, domain.CommentPublished},
		{domain.MemberRoleMember, true, false, false, old, domain.CommentPending},
		{domain.MemberRoleMember, true, false, true, young, domain.CommentPending},
		{domain.MemberRoleMember, true, false, true, old, domain.CommentPublished},
	}
	for i, c := range cases {
		if got := InitialCommentStatus(c.role, c.hold, c.pub, c.verified, c.age); got != c.want {
			t.Errorf("case %d %+v: got %s", i, c, got)
		}
	}
}

func TestMaskEmail(t *testing.T) {
	for in, want := range map[string]string{"somchai@gmail.com": "s***@g***.com", "a@b.co.th": "a***@b***.th",
		"x@localhost": "x***@l***", "bad": "***"} {
		if got := MaskEmail(in); got != want {
			t.Errorf("MaskEmail(%q) = %q, want %q", in, got, want)
		}
	}
}
