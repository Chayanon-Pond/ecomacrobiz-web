package handlers

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
	"github.com/ecomacrobiz/escoma/api/internal/ratelimit"
)

// CommunityLimiters are the in-memory budgets of the community API. A nil
// limiter disables that limit.
type CommunityLimiters struct {
	Register    *ratelimit.Limiter // per IP (MEMBER_REGISTER_RATE_LIMIT)
	LoginIP     *ratelimit.Limiter // per IP (MEMBER_LOGIN_RATE_LIMIT)
	LoginEmail  *ratelimit.Limiter // per e-mail (MEMBER_LOGIN_RATE_LIMIT)
	Token       *ratelimit.Limiter // verify-email / password reset, per IP
	Forgot      *ratelimit.Limiter // per IP
	Resend      *ratelimit.Limiter // per member, 3/h
	GoogleStart *ratelimit.Limiter // per IP
	GoogleLink  *ratelimit.Limiter // per IP, 10/15m
	Avatar      *ratelimit.Limiter // per member, 10/h
	Password    *ratelimit.Limiter // per member, 5/15m (password, e-mail, delete)
	Views       *ratelimit.Limiter // per IP, 60/10m
	Likes       *ratelimit.Limiter // per member, 60/1m
	Comment     *ratelimit.Limiter // per member (COMMENT_RATE_LIMIT)
	CommentIP   *ratelimit.Limiter // per IP (COMMENT_IP_RATE_LIMIT)
	Report      *ratelimit.Limiter // per member, 20/h
	Upload      *ratelimit.Limiter // per member, 10/h
}

// All returns the non-nil limiters (janitor start/stop).
func (l CommunityLimiters) All() []*ratelimit.Limiter {
	var out []*ratelimit.Limiter
	for _, x := range []*ratelimit.Limiter{l.Register, l.LoginIP, l.LoginEmail, l.Token, l.Forgot, l.Resend,
		l.GoogleStart, l.GoogleLink, l.Avatar, l.Password, l.Views, l.Likes, l.Comment, l.CommentIP, l.Report, l.Upload} {
		if x != nil {
			out = append(out, x)
		}
	}
	return out
}

// limit is RateLimit that tolerates a nil limiter.
func limit(l *ratelimit.Limiter, key func(*gin.Context) string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if l != nil {
			if ok, wait := l.Allow(key(c), time.Now()); !ok {
				middleware.AbortRateLimited(c, wait)
				return
			}
		}
		c.Next()
	}
}

func communityPublicCache(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=60")
	c.Next()
}

const (
	commentBodyLimit = 32 << 10
	uploadOverhead   = 1 << 20
)

