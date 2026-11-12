package service

import (
	"bytes"
	"context"
	"encoding/binary"
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
	log      *slog.Logger
}

func NewMediaService(repo repository.Media, store storage.MediaStore, maxBytes int64, log *slog.Logger) *MediaService {
	return &MediaService{repo: repo, store: store, maxBytes: maxBytes, log: log}
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

func (s *MediaService) Upload(ctx context.Context, r io.Reader, originalName, uploadedBy string) (domain.Media, error) {
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
	key := uuid.NewString() + "." + mimeExt[mt]
	if err := s.store.Put(ctx, key, bytes.NewReader(data), mt); err != nil {
		return domain.Media{}, fmt.Errorf("store media: %w", err)
	}
	name := truncateRunes(cleanLine(filepath.Base(strings.ReplaceAll(originalName, `\`, "/"))), 255)
	if name == "." || name == "/" {
		name = ""
	}
	m := domain.Media{StorageKey: key, URL: s.store.URL(key), OriginalName: name, Mime: mt,
		SizeBytes: int64(len(data)), Width: w, Height: h}
	if uploadedBy != "" {
		m.UploadedBy = &uploadedBy
	}
	if err := s.repo.Create(ctx, &m); err != nil {
		if derr := s.store.Delete(context.WithoutCancel(ctx), key); derr != nil {
			s.log.Error("orphan media file", "key", key, "err", derr)
		}
		return domain.Media{}, fmt.Errorf("create media row: %w", err)
	}
	s.log.Info("media uploaded", "media_id", m.ID, "mime", mt, "size", m.SizeBytes, "actor", uploadedBy)
	return m, nil
}
