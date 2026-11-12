package handlers

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

func (h *handler) listCategories(c *gin.Context) {
	cats, err := h.Posts.Categories(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toCategories(cats))
}

func (h *handler) listPosts(c *gin.Context) {
	page := service.NormalizePage(queryInt(c, "page"), queryInt(c, "per_page"), 12, 50)
	posts, total, err := h.Posts.ListPublished(c.Request.Context(), page, c.Query("category"))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.List(c, toSummaries(posts, false), respond.NewMeta(page, total))
}

func (h *handler) getPost(c *gin.Context) {
	p, err := h.Posts.GetPublished(c.Request.Context(), c.Param("slug"))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, toPost(p, false))
}

func (h *handler) contact(c *gin.Context) {
	var in service.ContactInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	res, err := h.Contact.Submit(c.Request.Context(), in, service.RequestMeta{
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent()})
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusCreated, gin.H{"id": res.ID})
}

var mediaTypes = map[string]string{
	".jpg":  "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".avif": "image/avif",
	".gif":  "image/gif",
}

func (h *handler) serveMedia(c *gin.Context) {
	key := strings.TrimPrefix(c.Param("filepath"), "/")
	ct, ok := mediaTypes[path.Ext(key)]
	if !ok {
		respond.Error(c, http.StatusNotFound, respond.CodeNotFound, domain.MsgNotFound, nil)
		return
	}
	f, err := h.MediaFiles.Open(key)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			h.Log.Error("open media", "key", key, "err", err)
		}
		respond.Error(c, http.StatusNotFound, respond.CodeNotFound, domain.MsgNotFound, nil)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		respond.Error(c, http.StatusNotFound, respond.CodeNotFound, domain.MsgNotFound, nil)
		return
	}
	hd := c.Writer.Header()
	hd.Set("Content-Type", ct)
	// Keys are random UUIDs and never rewritten, so the content is immutable.
	hd.Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(c.Writer, c.Request, "", st.ModTime(), f)
}
