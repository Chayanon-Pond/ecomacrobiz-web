package service

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

// Indexer is implemented by notify.IndexNow: it submits changed site paths
// (or absolute URLs on the site's host) to search engines. Must not block.
type Indexer interface {
	Submit(urls ...string)
}

type nopIndexer struct{}

func (nopIndexer) Submit(...string) {}

// Thai messages of the redirect rules.
const (
	MsgRedirectChain    = "ปลายทางเป็น URL ที่ถูก redirect อยู่แล้ว (ห้ามทำ redirect ต่อกันเป็นทอด)"
	MsgRedirectSelf     = "ปลายทางต้องไม่ใช่ URL เดียวกับต้นทาง"
	MsgRedirectLivePost = "URL นี้เป็นบทความที่เผยแพร่อยู่ ไม่สามารถตั้ง redirect ทับได้"
	MsgRedirectCorePage = "ไม่สามารถตั้ง redirect จากหน้าหลักของเว็บไซต์ได้"
	MsgRedirectDup      = "มี redirect จาก URL นี้อยู่แล้ว"
	MsgRedirectTarget   = "ปลายทางต้องเป็น path ภายในเว็บ (ขึ้นต้นด้วย /) หรือ URL แบบเต็มที่ขึ้นต้นด้วย https://"
	MsgRedirectOwnPath  = "ปลายทางต้องไม่ใช่ URL ของบทความนี้เอง"
)

// corePaths are the static pages of the web app; they can never be the
// source of a redirect. reservedPrefixes are app-internal path spaces.
var (
	corePaths        = []string{"/", "/purpose", "/solutions", "/gallery", "/how-we-work", "/contact", "/privacy", "/knowledge"}
	reservedPrefixes = []string{"/admin", "/api", "/_next"}
)

type RedirectService struct {
	repo       repository.Redirects
	posts      repository.Posts
	revalidate Revalidator
	audit      Auditor
	log        *slog.Logger
	siteHost   string
	Now        func() time.Time
}

func NewRedirectService(repo repository.Redirects, posts repository.Posts, rv Revalidator, audit Auditor,
	log *slog.Logger) *RedirectService {
	return &RedirectService{repo: repo, posts: posts, revalidate: rv, audit: audit, log: log, Now: time.Now}
}

// SetSiteBaseURL (WEB_BASE_URL) lets absolute targets on the site's own host
// be stored as paths, so chain/loop checks also cover them.
func (s *RedirectService) SetSiteBaseURL(base string) {
	if u, err := url.Parse(base); err == nil {
		s.siteHost = strings.ToLower(u.Host)
	}
}

// RedirectInput is the admin create/update body.
type RedirectInput struct {
	From   string  `json:"from"`
	To     *string `json:"to"`
	Status int     `json:"status"`
	Note   string  `json:"note"`
}

func fieldErr(field, msg string) error {
	return &domain.ValidationError{Message: domain.MsgValidationFailed, Fields: map[string]string{field: msg}}
}

// NormalizeTarget validates a redirect target: a site path (normalized like
// a source path) or an absolute https URL. Absolute URLs on the site's own
// host become paths.
func (s *RedirectService) NormalizeTarget(raw string) (string, string) {
	t := strings.TrimSpace(raw)
	if t == "" {
		return "", "กรุณากรอกปลายทาง"
	}
	if strings.HasPrefix(t, "/") && !strings.HasPrefix(t, "//") {
		p, err := domain.NormalizePath(t)
		if err != nil {
			return "", err.Error()
		}
		return p, ""
	}
	u, err := url.Parse(t)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || len(t) > 2000 ||
		strings.ContainsAny(t, " \t\r\n\\") {
		return "", MsgRedirectTarget
	}
	if s.siteHost != "" && strings.EqualFold(u.Host, s.siteHost) {
		if u.RawQuery != "" || u.Fragment != "" {
			return "", "URL ภายในเว็บต้องไม่มี query (?) หรือ fragment (#)"
		}
		p := u.EscapedPath()
		if p == "" {
			p = "/"
		}
		np, err := domain.NormalizePath(p)
		if err != nil {
			return "", err.Error()
		}
		return np, ""
	}
	return t, ""
}

// liveIndex maps every live post path (slug and legacy) to its canonical path.
func (s *RedirectService) liveIndex(ctx context.Context) (map[string]string, error) {
	live, err := s.posts.LiveSlugs(ctx, s.Now())
	if err != nil {
		return nil, err
	}
	idx := map[string]string{}
	for _, p := range live {
		canon := domain.KnowledgePath(p.Slug)
		for _, path := range p.Paths() {
			if _, ok := idx[path]; !ok || path == canon {
				idx[path] = canon
			}
		}
	}
	return idx, nil
}

