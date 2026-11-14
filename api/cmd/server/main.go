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
	tokenLim := ratelimit.New(20, 10*time.Minute) // public invite/reset token endpoints, per IP
	for _, l := range []*ratelimit.Limiter{contactLim, loginIPLim, loginEmailLim, tokenLim} {
		l.StartJanitor(time.Minute)
		defer l.Stop()
	}

	router, err := handlers.NewRouter(handlers.Deps{
		Config:            cfg,
		Log:               log,
		DB:                pool,
		Posts:             service.NewPostService(store.Posts, store.Categories, store.Media, revalidator, audit, log),
		Contact:           service.NewContactService(store.Leads, dispatcher, log),
		Auth:              auth,
		Leads:             service.NewLeadService(store.Leads, audit, log),
		Media:             service.NewMediaService(store.Media, media, cfg.MaxUploadBytes, cfg.MediaMaxDimension, audit, log),
		MediaFiles:        media,
		ContactLimiter:    contactLim,
		LoginIPLimiter:    loginIPLim,
		LoginEmailLimiter: loginEmailLim,
		TokenLimiter:      tokenLim,
		Users:             users,
		Account:           service.NewAccountService(store.AdminUsers, store.Sessions, auth, audit, log),
		Audit:             audit,
	})
	if err != nil {
		return err
	}

	go sessionJanitor(ctx, auth, log)

	// Scheduled posts: runs once now, then every SCHEDULER_INTERVAL.
	scheduler := service.NewPostScheduler(store.Posts, audit, revalidator, log)
	schedCtx, stopScheduler := context.WithCancel(ctx)
	schedDone := make(chan struct{})
	go func() {
		defer close(schedDone)
		scheduler.Run(schedCtx, cfg.SchedulerInterval)
	}()
	defer func() { stopScheduler(); <-schedDone }()
	log.Info("post scheduler started", "interval", cfg.SchedulerInterval.String())

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
	dispatcher.Wait(shutdownCtx)
	mailer.Wait(shutdownCtx)
	revalidator.Wait(shutdownCtx)
	log.Info("shutdown complete")
	return nil
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
