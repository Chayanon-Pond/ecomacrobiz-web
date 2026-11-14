package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

// ---- users ----

func (h *handler) listUsers(c *gin.Context) {
	us, err := h.Users.List(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toAdminUsers(us))
}

func (h *handler) updateUser(c *gin.Context) {
	var in service.UserPatch
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	u, err := h.Users.Update(c.Request.Context(), middleware.ActorFrom(c), c.Param("id"), in)
	if err != nil {
		h.failIdentity(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toAdminUser(u))
}

func (h *handler) deleteUser(c *gin.Context) {
	if err := h.Users.Delete(c.Request.Context(), middleware.ActorFrom(c), c.Param("id")); err != nil {
		h.failIdentity(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) issueResetLink(c *gin.Context) {
	res, err := h.Users.IssueReset(c.Request.Context(), middleware.ActorFrom(c), c.Param("id"))
	if err != nil {
		h.failIdentity(c, err)
		return
	}
	respond.Data(c, http.StatusOK, resetLinkDTO{Token: res.Token, ExpiresAt: res.ExpiresAt.UTC(),
		EmailSent: res.EmailSent})
}

// ---- invites ----

func (h *handler) listInvites(c *gin.Context) {
	vs, err := h.Users.ListInvites(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	out := make([]inviteDTO, 0, len(vs))
	for _, v := range vs {
		out = append(out, toInvite(v))
	}
	respond.Data(c, http.StatusOK, out)
}

func (h *handler) createInvite(c *gin.Context) {
	var in service.InviteInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	res, err := h.Users.Invite(c.Request.Context(), middleware.ActorFrom(c), in)
	if err != nil {
		h.failIdentity(c, err)
		return
	}
	respond.Data(c, http.StatusCreated, inviteCreatedDTO{Invite: toInvite(res.Invite), Token: res.Token,
		EmailSent: res.EmailSent})
}

func (h *handler) resendInvite(c *gin.Context) {
	res, err := h.Users.ResendInvite(c.Request.Context(), middleware.ActorFrom(c), c.Param("id"))
	if err != nil {
		h.failIdentity(c, err)
		return
	}
	respond.Data(c, http.StatusOK, inviteCreatedDTO{Invite: toInvite(res.Invite), Token: res.Token,
		EmailSent: res.EmailSent})
}

func (h *handler) revokeInvite(c *gin.Context) {
	if err := h.Users.RevokeInvite(c.Request.Context(), middleware.ActorFrom(c), c.Param("id")); err != nil {
		h.failIdentity(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---- audit ----

func (h *handler) listAudit(c *gin.Context) {
	entries, page, total, err := h.Audit.List(c.Request.Context(), service.AuditQuery{
		ActorID: c.Query("actor_id"), Action: c.Query("action"), TargetType: c.Query("target_type"),
		TargetID: c.Query("target_id"), From: c.Query("from"), To: c.Query("to"),
		Page: queryInt(c, "page"), PerPage: queryInt(c, "per_page"),
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.List(c, toAudit(entries), respond.NewMeta(page, total))
}

// ---- settings ----

func (h *handler) settingsOverview(c *gin.Context) {
	cfg := h.Config
	email := emailOverviewDTO{}
	if p := cfg.EmailProvider(); p != "" {
		email = emailOverviewDTO{Configured: true, Provider: &p, Recipients: len(cfg.SMTPTo)}
	}
	respond.Data(c, http.StatusOK, settingsDTO{
		AppEnv:                   cfg.AppEnv,
		PublicBaseURL:            cfg.PublicBaseURL,
		WebBaseURL:               cfg.WebBaseURL,
		RevalidateWebhook:        cfg.WebRevalidateURL != "",
		Email:                    email,
		Line:                     lineOverviewDTO{Configured: cfg.LineEnabled()},
		SessionTTLHours:          cfg.SessionTTL.Hours(),
		InviteTTLHours:           cfg.InviteTTL.Hours(),
		MaxUploadMB:              cfg.MaxUploadBytes >> 20,
		SchedulerIntervalSeconds: cfg.SchedulerInterval.Seconds(),
		MigrateOnStart:           cfg.MigrateOnStart,
	})
}
