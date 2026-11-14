package handlers

import (
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

// adminUserDTO is the contract's UserDTO.
type adminUserDTO struct {
	ID          string     `json:"id"`
	Email       string     `json:"email"`
	Name        string     `json:"name"`
	Role        string     `json:"role"`
	IsActive    bool       `json:"is_active"`
	LastLoginAt *time.Time `json:"last_login_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

func utcPtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

func toAdminUser(u domain.AdminUser) adminUserDTO {
	return adminUserDTO{ID: u.ID, Email: u.Email, Name: u.Name, Role: string(u.Role), IsActive: u.IsActive,
		LastLoginAt: utcPtr(u.LastLoginAt), CreatedAt: u.CreatedAt.UTC()}
}

func toAdminUsers(us []domain.AdminUser) []adminUserDTO {
	out := make([]adminUserDTO, 0, len(us))
	for _, u := range us {
		out = append(out, toAdminUser(u))
	}
	return out
}

// meDTO: login, /auth/me and token accept.
type meDTO struct {
	User        adminUserDTO `json:"user"`
	Permissions []string     `json:"permissions"`
	CSRFToken   string       `json:"csrf_token"`
}

func toMe(u domain.AdminUser, csrf string) meDTO {
	perms := make([]string, 0, len(domain.AllPermissions))
	for _, p := range domain.AllPermissions { // stable order
		if u.Role.Has(p) {
			perms = append(perms, string(p))
		}
	}
	return meDTO{User: toAdminUser(u), Permissions: perms, CSRFToken: csrf}
}

type inviteDTO struct {
	ID        string      `json:"id"`
	Email     string      `json:"email"`
	Role      string      `json:"role"`
	CreatedAt time.Time   `json:"created_at"`
	ExpiresAt time.Time   `json:"expires_at"`
	Expired   bool        `json:"expired"`
	InvitedBy *userRefDTO `json:"invited_by"`
}

func toInvite(v service.InviteView) inviteDTO {
	d := inviteDTO{ID: v.ID, Email: v.Email, CreatedAt: v.CreatedAt.UTC(), ExpiresAt: v.ExpiresAt.UTC(),
		Expired: v.Expired, InvitedBy: toUserRef(v.CreatedBy)}
	if v.Role != nil {
		d.Role = string(*v.Role)
	}
	return d
}

type inviteCreatedDTO struct {
	Invite    inviteDTO `json:"invite"`
	Token     string    `json:"token"`
	EmailSent bool      `json:"email_sent"`
}

type resetLinkDTO struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	EmailSent bool      `json:"email_sent"`
}

type tokenInfoDTO struct {
	Purpose   string    `json:"purpose"`
	Email     string    `json:"email"`
	Role      *string   `json:"role"`
	Name      string    `json:"name"`
	ExpiresAt time.Time `json:"expires_at"`
}

type sessionDTO struct {
	ID         string     `json:"id"`
	IP         string     `json:"ip"`
	UserAgent  string     `json:"user_agent"`
	CreatedAt  time.Time  `json:"created_at"`
	LastSeenAt *time.Time `json:"last_seen_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	Current    bool       `json:"current"`
}

type auditActorDTO struct {
	ID    *string `json:"id"`
	Email string  `json:"email"`
	Name  string  `json:"name"`
}

type auditDTO struct {
	ID         int64          `json:"id"`
	CreatedAt  time.Time      `json:"created_at"`
	Actor      auditActorDTO  `json:"actor"`
	Action     string         `json:"action"`
	TargetType string         `json:"target_type"`
	TargetID   string         `json:"target_id"`
	Metadata   map[string]any `json:"metadata"`
	IP         string         `json:"ip"`
	UserAgent  string         `json:"user_agent"`
}

func toAudit(es []domain.AuditEntry) []auditDTO {
	out := make([]auditDTO, 0, len(es))
	for _, e := range es {
		meta := e.Metadata
		if meta == nil {
			meta = map[string]any{}
		}
		out = append(out, auditDTO{ID: e.ID, CreatedAt: e.CreatedAt.UTC(),
			Actor:  auditActorDTO{ID: e.ActorID, Email: e.ActorEmail, Name: e.ActorName},
			Action: e.Action, TargetType: e.TargetType, TargetID: e.TargetID, Metadata: meta, IP: e.IP,
			UserAgent: e.UserAgent})
	}
	return out
}

type emailOverviewDTO struct {
	Configured bool    `json:"configured"`
	Provider   *string `json:"provider"`
	Recipients int     `json:"recipients"`
}

type lineOverviewDTO struct {
	Configured bool `json:"configured"`
}

// settingsDTO: GET /settings/overview. Never secrets or recipient addresses.
type settingsDTO struct {
	AppEnv                   string           `json:"app_env"`
	PublicBaseURL            string           `json:"public_base_url"`
	WebBaseURL               string           `json:"web_base_url"`
	RevalidateWebhook        bool             `json:"revalidate_webhook"`
	Email                    emailOverviewDTO `json:"email"`
	Line                     lineOverviewDTO  `json:"line"`
	SessionTTLHours          float64          `json:"session_ttl_hours"`
	InviteTTLHours           float64          `json:"invite_ttl_hours"`
	MaxUploadMB              int64            `json:"max_upload_mb"`
	SchedulerIntervalSeconds float64          `json:"scheduler_interval_seconds"`
	MigrateOnStart           bool             `json:"migrate_on_start"`
}
