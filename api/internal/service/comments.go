package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/storage"
)

type CommentServiceConfig struct {
	HoldFirstComment bool
	RequireVerified  bool
	ImageMaxBytes    int64
}

// CommentService: public comment listing, member comment actions, member
// moderators and the admin moderation API.
type CommentService struct {
	comments   repository.Comments
	posts      repository.Posts
	members    repository.Members
	engagement repository.Engagement
	store      storage.MediaStore
	rv         Revalidator
	audit      Auditor
	cfg        CommentServiceConfig
	log        *slog.Logger
	Now        func() time.Time
}

func NewCommentService(comments repository.Comments, posts repository.Posts, members repository.Members,
	engagement repository.Engagement, store storage.MediaStore, rv Revalidator, audit Auditor,
	cfg CommentServiceConfig, log *slog.Logger) *CommentService {
	if audit == nil {
		audit = NopAuditor{}
	}
	if cfg.ImageMaxBytes <= 0 {
		cfg.ImageMaxBytes = 5 << 20
	}
	return &CommentService{comments: comments, posts: posts, members: members, engagement: engagement, store: store,
		rv: rv, audit: audit, cfg: cfg, log: log, Now: time.Now}
}

func (s *CommentService) ImageMaxBytes() int64 { return s.cfg.ImageMaxBytes }

// ImageURL is the public URL of a stored comment image / avatar key.
func (s *CommentService) ImageURL(key string) string {
	if key == "" {
		return ""
	}
	return s.store.URL(key)
}

// Viewer returns the visibility context of an (optional) member.
func Viewer(m *domain.Member) repository.CommentViewer {
	if m == nil {
		return repository.CommentViewer{}
	}
	return repository.CommentViewer{MemberID: m.ID, Moderator: m.Role == domain.MemberRoleModerator}
}

// canWrite is the gate for comments, likes, reports and uploads.
func (s *CommentService) canWrite(m domain.Member) error {
	if m.Banned() {
		return domain.ErrMemberBanned
	}
	if s.cfg.RequireVerified && !m.EmailVerified() {
		return domain.ErrEmailUnverified
	}
	return nil
}

func (s *CommentService) post(ctx context.Context, slug string) (domain.Post, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" || len(slug) > 200 {
		return domain.Post{}, domain.ErrNotFound
	}
	return s.posts.GetPublishedBySlug(ctx, slug, s.Now())
}

func validID(id string) bool {
	_, err := uuid.Parse(id)
	return err == nil
}

// CommentsPage is one page of top-level comments.
type CommentsPage struct {
	Comments     []domain.Comment
	Page         domain.Page
	Total        int
	CommentCount int
	PostSlug     string
}

type CommentQuery struct {
	Sort           string
	Page, PerPage  int
	RepliesPreview int
}

func (s *CommentService) List(ctx context.Context, slug string, viewer *domain.Member, q CommentQuery) (CommentsPage, error) {
	p, err := s.post(ctx, slug)
	if err != nil {
		return CommentsPage{}, err
	}
	sort := q.Sort
	if sort != "top" {
		sort = "newest"
	}
	preview := q.RepliesPreview
	if preview < 0 {
		preview = 0
	}
	if preview > 10 {
		preview = 10
	}
	page := NormalizePage(q.Page, q.PerPage, 10, 50)
	list, total, err := s.comments.ListTop(ctx, repository.CommentListFilter{Page: page, PostID: p.ID,
		Viewer: Viewer(viewer), Sort: sort, RepliesPreview: preview})
	if err != nil {
		return CommentsPage{}, err
	}
	st, _, err := s.engagement.PostStats(ctx, p.ID, "")
	if err != nil {
		return CommentsPage{}, err
	}
	return CommentsPage{Comments: list, Page: page, Total: total, CommentCount: st.Comments, PostSlug: p.Slug}, nil
}

// Replies lists the visible replies of a top-level comment, oldest first.
func (s *CommentService) Replies(ctx context.Context, id string, viewer *domain.Member, pageNo, perPage int) ([]domain.Comment, domain.Page, int, error) {
	page := NormalizePage(pageNo, perPage, 20, 50)
	if !validID(id) {
		return nil, page, 0, domain.ErrNotFound
	}
	v := Viewer(viewer)
	parent, err := s.comments.Get(ctx, id, v)
	if err != nil {
		return nil, page, 0, err
	}
	if !parent.IsTopLevel() || !s.livePost(ctx, parent.PostSlug) {
		return nil, page, 0, domain.ErrNotFound
	}
	list, total, err := s.comments.ListReplies(ctx, id, v, page)
	return list, page, total, err
}

