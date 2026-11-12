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

const (
	SessionCookie = "escoma_admin"
	CSRFHeader    = "X-CSRF-Token"
	ctxSession    = "admin_session"
	ctxUser       = "admin_user"
)

// RequireSession loads the admin session from the cookie or aborts with 401.
func RequireSession(auth *service.AuthService, log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, _ := c.Cookie(SessionCookie)
		sess, user, err := auth.Authenticate(c.Request.Context(), token)
		if err != nil {
			if !errors.Is(err, domain.ErrUnauthorized) {
				respond.FromError(c, log, err)
				return
			}
			respond.Error(c, http.StatusUnauthorized, respond.CodeUnauthorized, domain.MsgUnauthorized, nil)
			return
		}
		c.Set(ctxSession, sess)
		c.Set(ctxUser, user)
		c.Next()
	}
}

func isSafeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// RequireOrigin rejects unsafe requests whose Origin header is present but not
// allowlisted. Used on login (no session yet) and by RequireCSRF.
func RequireOrigin(allowed []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isSafeMethod(c.Request.Method) && !originOK(allowed, c) {
			respond.Error(c, http.StatusForbidden, respond.CodeForbidden, domain.MsgForbidden, nil)
			return
		}
		c.Next()
	}
}

func originOK(allowed []string, c *gin.Context) bool {
	o := c.GetHeader("Origin")
	return o == "" || OriginAllowed(allowed, o)
}

// RequireCSRF must run after RequireSession: unsafe methods need
// X-CSRF-Token equal (constant time) to the session's token.
func RequireCSRF(allowed []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if isSafeMethod(c.Request.Method) {
			c.Next()
			return
		}
		sess, ok := SessionFrom(c)
		if !ok || !originOK(allowed, c) || !service.CSRFEqual(sess.CSRFToken, c.GetHeader(CSRFHeader)) {
			respond.Error(c, http.StatusForbidden, respond.CodeForbidden, domain.MsgForbidden, nil)
			return
		}
		c.Next()
	}
}

func SessionFrom(c *gin.Context) (domain.Session, bool) {
	v, ok := c.Get(ctxSession)
	if !ok {
		return domain.Session{}, false
	}
	s, ok := v.(domain.Session)
	return s, ok
}

func UserFrom(c *gin.Context) (domain.AdminUser, bool) {
	v, ok := c.Get(ctxUser)
	if !ok {
		return domain.AdminUser{}, false
	}
	u, ok := v.(domain.AdminUser)
	return u, ok
}
