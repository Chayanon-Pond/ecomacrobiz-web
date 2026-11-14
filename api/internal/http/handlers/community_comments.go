package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
	"github.com/ecomacrobiz/escoma/api/internal/service"
)

// ---- stats, likes, views ----

func (h *handler) communityStats(c *gin.Context) {
	stats, err := h.Engagement.Stats(c.Request.Context(), c.Query("slugs"))
	if err != nil {
		h.fail(c, err)
		return
	}
	out := make(map[string]statsDTO, len(stats))
	for slug, s := range stats {
		out[slug] = toStats(s)
	}
	respond.Data(c, http.StatusOK, out)
}

func (h *handler) postStats(c *gin.Context) {
	st, liked, err := h.Engagement.PostStats(c.Request.Context(), c.Param("slug"), middleware.MemberPtr(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, postStatsDTO{statsDTO: toStats(st), LikedByMe: liked})
}

func (h *handler) recordView(c *gin.Context) {
	h.Engagement.RecordView(c.Request.Context(), c.Param("slug"), c.ClientIP(), c.Request.UserAgent())
	c.Status(http.StatusNoContent)
}

func (h *handler) setPostLike(c *gin.Context, like bool) {
	m, _ := current(c)
	liked, n, err := h.Engagement.LikePost(c.Request.Context(), m, c.Param("slug"), like)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	respond.Data(c, http.StatusOK, likeDTO{Liked: liked, Likes: n})
}

func (h *handler) likePost(c *gin.Context)   { h.setPostLike(c, true) }
func (h *handler) unlikePost(c *gin.Context) { h.setPostLike(c, false) }

// ---- comments ----

func (h *handler) listComments(c *gin.Context) {
	viewer := middleware.MemberPtr(c)
	res, err := h.Comments.List(c.Request.Context(), c.Param("slug"), viewer, service.CommentQuery{
		Sort: c.Query("sort"), Page: queryInt(c, "page"), PerPage: queryInt(c, "per_page"),
		RepliesPreview: queryIntDefault(c, "replies_preview", 2)})
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": h.toComments(res.Comments, viewer), "meta": commentsMetaDTO{
		Page: res.Page.Page, PerPage: res.Page.PerPage, Total: res.Total,
		TotalPages: domain.TotalPages(res.Total, res.Page.PerPage), CommentCount: res.CommentCount}})
}

func queryIntDefault(c *gin.Context, key string, def int) int {
	if _, ok := c.GetQuery(key); !ok {
		return def
	}
	return queryInt(c, key)
}

func (h *handler) listReplies(c *gin.Context) {
	viewer := middleware.MemberPtr(c)
	list, page, total, err := h.Comments.Replies(c.Request.Context(), c.Param("id"), viewer, queryInt(c, "page"),
		queryInt(c, "per_page"))
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.List(c, h.toComments(list, viewer), respond.NewMeta(page, total))
}

func (h *handler) createComment(c *gin.Context) {
	var in service.CreateCommentInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	m, _ := current(c)
	cm, err := h.Comments.Create(c.Request.Context(), m, c.Param("slug"), in)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	respond.Data(c, http.StatusCreated, h.toComment(cm, &m))
}

type editCommentBody struct {
	Body string `json:"body"`
}

func (h *handler) editComment(c *gin.Context) {
	var in editCommentBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	m, _ := current(c)
	cm, err := h.Comments.Edit(c.Request.Context(), m, c.Param("id"), in.Body)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	respond.Data(c, http.StatusOK, h.toComment(cm, &m))
}