func (s *CommentService) livePost(ctx context.Context, slug string) bool {
	_, err := s.post(ctx, slug)
	return err == nil
}

// visibleTo mirrors the repository visibility rule for a single comment.
func visibleTo(c domain.Comment, v repository.CommentViewer) bool {
	switch c.Status {
	case domain.CommentPublished:
		return true
	case domain.CommentPending:
		return v.Moderator || (c.MemberID != nil && *c.MemberID == v.MemberID)
	case domain.CommentHidden:
		return v.Moderator
	}
	return false
}

type CreateCommentInput struct {
	Body      string  `json:"body"`
	ParentID  *string `json:"parent_id"`
	ReplyToID *string `json:"reply_to_id"`
	ImageID   *string `json:"image_id"`
	Website   string  `json:"website"`
	ElapsedMS int64   `json:"elapsed_ms"`
}

func bodyErr(msg string) error {
	return &domain.ValidationError{Message: msg, Fields: map[string]string{"body": msg}}
}

const (
	minElapsedMS = 2500
	duplicateWin = 24 * time.Hour
)

// checkBody applies the length/link rules; empty is allowed when allowEmpty.
func checkBody(body string, allowEmpty bool) error {
	n := runeLen(body)
	switch {
	case n == 0 && !allowEmpty:
		return bodyErr("กรุณาพิมพ์ความคิดเห็น")
	case n > domain.CommentMaxRunes:
		return bodyErr(fmt.Sprintf("ความคิดเห็นต้องไม่เกิน %d ตัวอักษร", domain.CommentMaxRunes))
	case CountLinks(body) > 2:
		return bodyErr("ใส่ลิงก์ได้ไม่เกิน 2 ลิงก์")
	}
	return nil
}

func strPtr(s string) *string { return &s }

// Create posts a comment or reply (rules: CONTRACT §5). A filled honeypot
// returns a fake pending comment and stores nothing.
func (s *CommentService) Create(ctx context.Context, m domain.Member, slug string, in CreateCommentInput) (domain.Comment, error) {
	if err := s.canWrite(m); err != nil {
		return domain.Comment{}, err
	}
	p, err := s.post(ctx, slug)
	if err != nil {
		return domain.Comment{}, err
	}
	body := NormalizeCommentBody(in.Body)
	now := s.Now().UTC()
	if strings.TrimSpace(in.Website) != "" {
		s.log.Info("comment honeypot hit", "member_id", m.ID)
		mid := m.ID
		return domain.Comment{ID: uuid.NewString(), PostID: p.ID, PostSlug: p.Slug, MemberID: &mid,
			Author: &domain.MemberRef{ID: m.ID, DisplayName: m.DisplayName, AvatarKey: m.AvatarKey, Role: m.Role},
			Body:   body, Status: domain.CommentPending, CreatedAt: now, UpdatedAt: now}, nil
	}
	if in.ElapsedMS < minElapsedMS {
		return domain.Comment{}, bodyErr("ส่งเร็วเกินไป กรุณาลองใหม่อีกครั้ง")
	}
	imageID := ""
	if in.ImageID != nil && strings.TrimSpace(*in.ImageID) != "" {
		imageID = strings.TrimSpace(*in.ImageID)
		if !validID(imageID) {
			return domain.Comment{}, imageErr()
		}
	}
	if err := checkBody(body, imageID != ""); err != nil {
		return domain.Comment{}, err
	}
	c := domain.Comment{PostID: p.ID, PostSlug: p.Slug, MemberID: &m.ID, Body: body, CreatedAt: now}
	if err := s.resolveThread(ctx, m, p, in, &c); err != nil {
		return domain.Comment{}, err
	}
	hash := CommentContentHash(body)
	c.ContentHash = hash
	if body != "" {
		dup, err := s.comments.HasRecentDuplicate(ctx, m.ID, hash, now.Add(-duplicateWin), "")
		if err != nil {
			return domain.Comment{}, err
		}
		if dup {
			return domain.Comment{}, domain.ErrDuplicateComment
		}
	}
	hasPublished := true
	if !m.Role.PublishesDirectly() && s.cfg.HoldFirstComment {
		if hasPublished, err = s.members.HasPublishedComment(ctx, m.ID); err != nil {
			return domain.Comment{}, err
		}
	}
	c.Status = InitialCommentStatus(m.Role, s.cfg.HoldFirstComment, hasPublished, m.EmailVerified(), now.Sub(m.CreatedAt))
	if err := s.comments.Create(ctx, &c, imageID); err != nil {
		if errors.Is(err, repository.ErrImageUnavailable) {
			return domain.Comment{}, imageErr()
		}
		return domain.Comment{}, err
	}
	s.log.Info("comment created", "comment_id", c.ID, "member_id", m.ID, "status", c.Status)
	if c.Status == domain.CommentPublished {
		s.rv.Revalidate(commentTags(p.Slug)...)
	}
	return s.comments.Get(ctx, c.ID, Viewer(&m))
}

