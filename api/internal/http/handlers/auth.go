package handlers

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

const (
	codeConflict     = "conflict"
	codeLastOwner    = "last_owner"
	codeTokenInvalid = "token_invalid"

	msgConflict = "ข้อมูลซ้ำกับที่มีอยู่แล้ว"
)

// failIdentity maps the identity-specific errors, then falls back to h.fail.
func (h *handler) failIdentity(c *gin.Context, err error) {
	switch {
	case errors.Is(err, domain.ErrTokenInvalid):
		respond.Error(c, http.StatusNotFound, codeTokenInvalid, domain.MsgTokenInvalid, nil)
	case errors.Is(err, domain.ErrLastOwner):
		respond.Error(c, http.StatusConflict, codeLastOwner, domain.MsgLastOwner, nil)
	case errors.Is(err, domain.ErrEmailTaken):
		respond.Error(c, http.StatusConflict, codeConflict, domain.MsgEmailHasAccount, nil)
	case errors.Is(err, domain.ErrConflict):
		respond.Error(c, http.StatusConflict, codeConflict, msgConflict, nil)
	case errors.Is(err, domain.ErrSelfElevation):
		respond.Error(c, http.StatusForbidden, respond.CodeForbidden, domain.MsgCannotElevateSelf, nil)
	case errors.Is(err, domain.ErrForbidden):
		respond.Error(c, http.StatusForbidden, respond.CodeForbidden, domain.MsgNoPermission, nil)
	default:
		h.fail(c, err)
	}
}

func requestMeta(c *gin.Context) service.RequestMeta {
	return service.RequestMeta{IP: c.ClientIP(), UserAgent: c.Request.UserAgent()}
}

type loginBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *handler) login(c *gin.Context) {
	now := time.Now()
	if ok, wait := h.LoginIPLimiter.Allow(middleware.ClientIPKey(c), now); !ok {
		middleware.AbortRateLimited(c, wait)
		return
	}
	var in loginBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	if email := service.NormalizeEmail(in.Email); email != "" {
		if ok, wait := h.LoginEmailLimiter.Allow("email:"+email, now); !ok {
			middleware.AbortRateLimited(c, wait)
			return
		}
	}
	res, err := h.Auth.Login(c.Request.Context(), in.Email, in.Password, requestMeta(c))
	if errors.Is(err, domain.ErrUnauthorized) {
		respond.Error(c, http.StatusUnauthorized, respond.CodeUnauthorized, domain.MsgInvalidLogin, nil)
		return
	}
	if err != nil {
		h.fail(c, err)
		return
	}
	h.setSessionCookie(c, res.Token, h.Auth.TTL())
	respond.Data(c, http.StatusOK, toMe(res.User, res.CSRFToken))
}

func (h *handler) setSessionCookie(c *gin.Context, value string, ttl time.Duration) {
	ck := &http.Cookie{
		Name:     middleware.SessionCookie,
		Value:    value,
		Path:     "/",
		Domain:   h.Config.CookieDomain,
		HttpOnly: true,
		Secure:   h.Config.CookieSecure,
		SameSite: http.SameSiteStrictMode,
	}
	if ttl > 0 {
		ck.MaxAge = int(ttl.Seconds())
		ck.Expires = time.Now().Add(ttl).UTC()
	} else {
		ck.MaxAge = -1
		ck.Expires = time.Unix(0, 0)
	}
	http.SetCookie(c.Writer, ck)
}

func (h *handler) logout(c *gin.Context) {
	token, _ := c.Cookie(middleware.SessionCookie)
	if err := h.Auth.Logout(c.Request.Context(), token, middleware.ActorFrom(c)); err != nil {
		h.fail(c, err)
		return
	}
	h.setSessionCookie(c, "", 0)
	c.Status(http.StatusNoContent)
}

func (h *handler) me(c *gin.Context) {
	u, _ := middleware.UserFrom(c)
	s, _ := middleware.SessionFrom(c)
	respond.Data(c, http.StatusOK, toMe(u, s.CSRFToken))
}

// ---- public token endpoints (invite accept / password reset) ----

// tokenRateLimit is the per-IP budget of the public token endpoints; a nil
// limiter disables it.
func (h *handler) tokenRateLimit(c *gin.Context) {
	if h.TokenLimiter != nil {
		if ok, wait := h.TokenLimiter.Allow(middleware.ClientIPKey(c), time.Now()); !ok {
			middleware.AbortRateLimited(c, wait)
			return
		}
	}
	c.Next()
}

type tokenBody struct {
	Token string `json:"token"`
}

func (h *handler) inspectToken(c *gin.Context) {
	var in tokenBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	info, err := h.Users.InspectToken(c.Request.Context(), in.Token)
	if err != nil {
		h.failIdentity(c, err)
		return
	}
	d := tokenInfoDTO{Purpose: string(info.Purpose), Email: info.Email, Name: info.Name,
		ExpiresAt: info.ExpiresAt.UTC()}
	if info.Role != nil {
		r := string(*info.Role)
		d.Role = &r
	}
	respond.Data(c, http.StatusOK, d)
}

func (h *handler) acceptToken(c *gin.Context) {
	var in service.AcceptInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	res, err := h.Users.AcceptToken(c.Request.Context(), in, requestMeta(c))
	if err != nil {
		h.failIdentity(c, err)
		return
	}
	h.setSessionCookie(c, res.Token, h.Auth.TTL())
	respond.Data(c, http.StatusOK, toMe(res.User, res.CSRFToken))
}

// ---- self-service account ----

type profileBody struct {
	Name string `json:"name"`
}

func (h *handler) updateProfile(c *gin.Context) {
	var in profileBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	u, err := h.Account.UpdateProfile(c.Request.Context(), middleware.ActorFrom(c), in.Name)
	if err != nil {
		h.failIdentity(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toAdminUser(u))
}

func (h *handler) changePassword(c *gin.Context) {
	var in service.PasswordChange
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	s, _ := middleware.SessionFrom(c)
	if err := h.Account.ChangePassword(c.Request.Context(), middleware.ActorFrom(c), s.ID, in); err != nil {
		h.failIdentity(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) listSessions(c *gin.Context) {
	u, _ := middleware.UserFrom(c)
	cur, _ := middleware.SessionFrom(c)
	ss, err := h.Account.Sessions(c.Request.Context(), u.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	out := make([]sessionDTO, 0, len(ss))
	for _, s := range ss {
		out = append(out, sessionDTO{ID: s.ID, IP: s.IP, UserAgent: s.UserAgent, CreatedAt: s.CreatedAt.UTC(),
			LastSeenAt: utcPtr(s.LastSeenAt), ExpiresAt: s.ExpiresAt.UTC(), Current: s.ID == cur.ID})
	}
	respond.Data(c, http.StatusOK, out)
}

func (h *handler) revokeOtherSessions(c *gin.Context) {
	s, _ := middleware.SessionFrom(c)
	n, err := h.Account.SignOutOthers(c.Request.Context(), middleware.ActorFrom(c), s.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, gin.H{"revoked": n})
}