func (h *handler) deleteComment(c *gin.Context) {
	m, _ := current(c)
	if err := h.Comments.Delete(c.Request.Context(), m, c.Param("id")); err != nil {
		h.failCommunity(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) setCommentLike(c *gin.Context, like bool) {
	m, _ := current(c)
	liked, n, err := h.Comments.Like(c.Request.Context(), m, c.Param("id"), like)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	respond.Data(c, http.StatusOK, likeDTO{Liked: liked, Likes: n})
}

func (h *handler) likeComment(c *gin.Context)   { h.setCommentLike(c, true) }
func (h *handler) unlikeComment(c *gin.Context) { h.setCommentLike(c, false) }

func (h *handler) reportComment(c *gin.Context) {
	var in service.ReportInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	m, _ := current(c)
	if err := h.Comments.Report(c.Request.Context(), m, c.Param("id"), in); err != nil {
		h.failCommunity(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type moderateBody struct {
	Action string `json:"action"`
}

func (h *handler) moderateComment(c *gin.Context) {
	var in moderateBody
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	m, _ := current(c)
	cm, err := h.Comments.Moderate(c.Request.Context(), m, c.Param("id"), in.Action)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	respond.Data(c, http.StatusOK, h.toComment(cm, &m))
}

func (h *handler) uploadCommentImage(c *gin.Context) {
	data, ok := readUploadFile(c, h.Comments.ImageMaxBytes())
	if !ok {
		return
	}
	m, _ := current(c)
	img, err := h.Comments.UploadImage(c.Request.Context(), m, data)
	if err != nil {
		h.failCommunity(c, err)
		return
	}
	respond.Data(c, http.StatusCreated, commentImageUploadDTO{ID: img.ID, URL: h.Comments.ImageURL(img.StorageKey),
		Width: img.Width, Height: img.Height})
}

// ---- admin ----

func (h *handler) adminListComments(c *gin.Context) {
	list, page, total, counts, err := h.Comments.AdminList(c.Request.Context(), service.AdminCommentQuery{
		Status: c.Query("status"), Q: c.Query("q"), Post: c.Query("post"), MemberID: c.Query("member_id"),
		Page: queryInt(c, "page"), PerPage: queryInt(c, "per_page")})
	if err != nil {
		h.fail(c, err)
		return
	}
	out := make([]adminCommentDTO, 0, len(list))
	for _, cm := range list {
		out = append(out, h.toAdminComment(cm))
	}
	c.JSON(http.StatusOK, gin.H{"data": out, "meta": respond.NewMeta(page, total),
		"counts": adminCommentCountsDTO{Pending: counts.Pending, Reported: counts.Reported}})
}

type adminCommentPatch struct {
	Status string `json:"status"`
}

func (h *handler) adminPatchComment(c *gin.Context) {
	var in adminCommentPatch
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	cm, err := h.Comments.AdminSetStatus(c.Request.Context(), middleware.ActorFrom(c), c.Param("id"), in.Status)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, h.toAdminComment(cm))
}

func (h *handler) adminDeleteComment(c *gin.Context) {
	if err := h.Comments.AdminDelete(c.Request.Context(), middleware.ActorFrom(c), c.Param("id")); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) adminBulkComments(c *gin.Context) {
	var in service.BulkCommentInput
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	res, err := h.Comments.AdminBulk(c.Request.Context(), middleware.ActorFrom(c), in)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, res)
}

func (h *handler) adminCommentHistory(c *gin.Context) {
	edits, err := h.Comments.History(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	out := make([]commentEditDTO, 0, len(edits))
	for _, e := range edits {
		out = append(out, commentEditDTO{Body: e.Body, EditedAt: e.EditedAt.UTC()})
	}
	respond.Data(c, http.StatusOK, out)
}

func (h *handler) adminListMembers(c *gin.Context) {
	rows, page, total, err := h.Members.AdminList(c.Request.Context(), service.AdminMemberQuery{Q: c.Query("q"),
		Role: c.Query("role"), Page: queryInt(c, "page"), PerPage: queryInt(c, "per_page")})
	if err != nil {
		h.fail(c, err)
		return
	}
	withEmail := middleware.PermFrom(c, domain.PermUsersManage)
	out := make([]adminMemberDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, h.toAdminMember(r, withEmail))
	}
	respond.List(c, out, respond.NewMeta(page, total))
}

func (h *handler) adminPatchMember(c *gin.Context) {
	var in service.MemberPatch
	if err := decodeJSON(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	row, err := h.Members.AdminUpdate(c.Request.Context(), middleware.ActorFrom(c), c.Param("id"), in)
	if err != nil {
		h.fail(c, err)
		return
	}
	respond.Data(c, http.StatusOK, h.toAdminMember(row, middleware.PermFrom(c, domain.PermUsersManage)))
}
