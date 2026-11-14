package handlers

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
	"github.com/ecomacrobiz/escoma/api/internal/service"
	"github.com/ecomacrobiz/escoma/api/internal/vault"
)

const (
	codeEmailTaken         = "email_taken"
	codeInvalidCredentials = "invalid_credentials"
	codeMemberBanned       = "member_banned"
	codeEmailUnverified    = "email_unverified"
	codeDuplicateComment   = "duplicate_comment"
	codeLastLoginMethod    = "last_login_method"

	oauthCookiePath = "/api/community/auth/google"
	oauthCookieTTL  = 10 * time.Minute
)

// failCommunity maps the community error sentinels, then falls back to h.fail.
func (h *handler) failCommunity(c *gin.Context, err error) {
	switch {
	case errors.Is(err, domain.ErrEmailTaken):
		respond.Error(c, http.StatusConflict, codeEmailTaken, domain.MsgEmailTaken, nil)
	case errors.Is(err, domain.ErrInvalidCredentials):
		respond.Error(c, http.StatusUnauthorized, codeInvalidCredentials, domain.MsgInvalidLogin, nil)
	case errors.Is(err, domain.ErrMemberBanned):
		respond.Error(c, http.StatusForbidden, codeMemberBanned, domain.MsgMemberBanned, nil)
	case errors.Is(err, domain.ErrEmailUnverified):
		respond.Error(c, http.StatusForbidden, codeEmailUnverified, domain.MsgEmailUnverified, nil)
	case errors.Is(err, domain.ErrTokenInvalid):
		respond.Error(c, http.StatusNotFound, codeTokenInvalid, domain.MsgTokenInvalid, nil)
	case errors.Is(err, domain.ErrDuplicateComment):
		respond.Error(c, http.StatusUnprocessableEntity, codeDuplicateComment, domain.MsgDuplicateComment, nil)
	case errors.Is(err, domain.ErrLastLoginMethod):
		respond.Error(c, http.StatusConflict, codeLastLoginMethod, domain.MsgLastLoginMethod, nil)
	case errors.Is(err, domain.ErrConflict):
		respond.Error(c, http.StatusConflict, codeConflict, msgConflict, nil)
	default:
		h.fail(c, err)
	}
}

func (h *handler) setMemberCookie(c *gin.Context, value string, ttl time.Duration) {
	setCookie(c, middleware.MemberCookie, value, "/", h.Config.CookieDomain, h.Config.CookieSecure, ttl)
}

func (h *handler) setOAuthCookie(c *gin.Context, value string, ttl time.Duration) {
	setCookie(c, middleware.OAuthCookie, value, oauthCookiePath, h.Config.CookieDomain, h.Config.CookieSecure, ttl)
}

// setCookie writes an HttpOnly SameSite=Lax cookie (Lax so the Google
// redirect back to the site carries it); ttl <= 0 deletes it.
func setCookie(c *gin.Context, name, value, path, domain string, secure bool, ttl time.Duration) {
	ck := &http.Cookie{Name: name, Value: value, Path: path, Domain: domain, HttpOnly: true, Secure: secure,
		SameSite: http.SameSiteLaxMode}
	if ttl > 0 {
		ck.MaxAge = int(ttl.Seconds())
		ck.Expires = time.Now().Add(ttl).UTC()
	} else {
		ck.MaxAge = -1
		ck.Expires = time.Unix(0, 0)
	}
	http.SetCookie(c.Writer, ck)
}

func (h *handler) memberSession(c *gin.Context, status int, a service.MemberAuth) {
	h.setMemberCookie(c, a.Token, h.Members.SessionTTL())
	respond.Data(c, status, memberSessionDTO{Member: h.toMemberMe(a.Member, a.Identities), CSRFToken: a.CSRFToken})
}

// current returns the signed-in member and session (RequireMember ran).
func current(c *gin.Context) (domain.Member, domain.MemberSession) {
	m, _ := middleware.MemberFrom(c)
	s, _ := middleware.MemberSessionFrom(c)
	return m, s
}

