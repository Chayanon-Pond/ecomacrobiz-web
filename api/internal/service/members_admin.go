package service

import (
	"context"
	"strings"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

type AdminMemberQuery struct {
	Q, Role       string
	Page, PerPage int
}

// AdminList: q containing "@" is an exact e-mail lookup (blind index),
// otherwise a display-name search.
func (s *MemberService) AdminList(ctx context.Context, q AdminMemberQuery) ([]repository.MemberAdminRow, domain.Page, int, error) {
	page := NormalizePage(q.Page, q.PerPage, 20, 100)
	f := repository.MemberFilter{Page: page}
	if role := strings.TrimSpace(q.Role); role != "" && role != "all" {
		if !domain.MemberRole(role).Valid() {
			return nil, page, 0, &domain.ValidationError{Message: domain.MsgValidationFailed,
				Fields: map[string]string{"role": "บทบาทไม่ถูกต้อง"}}
		}
		f.Role = role
	}
	if term := strings.TrimSpace(q.Q); strings.Contains(term, "@") {
		f.EmailIndex = s.crypto.Index.Email(term)
	} else if term != "" {
		f.Name = truncateRunes(term, 100)
	}
	rows, total, err := s.members.AdminList(ctx, f)
	if err != nil {
		return nil, page, 0, err
	}
	for i := range rows {
		s.openSoft(&rows[i].Member)
	}
	return rows, page, total, nil
}

type MemberPatch struct {
	Role         *string `json:"role"`
	BannedReason *string `json:"banned_reason"`
	HideComments *bool   `json:"hide_comments"`
}

func memberAudit(m domain.Member, extra map[string]any) map[string]any {
	md := map[string]any{"member_id": m.ID, "display_name": m.DisplayName}
	for k, v := range extra {
		md[k] = v
	}
	return md
}

// AdminUpdate changes a member's role (banning revokes all sessions) and/or
// hides all of their published comments.
func (s *MemberService) AdminUpdate(ctx context.Context, actor domain.Actor, id string, in MemberPatch) (repository.MemberAdminRow, error) {
	if !validID(id) {
		return repository.MemberAdminRow{}, domain.ErrNotFound
	}
	var v domain.Validator
	if in.Role == nil && in.BannedReason == nil && (in.HideComments == nil || !*in.HideComments) {
		v.Add("role", "กรุณาระบุสิ่งที่ต้องการเปลี่ยน")
	}
	var role domain.MemberRole
	if in.Role != nil {
		role = domain.MemberRole(strings.TrimSpace(*in.Role))
		if !role.Valid() {
			v.Add("role", "บทบาทต้องเป็น member, trusted, moderator หรือ banned")
		}
	}
	reason := ""
	if in.BannedReason != nil {
		reason = cleanLine(*in.BannedReason)
		if runeLen(reason) > 500 {
			v.Add("banned_reason", "เหตุผลต้องไม่เกิน 500 ตัวอักษร")
		}
	}
	if err := v.Err(); err != nil {
		return repository.MemberAdminRow{}, err
	}
	cur, err := s.members.GetByID(ctx, id)
	if err != nil {
		return repository.MemberAdminRow{}, err
	}
	if role == "" {
		role = cur.Role
	}
	if in.BannedReason == nil {
		reason = cur.BannedReason
	}
	if role != cur.Role || (role == domain.MemberRoleBanned && reason != cur.BannedReason) {
		before, after, err := s.members.SetRole(ctx, id, role, reason, s.Now().UTC())
		if err != nil {
			return repository.MemberAdminRow{}, err
		}
		ev := func(action string, md map[string]any) {
			s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: action, TargetType: domain.TargetMember,
				TargetID: id, Metadata: memberAudit(after, md)})
		}
		if before.Role != after.Role {
			ev(domain.AuditMemberRoleChange, map[string]any{"from": string(before.Role), "to": string(after.Role)})
		}
		switch {
		case after.Banned() && (!before.Banned() || before.BannedReason != after.BannedReason):
			ev(domain.AuditMemberBan, map[string]any{"reason": after.BannedReason})
		case before.Banned() && !after.Banned():
			ev(domain.AuditMemberUnban, nil)
		}
		s.log.Info("member role changed", "member_id", id, "from", before.Role, "to", after.Role, "actor", actor.ID)
	}
	if in.HideComments != nil && *in.HideComments {
		slugs, err := s.comments.HidePublishedBy(ctx, id, actor.ID, s.Now().UTC())
		if err != nil {
			return repository.MemberAdminRow{}, err
		}
		if tags := commentTags(slugs...); len(tags) > 0 {
			s.rv.Revalidate(tags...)
		}
		s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditMemberHideComments,
			TargetType: domain.TargetMember, TargetID: id, Metadata: memberAudit(cur, map[string]any{"posts": len(slugs)})})
	}
	row, err := s.members.AdminGet(ctx, id)
	if err != nil {
		return row, err
	}
	s.openSoft(&row.Member)
	return row, nil
}
