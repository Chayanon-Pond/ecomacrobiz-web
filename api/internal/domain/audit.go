package domain

import "time"

// Audit actions ("<area>.<verb>", lower snake). Keep in sync with the list in
// api/README.md and web/src/lib/admin/permissions.ts (AUDIT_ACTIONS).
const (
	AuditLoginSuccess   = "auth.login"
	AuditLoginFailed    = "auth.login_failed"
	AuditLogout         = "auth.logout"
	AuditPasswordChange = "auth.password_change" // own password (current pw verified)
	AuditPasswordReset  = "auth.password_reset"  // via owner-issued reset link
	AuditSessionsRevoke = "auth.sessions_revoke" // "sign out other sessions"
	AuditProfileUpdate  = "auth.profile_update"

	AuditUserInvite       = "user.invite"
	AuditUserInviteResend = "user.invite_resend"
	AuditUserInviteRevoke = "user.invite_revoke"
	AuditUserInviteAccept = "user.invite_accept"
	AuditUserRoleChange   = "user.role_change"
	AuditUserDeactivate   = "user.deactivate"
	AuditUserReactivate   = "user.reactivate"
	AuditUserResetIssue   = "user.reset_issue" // owner created a reset link
	AuditUserDelete       = "user.delete"

	AuditPostCreate    = "post.create"
	AuditPostUpdate    = "post.update"
	AuditPostPublish   = "post.publish"
	AuditPostUnpublish = "post.unpublish"
	AuditPostSchedule  = "post.schedule"
	AuditPostDelete    = "post.delete"

	AuditMediaUpload = "media.upload"
	AuditMediaUpdate = "media.update"
	AuditMediaDelete = "media.delete"

	AuditLeadStatus = "lead.status_change"
	AuditLeadNote   = "lead.note"
	AuditLeadAssign = "lead.assign"
	AuditLeadExport = "lead.export"
)

// Audit target types.
const (
	TargetUser   = "user"
	TargetInvite = "invite"
	TargetPost   = "post"
	TargetMedia  = "media"
	TargetLead   = "lead"
)

// Actor identifies who performed an action plus request context. A zero
// Actor (ID == "") means the system (e.g. the post scheduler).
type Actor struct {
	ID        string
	Email     string
	Name      string
	Role      Role
	IP        string
	UserAgent string
}

func (a Actor) IsSystem() bool { return a.ID == "" }

// AuditEvent is what services record. Metadata must never contain secrets
// (passwords, tokens, hashes) and only the minimum PII needed.
type AuditEvent struct {
	Actor      Actor
	Action     string
	TargetType string
	TargetID   string
	Metadata   map[string]any
}

// AuditEntry is a stored audit row.
type AuditEntry struct {
	ID         int64
	CreatedAt  time.Time
	ActorID    *string
	ActorEmail string
	ActorName  string // joined from admin_users when the user still exists
	Action     string
	TargetType string
	TargetID   string
	Metadata   map[string]any
	IP         string
	UserAgent  string
}