// resolveTarget applies the chain rules to a normalized target: a site path
// that is the source of a 301 (other than selfID) is rejected; a live legacy
// post URL is replaced by the post's canonical URL (its public redirect).
func (s *RedirectService) resolveTarget(ctx context.Context, to, selfID string, live map[string]string) (string, error) {
	if !strings.HasPrefix(to, "/") {
		return to, nil
	}
	if canon, ok := live[to]; ok {
		return canon, nil
	}
	cur, err := s.repo.GetByFrom(ctx, to)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return to, nil
	case err != nil:
		return "", err
	case cur.Status == 301 && cur.ID != selfID:
		return "", errChain
	}
	return to, nil
}

var errChain = errors.New("redirect chain")

func (s *RedirectService) validate(ctx context.Context, in RedirectInput, selfID string) (domain.Redirect, error) {
	var v domain.Validator
	d := domain.Redirect{Status: in.Status, Kind: domain.RedirectManual, Note: cleanText(in.Note)}
	from, err := domain.NormalizePath(in.From)
	if err != nil {
		v.Add("from", err.Error())
	} else if slices.Contains(corePaths, from) || hasReservedPrefix(from) {
		v.Add("from", MsgRedirectCorePage)
	}
	d.From = from
	if runeLen(d.Note) > 500 {
		v.Add("note", "หมายเหตุต้องไม่เกิน 500 ตัวอักษร")
	}
	var to string
	switch in.Status {
	case 301:
		if in.To == nil {
			v.Add("to", "กรุณากรอกปลายทาง")
			break
		}
		var msg string
		if to, msg = s.NormalizeTarget(*in.To); msg != "" {
			v.Add("to", msg)
		}
	case 410:
	default:
		v.Add("status", "สถานะต้องเป็น 301 หรือ 410")
	}
	if err := v.Err(); err != nil {
		return d, err
	}
	live, err := s.liveIndex(ctx)
	if err != nil {
		return d, err
	}
	if _, ok := live[from]; ok {
		return d, fieldErr("from", MsgRedirectLivePost)
	}
	if in.Status == 301 {
		if to, err = s.resolveTarget(ctx, to, selfID, live); err != nil {
			if errors.Is(err, errChain) {
				return d, fieldErr("to", MsgRedirectChain)
			}
			return d, err
		}
		if to == from {
			return d, fieldErr("to", MsgRedirectSelf)
		}
		d.To = &to
	}
	return d, nil
}

func hasReservedPrefix(p string) bool {
	for _, pre := range reservedPrefixes {
		if p == pre || strings.HasPrefix(p, pre+"/") {
			return true
		}
	}
	return false
}

func redirectMeta(d domain.Redirect, flattened int) map[string]any {
	m := map[string]any{"from": d.From, "status": d.Status, "flattened": flattened}
	if d.To != nil {
		m["to"] = *d.To
	}
	return m
}

func (s *RedirectService) List(ctx context.Context, f repository.RedirectFilter) ([]domain.Redirect, int, error) {
	var v domain.Validator
	if f.Kind == "all" {
		f.Kind = ""
	}
	if f.Kind != "" && f.Kind != domain.RedirectManual && f.Kind != domain.RedirectAuto {
		v.Add("kind", "kind ต้องเป็น manual หรือ auto")
	}
	if f.Status != 0 && f.Status != 301 && f.Status != 410 {
		v.Add("status", "สถานะต้องเป็น 301 หรือ 410")
	}
	if err := v.Err(); err != nil {
		return nil, 0, err
	}
	return s.repo.List(ctx, f)
}

func (s *RedirectService) Create(ctx context.Context, in RedirectInput, actor domain.Actor) (domain.Redirect, int, error) {
	d, err := s.validate(ctx, in, "")
	if err != nil {
		return d, 0, err
	}
	var by *string
	if !actor.IsSystem() {
		by = &actor.ID
	}
	n, err := s.repo.Create(ctx, &d, by)
	if errors.Is(err, domain.ErrConflict) {
		return d, 0, fieldErr("from", MsgRedirectDup)
	}
	if err != nil {
		return d, 0, err
	}
	s.log.Info("redirect created", "redirect_id", d.ID, "from", d.From, "status", d.Status, "flattened", n,
		"actor", actor.ID)
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditRedirectCreate,
		TargetType: domain.TargetRedirect, TargetID: d.ID, Metadata: redirectMeta(d, n)})
	s.revalidate.Revalidate("redirects")
	return d, n, nil
}

