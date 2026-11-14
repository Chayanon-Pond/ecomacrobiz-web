package middleware

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

// Community members have their own cookie, session and CSRF token. Nothing
// here reads the admin cookie, and the admin middleware never reads this one.
const (
	MemberCookie  = "escoma_member"
	OAuthCookie   = "escoma_oauth"
	ctxMemberSess = "member_session"
	ctxMember     = "member"
)

// LoadMemberSession sets the member when the escoma_member cookie is a live
// session; otherwise the request continues anonymously.
func LoadMemberSession(members *service.MemberService, log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, _ := c.Cookie(MemberCookie)
		if token != "" {
			sess, m, err := members.Authenticate(c.Request.Context(), token)
			switch {
			case err == nil:
				c.Set(ctxMemberSess, sess)
				c.Set(ctxMember, m)
			case !errors.Is(err, domain.ErrUnauthorized):
				respond.FromError(c, log, err)
				return
			}
		}
		c.Next()
	}
}

// RequireMember aborts anonymous requests with 401.
func RequireMember() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := MemberFrom(c); !ok {
			respond.Error(c, http.StatusUnauthorized, respond.CodeUnauthorized, domain.MsgUnauthorized, nil)
			return
		}
		c.Next()
	}
}

// RequireMemberCSRF must run after RequireMember: unsafe methods need an
// allowlisted Origin (when present) and X-CSRF-Token equal to the member
// session's token.
func RequireMemberCSRF(allowed []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if isSafeMethod(c.Request.Method) {
			c.Next()
			return
		}
		sess, ok := MemberSessionFrom(c)
		if !ok || !originOK(allowed, c) || !service.CSRFEqual(sess.CSRFToken, c.GetHeader(CSRFHeader)) {
			respond.Error(c, http.StatusForbidden, respond.CodeForbidden, domain.MsgForbidden, nil)
			return
		}
		c.Next()
	}
}

func MemberSessionFrom(c *gin.Context) (domain.MemberSession, bool) {
	v, ok := c.Get(ctxMemberSess)
	if !ok {
		return domain.MemberSession{}, false
	}
	s, ok := v.(domain.MemberSession)
	return s, ok
}

func MemberFrom(c *gin.Context) (domain.Member, bool) {
	v, ok := c.Get(ctxMember)
	if !ok {
		return domain.Member{}, false
	}
	m, ok := v.(domain.Member)
	return m, ok
}

// MemberPtr is MemberFrom as an optional pointer (nil = anonymous).
func MemberPtr(c *gin.Context) *domain.Member {
	if m, ok := MemberFrom(c); ok {
		return &m
	}
	return nil
}

// MemberKey is the per-member rate-limit key.
func MemberKey(c *gin.Context) string {
	m, _ := MemberFrom(c)
	return "member:" + m.ID
}
