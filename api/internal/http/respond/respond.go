// Package respond writes JSON success bodies and the API error envelope:
// {"error":{"code","message","fields"}}.
package respond

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

const (
	CodeValidation      = "validation_failed"
	CodeNotFound        = "not_found"
	CodeRateLimited     = "rate_limited"
	CodeUnauthorized    = "unauthorized"
	CodeForbidden       = "forbidden"
	CodePayloadTooLarge = "payload_too_large"
	CodeInternal        = "internal"
	CodeInUse           = "in_use"
)

type ErrorBody struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

type Envelope struct {
	Error ErrorBody `json:"error"`
}

type Meta struct {
	Page       int `json:"page"`
	PerPage    int `json:"per_page"`
	Total      int `json:"total"`
	TotalPages int `json:"total_pages"`
}

func NewMeta(p domain.Page, total int) Meta {
	return Meta{Page: p.Page, PerPage: p.PerPage, Total: total, TotalPages: domain.TotalPages(total, p.PerPage)}
}

func Data(c *gin.Context, status int, data any) {
	c.JSON(status, gin.H{"data": data})
}

func List(c *gin.Context, data any, meta Meta) {
	c.JSON(http.StatusOK, gin.H{"data": data, "meta": meta})
}

// Error aborts the request with the error envelope.
func Error(c *gin.Context, status int, code, message string, fields map[string]string) {
	c.AbortWithStatusJSON(status, Envelope{Error: ErrorBody{Code: code, Message: message, Fields: fields}})
}

var (
	// ErrBadJSON is mapped to 400 validation_failed.
	ErrBadJSON = errors.New("malformed json")
)

// FromError maps domain/service errors onto the envelope; unknown errors are
// logged and returned as 500 internal without leaking details.
func FromError(c *gin.Context, log *slog.Logger, err error) {
	var ve *domain.ValidationError
	var mbe *http.MaxBytesError
	var iu *domain.InUseError
	switch {
	case errors.Is(err, domain.ErrNoPermission):
		Error(c, http.StatusForbidden, CodeForbidden, domain.MsgNoPermission, nil)
	case errors.As(err, &iu):
		Error(c, http.StatusConflict, CodeInUse, iu.Message(), nil)
	case errors.As(err, &ve):
		msg := ve.Message
		if msg == "" {
			msg = domain.MsgValidationFailed
		}
		Error(c, http.StatusUnprocessableEntity, CodeValidation, msg, ve.Fields)
	case errors.Is(err, domain.ErrNotFound):
		Error(c, http.StatusNotFound, CodeNotFound, domain.MsgNotFound, nil)
	case errors.Is(err, domain.ErrUnauthorized):
		Error(c, http.StatusUnauthorized, CodeUnauthorized, domain.MsgUnauthorized, nil)
	case errors.Is(err, domain.ErrForbidden):
		Error(c, http.StatusForbidden, CodeForbidden, domain.MsgForbidden, nil)
	case errors.Is(err, domain.ErrTooLarge), errors.As(err, &mbe):
		Error(c, http.StatusRequestEntityTooLarge, CodePayloadTooLarge, domain.MsgPayloadTooLarge, nil)
	case errors.Is(err, ErrBadJSON):
		Error(c, http.StatusBadRequest, CodeValidation, domain.MsgInvalidJSON, nil)
	default:
		log.Error("request failed", "err", err, "path", c.FullPath(), "request_id", c.GetString("request_id"))
		Error(c, http.StatusInternalServerError, CodeInternal, domain.MsgInternal, nil)
	}
}
