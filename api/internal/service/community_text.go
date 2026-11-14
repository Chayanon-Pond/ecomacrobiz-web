package service

import (
	"crypto/sha256"
	"html"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// ---- comment body ----

var blankLinesRe = regexp.MustCompile(`\n{3,}`)

// NormalizeCommentBody: NFC, CRLF/CR -> LF, control characters removed
// (newline kept, tab -> space), trailing spaces per line trimmed, more than
// two consecutive blank lines collapsed, whole body trimmed.
func NormalizeCommentBody(s string) string {
	s = norm.NFC.String(s)
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = strings.Map(func(r rune) rune {
		switch {
		case r == '\n':
			return r
		case r == '\t':
			return ' '
		case unicode.IsControl(r), r == ' ', r == ' ':
			return -1
		}
		return r
	}, s)
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRightFunc(l, unicode.IsSpace)
	}
	s = strings.Join(lines, "\n")
	s = blankLinesRe.ReplaceAllString(s, "\n\n\n")
	return strings.TrimSpace(s)
}

// CommentContentHash is the duplicate-detection hash of a normalized body
// (case- and whitespace-insensitive).
func CommentContentHash(body string) []byte {
	sum := sha256.Sum256([]byte(strings.Join(strings.Fields(strings.ToLower(body)), " ")))
	return sum[:]
}

var (
	httpURLRe = regexp.MustCompile(`(?i)\bhttps?://[^\s<>"']+`)
	// bareDomainRe: www.example.com or example.<common tld>, optional path.
	bareDomainRe = regexp.MustCompile(`(?i)(?:^|[^\p{L}\p{N}@._/-])((?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+` +
		`(?:com|net|org|info|biz|io|co|me|app|dev|xyz|site|online|shop|store|top|club|tech|ly|gl|to|tv|cc|us|uk|th|asia|ai|gg|link|page|live|link|click|vip|win|bet|cn|ru|in|jp|kr|de|fr|be|nl|it|es|au|ca)\b(?:/[^\s]*)?)`)
)

// CountLinks counts http(s) URLs plus bare domains (spam rule: max 2).
func CountLinks(body string) int {
	n := len(httpURLRe.FindAllStringIndex(body, -1))
	rest := httpURLRe.ReplaceAllString(body, " ")
	return n + len(bareDomainRe.FindAllStringIndex(rest, -1))
}

// ---- body_html renderer ----

const maxLinkText = 200

var (
	// mdLinkRe matches [text](http(s)://url) on the raw text.
	mdLinkRe = regexp.MustCompile(`\[([^\[\]\n]{1,200})\]\((https?://[^\s()<>]+)\)`)
	strongRe = regexp.MustCompile(`\*\*([^*\n]+?)\*\*`)
	emStarRe = regexp.MustCompile(`\*([^*\n]+?)\*`)
	emUndRe  = regexp.MustCompile(`(^|[^\p{L}\p{N}_])_([^_\n]+?)_($|[^\p{L}\p{N}_])`)
)

// safeHTTPURL returns the normalized URL when raw is an absolute http(s) URL.
func safeHTTPURL(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return "", false
	}
	return u.String(), true
}

// trimURLTail drops trailing punctuation that is almost never part of a URL.
func trimURLTail(s string) string {
	for len(s) > 0 {
		last := s[len(s)-1]
		switch {
		case strings.ContainsRune(".,!?;:'\"", rune(last)):
			s = s[:len(s)-1]
		case last == ')' && strings.Count(s, "(") < strings.Count(s, ")"):
			s = s[:len(s)-1]
		default:
			return s
		}
	}
	return s
}

func anchor(href, text string) string {
	if utf8.RuneCountInString(text) > maxLinkText {
		text = string([]rune(text)[:maxLinkText-1]) + "…"
	}
	return `<a href="` + html.EscapeString(href) + `" rel="ugc nofollow noopener" target="_blank">` +
		html.EscapeString(text) + `</a>`
}

// RenderCommentHTML renders the light-markdown body to safe HTML. Every
// character of user input reaches the output only through
// html.EscapeString; the only tags ever produced are strong, em, br and
// a[href=http(s)][rel][target]. Links are found on the raw text (so URLs can
// be validated and truncated correctly), everything else is escaped before
// the emphasis markers are applied.
func RenderCommentHTML(body string) string {
	var b strings.Builder
	for _, line := range splitKeep(body) {
		if line == "\n" {
			b.WriteString("<br>")
			continue
		}
		renderLine(&b, line)
	}
	return b.String()
}

func splitKeep(s string) []string {
	var out []string
	for {
		i := strings.IndexByte(s, '\n')
		if i < 0 {
			if s != "" {
				out = append(out, s)
			}
			return out
		}
		if i > 0 {
			out = append(out, s[:i])
		}
		out = append(out, "\n")
		s = s[i+1:]
	}
}

func renderLine(b *strings.Builder, line string) {
	for line != "" {
		md := mdLinkRe.FindStringSubmatchIndex(line)
		bare := httpURLRe.FindStringIndex(line)
		switch {
		case md != nil && (bare == nil || md[0] <= bare[0]):
			b.WriteString(renderEmphasis(line[:md[0]]))
			text, raw := line[md[2]:md[3]], line[md[4]:md[5]]
			if href, ok := safeHTTPURL(raw); ok {
				b.WriteString(anchor(href, text))
			} else {
				b.WriteString(renderEmphasis(line[md[0]:md[1]]))
			}
			line = line[md[1]:]
		case bare != nil:
			b.WriteString(renderEmphasis(line[:bare[0]]))
			raw := trimURLTail(line[bare[0]:bare[1]])
			end := bare[0] + len(raw)
			if href, ok := safeHTTPURL(raw); ok && raw != "" {
				b.WriteString(anchor(href, raw))
			} else {
				end = bare[1]
				b.WriteString(html.EscapeString(line[bare[0]:end]))
			}
			line = line[end:]
		default:
			b.WriteString(renderEmphasis(line))
			line = ""
		}
	}
}

