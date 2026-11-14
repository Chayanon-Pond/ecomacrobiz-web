// Package handlers wires the Gin router and implements the HTTP endpoints of
// the contract in CONTRACTS.md ("Go API contract").
package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/ecomacrobiz/escoma/api/internal/config"
	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/http/middleware"
	"github.com/ecomacrobiz/escoma/api/internal/http/respond"
	"github.com/ecomacrobiz/escoma/api/internal/ratelimit"
	"github.com/ecomacrobiz/escoma/api/internal/service"
	"github.com/ecomacrobiz/escoma/api/internal/storage"
)

type Pinger interface {
	Ping(ctx context.Context) error
}

type Deps struct {
	Config     *config.Config
	Log        *slog.Logger
	DB         Pinger
	Posts      *service.PostService
	Contact    *service.ContactService
	Auth       *service.AuthService
	Leads      *service.LeadService
	Media      *service.MediaService
	MediaFiles storage.Opener // nil when media is not served by this process

	Users   *service.UserService
	Account *service.AccountService
	Audit   *service.AuditService

	ContactLimiter    *ratelimit.Limiter
	LoginIPLimiter    *ratelimit.Limiter
	LoginEmailLimiter *ratelimit.Limiter
	// TokenLimiter: per-IP limit on the public invite/reset token endpoints.
	TokenLimiter *ratelimit.Limiter
}

type handler struct{ Deps }

const (
	contactBodyLimit = 16 << 10
	smallBodyLimit   = 16 << 10
	postBodyLimit    = 1 << 20
)

func NewRouter(d Deps) (*gin.Engine, error) {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	// Default Gin trusts every proxy; we only trust TRUSTED_PROXIES (nil = none).
	if err := r.SetTrustedProxies(d.Config.TrustedProxies); err != nil {
		return nil, err
	}
	r.ForwardedByClientIP = true
	r.RemoteIPHeaders = []string{"X-Forwarded-For"}
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false
	r.ContextWithFallback = true

	h := &handler{Deps: d}
	cors := d.Config.CORSAllowedOrigins

	r.Use(middleware.RequestID(), middleware.AccessLog(d.Log), middleware.Recover(d.Log),
		middleware.SecurityHeaders(d.Config.HSTSEnabled), middleware.CORS(cors))
	r.NoRoute(func(c *gin.Context) {
		respond.Error(c, http.StatusNotFound, respond.CodeNotFound, domain.MsgNotFound, nil)
	})

	r.GET("/healthz", h.healthz)
	if d.MediaFiles != nil {
		r.GET("/media/*filepath", h.serveMedia)
		r.HEAD("/media/*filepath", h.serveMedia)
	}

	v1 := r.Group("/api/v1")
	pub := v1.Group("", publicCache)
	pub.GET("/categories", h.listCategories)
	pub.GET("/posts", h.listPosts)
	pub.GET("/posts/:slug", h.getPost)
	v1.POST("/contact", noStore, middleware.BodyLimit(contactBodyLimit),
		middleware.RateLimit(d.ContactLimiter, middleware.ClientIPKey), h.contact)

	admin := v1.Group("/admin", noStore)
	admin.POST("/auth/login", middleware.BodyLimit(smallBodyLimit), middleware.RequireOrigin(cors), h.login)

	authed := admin.Group("", middleware.RequireSession(d.Auth, d.Log), middleware.RequireCSRF(cors))
	// Every authed route MUST carry RequirePerm / RequireAnyPerm / AnyAuthenticated
	// (asserted by the RBAC matrix test).
	h.registerAuthRoutes(admin, authed) // routes_auth.go: auth, account, users, invites, audit, settings
	h.registerContentRoutes(authed)     // routes_content.go: dashboard, posts, media, leads
	return r, nil
}

func publicCache(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
	c.Next()
}

func noStore(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Next()
}

func (h *handler) fail(c *gin.Context, err error) { respond.FromError(c, h.Log, err) }

// decodeJSON requires a JSON content type and a single JSON value.
func decodeJSON(c *gin.Context, dst any) error {
	if mt, _, err := mime.ParseMediaType(c.GetHeader("Content-Type")); err != nil || mt != "application/json" {
		return &domain.ValidationError{Message: "Content-Type ต้องเป็น application/json"}
	}
	dec := json.NewDecoder(c.Request.Body)
	if err := dec.Decode(dst); err != nil {
		var mbe *http.MaxBytesError
		var te *json.UnmarshalTypeError
		switch {
		case errors.As(err, &mbe):
			return err
		case errors.As(err, &te) && te.Field != "":
			return &domain.ValidationError{Message: domain.MsgValidationFailed,
				Fields: map[string]string{te.Field: "รูปแบบข้อมูลไม่ถูกต้อง"}}
		default:
			return respond.ErrBadJSON
		}
	}
	if dec.More() {
		return respond.ErrBadJSON
	}
	return nil
}

func queryInt(c *gin.Context, key string) int {
	n, err := strconv.Atoi(c.Query(key))
	if err != nil {
		return 0
	}
	return n
}

func (h *handler) healthz(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := h.DB.Ping(ctx); err != nil {
		h.Log.Error("healthz: database ping failed", "err", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "error", "db": "down"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "db": "ok"})
}