// Update replaces a row; an edited auto row becomes manual.
func (s *RedirectService) Update(ctx context.Context, id string, in RedirectInput, actor domain.Actor) (domain.Redirect, int, error) {
	if _, err := uuid.Parse(id); err != nil {
		return domain.Redirect{}, 0, domain.ErrNotFound
	}
	if _, err := s.repo.Get(ctx, id); err != nil {
		return domain.Redirect{}, 0, err
	}
	d, err := s.validate(ctx, in, id)
	if err != nil {
		return d, 0, err
	}
	d.ID = id
	n, err := s.repo.Update(ctx, &d)
	if errors.Is(err, domain.ErrConflict) {
		return d, 0, fieldErr("from", MsgRedirectDup)
	}
	if err != nil {
		return d, 0, err
	}
	s.log.Info("redirect updated", "redirect_id", d.ID, "from", d.From, "status", d.Status, "flattened", n,
		"actor", actor.ID)
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditRedirectUpdate,
		TargetType: domain.TargetRedirect, TargetID: d.ID, Metadata: redirectMeta(d, n)})
	s.revalidate.Revalidate("redirects")
	return d, n, nil
}

func (s *RedirectService) Delete(ctx context.Context, id string, actor domain.Actor) error {
	if _, err := uuid.Parse(id); err != nil {
		return domain.ErrNotFound
	}
	d, err := s.repo.Delete(ctx, id)
	if err != nil {
		return err
	}
	s.log.Info("redirect deleted", "redirect_id", id, "from", d.From, "actor", actor.ID)
	meta := redirectMeta(d, 0)
	delete(meta, "flattened")
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditRedirectDelete,
		TargetType: domain.TargetRedirect, TargetID: id, Metadata: meta})
	s.revalidate.Revalidate("redirects")
	return nil
}

// Public is the map the web uses for 301/410: every table row plus the
// legacy slugs of live posts (301 to the canonical post URL). A live post
// URL always wins over a table row. Sorted by From.
func (s *RedirectService) Public(ctx context.Context) ([]domain.PublicRedirect, error) {
	live, err := s.posts.LiveSlugs(ctx, s.Now())
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.All(ctx)
	if err != nil {
		return nil, err
	}
	livePaths := map[string]bool{}
	out := []domain.PublicRedirect{}
	for _, p := range live {
		canon := domain.KnowledgePath(p.Slug)
		livePaths[canon] = true
		for _, lp := range p.Paths() {
			if lp == canon || livePaths[lp] {
				continue
			}
			livePaths[lp] = true
			to := canon
			out = append(out, domain.PublicRedirect{From: lp, To: &to, Status: 301})
		}
	}
	for _, r := range rows {
		if livePaths[r.From] {
			continue
		}
		out = append(out, domain.PublicRedirect{From: r.From, To: r.To, Status: r.Status})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].From < out[j].From })
	return out, nil
}

// ---- automatic redirects for post changes ----

// livePlan: the post's URLs are live again, so redirect rows for them go.
func livePlan(ref domain.PostRef) *repository.RedirectPlan {
	return &repository.RedirectPlan{Remove: ref.Paths()}
}

// gonePlan: the post's URLs (slug + legacy) stop being live. Each becomes a
// 301 to target (validated: not a chain, not one of its own URLs) or, when
// target is nil/blank, a 410. Returns the normalized target ("" for 410).
// Validation errors use field "redirect_to".
func (s *RedirectService) gonePlan(ctx context.Context, ref domain.PostRef, target *string,
	actor domain.Actor) (*repository.RedirectPlan, string, error) {
	paths := ref.Paths()
	to := ""
	if target != nil && strings.TrimSpace(*target) != "" {
		var msg string
		if to, msg = s.NormalizeTarget(*target); msg != "" {
			return nil, "", fieldErr("redirect_to", msg)
		}
		if slices.Contains(paths, to) {
			return nil, "", fieldErr("redirect_to", MsgRedirectOwnPath)
		}
		live, err := s.liveIndex(ctx)
		if err != nil {
			return nil, "", err
		}
		// The post is still live while we validate: ignore its own entries.
		for _, p := range paths {
			delete(live, p)
		}
		if to, err = s.resolveTarget(ctx, to, "", live); err != nil {
			if errors.Is(err, errChain) {
				return nil, "", fieldErr("redirect_to", MsgRedirectChain)
			}
			return nil, "", err
		}
	}
	var by *string
	if !actor.IsSystem() {
		by = &actor.ID
	}
	plan := &repository.RedirectPlan{}
	for _, p := range paths {
		r := domain.Redirect{From: p, Status: 410, Kind: domain.RedirectAuto}
		if to != "" {
			t := to
			r.To, r.Status = &t, 301
		}
		plan.Set = append(plan.Set, repository.RedirectSet{Redirect: r, CreatedBy: by})
	}
	return plan, to, nil
}
