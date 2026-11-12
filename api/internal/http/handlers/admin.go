package handlers

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

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
	res, err := h.Auth.Login(c.Request.Context(), in.Email, in.Password, service.RequestMeta{
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent()})
	if errors.Is(err, domain.ErrUnauthorized) {
		respond.Error(c, http.StatusUnauthorized, respond.CodeUnauthorized, domain.MsgInvalidLogin, nil)
		return
	}
	if err != nil {
		h.fail(c, err)
		return
	}
	h.setSessionCookie(c, res.Token, h.Auth.TTL())
	respond.Data(c, http.StatusOK, gin.H{"user": toUser(res.User), "csrf_token": res.CSRFToken})
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
	if err := h.Auth.Logout(c.Request.Context(), token); err != nil {
		h.fail(c, err)
		return
	}
	h.setSessionCookie(c, "", 0)
	c.Status(http.StatusNoContent)
}

func (h *handler) me(c *gin.Context) {
	u, _ := middleware.UserFrom(c)
	s, _ := middleware.SessionFrom(c)
	respond.Data(c, http.StatusOK, gin.H{"user": toUser(u), "csrf_token": s.CSRFToken})
}

func actorID(c *gin.Context) string {
	u, _ := middleware.UserFrom(c)
	return u.ID
}

// ---- posts ----

func (h *handler) adminListPosts(c *gin.Context) {
	status := c.DefaultQuery("status", "all")
	if status != "all" && status != "" && !domain.PostStatus(status).Valid() {
		respond.Error(c, http.StatusUnprocessableEntity, respond.CodeValidation, domain.MsgValidationFailed,
			map[string]string{"status": "สถานะต้องเป็น draft, published หรือ all"})
		return
	}
	page := service.NormalizePage(queryInt(c, "page"), queryInt(c, "per_page"), 20, 100)
	posts, total, err := h.Posts.AdminList(c.Request.Context(), repository.AdminPostFilter{
		Page: page, Status: status, Query: c.Query("q")})
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.List(c, toSummaries(posts, true), respond.NewMeta(page, total))
}

func (h *handler) adminGetPost(c *gin.Context) {
	p, err := h.Posts.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toPost(p, true))
}

func (h *handler) adminCreatePost(c *gin.Context) {
	var in service.PostInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	p, err := h.Posts.Create(c.Request.Context(), in, actorID(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusCreated, toPost(p, true))
}

func (h *handler) adminUpdatePost(c *gin.Context) {
	var in service.PostInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	p, err := h.Posts.Update(c.Request.Context(), c.Param("id"), in, actorID(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toPost(p, true))
}

func (h *handler) adminDeletePost(c *gin.Context) {
	if err := h.Posts.Delete(c.Request.Context(), c.Param("id"), actorID(c)); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---- media ----

func (h *handler) uploadMedia(c *gin.Context) {
	mt, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mt != "multipart/form-data" {
		respond.Error(c, http.StatusUnprocessableEntity, respond.CodeValidation, domain.MsgValidationFailed,
			map[string]string{"file": "กรุณาอัปโหลดไฟล์แบบ multipart/form-data ในฟิลด์ file"})
		return
	}
	mr, err := c.Request.MultipartReader()
	if err != nil {
		h.fail(c, respond.ErrBadJSON)
		return
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			var mbe *http.MaxBytesError
			if errors.As(err, &mbe) {
				h.fail(c, err)
				return
			}
			respond.Error(c, http.StatusBadRequest, respond.CodeValidation, domain.MsgInvalidJSON, nil)
			return
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}
		m, err := h.Media.Upload(c.Request.Context(), part, part.FileName(), actorID(c))
		_ = part.Close()
		if err != nil {
			h.fail(c, err)
			return
		}
		respond.Data(c, http.StatusCreated, mediaDTO{ID: m.ID, URL: m.URL, Width: m.Width, Height: m.Height,
			Mime: m.Mime, Size: m.SizeBytes})
		return
	}
	respond.Error(c, http.StatusUnprocessableEntity, respond.CodeValidation, domain.MsgValidationFailed,
		map[string]string{"file": "กรุณาเลือกไฟล์"})
}

// ---- leads ----

func leadStatusParam(c *gin.Context) (string, bool) {
	s := strings.TrimSpace(c.Query("status"))
	if s == "" || s == "all" {
		return "", true
	}
	if !domain.LeadStatus(s).Valid() {
		respond.Error(c, http.StatusUnprocessableEntity, respond.CodeValidation, domain.MsgValidationFailed,
			map[string]string{"status": "สถานะไม่ถูกต้อง"})
		return "", false
	}
	return s, true
}

func (h *handler) listLeads(c *gin.Context) {
	status, ok := leadStatusParam(c)
	if !ok {
		return
	}
	page := service.NormalizePage(queryInt(c, "page"), queryInt(c, "per_page"), 20, 100)
	leads, total, err := h.Leads.List(c.Request.Context(), repository.LeadFilter{Page: page, Status: status,
		Query: c.Query("q")})
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.List(c, toLeads(leads), respond.NewMeta(page, total))
}

func (h *handler) getLead(c *gin.Context) {
	l, err := h.Leads.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toLead(l))
}

func (h *handler) updateLead(c *gin.Context) {
	var in service.LeadUpdate
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	l, err := h.Leads.Update(c.Request.Context(), c.Param("id"), in, actorID(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toLead(l))
}

func (h *handler) exportLeads(c *gin.Context) {
	status, ok := leadStatusParam(c)
	if !ok {
		return
	}
	name := "leads-" + time.Now().In(service.Bangkok()).Format("20060102-1504")
	if status != "" {
		name += "-" + status
	}
	hd := c.Writer.Header()
	hd.Set("Content-Type", "text/csv; charset=utf-8")
	hd.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, name))
	c.Status(http.StatusOK)
	if err := h.Leads.ExportCSV(c.Request.Context(), c.Writer, status); err != nil {
		// Headers are already sent; the truncated file is the best we can do.
		h.Log.Error("lead export failed", "err", err, "actor", actorID(c))
		c.Abort()
		return
	}
	h.Log.Info("leads exported", "status", status, "actor", actorID(c))
}
