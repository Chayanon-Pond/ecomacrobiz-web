package handlers

import (
	"bytes"
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

// ---- dashboard ----

// dashboard: each section is null when the user lacks its read permission.
func (h *handler) dashboard(c *gin.Context) {
	ctx := c.Request.Context()
	var out dashboardDTO
	if middleware.PermFrom(c, domain.PermLeadsRead) {
		d, err := h.Leads.Dashboard(ctx)
		if err != nil {
			h.fail(c, err)
			return
		}
		out.Leads = toDashboardLeads(d)
	}
	if middleware.PermFrom(c, domain.PermPostsRead) {
		d, err := h.Posts.Dashboard(ctx)
		if err != nil {
			h.fail(c, err)
			return
		}
		out.Posts = toDashboardPosts(d)
	}
	respond.Data(c, http.StatusOK, out)
}

// ---- posts ----

func (h *handler) adminListPosts(c *gin.Context) {
	page := service.NormalizePage(queryInt(c, "page"), queryInt(c, "per_page"), 20, 100)
	posts, total, err := h.Posts.AdminList(c.Request.Context(), repository.AdminPostFilter{
		Page: page, Status: c.DefaultQuery("status", "all"), Query: c.Query("q"),
		CategorySlug: c.Query("category"), Sort: c.Query("sort")})
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.List(c, toAdminSummaries(posts), respond.NewMeta(page, total))
}

func (h *handler) adminSlugCheck(c *gin.Context) {
	res, err := h.Posts.SlugCheck(c.Request.Context(), c.Query("slug"), c.Query("exclude_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, res)
}

func (h *handler) adminGetPost(c *gin.Context) {
	p, err := h.Posts.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toAdminPost(p))
}

func (h *handler) adminCreatePost(c *gin.Context) {
	var in service.PostInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	p, err := h.Posts.Create(c.Request.Context(), in, middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusCreated, toAdminPost(p))
}

func (h *handler) adminUpdatePost(c *gin.Context) {
	var in service.PostInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	p, err := h.Posts.Update(c.Request.Context(), c.Param("id"), in, middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toAdminPost(p))
}

func (h *handler) adminBulkPosts(c *gin.Context) {
	var in service.BulkInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	res, err := h.Posts.Bulk(c.Request.Context(), in, middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, res)
}

// ---- media ----

func (h *handler) listMedia(c *gin.Context) {
	page := service.NormalizePage(queryInt(c, "page"), queryInt(c, "per_page"), 24, 100)
	items, total, err := h.Media.List(c.Request.Context(), repository.MediaFilter{Page: page, Query: c.Query("q"),
		Mime: strings.TrimSpace(c.Query("type"))})
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.List(c, toMediaList(items), respond.NewMeta(page, total))
}

func (h *handler) getMedia(c *gin.Context) {
	m, usage, err := h.Media.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toMediaDetail(m, usage))
}

func (h *handler) updateMedia(c *gin.Context) {
	var in struct {
		Alt string `json:"alt"`
	}
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	m, err := h.Media.UpdateAlt(c.Request.Context(), c.Param("id"), in.Alt, middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toMedia(m))
}

func (h *handler) deleteMedia(c *gin.Context) {
	if err := h.Media.Delete(c.Request.Context(), c.Param("id"), middleware.ActorFrom(c)); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

const maxAltField = 4 << 10

// uploadMedia reads multipart fields "file" (required) and "alt" (optional,
// any order), then hands the file to the media service.
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
	var (
		file     []byte
		fileName string
		hasFile  bool
		alt      string
	)
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
		switch part.FormName() {
		case "file":
			if hasFile {
				break
			}
			hasFile, fileName = true, part.FileName()
			file, err = io.ReadAll(io.LimitReader(part, h.Media.MaxBytes()+1))
		case "alt":
			var b []byte
			b, err = io.ReadAll(io.LimitReader(part, maxAltField))
			alt = string(b)
		}
		_ = part.Close()
		if err != nil {
			h.fail(c, err)
			return
		}
	}
	if !hasFile {
		respond.Error(c, http.StatusUnprocessableEntity, respond.CodeValidation, domain.MsgValidationFailed,
			map[string]string{"file": "กรุณาเลือกไฟล์"})
		return
	}
	m, err := h.Media.Upload(c.Request.Context(), bytes.NewReader(file), fileName, alt,
		middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusCreated, toMedia(m))
}

// ---- leads ----

func leadQuery(c *gin.Context) service.LeadQuery {
	return service.LeadQuery{Status: c.Query("status"), Q: c.Query("q"), Assigned: c.Query("assigned"),
		From: c.Query("from"), To: c.Query("to")}
}

func (h *handler) listLeads(c *gin.Context) {
	f, err := h.Leads.Filter(leadQuery(c), middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	f.Page = service.NormalizePage(queryInt(c, "page"), queryInt(c, "per_page"), 20, 100)
	leads, total, err := h.Leads.List(c.Request.Context(), f)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.List(c, toLeads(leads), respond.NewMeta(f.Page, total))
}

func (h *handler) leadBoard(c *gin.Context) {
	q := leadQuery(c)
	q.Status, q.From, q.To = "", "", ""
	f, err := h.Leads.Filter(q, middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	b, err := h.Leads.Board(c.Request.Context(), f)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toBoard(b))
}

func (h *handler) leadAssignees(c *gin.Context) {
	us, err := h.Leads.Assignees(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toUserRefs(us))
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
	l, err := h.Leads.Update(c.Request.Context(), c.Param("id"), in, middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toLead(l))
}

func (h *handler) leadActivity(c *gin.Context) {
	as, err := h.Leads.Activities(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toActivities(as))
}

func (h *handler) addLeadNote(c *gin.Context) {
	var in struct {
		Body string `json:"body"`
	}
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	a, err := h.Leads.AddNote(c.Request.Context(), c.Param("id"), in.Body, middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusCreated, toActivity(a))
}

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

func (h *handler) exportLeads(c *gin.Context) {
	status, ok := leadStatusParam(c)
	if !ok {
		return
	}
	actor := middleware.ActorFrom(c)
	name := "leads-" + time.Now().In(service.Bangkok()).Format("20060102-1504")
	if status != "" {
		name += "-" + status
	}
	hd := c.Writer.Header()
	hd.Set("Content-Type", "text/csv; charset=utf-8")
	hd.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, name))
	c.Status(http.StatusOK)
	if err := h.Leads.ExportCSV(c.Request.Context(), c.Writer, status, actor); err != nil {
		// Headers are already sent; the truncated file is the best we can do.
		h.Log.Error("lead export failed", "err", err, "actor", actor.ID)
		c.Abort()
		return
	}
	h.Log.Info("leads exported", "status", status, "actor", actor.ID)
}