func imageErr() error {
	return &domain.ValidationError{Message: domain.MsgValidationFailed,
		Fields: map[string]string{"image_id": "ไม่พบรูปภาพ กรุณาอัปโหลดใหม่"}}
}

// resolveThread sets ParentID (always top-level) and ReplyToID.
func (s *CommentService) resolveThread(ctx context.Context, m domain.Member, p domain.Post, in CreateCommentInput, c *domain.Comment) error {
	parentRaw := ""
	if in.ParentID != nil {
		parentRaw = strings.TrimSpace(*in.ParentID)
	}
	replyRaw := ""
	if in.ReplyToID != nil {
		replyRaw = strings.TrimSpace(*in.ReplyToID)
	}
	if parentRaw == "" {
		if replyRaw != "" {
			return threadErr("reply_to_id")
		}
		return nil
	}
	v := Viewer(&m)
	if !validID(parentRaw) {
		return threadErr("parent_id")
	}
	parent, err := s.comments.Get(ctx, parentRaw, v)
	if err != nil || parent.PostID != p.ID || !visibleTo(parent, v) {
		return threadErr("parent_id")
	}
	root := parent.ID
	if parent.ParentID != nil {
		root = *parent.ParentID
		if replyRaw == "" {
			replyRaw = parent.ID
		}
	}
	c.ParentID = strPtr(root)
	if replyRaw != "" {
		if !validID(replyRaw) {
			return threadErr("reply_to_id")
		}
		rt, err := s.comments.Get(ctx, replyRaw, v)
		if err != nil || !(rt.ID == root || (rt.ParentID != nil && *rt.ParentID == root)) {
			return threadErr("reply_to_id")
		}
		c.ReplyToID = strPtr(rt.ID)
	}
	return nil
}

func threadErr(field string) error {
	return &domain.ValidationError{Message: domain.MsgValidationFailed,
		Fields: map[string]string{field: "ไม่พบความคิดเห็นที่ต้องการตอบกลับ"}}
}

// own loads a comment the member wrote (ErrNotFound otherwise).
func (s *CommentService) load(ctx context.Context, m *domain.Member, id string) (domain.Comment, error) {
	if !validID(id) {
		return domain.Comment{}, domain.ErrNotFound
	}
	return s.comments.Get(ctx, id, Viewer(m))
}

func isAuthor(c domain.Comment, m domain.Member) bool {
	return c.MemberID != nil && *c.MemberID == m.ID
}

// Edit changes the body of the member's own published or pending comment.
func (s *CommentService) Edit(ctx context.Context, m domain.Member, id, rawBody string) (domain.Comment, error) {
	if m.Banned() {
		return domain.Comment{}, domain.ErrMemberBanned
	}
	c, err := s.load(ctx, &m, id)
	if err != nil {
		return c, err
	}
	if !isAuthor(c, m) || (c.Status != domain.CommentPublished && c.Status != domain.CommentPending) {
		return domain.Comment{}, domain.ErrNotFound
	}
	body := NormalizeCommentBody(rawBody)
	if err := checkBody(body, c.Image != nil); err != nil {
		return domain.Comment{}, err
	}
	if body == c.Body {
		return c, nil
	}
	hash := CommentContentHash(body)
	if body != "" {
		dup, err := s.comments.HasRecentDuplicate(ctx, m.ID, hash, s.Now().UTC().Add(-duplicateWin), c.ID)
		if err != nil {
			return domain.Comment{}, err
		}
		if dup {
			return domain.Comment{}, domain.ErrDuplicateComment
		}
	}
	if err := s.comments.Edit(ctx, c.ID, body, hash, s.Now().UTC()); err != nil {
		return domain.Comment{}, err
	}
	if c.Status == domain.CommentPublished {
		s.rv.Revalidate(commentTags(c.PostSlug)...)
	}
	return s.comments.Get(ctx, c.ID, Viewer(&m))
}

