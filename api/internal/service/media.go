package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"  // register decoder for DecodeConfig
	_ "image/jpeg" // register decoder for DecodeConfig
	_ "image/png"  // register decoder for DecodeConfig
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	_ "golang.org/x/image/webp" // register decoder for DecodeConfig

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/storage"
)

type MediaService struct {
	repo     repository.Media
	store    storage.MediaStore
	maxBytes int64
	maxDim   int
	audit    Auditor
	log      *slog.Logger
}

// NewMediaService: maxDimension is the longest image side kept after upload
// processing (MEDIA_MAX_DIMENSION); <= 0 means DefaultMaxDimension.
func NewMediaService(repo repository.Media, store storage.MediaStore, maxBytes int64, maxDimension int,
	audit Auditor, log *slog.Logger) *MediaService {
	if maxDimension <= 0 {
		maxDimension = DefaultMaxDimension
	}
	return &MediaService{repo: repo, store: store, maxBytes: maxBytes, maxDim: maxDimension, audit: audit, log: log}
}

func (s *MediaService) MaxBytes() int64 { return s.maxBytes }

var mimeExt = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
	"image/avif": "avif",
	"image/gif":  "gif",
}

// SniffImage detects the type from content (never from the filename or the
// client's Content-Type) and returns "" when it is not an allowed image.
func SniffImage(b []byte) string {
	if isAVIF(b) {
		return "image/avif"
	}
	mt := http.DetectContentType(b)
	if _, ok := mimeExt[mt]; ok {
		return mt
	}
	return ""
}

func isAVIF(b []byte) bool {
	if len(b) < 16 || string(b[4:8]) != "ftyp" {
		return false
	}
	size := int(binary.BigEndian.Uint32(b[0:4]))
	if size < 16 || size > len(b) {
		size = min(len(b), 64)
	}
	for i := 8; i+4 <= size; i += 4 {
		if i == 12 { // minor_version
			continue
		}
		if brand := string(b[i : i+4]); brand == "avif" || brand == "avis" {
			return true
		}
	}
	return false
}

// avifDimensions reads the first 'ispe' (image spatial extents) property.
func avifDimensions(b []byte) (int, int) {
	limit := b
	if len(limit) > 1<<16 {
		limit = limit[:1<<16]
	}
	i := bytes.Index(limit, []byte("ispe"))
	if i < 0 || i+16 > len(b) {
		return 0, 0
	}
	w := binary.BigEndian.Uint32(b[i+8 : i+12])
	h := binary.BigEndian.Uint32(b[i+12 : i+16])
	return int(w), int(h)
}

func imageDimensions(mime string, b []byte) (int, int, error) {
	if mime == "image/avif" {
		w, h := avifDimensions(b)
		return w, h, nil
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return 0, 0, err
	}
	return cfg.Width, cfg.Height, nil
}

const invalidImageMsg = "รองรับเฉพาะไฟล์ภาพ JPEG, PNG, WebP, AVIF หรือ GIF"

func fileErr(msg string) error {
	return &domain.ValidationError{Message: domain.MsgValidationFailed, Fields: map[string]string{"file": msg}}
}

const maxAltLen = 300

func cleanAlt(alt string) (string, error) {
	alt = cleanLine(alt)
	if runeLen(alt) > maxAltLen {
		return "", &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"alt": "คำอธิบายภาพต้องไม่เกิน 300 ตัวอักษร"}}
	}
	return alt, nil
}

