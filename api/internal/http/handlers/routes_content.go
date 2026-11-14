package handlers

import (
	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
)

// registerContentRoutes: dashboard, posts, media and leads. Static segments
// (/posts/slug-check, /posts/bulk, /leads/board, ...) coexist with the :id
// siblings (Gin prefers the static match; covered by TestContentRouting).
func (h *handler) registerContentRoutes(authed *gin.RouterGroup) {
	perm := middleware.RequirePerm
	small := middleware.BodyLimit(smallBodyLimit)

	authed.GET("/dashboard", middleware.RequireAnyPerm(domain.PermPostsRead, domain.PermLeadsRead), h.dashboard)

	authed.GET("/categories", perm(domain.PermPostsRead), h.listCategories)
	authed.GET("/posts", perm(domain.PermPostsRead), h.adminListPosts)
	authed.GET("/posts/slug-check", perm(domain.PermPostsRead), h.adminSlugCheck)
	authed.GET("/posts/:id", perm(domain.PermPostsRead), h.adminGetPost)
	authed.POST("/posts", perm(domain.PermPostsWrite), middleware.BodyLimit(postBodyLimit), h.adminCreatePost)
	authed.POST("/posts/bulk", perm(domain.PermPostsPublish), small, h.adminBulkPosts)
	authed.PUT("/posts/:id", perm(domain.PermPostsWrite), middleware.BodyLimit(postBodyLimit), h.adminUpdatePost)
	authed.DELETE("/posts/:id", perm(domain.PermPostsWrite), h.adminDeletePost)

	authed.GET("/media", perm(domain.PermMediaRead), h.listMedia)
	authed.GET("/media/:id", perm(domain.PermMediaRead), h.getMedia)
	authed.POST("/media", perm(domain.PermMediaWrite), middleware.BodyLimit(h.Media.MaxBytes()+(1<<20)), h.uploadMedia)
	authed.PATCH("/media/:id", perm(domain.PermMediaWrite), small, h.updateMedia)
	authed.DELETE("/media/:id", perm(domain.PermMediaWrite), h.deleteMedia)

	authed.GET("/leads", perm(domain.PermLeadsRead), h.listLeads)
	authed.GET("/leads/board", perm(domain.PermLeadsRead), h.leadBoard)
	authed.GET("/leads/assignees", perm(domain.PermLeadsRead), h.leadAssignees)
	authed.GET("/leads/export.csv", perm(domain.PermLeadsExport), h.exportLeads)
	authed.GET("/leads/:id", perm(domain.PermLeadsRead), h.getLead)
	authed.PATCH("/leads/:id", perm(domain.PermLeadsWrite), small, h.updateLead)
	authed.GET("/leads/:id/activity", perm(domain.PermLeadsRead), h.leadActivity)
	authed.POST("/leads/:id/notes", perm(domain.PermLeadsWrite), small, h.addLeadNote)
}