func (h *handler) communityConfig(c *gin.Context) {
	mc := h.Config.Members
	respond.Data(c, http.StatusOK, communityConfigDTO{
		GoogleEnabled:        h.Google != nil,
		RequireVerifiedEmail: h.Members.RequireVerified(),
		EmailTransport:       h.Members.MailEnabled(),
		ConsentVersion:       domain.ConsentVersion,
		CommentMaxChars:      domain.CommentMaxRunes,
		CommentImageMaxMB:    mc.CommentImageMaxBytes >> 20,
		AvatarMaxMB:          mc.AvatarMaxBytes >> 20,
		Turnstile:            h.Members.TurnstileEnabled(),
	})
}

func (h *handler) memberMe(c *gin.Context) {
	m, ok := middleware.MemberFrom(c)
	if !ok {
		respond.Data(c, http.StatusOK, nil)
		return
	}
	s, _ := middleware.MemberSessionFrom(c)
	ids, err := h.Members.Identities(c.Request.Context(), m.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, memberSessionDTO{Member: h.toMemberMe(m, ids), CSRFToken: s.CSRFToken})
}

func (h *handler) memberRegister(c *gin.Context) {
	var in service.RegisterInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	a, err := h.Members.Register(c.Request.Context(), in, requestMeta(c))
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	h.memberSession(c, http.StatusCreated, a)
}

type memberLoginBody struct {
	Email          string `json:"email"`
	Password       string `json:"password"`
	TurnstileToken string `json:"turnstile_token"`
}

func (h *handler) memberLogin(c *gin.Context) {
	now := time.Now()
	if l := h.CommunityLimits.LoginIP; l != nil {
		if ok, wait := l.Allow(middleware.ClientIPKey(c), now); !ok {
			middleware.AbortRateLimited(c, wait)
			return
		}
	}
	var in memberLoginBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	if email := vault.NormalizeEmail(in.Email); email != "" && h.CommunityLimits.LoginEmail != nil {
		if ok, wait := h.CommunityLimits.LoginEmail.Allow("email:"+email, now); !ok {
			middleware.AbortRateLimited(c, wait)
			return
		}
	}
	a, err := h.Members.Login(c.Request.Context(), in.Email, in.Password, in.TurnstileToken, requestMeta(c))
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	h.memberSession(c, http.StatusOK, a)
}

func (h *handler) memberLogout(c *gin.Context) {
	token, _ := c.Cookie(middleware.MemberCookie)
	if err := h.Members.Logout(c.Request.Context(), token); err != nil {
		h.fail(c, err)
		return
	}
	h.setMemberCookie(c, "", 0)
	c.Status(http.StatusNoContent)
}

func (h *handler) memberVerifyEmail(c *gin.Context) {
	var in tokenBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	kind, err := h.Members.VerifyEmail(c.Request.Context(), in.Token)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	respond.Data(c, http.StatusOK, gin.H{"verified": true, "kind": kind})
}

