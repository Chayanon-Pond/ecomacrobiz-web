package handlers

import (
	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
)

// registerAuthRoutes: authentication, self-service account, users/invites,
// audit and settings. `admin` is the unauthenticated /api/v1/admin group
// (public token endpoints), `authed` requires a session + CSRF.
func (h *handler) registerAuthRoutes(admin, authed *gin.RouterGroup) {
	perm := middleware.RequirePerm
	anyAuth := middleware.AnyAuthenticated
	small := middleware.BodyLimit(smallBodyLimit)

	// Public: the token is the credential. Origin check + per-IP limit.
	tokens := admin.Group("/auth/tokens", small, middleware.RequireOrigin(h.Config.CORSAllowedOrigins),
		h.tokenRateLimit)
	tokens.POST("/inspect", h.inspectToken)
	tokens.POST("/accept", h.acceptToken)

	authed.POST("/auth/logout", anyAuth(), h.logout)
	authed.GET("/auth/me", anyAuth(), h.me)

	authed.PUT("/account/profile", anyAuth(), small, h.updateProfile)
	authed.PUT("/account/password", anyAuth(), h.passwordRateLimit, small, h.changePassword)
	authed.GET("/account/sessions", anyAuth(), h.listSessions)
	authed.DELETE("/account/sessions/others", anyAuth(), h.revokeOtherSessions)

	authed.GET("/users", perm(domain.PermUsersRead), h.listUsers)
	authed.PATCH("/users/:id", perm(domain.PermUsersManage), small, h.updateUser)
	authed.DELETE("/users/:id", perm(domain.PermUsersManage), h.deleteUser)
	authed.POST("/users/:id/reset-link", perm(domain.PermUsersManage), small, h.issueResetLink)

	authed.GET("/invites", perm(domain.PermUsersRead), h.listInvites)
	authed.POST("/invites", perm(domain.PermUsersManage), small, h.createInvite)
	authed.POST("/invites/:id/resend", perm(domain.PermUsersManage), small, h.resendInvite)
	authed.DELETE("/invites/:id", perm(domain.PermUsersManage), h.revokeInvite)

	authed.GET("/audit", perm(domain.PermAuditRead), h.listAudit)
	authed.GET("/settings/overview", perm(domain.PermSettingsManage), h.settingsOverview)
}