// Upload validates, processes (see ProcessImage) and stores an image.
func (s *MediaService) Upload(ctx context.Context, r io.Reader, originalName, alt string, actor domain.Actor) (domain.Media, error) {
	alt, err := cleanAlt(alt)
	if err != nil {
		return domain.Media{}, err
	}
	data, err := io.ReadAll(io.LimitReader(r, s.maxBytes+1))
	if err != nil {
		return domain.Media{}, err
	}
	if int64(len(data)) > s.maxBytes {
		return domain.Media{}, domain.ErrTooLarge
	}
	if len(data) == 0 {
		return domain.Media{}, fileErr("กรุณาเลือกไฟล์")
	}
	mt := SniffImage(data)
	if mt == "" {
		return domain.Media{}, fileErr(invalidImageMsg)
	}
	w, h, err := imageDimensions(mt, data)
	if err != nil {
		return domain.Media{}, fileErr("ไฟล์ภาพเสียหายหรืออ่านไม่ได้")
	}
	if w > 20000 || h > 20000 {
		return domain.Media{}, fileErr("ขนาดภาพใหญ่เกินไป (สูงสุด 20000 พิกเซล)")
	}
	out, err := ProcessImage(mt, data, s.maxDim)
	if err != nil {
		return domain.Media{}, err
	}
	data, w, h = out.Data, out.Width, out.Height
	var key string
	for attempt := 0; ; attempt++ {
		key = MediaKey(alt, originalName, mimeExt[mt])
		err := s.store.Put(ctx, key, bytes.NewReader(data), mt)
		if errors.Is(err, storage.ErrKeyExists) && attempt < 4 {
			continue
		}
		if err != nil {
			return domain.Media{}, fmt.Errorf("store media: %w", err)
		}
		break
	}
	name := truncateRunes(cleanLine(filepath.Base(strings.ReplaceAll(originalName, `\`, "/"))), 255)
	if name == "." || name == "/" {
		name = ""
	}
	m := domain.Media{StorageKey: key, URL: s.store.URL(key), OriginalName: name, Mime: mt,
		SizeBytes: int64(len(data)), Width: w, Height: h, Alt: alt}
	if !actor.IsSystem() {
		m.UploadedBy = &actor.ID
	}
	if err := s.repo.Create(ctx, &m); err != nil {
		if derr := s.store.Delete(context.WithoutCancel(ctx), key); derr != nil {
			s.log.Error("orphan media file", "key", key, "err", derr)
		}
		return domain.Media{}, fmt.Errorf("create media row: %w", err)
	}
	s.log.Info("media uploaded", "media_id", m.ID, "mime", mt, "size", m.SizeBytes, "resized", out.Resized,
		"actor", actor.ID)
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditMediaUpload, TargetType: domain.TargetMedia,
		TargetID: m.ID, Metadata: map[string]any{"name": m.OriginalName, "mime": mt, "size": m.SizeBytes}})
	return m, nil
}

const maxKeySlug = 60

// MediaKey builds a descriptive storage key: an ASCII slug of the alt text
// (else the original file name without extension), at most 60 characters,
// plus 8 random hex digits: "<slug>-<8hex>.<ext>" ("image-<8hex>.<ext>"
// when nothing ASCII is usable, e.g. Thai-only text).
// minKeySlug: shorter slugs carry no meaning and fall back to "image".
const minKeySlug = 3

func MediaKey(alt, originalName, ext string) string {
	// Thai alt text often slugifies to a stray Latin fragment (e.g. "g"):
	// use the alt only when it yields a meaningful slug, else the filename,
	// else whichever of the two is longer.
	slug := Slugify(alt)
	if len(slug) < minKeySlug {
		base := filepath.Base(strings.ReplaceAll(originalName, `\`, "/"))
		if fromName := Slugify(strings.TrimSuffix(base, filepath.Ext(base))); len(fromName) > len(slug) {
			slug = fromName
		}
	}
	if len(slug) < minKeySlug {
		slug = ""
	}
	if len(slug) > maxKeySlug {
		slug = strings.TrimRight(slug[:maxKeySlug], "-")
	}
	if slug == "" {
		slug = "image"
	}
	var b [4]byte
	_, _ = rand.Read(b[:])
	return slug + "-" + hex.EncodeToString(b[:]) + "." + ext
}

func (s *MediaService) List(ctx context.Context, f repository.MediaFilter) ([]domain.Media, int, error) {
	if f.Mime == "all" {
		f.Mime = ""
	}
	if _, ok := mimeExt[f.Mime]; f.Mime != "" && !ok {
		return nil, 0, &domain.ValidationError{Message: domain.MsgValidationFailed,
			Fields: map[string]string{"type": "ประเภทไฟล์ไม่ถูกต้อง"}}
	}
	return s.repo.List(ctx, f)
}

func (s *MediaService) Get(ctx context.Context, id string) (domain.Media, []domain.MediaUsage, error) {
	if _, err := uuid.Parse(id); err != nil {
		return domain.Media{}, nil, domain.ErrNotFound
	}
	m, err := s.repo.Get(ctx, id)
	if err != nil {
		return m, nil, err
	}
	usage, err := s.repo.Usage(ctx, id)
	if usage == nil {
		usage = []domain.MediaUsage{}
	}
	return m, usage, err
}

func (s *MediaService) UpdateAlt(ctx context.Context, id, alt string, actor domain.Actor) (domain.Media, error) {
	if _, err := uuid.Parse(id); err != nil {
		return domain.Media{}, domain.ErrNotFound
	}
	alt, err := cleanAlt(alt)
	if err != nil {
		return domain.Media{}, err
	}
	m, err := s.repo.UpdateAlt(ctx, id, alt)
	if err != nil {
		return m, err
	}
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditMediaUpdate, TargetType: domain.TargetMedia,
		TargetID: id, Metadata: map[string]any{"alt_length": runeLen(alt)}})
	return m, nil
}

// Delete soft-deletes an unused media row and removes its file. A file still
// referenced by live posts returns *domain.InUseError (409 in_use).
func (s *MediaService) Delete(ctx context.Context, id string, actor domain.Actor) error {
	if _, err := uuid.Parse(id); err != nil {
		return domain.ErrNotFound
	}
	m, err := s.repo.SoftDeleteUnused(ctx, id)
	if err != nil {
		return err
	}
	if err := s.store.Delete(context.WithoutCancel(ctx), m.StorageKey); err != nil {
		s.log.Error("delete media file", "key", m.StorageKey, "err", err)
	}
	s.log.Info("media deleted", "media_id", id, "actor", actor.ID)
	s.audit.Record(ctx, domain.AuditEvent{Actor: actor, Action: domain.AuditMediaDelete, TargetType: domain.TargetMedia,
		TargetID: id, Metadata: map[string]any{"name": m.OriginalName}})
	return nil
}
