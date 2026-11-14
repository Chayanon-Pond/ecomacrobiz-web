package domain

import (
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// Redirect kinds (redirects.kind).
const (
	RedirectManual = "manual"
	RedirectAuto   = "auto"
)

// Redirect is one row of the redirects table. To is nil for 410 Gone.
type Redirect struct {
	ID        string
	From      string
	To        *string
	Status    int // 301 | 410
	Kind      string
	Note      string
	CreatedBy *UserRef
	CreatedAt time.Time
	UpdatedAt time.Time
}

// PublicRedirect is one entry of the public redirect map.
type PublicRedirect struct {
	From   string
	To     *string
	Status int
}

// KnowledgePrefix is the public URL prefix of a post.
const KnowledgePrefix = "/knowledge/"

// KnowledgePath is the normalized public path of a post slug (or legacy
// slug, which may be Thai or percent-encoded).
func KnowledgePath(slug string) string {
	if p, err := NormalizePath(KnowledgePrefix + slug); err == nil {
		return p
	}
	return KnowledgePrefix + norm.NFC.String(slug)
}

// PathError explains (in Thai) why a path cannot be normalized.
type PathError struct{ Msg string }

func (e *PathError) Error() string { return e.Msg }

const maxPathLen = 2000

// NormalizePath returns the canonical stored form of a site path: leading
// '/', percent-decoded, NFC, no repeated '/', no trailing '/' (except "/"),
// no query/fragment, no dot segments, no whitespace/control characters.
func NormalizePath(raw string) (string, error) {
	p := strings.TrimSpace(raw)
	if p == "" {
		return "", &PathError{"กรุณากรอก path"}
	}
	if !strings.HasPrefix(p, "/") {
		return "", &PathError{"path ต้องขึ้นต้นด้วย /"}
	}
	if strings.ContainsAny(p, "?#") {
		return "", &PathError{"path ต้องไม่มี query (?) หรือ fragment (#)"}
	}
	dec, err := url.PathUnescape(p)
	if err != nil || !utf8.ValidString(dec) {
		return "", &PathError{"path มีการเข้ารหัส (%) ไม่ถูกต้อง"}
	}
	for _, r := range dec {
		if unicode.IsControl(r) || unicode.IsSpace(r) || r == '\\' || r == '?' || r == '#' {
			return "", &PathError{"path ต้องไม่มีช่องว่าง อักขระควบคุม \\ ? หรือ #"}
		}
	}
	dec = norm.NFC.String(dec)
	segs := strings.Split(dec, "/")
	out := make([]string, 0, len(segs))
	for _, s := range segs {
		if s == "" {
			continue
		}
		if s == "." || s == ".." {
			return "", &PathError{"path ต้องไม่มีส่วน . หรือ .."}
		}
		out = append(out, s)
	}
	res := "/" + strings.Join(out, "/")
	if len(res) > maxPathLen {
		return "", &PathError{"path ยาวเกินไป (สูงสุด 2000 ไบต์)"}
	}
	return res, nil
}

// LinkSuggestion is a live post proposed as an internal link target.
type LinkSuggestion struct {
	ID    string
	Title string
	Slug  string
}

// Paths returns the normalized public paths of the post: its slug and every
// legacy slug, deduplicated.
func (p PostRef) Paths() []string {
	out := []string{KnowledgePath(p.Slug)}
	for _, l := range p.LegacySlugs {
		if lp := KnowledgePath(l); !slices.Contains(out, lp) {
			out = append(out, lp)
		}
	}
	return out
}