func (h *handler) memberResendVerification(c *gin.Context) {
	m, _ := current(c)
	if err := h.Members.ResendVerification(c.Request.Context(), m); err != nil {
		h.failCommunity(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type forgotBody struct {
	Email string `json:"email"`
}

func (h *handler) memberForgotPassword(c *gin.Context) {
	var in forgotBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	// Per-address budget too, so one inbox cannot be flooded from many IPs.
	if email := vault.NormalizeEmail(in.Email); email != "" && h.CommunityLimits.Forgot != nil {
		if ok, _ := h.CommunityLimits.Forgot.Allow("forgot:"+email, time.Now()); !ok {
			c.Status(http.StatusNoContent)
			return
		}
	}
	if err := h.Members.ForgotPassword(c.Request.Context(), in.Email); err != nil {
		h.Log.Error("member forgot password", "err", err)
	}
	c.Status(http.StatusNoContent)
}

type resetBody struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (h *handler) memberResetPassword(c *gin.Context) {
	var in resetBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	if err := h.Members.ResetPassword(c.Request.Context(), in.Token, in.Password); err != nil {
		h.failCommunity(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---- Google ----

func (h *handler) googleStart(c *gin.Context) {
	if h.Google == nil {
		respond.Error(c, http.StatusNotFound, respond.CodeNotFound, domain.MsgNotFound, nil)
		return
	}
	res, err := h.Google.Start(c.Request.Context(), c.Query("next"), c.Query("consent") == "1")
	if err != nil {
		h.Log.Error("google start", "err", err)
		c.Redirect(http.StatusFound, h.Config.WebBaseURL+service.SafeNextPath(c.Query("next"))+"#community=error-provider")
		return
	}
	h.setOAuthCookie(c, res.Binding, oauthCookieTTL)
	c.Redirect(http.StatusFound, res.RedirectURL)
}

func (h *handler) googleCallback(c *gin.Context) {
	if h.Google == nil {
		respond.Error(c, http.StatusNotFound, respond.CodeNotFound, domain.MsgNotFound, nil)
		return
	}
	binding, _ := c.Cookie(middleware.OAuthCookie)
	out := h.Google.Callback(c.Request.Context(), service.GoogleCallbackInput{Code: c.Query("code"),
		State: c.Query("state"), Error: c.Query("error"), Binding: binding}, requestMeta(c))
	h.setOAuthCookie(c, "", 0)
	if out.Auth != nil {
		h.setMemberCookie(c, out.Auth.Token, h.Members.SessionTTL())
	}
	h.Log.Info("google callback", "outcome", out.Code)
	c.Redirect(http.StatusFound, out.Location)
}

type googleLinkBody struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (h *handler) googleLink(c *gin.Context) {
	var in googleLinkBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	a, err := h.Members.LinkGoogle(c.Request.Context(), in.Token, in.Password, requestMeta(c))
	if errors.Is(err, domain.ErrInvalidCredentials) {
		// Counts toward the login budget of this IP.
		if l := h.CommunityLimits.LoginIP; l != nil {
			l.Allow(middleware.ClientIPKey(c), time.Now())
		}
	}
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	h.memberSession(c, http.StatusOK, a)
}

// ---- account ----

func (h *handler) respondMe(c *gin.Context, m domain.Member) {
	ids, err := h.Members.Identities(c.Request.Context(), m.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, h.toMemberMe(m, ids))
}

type memberProfileBody struct {
	DisplayName string `json:"display_name"`
}

func (h *handler) memberUpdateProfile(c *gin.Context) {
	var in memberProfileBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	m, _ := current(c)
	out, err := h.Members.UpdateProfile(c.Request.Context(), m, in.DisplayName)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	h.respondMe(c, out)
}

// readUploadFile reads the multipart field "file" (at most max+1 bytes, so
// the service can report 413).
func readUploadFile(c *gin.Context, max int64) ([]byte, bool) {
	mt, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mt != "multipart/form-data" {
		respond.Error(c, http.StatusUnprocessableEntity, respond.CodeValidation, domain.MsgValidationFailed,
			map[string]string{"file": "กรุณาอัปโหลดไฟล์แบบ multipart/form-data ในฟิลด์ file"})
		return nil, false
	}
	mr, err := c.Request.MultipartReader()
	if err != nil {
		respond.Error(c, http.StatusBadRequest, respond.CodeValidation, domain.MsgInvalidJSON, nil)
		return nil, false
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			var mbe *http.MaxBytesError
			if errors.As(err, &mbe) {
				respond.Error(c, http.StatusRequestEntityTooLarge, respond.CodePayloadTooLarge, domain.MsgPayloadTooLarge, nil)
				return nil, false
			}
			respond.Error(c, http.StatusBadRequest, respond.CodeValidation, domain.MsgInvalidJSON, nil)
			return nil, false
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}
		data, err := io.ReadAll(io.LimitReader(part, max+1))
		_ = part.Close()
		if err != nil {
			respond.Error(c, http.StatusRequestEntityTooLarge, respond.CodePayloadTooLarge, domain.MsgPayloadTooLarge, nil)
			return nil, false
		}
		return data, true
	}
	respond.Error(c, http.StatusUnprocessableEntity, respond.CodeValidation, domain.MsgValidationFailed,
		map[string]string{"file": "กรุณาเลือกไฟล์"})
	return nil, false
}

func (h *handler) memberUploadAvatar(c *gin.Context) {
	data, ok := readUploadFile(c, h.Members.AvatarMaxBytes())
	if !ok {
		return
	}
	m, _ := current(c)
	out, err := h.Members.SetAvatar(c.Request.Context(), m, data)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	h.respondMe(c, out)
}

func (h *handler) memberDeleteAvatar(c *gin.Context) {
	m, _ := current(c)
	out, err := h.Members.RemoveAvatar(c.Request.Context(), m)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	h.respondMe(c, out)
}

type changeEmailBody struct {
	NewEmail        string `json:"new_email"`
	CurrentPassword string `json:"current_password"`
}

func (h *handler) memberChangeEmail(c *gin.Context) {
	var in changeEmailBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	m, _ := current(c)
	out, sent, err := h.Members.ChangeEmail(c.Request.Context(), m, in.NewEmail, in.CurrentPassword)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	ids, err := h.Members.Identities(c.Request.Context(), m.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, gin.H{"member": h.toMemberMe(out, ids), "verification_sent": sent})
}

func (h *handler) memberChangePassword(c *gin.Context) {
	var in service.MemberPasswordChange
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	m, s := current(c)
	if err := h.Members.ChangePassword(c.Request.Context(), m, s.ID, in); err != nil {
		h.failCommunity(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) memberSessions(c *gin.Context) {
	m, s := current(c)
	ss, err := h.Members.Sessions(c.Request.Context(), m.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toMemberSessions(ss, s.ID))
}

func (h *handler) memberRevokeOtherSessions(c *gin.Context) {
	m, s := current(c)
	n, err := h.Members.SignOutOthers(c.Request.Context(), m.ID, s.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, gin.H{"revoked": n})
}

func (h *handler) memberUnlinkGoogle(c *gin.Context) {
	m, _ := current(c)
	if err := h.Members.UnlinkGoogle(c.Request.Context(), m); err != nil {
		h.failCommunity(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) memberExport(c *gin.Context) {
	m, s := current(c)
	ex, err := h.Members.Export(c.Request.Context(), m)
	if err != nil {
		h.fail(c, err)
		return
	}
	out := accountExportDTO{Member: h.toMemberMe(m, ex.Identities), Identities: toIdentities(ex.Identities),
		Comments: []exportCommentDTO{}, Likes: exportLikesDTO{Posts: ex.Data.LikedPosts, Comments: ex.Data.LikedComments},
		Sessions: toMemberSessions(ex.Sessions, s.ID)}
	if out.Likes.Posts == nil {
		out.Likes.Posts = []string{}
	}
	if out.Likes.Comments == nil {
		out.Likes.Comments = []string{}
	}
	for _, cm := range ex.Data.Comments {
		out.Comments = append(out.Comments, exportCommentDTO{PostSlug: cm.PostSlug, Body: cm.Body,
			Status: string(cm.Status), CreatedAt: cm.CreatedAt.UTC(), EditedAt: utcPtr(cm.EditedAt)})
	}
	c.Header("Content-Disposition", `attachment; filename="ecomacrobiz-account.json"`)
	c.JSON(http.StatusOK, out)
}

func (h *handler) memberDeleteAccount(c *gin.Context) {
	var in service.DeleteAccountInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	m, _ := current(c)
	if err := h.Members.DeleteAccount(c.Request.Context(), m, in); err != nil {
		h.failCommunity(c, err)
		return
	}
	h.setMemberCookie(c, "", 0)
	c.Status(http.StatusNoContent)
}
