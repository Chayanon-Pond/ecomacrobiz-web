// Command server is the ECOMACROBIZ API.
//
//	server [serve]                      run the HTTP API (default)
//	server migrate up|down|status       manage the schema (goose, embedded SQL)
//	server seed-posts --file posts.json import the blog bundle (idempotent)
//	server create-admin                 upsert the admin from ADMIN_* env
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
	_ "time/tzdata" // Asia/Bangkok in minimal images

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/ecomacrobiz/escoma/api/internal/config"
	"github.com/ecomacrobiz/escoma/api/internal/http/handlers"
	"github.com/ecomacrobiz/escoma/api/internal/notify"
	"github.com/ecomacrobiz/escoma/api/internal/ratelimit"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/seed"
	"github.com/ecomacrobiz/escoma/api/internal/service"
	"github.com/ecomacrobiz/escoma/api/internal/storage"
	"github.com/ecomacrobiz/escoma/api/internal/vault"
	"github.com/ecomacrobiz/escoma/api/migrations"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(log)

	cmd := "serve"
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch cmd {
	case "serve":
		return serve(ctx, cfg, log)
	case "migrate":
		return migrateCmd(ctx, cfg, log, args)
	case "seed-posts":
		return seedCmd(ctx, cfg, log, args)
	case "create-admin":
		return createAdminCmd(ctx, cfg, log)
	case "help", "-h", "--help":
		fmt.Println("usage: server [serve | migrate up|down|status | seed-posts --file <posts.json> | create-admin]")
		return nil
	default:
		return fmt.Errorf("unknown command %q", cmd)
	}
}