func (s *CommentService) afterStatus(ch repository.StatusChange) {
	if ch.ImageKey != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		if err := s.store.Delete(ctx, ch.ImageKey); err != nil {
			s.log.Error("delete comment image", "key", ch.ImageKey, "err", err)
		}
		cancel()
	}
	// Any status change touches public output (count, placeholder or text).
	if ch.From != ch.To && (ch.From == domain.CommentPublished || ch.To == domain.CommentPublished ||
		ch.To == domain.CommentDeleted) {
		s.rv.Revalidate(commentTags(ch.PostSlug)...)
	}
}

// Delete soft-deletes a comment (author or member moderator).
func (s *CommentService) Delete(ctx context.Context, m domain.Member, id string) error {
	if m.Banned() {
		return domain.ErrMemberBanned
	}
	c, err := s.load(ctx, &m, id)
	if err != nil {
		return err
	}
	mod := m.Role == domain.MemberRoleModerator
	if c.Status == domain.CommentDeleted || !(isAuthor(c, m) || mod) || !visibleTo(c, Viewer(&m)) {
		return domain.ErrNotFound
	}
	by := repository.CommentModerator{}
	if !isAuthor(c, m) {
		by.MemberID = m.ID
	}
	ch, err := s.comments.SetStatus(ctx, c.ID, domain.CommentDeleted, by, s.Now().UTC())
	if err != nil {
		return err
	}
	s.afterStatus(ch)
	s.log.Info("comment deleted", "comment_id", c.ID, "member_id", m.ID, "moderator", by.MemberID != "")
	return nil
}

// Moderate: member moderators approve or hide.
func (s *CommentService) Moderate(ctx context.Context, m domain.Member, id, action string) (domain.Comment, error) {
	if m.Banned() {
		return domain.Comment{}, domain.ErrMemberBanned
	}
	if m.Role != domain.MemberRoleModerator {
		return domain.Comment{}, domain.ErrForbidden
	}
	var to domain.CommentStatus
	switch action {
	case "approve":
		to = domain.CommentPublished
	case "hide":
		to = domain.CommentHidden
	default:
		return domain.Comment{}, &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"action": "action ต้องเป็น approve หรือ hide"}}
	}
	c, err := s.load(ctx, &m, id)
	if err != nil {
		return c, err
	}
	if c.Status == domain.CommentDeleted {
		return domain.Comment{}, domain.ErrNotFound
	}
	ch, err := s.comments.SetStatus(ctx, c.ID, to, repository.CommentModerator{MemberID: m.ID}, s.Now().UTC())
	if err != nil {
		return domain.Comment{}, err
	}
	s.afterStatus(ch)
	return s.comments.Get(ctx, c.ID, Viewer(&m))
}

// Like toggles the member's like on a published comment.
func (s *CommentService) Like(ctx context.Context, m domain.Member, id string, like bool) (bool, int, error) {
	if err := s.canWrite(m); err != nil {
		return false, 0, err
	}
	if !validID(id) {
		return false, 0, domain.ErrNotFound
	}
	return s.comments.Like(ctx, id, m.ID, like, s.Now().UTC())
}

type ReportInput struct {
	Reason string `json:"reason"`
	Note   string `json:"note"`
}