// renderEmphasis escapes s, then turns **x** into <strong> and *x* / _x_
// into <em>. Em is applied separately inside and outside each strong span,
// so tags always nest properly.
func renderEmphasis(s string) string {
	esc := html.EscapeString(s)
	var b strings.Builder
	for {
		m := strongRe.FindStringSubmatchIndex(esc)
		if m == nil {
			b.WriteString(applyEm(esc))
			return b.String()
		}
		b.WriteString(applyEm(esc[:m[0]]))
		b.WriteString("<strong>" + applyEm(esc[m[2]:m[3]]) + "</strong>")
		esc = esc[m[1]:]
	}
}

func applyEm(s string) string {
	s = emStarRe.ReplaceAllString(s, "<em>$1</em>")
	return emUndRe.ReplaceAllString(s, "$1<em>$2</em>$3")
}

// ---- display names ----

var reservedNames = []string{"admin", "administrator", "ecomacrobiz", "moderator", "แอดมิน", "ผู้ดูแลระบบ",
	domain.MsgDeletedAuthor}

// CleanDisplayName: NFC, control/format characters removed, inner
// whitespace collapsed, trimmed.
func CleanDisplayName(s string) string {
	s = norm.NFC.String(s)
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s)
	return strings.Join(strings.Fields(s), " ")
}

// DisplayNameProblem returns a Thai message when the cleaned name is not
// acceptable ("" = OK): 2..40 characters, letters or digits present, no
// "@" or URL, not a reserved name.
func DisplayNameProblem(name string) string {
	n := utf8.RuneCountInString(name)
	if n < 2 || n > 40 {
		return "ชื่อที่แสดงต้องมี 2-40 ตัวอักษร"
	}
	hasAlnum := false
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			hasAlnum = true
			break
		}
	}
	if !hasAlnum {
		return "ชื่อที่แสดงต้องมีตัวอักษรหรือตัวเลข"
	}
	if strings.ContainsAny(name, "@<>") || httpURLRe.MatchString(name) || strings.Contains(strings.ToLower(name), "www.") {
		return "ชื่อที่แสดงห้ามมีอีเมลหรือลิงก์"
	}
	lower := strings.ToLower(name)
	for _, r := range reservedNames {
		if lower == strings.ToLower(r) {
			return "ไม่สามารถใช้ชื่อนี้ได้"
		}
	}
	return ""
}

// NameFromGoogle derives a valid display name from the Google profile name,
// then the e-mail local part, then DefaultMemberName.
func NameFromGoogle(name, email string) string {
	for _, cand := range []string{name, strings.SplitN(email, "@", 2)[0]} {
		c := CleanDisplayName(cand)
		if utf8.RuneCountInString(c) > 40 {
			c = strings.TrimSpace(string([]rune(c)[:40]))
		}
		if DisplayNameProblem(c) == "" {
			return c
		}
	}
	return domain.DefaultMemberName
}

// ---- misc rules ----

// SafeNextPath validates a post-login return path: it must start with "/",
// not "//", contain no backslash or control character and be at most 512
// bytes; anything else becomes "/". A fragment is dropped (the callback
// appends its own).
func SafeNextPath(p string) string {
	if i := strings.IndexByte(p, '#'); i >= 0 {
		p = p[:i]
	}
	if p == "" || len(p) > 512 || p[0] != '/' || strings.HasPrefix(p, "//") || strings.ContainsRune(p, '\\') {
		return "/"
	}
	for _, r := range p {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return "/"
		}
	}
	return p
}

var botUARe = regexp.MustCompile(`(?i)bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|` +
	`quora link preview|whatsapp|telegrambot|discordbot|linkedinbot|headless|lighthouse|pagespeed|` +
	`google-inspectiontool|ahrefs|semrush|curl|wget|python-requests|go-http-client|node-fetch|axios`)

// IsBotUA: empty user agents count as bots.
func IsBotUA(ua string) bool {
	ua = strings.TrimSpace(ua)
	return ua == "" || botUARe.MatchString(ua)
}

// InitialCommentStatus is the moderation decision for a new comment.
func InitialCommentStatus(role domain.MemberRole, holdFirst, hasPublished, emailVerified bool, accountAge time.Duration) domain.CommentStatus {
	if role.PublishesDirectly() {
		return domain.CommentPublished
	}
	if holdFirst && !hasPublished && (!emailVerified || accountAge < 24*time.Hour) {
		return domain.CommentPending
	}
	return domain.CommentPublished
}

// MaskEmail: "somchai@gmail.com" -> "s***@g***.com".
func MaskEmail(email string) string {
	local, dom, ok := strings.Cut(email, "@")
	if !ok || local == "" || dom == "" {
		return "***"
	}
	first := func(s string) string {
		r, _ := utf8.DecodeRuneInString(s)
		return string(r)
	}
	tld := ""
	if i := strings.LastIndexByte(dom, '.'); i > 0 {
		tld, dom = dom[i:], dom[:i]
	}
	return first(local) + "***@" + first(dom) + "***" + tld
}
