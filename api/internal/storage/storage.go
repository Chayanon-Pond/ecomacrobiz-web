// Package storage abstracts where uploaded media bytes live. LocalDisk is the
// only implementation today; an S3/R2 store only needs to implement MediaStore
// (and return absolute CDN URLs from URL), the /media route is then unused.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"regexp"
	"strings"
)

type MediaStore interface {
	// Put stores r under key (ErrKeyExists if taken). Keys are flat names
	// like "<descriptive-slug>-<8 hex>.webp" (older uploads: "<uuid>.webp").
	Put(ctx context.Context, key string, r io.Reader, contentType string) error
	Delete(ctx context.Context, key string) error
	// URL returns the absolute public URL for key.
	URL(key string) string
}

// Opener is implemented by stores that the API serves itself under /media/.
type Opener interface {
	Open(key string) (*os.File, error)
}

var keyRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.[a-z0-9]{1,8}$`)

var ErrInvalidKey = errors.New("invalid media key")

// ErrKeyExists: Put never overwrites a stored file (keys are immutable).
var ErrKeyExists = errors.New("media key exists")

func ValidKey(key string) bool { return keyRe.MatchString(key) }

// LocalDisk stores files in a directory, confined with os.Root so a key can
// never escape it.
type LocalDisk struct {
	root    *os.Root
	baseURL string
}

// NewLocalDisk creates dir if needed. baseURL is e.g. "https://api.example.com".
func NewLocalDisk(dir, baseURL string) (*LocalDisk, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("create media dir: %w", err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("open media dir: %w", err)
	}
	// Fail fast when the directory is not writable (e.g. a root-owned Railway
	// volume while the image runs as uid 65532 — set RAILWAY_RUN_UID=0) instead
	// of booting fine and failing every upload later.
	const probe = ".write-probe"
	f, err := root.OpenFile(probe, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o640)
	if err != nil {
		root.Close()
		return nil, fmt.Errorf("media dir %q is not writable: %w", dir, err)
	}
	f.Close()
	_ = root.Remove(probe)
	return &LocalDisk{root: root, baseURL: strings.TrimRight(baseURL, "/")}, nil
}

func (l *LocalDisk) Put(_ context.Context, key string, r io.Reader, _ string) error {
	if !ValidKey(key) {
		return ErrInvalidKey
	}
	tmp := key + ".part"
	f, err := l.root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		_ = l.root.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = l.root.Remove(tmp)
		return err
	}
	if _, err := l.root.Stat(key); err == nil {
		_ = l.root.Remove(tmp)
		return ErrKeyExists
	}
	if err := l.root.Rename(tmp, key); err != nil {
		_ = l.root.Remove(tmp)
		return err
	}
	return nil
}

func (l *LocalDisk) Delete(_ context.Context, key string) error {
	if !ValidKey(key) {
		return ErrInvalidKey
	}
	err := l.root.Remove(key)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

func (l *LocalDisk) URL(key string) string { return l.baseURL + "/media/" + path.Clean(key) }

func (l *LocalDisk) Open(key string) (*os.File, error) {
	if !ValidKey(key) {
		return nil, fs.ErrNotExist
	}
	return l.root.Open(key)
}

func (l *LocalDisk) Close() error { return l.root.Close() }