// Report records (or updates) the member's report on someone else's
// published comment.
func (s *CommentService) Report(ctx context.Context, m domain.Member, id string, in ReportInput) error {
	if err := s.canWrite(m); err != nil {
		return err
	}
	var v domain.Validator
	reason := strings.TrimSpace(in.Reason)
	ok := false
	for _, r := range domain.ReportReasons {
		ok = ok || r == reason
	}
	if !ok {
		v.Add("reason", "กรุณาเลือกเหตุผลในการรายงาน")
	}
	note := cleanText(in.Note)
	if runeLen(note) > 500 {
		v.Add("note", "รายละเอียดต้องไม่เกิน 500 ตัวอักษร")
	}
	if err := v.Err(); err != nil {
		return err
	}
	c, err := s.load(ctx, &m, id)
	if err != nil {
		return err
	}
	if c.Status != domain.CommentPublished {
		return domain.ErrNotFound
	}
	if isAuthor(c, m) {
		return &domain.ValidationError{Message: "ไม่สามารถรายงานความคิดเห็นของตัวเองได้"}
	}
	held, slug, err := s.comments.Report(ctx, domain.CommentReport{CommentID: c.ID, MemberID: m.ID, Reason: reason,
		Note: note, CreatedAt: s.Now().UTC()}, domain.CommentReportThreshold)
	if err != nil {
		return err
	}
	if held {
		s.log.Info("comment held after reports", "comment_id", c.ID)
		s.rv.Revalidate(commentTags(slug)...)
	}
	return nil
}

// UploadImage processes and stores a comment image (unattached until a
// comment uses it; purged after 24 h otherwise).
func (s *CommentService) UploadImage(ctx context.Context, m domain.Member, data []byte) (domain.CommentImage, error) {
	if err := s.canWrite(m); err != nil {
		return domain.CommentImage{}, err
	}
	if int64(len(data)) > s.cfg.ImageMaxBytes {
		return domain.CommentImage{}, domain.ErrTooLarge
	}
	out, ext, err := ProcessCommentImage(data)
	if err != nil {
		return domain.CommentImage{}, err
	}
	ct := "image/jpeg"
	if ext == "png" {
		ct = "image/png"
	}
	var key string
	for attempt := 0; ; attempt++ {
		key = communityKey("c", ext)
		err := s.store.Put(ctx, key, bytes.NewReader(out.Data), ct)
		if errors.Is(err, storage.ErrKeyExists) && attempt < 4 {
			continue
		}
		if err != nil {
			return domain.CommentImage{}, fmt.Errorf("store comment image: %w", err)
		}
		break
	}
	img := domain.CommentImage{MemberID: m.ID, StorageKey: key, Width: out.Width, Height: out.Height,
		SizeBytes: int64(len(out.Data)), CreatedAt: s.Now().UTC()}
	if err := s.comments.CreateImage(ctx, &img); err != nil {
		if derr := s.store.Delete(context.WithoutCancel(ctx), key); derr != nil {
			s.log.Error("orphan comment image", "key", key, "err", derr)
		}
		return domain.CommentImage{}, err
	}
	return img, nil
}

// ---- admin moderation ----

type AdminCommentQuery struct {
	Status, Q, Post, MemberID string
	Page, PerPage             int
}

var adminCommentStatuses = []string{"", "all", "pending", "published", "hidden", "deleted", "reported"}

func (s *CommentService) AdminList(ctx context.Context, q AdminCommentQuery) ([]domain.Comment, domain.Page, int, repository.AdminCommentCounts, error) {
	page := NormalizePage(q.Page, q.PerPage, 20, 100)
	var v domain.Validator
	st := strings.TrimSpace(q.Status)
	ok := false
	for _, a := range adminCommentStatuses {
		ok = ok || a == st
	}
	if !ok {
		v.Add("status", "สถานะไม่ถูกต้อง")
	}
	mid := strings.TrimSpace(q.MemberID)
	if mid != "" && !validID(mid) {
		v.Add("member_id", "รหัสสมาชิกไม่ถูกต้อง")
	}
	if err := v.Err(); err != nil {
		return nil, page, 0, repository.AdminCommentCounts{}, err
	}
	list, total, counts, err := s.comments.AdminList(ctx, repository.AdminCommentFilter{Page: page, Status: st,
		Query: truncateRunes(strings.TrimSpace(q.Q), 200), PostSlug: strings.TrimSpace(q.Post), MemberID: mid})
	return list, page, total, counts, err
}

func (s *CommentService) adminGet(ctx context.Context, id string) (domain.Comment, error) {
	if !validID(id) {
		return domain.Comment{}, domain.ErrNotFound
	}
	return s.comments.Get(ctx, id, repository.CommentViewer{Moderator: true})
}

