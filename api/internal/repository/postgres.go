package repository

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
)

// DB is the subset of pgxpool.Pool (and pgx.Tx) used by the repositories.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Store bundles all Postgres repositories over one pool.
type Store struct {
	Categories *PGCategories
	Posts      *PGPosts
	Leads      *PGLeads
	AdminUsers *PGAdminUsers
	Sessions   *PGSessions
	Media      *PGMedia
	Tokens     *PGUserTokens
	Audit      *PGAuditLogs
}

func NewStore(db DB) *Store {
	return &Store{
		Categories: &PGCategories{db: db},
		Posts:      &PGPosts{db: db},
		Leads:      &PGLeads{db: db},
		AdminUsers: &PGAdminUsers{db: db},
		Sessions:   &PGSessions{db: db},
		Media:      &PGMedia{db: db},
		Tokens:     &PGUserTokens{db: db},
		Audit:      &PGAuditLogs{db: db},
	}
}

// NewPool opens and pings a pgx pool.
func NewPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func mapErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return domain.ErrConflict
		case "22P02": // invalid_text_representation, e.g. malformed uuid
			return domain.ErrNotFound
		}
	}
	return err
}

// likePattern escapes LIKE metacharacters and wraps the term in %...%.
func likePattern(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}

func withTx(ctx context.Context, db DB, fn func(tx pgx.Tx) error) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
