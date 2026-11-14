package service

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"net/http"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

// Community image pipeline (avatars and comment images). Unlike the admin
// media pipeline every accepted image is decoded and re-encoded, so no
// metadata (EXIF incl. GPS, XMP, ICC, text chunks) survives:
//
//	accepted: JPEG, PNG, WebP (sniffed from content), <= 40 MP
//	avatar:   auto-orient, centre square crop, <= 512 px, JPEG q85 with any
//	          alpha flattened onto #111318
//	comment:  auto-orient, longest side <= 1600 px, JPEG q82, except images
//	          with transparency which stay PNG
const (
	avatarMaxSide      = 512
	commentImageMax    = 1600
	avatarJPEGQuality  = 85
	commentJPEGQuality = 82
)

var flattenBG = color.RGBA{R: 0x11, G: 0x13, B: 0x18, A: 0xff}

const communityImageMsg = "รองรับเฉพาะไฟล์ภาพ JPEG, PNG หรือ WebP"

// sniffCommunityImage returns image/jpeg, image/png, image/webp or "".
func sniffCommunityImage(b []byte) string {
	switch mt := http.DetectContentType(b); mt {
	case "image/jpeg", "image/png", "image/webp":
		return mt
	}
	return ""
}

// decodeCommunityImage validates the size, decodes and auto-orients.
func decodeCommunityImage(data []byte) (image.Image, error) {
	if len(data) == 0 {
		return nil, fileErr("กรุณาเลือกไฟล์")
	}
	mt := sniffCommunityImage(data)
	if mt == "" {
		return nil, fileErr(communityImageMsg)
	}
	var (
		cfg image.Config
		err error
	)
	switch mt {
	case "image/jpeg":
		cfg, err = jpeg.DecodeConfig(bytes.NewReader(data))
	case "image/png":
		cfg, err = png.DecodeConfig(bytes.NewReader(data))
	default:
		cfg, err = webp.DecodeConfig(bytes.NewReader(data))
	}
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, corruptErr()
	}
	if cfg.Width*cfg.Height > MaxImagePixels {
		return nil, pixelLimitErr()
	}
	var img image.Image
	switch mt {
	case "image/jpeg":
		img, err = jpeg.Decode(bytes.NewReader(data))
	case "image/png":
		img, err = png.Decode(bytes.NewReader(data))
	default:
		img, err = webp.Decode(bytes.NewReader(data))
	}
	if err != nil {
		return nil, corruptErr()
	}
	if mt == "image/jpeg" {
		img = applyOrientation(img, JPEGOrientation(data))
	}
	return img, nil
}

// hasAlpha reports whether any pixel is not fully opaque (Opaque scans the
// pixels for the RGBA/NRGBA/NYCbCrA types the decoders return).
func hasAlpha(img image.Image) bool {
	if o, ok := img.(interface{ Opaque() bool }); ok {
		return !o.Opaque()
	}
	return true
}

func flatten(img image.Image) *image.RGBA {
	b := img.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: flattenBG}, image.Point{}, draw.Src)
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Over)
	return dst
}

// ProcessAvatar returns the JPEG bytes and side length of an avatar.
func ProcessAvatar(data []byte) ([]byte, int, error) {
	img, err := decodeCommunityImage(data)
	if err != nil {
		return nil, 0, err
	}
	b := img.Bounds()
	side := min(b.Dx(), b.Dy())
	x0 := b.Min.X + (b.Dx()-side)/2
	y0 := b.Min.Y + (b.Dy()-side)/2
	crop := image.Rect(x0, y0, x0+side, y0+side)
	out := min(side, avatarMaxSide)
	dst := image.NewRGBA(image.Rect(0, 0, out, out))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: flattenBG}, image.Point{}, draw.Src)
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, crop, xdraw.Over, nil)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: avatarJPEGQuality}); err != nil {
		return nil, 0, err
	}
	return buf.Bytes(), out, nil
}

// ProcessCommentImage returns the re-encoded bytes, extension and size.
func ProcessCommentImage(data []byte) (ProcessedImage, string, error) {
	img, err := decodeCommunityImage(data)
	if err != nil {
		return ProcessedImage{}, "", err
	}
	img, resized := downscale(img, commentImageMax)
	b := img.Bounds()
	var buf bytes.Buffer
	ext := "jpg"
	if hasAlpha(img) {
		ext = "png"
		err = png.Encode(&buf, img)
	} else {
		err = jpeg.Encode(&buf, flatten(img), &jpeg.Options{Quality: commentJPEGQuality})
	}
	if err != nil {
		return ProcessedImage{}, "", err
	}
	return ProcessedImage{Data: buf.Bytes(), Width: b.Dx(), Height: b.Dy(), Resized: resized}, ext, nil
}

// communityKey returns "<prefix>-<16 hex>.<ext>" (valid storage.ValidKey).
func communityKey(prefix, ext string) string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return prefix + "-" + hex.EncodeToString(b[:]) + "." + ext
}