func openPool(ctx context.Context, cfg *config.Config) (*pgxpool.Pool, error) {
	if err := cfg.RequireDB(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return repository.NewPool(ctx, cfg.DatabaseURL)
}

func migrate(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger, direction string) error {
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	return migrations.Run(ctx, db, log, direction)
}

func migrateCmd(ctx context.Context, cfg *config.Config, log *slog.Logger, args []string) error {
	if len(args) != 1 {
		return errors.New("usage: server migrate up|down|status")
	}
	pool, err := openPool(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	return migrate(ctx, pool, log, args[0])
}

func seedCmd(ctx context.Context, cfg *config.Config, log *slog.Logger, args []string) error {
	fs := flag.NewFlagSet("seed-posts", flag.ContinueOnError)
	file := fs.String("file", "", "path to posts.json (web/src/content/posts/posts.json)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *file == "" {
		return errors.New("seed-posts: --file is required")
	}
	f, err := os.Open(*file)
	if err != nil {
		return err
	}
	defer f.Close()
	bundle, err := seed.Decode(f)
	if err != nil {
		return err
	}
	pool, err := openPool(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	store := repository.NewStore(pool)
	res, err := seed.Run(ctx, bundle, store.Categories, store.Posts, log)
	if err != nil {
		return err
	}
	log.Info("seed complete", "categories", res.Categories, "posts_changed", res.PostsChanged,
		"posts_unchanged", res.PostsSame)
	return nil
}

func createAdminCmd(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	if cfg.AdminEmail == "" {
		return errors.New("create-admin: set ADMIN_EMAIL and ADMIN_PASSWORD (and optionally ADMIN_NAME, ADMIN_RESET_PASSWORD)")
	}
	pool, err := openPool(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	store := repository.NewStore(pool)
	auth := service.NewAuthService(store.AdminUsers, store.Sessions, cfg.SessionTTL, 0, log)
	return bootstrapAdmin(ctx, cfg, auth, log)
}

func bootstrapAdmin(ctx context.Context, cfg *config.Config, auth *service.AuthService, log *slog.Logger) error {
	if cfg.AdminEmail == "" {
		return nil
	}
	outcome, err := auth.EnsureAdmin(ctx, cfg.AdminEmail, cfg.AdminPassword, cfg.AdminName, cfg.AdminResetPassword)
	if err != nil {
		return fmt.Errorf("admin bootstrap: %w", err)
	}
	log.Info("admin bootstrap", "email", cfg.AdminEmail, "outcome", outcome)
	return nil
}

func buildNotifiers(cfg *config.Config, log *slog.Logger) []notify.Notifier {
	var ns []notify.Notifier
	if cfg.ResendEnabled() {
		ns = append(ns, notify.NewResend(cfg.ResendAPIKey, cfg.SMTPFrom, cfg.SMTPTo))
		log.Info("email notifier enabled (resend api)", "to", len(cfg.SMTPTo))
	} else if cfg.SMTPEnabled() {
		ns = append(ns, notify.NewEmail(notify.EmailConfig{Host: cfg.SMTPHost, Port: cfg.SMTPPort,
			Username: cfg.SMTPUsername, Password: cfg.SMTPPassword, From: cfg.SMTPFrom, To: cfg.SMTPTo}))
		log.Info("email notifier enabled", "host", cfg.SMTPHost, "port", cfg.SMTPPort, "to", len(cfg.SMTPTo))
	} else {
		log.Info("email notifier disabled (RESEND_API_KEY or SMTP_HOST, plus SMTP_FROM/SMTP_TO, unset)")
	}
	if cfg.LineEnabled() {
		ns = append(ns, notify.NewLine(cfg.LineChannelAccessToken, cfg.LineTo))
		log.Info("line notifier enabled")
	} else {
		log.Info("line notifier disabled (LINE_CHANNEL_ACCESS_TOKEN/LINE_TO unset)")
	}
	return ns
}

// directSender is the transport for invitation/reset e-mails: the same one
// as lead e-mails (Resend wins over SMTP), or nil when none is configured.
func directSender(cfg *config.Config) notify.DirectSender {
	switch cfg.EmailProvider() {
	case "resend":
		return notify.NewResend(cfg.ResendAPIKey, cfg.SMTPFrom, cfg.SMTPTo)
	case "smtp":
		return notify.NewEmail(notify.EmailConfig{Host: cfg.SMTPHost, Port: cfg.SMTPPort, Username: cfg.SMTPUsername,
			Password: cfg.SMTPPassword, From: cfg.SMTPFrom, To: cfg.SMTPTo})
	}
	return nil
}

func serve(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	pool, err := openPool(ctx, cfg)
	if err != nil {
		return fmt.Errorf("database: %w", err)
	}
	defer pool.Close()

	if cfg.MigrateOnStart {
		if err := migrate(ctx, pool, log, "up"); err != nil {
			return fmt.Errorf("migrate on start: %w", err)
		}
	}

	store := repository.NewStore(pool)
	audit := service.NewAuditService(store.Audit, log)
	media, err := storage.NewLocalDisk(cfg.MediaDir, cfg.PublicBaseURL)
	if err != nil {
		return err
	}
	defer media.Close()

	dispatcher := notify.NewDispatcher(log, 15*time.Second, buildNotifiers(cfg, log)...)
	revalidator := notify.NewRevalidator(cfg.WebRevalidateURL, cfg.RevalidateSecret, log)
	if cfg.WebRevalidateURL == "" {
		log.Info("revalidate webhook disabled (WEB_REVALIDATE_URL unset)")
	}
	indexNow := notify.NewIndexNow(cfg.IndexNowKey, cfg.WebBaseURL, log)
	if indexNow.Enabled() {
		log.Info("indexnow enabled", "host", cfg.WebBaseURL)
	} else {
		log.Info("indexnow disabled (needs INDEXNOW_KEY and WEB_BASE_URL)")
	}
	redirects := service.NewRedirectService(store.Redirects, store.Posts, revalidator, audit, log)
	redirects.SetSiteBaseURL(cfg.WebBaseURL)
	posts := service.NewPostService(store.Posts, store.Categories, store.Media, redirects, revalidator, audit, log)
	posts.SetIndexer(indexNow)

	auth := service.NewAuthService(store.AdminUsers, store.Sessions, cfg.SessionTTL, 0, log)
	auth.SetAuditor(audit)
	if err := bootstrapAdmin(ctx, cfg, auth, log); err != nil {
		return err
	}
	mailer := notify.NewMailer(directSender(cfg), log, 15*time.Second)
	if !mailer.Enabled() || cfg.WebBaseURL == "" {
		log.Info("invite/reset e-mails disabled (needs WEB_BASE_URL and an e-mail transport); owners copy the links")
	}
	users := service.NewUserService(store.AdminUsers, store.Sessions, store.Tokens, auth, audit, mailer,
		service.UserServiceConfig{InviteTTL: cfg.InviteTTL, WebBaseURL: cfg.WebBaseURL}, log)

	contactLim := ratelimit.New(cfg.ContactRateLimit.Events, cfg.ContactRateLimit.Per)
	loginIPLim := ratelimit.New(cfg.LoginRateLimit.Events, cfg.LoginRateLimit.Per)
	loginEmailLim := ratelimit.New(cfg.LoginRateLimit.Events, cfg.LoginRateLimit.Per)
	tokenLim := ratelimit.New(20, 10*time.Minute)   // public invite/reset token endpoints, per IP
	passwordLim := ratelimit.New(5, 15*time.Minute) // PUT /account/password, per user
	for _, l := range []*ratelimit.Limiter{contactLim, loginIPLim, loginEmailLim, tokenLim, passwordLim} {
		l.StartJanitor(time.Minute)
		defer l.Stop()
	}

	crypto, err := memberCrypto(cfg, log)
	if err != nil {
		return err
	}
	mc := cfg.Members
	var human service.HumanVerifier
	if mc.TurnstileSecret != "" {
		human = service.NewTurnstile(mc.TurnstileSecret, log)
	}
	members := service.NewMemberService(store.Members, store.MemberSessions, store.MemberTokens, store.Comments, crypto,
		media, mailer, human, revalidator, audit, service.MemberServiceConfig{SessionTTL: mc.SessionTTL,
			WebBaseURL: cfg.WebBaseURL, MailEnabled: cfg.MemberMailEnabled(), RequireVerified: mc.RequireVerifiedEmail,
			AvatarMaxBytes: mc.AvatarMaxBytes}, log)
	commentCfg := service.CommentServiceConfig{HoldFirstComment: mc.HoldFirstComment,
		RequireVerified: mc.RequireVerifiedEmail, ImageMaxBytes: mc.CommentImageMaxBytes}
	comments := service.NewCommentService(store.Comments, store.Posts, store.Members, store.Engagement, media,
		revalidator, audit, commentCfg, log)
	engagement := service.NewEngagementService(store.Engagement, store.Posts, commentCfg, log)
	var google *service.GoogleService
	if mc.GoogleEnabled() {
		google = service.NewGoogleService(
			service.NewGoogleOIDC(mc.OIDCIssuerURL, mc.GoogleClientID, mc.GoogleClientSecret, cfg.GoogleRedirectURL()),
			store.OAuthStates, store.Members, store.MemberTokens, members,
			service.GoogleServiceConfig{WebBaseURL: cfg.WebBaseURL, AvatarHostAllowed: avatarHosts(cfg)}, log)
		log.Info("google sign-in enabled", "issuer", mc.OIDCIssuerURL, "redirect_uri", cfg.GoogleRedirectURL())
	} else {
		log.Info("google sign-in disabled (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET unset)")
	}
	log.Info("community", "require_verified_email", mc.RequireVerifiedEmail, "hold_first_comment", mc.HoldFirstComment,
		"member_mail", members.MailEnabled(), "turnstile", human != nil, "data_key_ids", crypto.Keys.KeyIDs())
	rl := func(r config.RateLimit) *ratelimit.Limiter { return ratelimit.New(r.Events, r.Per) }
	limits := handlers.CommunityLimiters{
		Register:    rl(mc.RegisterRateLimit),
		LoginIP:     rl(mc.LoginRateLimit),
		LoginEmail:  rl(mc.LoginRateLimit),
		Token:       ratelimit.New(20, 10*time.Minute),
		Forgot:      ratelimit.New(5, time.Hour),
		Resend:      ratelimit.New(3, time.Hour),
		GoogleStart: ratelimit.New(20, 10*time.Minute),
		GoogleLink:  ratelimit.New(10, 15*time.Minute),
		Avatar:      ratelimit.New(10, time.Hour),
		Password:    ratelimit.New(5, 15*time.Minute),
		Views:       ratelimit.New(60, 10*time.Minute),
		Likes:       ratelimit.New(60, time.Minute),
		Comment:     rl(mc.CommentRateLimit),
		CommentIP:   rl(mc.CommentIPRateLimit),
		Report:      ratelimit.New(20, time.Hour),
		Upload:      ratelimit.New(10, time.Hour),
	}
	for _, l := range limits.All() {
		l.StartJanitor(time.Minute)
		defer l.Stop()
	}

	router, err := handlers.NewRouter(handlers.Deps{
		Config:            cfg,
		Log:               log,
		DB:                pool,
		Posts:             posts,
		Redirects:         redirects,
		Contact:           service.NewContactService(store.Leads, dispatcher, log),
		Auth:              auth,
		Leads:             service.NewLeadService(store.Leads, audit, log),
		Media:             service.NewMediaService(store.Media, media, cfg.MaxUploadBytes, cfg.MediaMaxDimension, audit, log),
		MediaFiles:        media,
		ContactLimiter:    contactLim,
		LoginIPLimiter:    loginIPLim,
		LoginEmailLimiter: loginEmailLim,
		TokenLimiter:      tokenLim,
		PasswordLimiter:   passwordLim,
		Users:             users,
		Account:           service.NewAccountService(store.AdminUsers, store.Sessions, auth, audit, log),
		Audit:             audit,
		Members:           members,
		Google:            google,
		Comments:          comments,
		Engagement:        engagement,
		CommunityLimits:   limits,
	})
	if err != nil {
		return err
	}

	go sessionJanitor(ctx, auth, log)

	// Scheduled posts: runs once now, then every SCHEDULER_INTERVAL.
	scheduler := service.NewPostScheduler(store.Posts, audit, revalidator, log)
	scheduler.SetIndexer(indexNow)
	schedCtx, stopScheduler := context.WithCancel(ctx)
	schedDone := make(chan struct{})
	go func() {
		defer close(schedDone)
		scheduler.Run(schedCtx, cfg.SchedulerInterval)
	}()
	defer func() { stopScheduler(); <-schedDone }()
	log.Info("post scheduler started", "interval", cfg.SchedulerInterval.String())

	// Community purge (expired member sessions/tokens/OAuth states, old view
	// salts, unattached comment images): now, then hourly.
	janitor := service.NewCommunityJanitor(store.Engagement, store.Comments, media, log)
	janitorDone := make(chan struct{})
	go func() {
		defer close(janitorDone)
		janitor.Run(schedCtx, time.Hour)
	}()
	defer func() { stopScheduler(); <-janitorDone }()

	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       60 * time.Second, // uploads
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
	errCh := make(chan error, 1)
	go func() {
		log.Info("api listening", "addr", srv.Addr, "env", cfg.AppEnv)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down", "timeout", cfg.ShutdownTimeout.String())
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("http shutdown", "err", err)
	}
	stopScheduler()
	<-schedDone
	<-janitorDone
	dispatcher.Wait(shutdownCtx)
	members.Wait(shutdownCtx)
	mailer.Wait(shutdownCtx)
	revalidator.Wait(shutdownCtx)
	indexNow.Wait(shutdownCtx)
	log.Info("shutdown complete")
	return nil
}

// memberCrypto builds the member keyring, blind index and password hasher.
// Outside production missing keys are generated per boot (config already
// rejects that in production).
func memberCrypto(cfg *config.Config, log *slog.Logger) (service.MemberCrypto, error) {
	mc := cfg.Members
	var (
		keys  *vault.Keyring
		index *vault.Index
		err   error
	)
	if mc.DataKey != "" {
		if keys, err = vault.ParseKeyring(mc.DataKey); err != nil {
			return service.MemberCrypto{}, fmt.Errorf("MEMBER_DATA_KEY: %w", err)
		}
	} else {
		log.Warn("MEMBER_DATA_KEY unset: using a random key for this process; member e-mails become unreadable after a restart")
		if keys, err = vault.NewKeyring([]int16{1}, map[int16][]byte{1: vault.RandomKey()}); err != nil {
			return service.MemberCrypto{}, err
		}
	}
	if mc.IndexKey != "" {
		if index, err = vault.ParseIndexKey(mc.IndexKey); err != nil {
			return service.MemberCrypto{}, fmt.Errorf("MEMBER_INDEX_KEY: %w", err)
		}
	} else {
		log.Warn("MEMBER_INDEX_KEY unset: using a random key for this process; members cannot sign in after a restart")
		index = vault.NewIndex(vault.RandomKey())
	}
	return service.MemberCrypto{Keys: keys, Index: index, Hasher: vault.NewHasher(vault.DefaultArgon2)}, nil
}

// avatarHosts: Google profile pictures, plus the stub issuer's host when
// OIDC_ISSUER_URL is overridden outside production.
func avatarHosts(cfg *config.Config) func(*url.URL) bool {
	stubHost := ""
	if cfg.Members.IssuerOverridden() && !cfg.IsProduction() {
		if u, err := url.Parse(cfg.Members.OIDCIssuerURL); err == nil {
			stubHost = u.Host
		}
	}
	return func(u *url.URL) bool {
		if service.GoogleAvatarHost(u) {
			return true
		}
		return stubHost != "" && u.Host == stubHost && (u.Scheme == "http" || u.Scheme == "https")
	}
}

func sessionJanitor(ctx context.Context, auth *service.AuthService, log *slog.Logger) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		n, err := auth.PurgeExpiredSessions(ctx)
		if err != nil && ctx.Err() == nil {
			log.Warn("purge expired sessions", "err", err)
		} else if n > 0 {
			log.Info("purged expired sessions", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
