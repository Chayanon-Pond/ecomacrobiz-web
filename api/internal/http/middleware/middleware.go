// Package middleware contains the Gin middleware chain: request id, access
// log, panic recovery, security headers, CORS, body limits, rate limiting,
// admin session auth and CSRF.
package middleware

import (
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
	"github.com/ecomacrobiz/escoma/api/internal/ratelimit"
)

const (
	RequestIDHeader = "X-Request-ID"
	CtxRequestID    = "request_id"
)

var requestIDRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// RequestID accepts a sane inbound X-Request-ID (e.g. from the Next proxy) or
// generates one, and echoes it on the response.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader(RequestIDHeader)
		if !requestIDRe.MatchString(id) {
			id = uuid.NewString()
		}
		c.Set(CtxRequestID, id)
		c.Header(RequestIDHeader, id)
		c.Next()
	}
}

// AccessLog writes one structured line per request. /healthz is logged at
// debug level to keep platform health probes out of the logs.
func AccessLog(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		status := c.Writer.Status()
		level := slog.LevelInfo
		switch {
		case status >= 500:
			level = slog.LevelError
		case status >= 400:
			level = slog.LevelWarn
		case c.Request.URL.Path == "/healthz":
			level = slog.LevelDebug
		}
		log.LogAttrs(c.Request.Context(), level, "http request",
			slog.String("request_id", c.GetString(CtxRequestID)),
			slog.String("method", c.Request.Method),
			slog.String("path", c.Request.URL.Path),
			slog.String("route", c.FullPath()),
			slog.Int("status", status),
			slog.Int("bytes", c.Writer.Size()),
			slog.Int64("duration_ms", time.Since(start).Milliseconds()),
			slog.String("ip", c.ClientIP()),
			slog.String("user_agent", c.Request.UserAgent()),
		)
	}
}

// Recover turns panics into a 500 envelope and logs the stack.
func Recover(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				if r == http.ErrAbortHandler {
					panic(r)
				}
				log.Error("panic recovered", "panic", fmt.Sprint(r), "request_id", c.GetString(CtxRequestID),
					"path", c.Request.URL.Path, "stack", string(debug.Stack()))
				if !c.Writer.Written() {
					respond.Error(c, http.StatusInternalServerError, respond.CodeInternal, domain.MsgInternal, nil)
				} else {
					c.Abort()
				}
			}
		}()
		c.Next()
	}
}

// APICSP is a deny-all policy: API responses are data, never documents.
const APICSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

func SecurityHeaders(hsts bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Content-Security-Policy", APICSP)
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		if strings.HasPrefix(c.Request.URL.Path, "/media/") {
			// Images are embedded by the website on another origin.
			h.Set("Cross-Origin-Resource-Policy", "cross-origin")
		} else {
			h.Set("Cross-Origin-Resource-Policy", "same-site")
		}
		if hsts {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		c.Next()
	}
}

// OriginAllowed reports whether origin exactly matches the allowlist.
func OriginAllowed(allowed []string, origin string) bool {
	return origin != "" && slices.Contains(allowed, origin)
}

// CORS allows credentialed requests only from the configured origins.
func CORS(allowed []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		h := c.Writer.Header()
		h.Add("Vary", "Origin")
		ok := OriginAllowed(allowed, origin)
		if ok {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Expose-Headers", "Retry-After, X-Request-ID, Content-Disposition")
		}
		if c.Request.Method == http.MethodOptions && c.GetHeader("Access-Control-Request-Method") != "" {
			if !ok {
				respond.Error(c, http.StatusForbidden, respond.CodeForbidden, domain.MsgForbidden, nil)
				return
			}
			h.Add("Vary", "Access-Control-Request-Method")
			h.Add("Vary", "Access-Control-Request-Headers")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Request-ID")
			h.Set("Access-Control-Max-Age", "600")
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// BodyLimit rejects bodies larger than n bytes (413) and caps the reader.
func BodyLimit(n int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > n {
			respond.Error(c, http.StatusRequestEntityTooLarge, respond.CodePayloadTooLarge, domain.MsgPayloadTooLarge, nil)
			return
		}
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, n)
		}
		c.Next()
	}
}

// RateLimit applies lim keyed by keyFn (e.g. client IP); 429 + Retry-After.
func RateLimit(lim *ratelimit.Limiter, keyFn func(*gin.Context) string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ok, wait := lim.Allow(keyFn(c), time.Now())
		if !ok {
			AbortRateLimited(c, wait)
			return
		}
		c.Next()
	}
}

func AbortRateLimited(c *gin.Context, wait time.Duration) {
	secs := int64(math.Ceil(wait.Seconds()))
	if secs < 1 {
		secs = 1
	}
	if secs > 86400 {
		secs = 86400
	}
	c.Header("Retry-After", strconv.FormatInt(secs, 10))
	respond.Error(c, http.StatusTooManyRequests, respond.CodeRateLimited, domain.MsgRateLimited, nil)
}

func ClientIPKey(c *gin.Context) string { return "ip:" + c.ClientIP() }