// registerCommunityRoutes: /api/v1/community. Every route loads the optional
// member session; [auth] routes add RequireMember + RequireMemberCSRF
// (covered route by route by TestMemberCSRFMatrix).
func (h *handler) registerCommunityRoutes(v1 *gin.RouterGroup) {
	cors := h.Config.CORSAllowedOrigins
	l := h.CommunityLimits
	ip := middleware.ClientIPKey
	member := middleware.MemberKey
	small := middleware.BodyLimit(smallBodyLimit)
	origin := middleware.RequireOrigin(cors)
	authed := func(hs ...gin.HandlerFunc) []gin.HandlerFunc {
		return append([]gin.HandlerFunc{middleware.RequireMember(), middleware.RequireMemberCSRF(cors)}, hs...)
	}
	signedIn := middleware.RequireMember()

	cm := v1.Group("/community", middleware.LoadMemberSession(h.Members, h.Log))
	cm.GET("/config", communityPublicCache, h.communityConfig)
	cm.GET("/stats", communityPublicCache, h.communityStats)

	g := cm.Group("", noStore)
	g.GET("/auth/me", h.memberMe)
	g.POST("/auth/register", small, origin, limit(l.Register, ip), h.memberRegister)
	g.POST("/auth/login", small, origin, h.memberLogin)
	g.POST("/auth/logout", authed(h.memberLogout)...)
	g.POST("/auth/verify-email", small, origin, limit(l.Token, ip), h.memberVerifyEmail)
	g.POST("/auth/verify-email/resend", authed(limit(l.Resend, member), h.memberResendVerification)...)
	g.POST("/auth/password/forgot", small, origin, limit(l.Forgot, ip), h.memberForgotPassword)
	g.POST("/auth/password/reset", small, origin, limit(l.Token, ip), h.memberResetPassword)
	g.GET("/auth/google/start", limit(l.GoogleStart, ip), h.googleStart)
	g.GET("/auth/google/callback", h.googleCallback)
	g.POST("/auth/google/link", small, origin, limit(l.GoogleLink, ip), h.googleLink)

	g.PUT("/account/profile", authed(small, h.memberUpdateProfile)...)
	g.POST("/account/avatar", authed(limit(l.Avatar, member),
		middleware.BodyLimit(h.Members.AvatarMaxBytes()+uploadOverhead), h.memberUploadAvatar)...)
	g.DELETE("/account/avatar", authed(h.memberDeleteAvatar)...)
	g.PUT("/account/email", authed(limit(l.Password, member), small, h.memberChangeEmail)...)
	g.PUT("/account/password", authed(limit(l.Password, member), small, h.memberChangePassword)...)
	g.GET("/account/sessions", signedIn, h.memberSessions)
	g.DELETE("/account/sessions/others", authed(h.memberRevokeOtherSessions)...)
	g.DELETE("/account/identities/google", authed(h.memberUnlinkGoogle)...)
	g.GET("/account/export", signedIn, h.memberExport)
	g.DELETE("/account", authed(limit(l.Password, member), small, h.memberDeleteAccount)...)

	g.GET("/posts/:slug/stats", h.postStats)
	g.POST("/posts/:slug/views", small, origin, limit(l.Views, ip), h.recordView)
	g.PUT("/posts/:slug/like", authed(limit(l.Likes, member), h.likePost)...)
	g.DELETE("/posts/:slug/like", authed(limit(l.Likes, member), h.unlikePost)...)
	g.GET("/posts/:slug/comments", h.listComments)
	g.POST("/posts/:slug/comments", authed(limit(l.Comment, member), limit(l.CommentIP, ip),
		middleware.BodyLimit(commentBodyLimit), h.createComment)...)

	g.GET("/comments/:id/replies", h.listReplies)
	g.PATCH("/comments/:id", authed(middleware.BodyLimit(commentBodyLimit), h.editComment)...)
	g.DELETE("/comments/:id", authed(h.deleteComment)...)
	g.PUT("/comments/:id/like", authed(limit(l.Likes, member), h.likeComment)...)
	g.DELETE("/comments/:id/like", authed(limit(l.Likes, member), h.unlikeComment)...)
	g.POST("/comments/:id/report", authed(limit(l.Report, member), small, h.reportComment)...)
	g.POST("/comments/:id/moderate", authed(small, h.moderateComment)...)
	g.POST("/uploads/comment-image", authed(limit(l.Upload, member),
		middleware.BodyLimit(h.Comments.ImageMaxBytes()+uploadOverhead), h.uploadCommentImage)...)
}

// registerCommentAdminRoutes: comment moderation and member management in
// the admin API (comments:moderate).
func (h *handler) registerCommentAdminRoutes(authed *gin.RouterGroup) {
	perm := middleware.RequirePerm(domain.PermCommentsModerate)
	small := middleware.BodyLimit(smallBodyLimit)
	authed.GET("/comments", perm, h.adminListComments)
	authed.POST("/comments/bulk", perm, small, h.adminBulkComments)
	authed.GET("/comments/:id/history", perm, h.adminCommentHistory)
	authed.PATCH("/comments/:id", perm, small, h.adminPatchComment)
	authed.DELETE("/comments/:id", perm, h.adminDeleteComment)
	authed.GET("/members", perm, h.adminListMembers)
	authed.PATCH("/members/:id", perm, small, h.adminPatchMember)
}