// AdminSetStatus: published (approve) or hidden (hide).
func (s *CommentService) AdminSetStatus(ctx context.Context, actor domain.Actor, id, status string) (domain.Comment, error) {
	to := domain.CommentStatus(strings.TrimSpace(status))
	if to != domain.CommentPublished && to != domain.CommentHidden {
		return domain.Comment{}, &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"status": "สถานะต้องเป็น published หรือ hidden"}}
	}
	c, err := s.adminGet(ctx, id)
	if err != nil {
		return c, err
	}
	if c.Status == domain.CommentDeleted {
		return domain.Comment{}, &domain.ValidationError{Message: "ความคิดเห็นนี้ถูกลบแล้ว"}
	}
	ch, err := s.comments.SetStatus(ctx, c.ID, to, repository.CommentModerator{AdminID: actor.ID}, s.Now().UTC())
	if err != nil {
		return domain.Comment{}, err
	}
	s.afterStatus(ch)
	action := domain.AuditCommentApprove
	if to == domain.CommentHidden {
		action = domain.AuditCommentHide
	}
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: action, TargetType: domain.TargetComment,
		TargetID: c.ID, Metadata: commentAuditMeta(c, ch)})
	return s.adminGet(ctx, c.ID)
}

func commentAuditMeta(c domain.Comment, ch repository.StatusChange) map[string]any {
	md := map[string]any{"post": ch.PostSlug, "from": string(ch.From), "to": string(ch.To)}
	if c.Author != nil {
		md["member_id"], md["display_name"] = c.Author.ID, c.Author.DisplayName
	}
	return md
}

func (s *CommentService) AdminDelete(ctx context.Context, actor domain.Actor, id string) error {
	c, err := s.adminGet(ctx, id)
	if err != nil {
		return err
	}
	if c.Status == domain.CommentDeleted {
		return nil
	}
	ch, err := s.comments.SetStatus(ctx, c.ID, domain.CommentDeleted, repository.CommentModerator{AdminID: actor.ID},
		s.Now().UTC())
	if err != nil {
		return err
	}
	s.afterStatus(ch)
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditCommentDelete, TargetType: domain.TargetComment,
		TargetID: c.ID, Metadata: commentAuditMeta(c, ch)})
	return nil
}

type BulkCommentInput struct {
	Action string   `json:"action"`
	IDs    []string `json:"ids"`
}

func (s *CommentService) AdminBulk(ctx context.Context, actor domain.Actor, in BulkCommentInput) (BulkResult, error) {
	var v domain.Validator
	if in.Action != "approve" && in.Action != "hide" && in.Action != "delete" {
		v.Add("action", "action ต้องเป็น approve, hide หรือ delete")
	}
	if len(in.IDs) == 0 || len(in.IDs) > 100 {
		v.Add("ids", "กรุณาเลือก 1-100 รายการ")
	}
	if err := v.Err(); err != nil {
		return BulkResult{}, err
	}
	succeeded := []string{}
	failed := []BulkFailure{}
	seen := map[string]bool{}
	for _, id := range in.IDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		var err error
		switch in.Action {
		case "approve":
			_, err = s.AdminSetStatus(ctx, actor, id, string(domain.CommentPublished))
		case "hide":
			_, err = s.AdminSetStatus(ctx, actor, id, string(domain.CommentHidden))
		default:
			err = s.AdminDelete(ctx, actor, id)
		}
		if err == nil {
			succeeded = append(succeeded, id)
			continue
		}
		var ve *domain.ValidationError
		switch {
		case errors.Is(err, domain.ErrNotFound):
			failed = append(failed, BulkFailure{ID: id, Message: "ไม่พบความคิดเห็น"})
		case errors.As(err, &ve):
			failed = append(failed, BulkFailure{ID: id, Message: ve.Message})
		default:
			return BulkResult{}, err
		}
	}
	return BulkResult{Succeeded: succeeded, Failed: failed}, nil
}

func (s *CommentService) History(ctx context.Context, id string) ([]domain.CommentEdit, error) {
	if _, err := s.adminGet(ctx, id); err != nil {
		return nil, err
	}
	return s.comments.History(ctx, id)
}
