package handlers

import (
	"bufio"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

// ---- DTOs ----

type publicRedirectDTO struct {
	From   string  `json:"from"`
	To     *string `json:"to"`
	Status int     `json:"status"`
}

type redirectDTO struct {
	ID        string      `json:"id"`
	From      string      `json:"from"`
	To        *string     `json:"to"`
	Status    int         `json:"status"`
	Kind      string      `json:"kind"`
	Note      string      `json:"note"`
	CreatedBy *userRefDTO `json:"created_by"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

type redirectWriteDTO struct {
	redirectDTO
	Flattened int `json:"flattened"`
}

type linkSuggestionDTO struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Slug  string `json:"slug"`
	URL   string `json:"url"`
}

func toRedirect(d domain.Redirect) redirectDTO {
	return redirectDTO{ID: d.ID, From: d.From, To: d.To, Status: d.Status, Kind: d.Kind, Note: d.Note,
		CreatedBy: toUserRef(d.CreatedBy), CreatedAt: d.CreatedAt.UTC(), UpdatedAt: d.UpdatedAt.UTC()}
}

// ---- public ----

func (h *handler) publicRedirects(c *gin.Context) {
	rs, err := h.Redirects.Public(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	out := make([]publicRedirectDTO, 0, len(rs))
	for _, r := range rs {
		out = append(out, publicRedirectDTO{From: r.From, To: r.To, Status: r.Status})
	}
	respond.Data(c, http.StatusOK, out)
}

// ---- admin redirects ----

func (h *handler) listRedirects(c *gin.Context) {
	page := service.NormalizePage(queryInt(c, "page"), queryInt(c, "per_page"), 50, 100)
	status := 0
	if s := strings.TrimSpace(c.Query("status")); s != "" && s != "all" {
		n, err := strconv.Atoi(s)
		if err != nil {
			n = -1
		}
		status = n
	}
	rs, total, err := h.Redirects.List(c.Request.Context(), repository.RedirectFilter{Page: page,
		Query: c.Query("q"), Kind: strings.TrimSpace(c.Query("kind")), Status: status})
	if err != nil {
		h.fail(c, err)
		return
	}
	out := make([]redirectDTO, 0, len(rs))
	for _, r := range rs {
		out = append(out, toRedirect(r))
	}
	respond.List(c, out, respond.NewMeta(page, total))
}

func (h *handler) createRedirect(c *gin.Context) {
	var in service.RedirectInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	d, n, err := h.Redirects.Create(c.Request.Context(), in, middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusCreated, redirectWriteDTO{redirectDTO: toRedirect(d), Flattened: n})
}

func (h *handler) updateRedirect(c *gin.Context) {
	var in service.RedirectInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	d, n, err := h.Redirects.Update(c.Request.Context(), c.Param("id"), in, middleware.ActorFrom(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, redirectWriteDTO{redirectDTO: toRedirect(d), Flattened: n})
}

func (h *handler) deleteRedirect(c *gin.Context) {
	if err := h.Redirects.Delete(c.Request.Context(), c.Param("id"), middleware.ActorFrom(c)); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---- posts: link suggestions + delete with redirect_to ----

func (h *handler) linkSuggestions(c *gin.Context) {
	ls, err := h.Posts.LinkSuggestions(c.Request.Context(), c.Query("post_id"), c.Query("q"))
	if err != nil {
		h.fail(c, err)
		return
	}
	out := make([]linkSuggestionDTO, 0, len(ls))
	for _, l := range ls {
		out = append(out, linkSuggestionDTO{ID: l.ID, Title: l.Title, Slug: l.Slug, URL: domain.KnowledgePrefix + l.Slug})
	}
	respond.Data(c, http.StatusOK, out)
}

type peekedBody struct {
	io.Reader
	io.Closer
}

// adminDeletePost accepts an optional JSON body {redirect_to}.
func (h *handler) adminDeletePost(c *gin.Context) {
	var in struct {
		RedirectTo *string `json:"redirect_to"`
	}
	br := bufio.NewReader(c.Request.Body)
	if _, err := br.Peek(1); err == nil {
		c.Request.Body = peekedBody{Reader: br, Closer: c.Request.Body}
		if err := decodeJSON(c, &in); err != nil {
			h.fail(c, err)
			return
		}
	}
	if err := h.Posts.Delete(c.Request.Context(), c.Param("id"), in.RedirectTo, middleware.ActorFrom(c)); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
