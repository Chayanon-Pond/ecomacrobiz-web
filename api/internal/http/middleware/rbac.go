package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
)

// ctxPermChecked marks that a permission gate ran (see AnyAuthenticated).
const ctxPermChecked = "perm_checked"

// RequirePerm must run after RequireSession: the user's role must grant ALL
// of perms, else 403 with a Thai message. Every authenticated admin route
// carries either RequirePerm, RequireAnyPerm or AnyAuthenticated so the RBAC
// matrix test can assert that no route is left ungated.
func RequirePerm(perms ...domain.Permission) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := UserFrom(c)
		if !ok {
			respond.Error(c, http.StatusUnauthorized, respond.CodeUnauthorized, domain.MsgUnauthorized, nil)
			return
		}
		for _, p := range perms {
			if !u.Role.Has(p) {
				respond.Error(c, http.StatusForbidden, respond.CodeForbidden, domain.MsgNoPermission, nil)
				return
			}
		}
		c.Set(ctxPermChecked, true)
		c.Next()
	}
}

// RequireAnyPerm passes when the role grants at least one of perms.
func RequireAnyPerm(perms ...domain.Permission) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := UserFrom(c)
		if !ok {
			respond.Error(c, http.StatusUnauthorized, respond.CodeUnauthorized, domain.MsgUnauthorized, nil)
			return
		}
		if !u.Role.HasAny(perms...) {
			respond.Error(c, http.StatusForbidden, respond.CodeForbidden, domain.MsgNoPermission, nil)
			return
		}
		c.Set(ctxPermChecked, true)
		c.Next()
	}
}

// AnyAuthenticated explicitly marks self-service routes (me, logout, own
// account) that every active user may call.
func AnyAuthenticated() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := UserFrom(c); !ok {
			respond.Error(c, http.StatusUnauthorized, respond.CodeUnauthorized, domain.MsgUnauthorized, nil)
			return
		}
		c.Set(ctxPermChecked, true)
		c.Next()
	}
}

// PermFrom reports whether the current user has p (for handler-level checks
// such as "posts:write without posts:publish may only save drafts").
func PermFrom(c *gin.Context, p domain.Permission) bool {
	u, ok := UserFrom(c)
	return ok && u.Role.Has(p)
}

// ActorFrom builds the audit/service actor for the current request.
func ActorFrom(c *gin.Context) domain.Actor {
	u, _ := UserFrom(c)
	return domain.Actor{ID: u.ID, Email: u.Email, Name: u.Name, Role: u.Role, IP: c.ClientIP(),
		UserAgent: c.Request.UserAgent()}
}

// RequestActor is ActorFrom for unauthenticated routes (login, invite accept).
func RequestActor(c *gin.Context) domain.Actor {
	return domain.Actor{IP: c.ClientIP(), UserAgent: c.Request.UserAgent()}
}
