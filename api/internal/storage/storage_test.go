package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalDisk(t *testing.T) {
	dir := t.TempDir()
	d, err := NewLocalDisk(filepath.Join(dir, "media"), "https://api.example.com/")
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx := context.Background()
	key := "0b5c4a39-8a0e-4c39-9a51-9d1f0d6b2f11.png"
	if err := d.Put(ctx, key, strings.NewReader("data"), "image/png"); err != nil {
		t.Fatal(err)
	}
	if got := d.URL(key); got != "https://api.example.com/media/"+key {
		t.Errorf("url %s", got)
	}
	f, err := d.Open(key)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(f)
	f.Close()
	if string(b) != "data" {
		t.Errorf("content %q", b)
	}
	if _, err := os.Stat(filepath.Join(dir, "media", key+".part")); !errors.Is(err, os.ErrNotExist) {
		t.Error("temp file left behind")
	}
	for _, bad := range []string{"../escape.png", "a/b.png", "", ".hidden", "x"} {
		if err := d.Put(ctx, bad, strings.NewReader("x"), ""); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("Put(%q) = %v", bad, err)
		}
		if _, err := d.Open(bad); err == nil {
			t.Errorf("Open(%q) succeeded", bad)
		}
	}
	if err := d.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if err := d.Delete(ctx, key); err != nil {
		t.Fatal("delete of a missing key should be a no-op")
	}
}

func TestLocalDiskNeverOverwrites(t *testing.T) {
	d, err := NewLocalDisk(t.TempDir(), "https://api.example.com")
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx := context.Background()
	key := "brand-photo-0a1b2c3d.webp"
	if err := d.Put(ctx, key, strings.NewReader("first"), "image/webp"); err != nil {
		t.Fatal(err)
	}
	if err := d.Put(ctx, key, strings.NewReader("second"), "image/webp"); !errors.Is(err, ErrKeyExists) {
		t.Fatalf("overwrite: %v", err)
	}
	f, err := d.Open(key)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	b, _ := io.ReadAll(f)
	if string(b) != "first" {
		t.Fatalf("content replaced: %q", b)
	}
}
