package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"sync"

	"github.com/pressly/goose/v3"
)

type gooseLogger struct{ log *slog.Logger }

func (g gooseLogger) Fatalf(format string, v ...any) { g.log.Error(fmt.Sprintf(format, v...)) }
func (g gooseLogger) Printf(format string, v ...any) { g.log.Info(fmt.Sprintf(format, v...)) }

var mu sync.Mutex // goose keeps package-level state

// Run applies "up", "down" (one step) or prints "status" using the embedded SQL.
func Run(ctx context.Context, db *sql.DB, log *slog.Logger, direction string) error {
	mu.Lock()
	defer mu.Unlock()
	goose.SetBaseFS(FS)
	goose.SetLogger(gooseLogger{log})
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	switch direction {
	case "up":
		return goose.UpContext(ctx, db, ".")
	case "down":
		return goose.DownContext(ctx, db, ".")
	case "status":
		return goose.StatusContext(ctx, db, ".")
	default:
		return fmt.Errorf("migrate: unknown direction %q (want up, down or status)", direction)
	}
}
