package service

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

// pngBytes is an opaque w x h PNG.
func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 90, A: 255})
		}
	}
	return encodePNG(t, img)
}

func TestProcessAvatar(t *testing.T) {
	// wide JPEG with EXIF (incl. orientation 6) -> square, <= 512, upright, no EXIF
	src := image.NewRGBA(image.Rect(0, 0, 1200, 800))
	for y := 0; y < 800; y++ {
		for x := 0; x < 1200; x++ {
			src.Set(x, y, color.RGBA{R: 200, G: 30, B: 30, A: 255})
		}
	}
	data := jpegWithEXIF(t, src, 6, binary.BigEndian)
	out, side, err := ProcessAvatar(data)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(out))
	if err != nil || cfg.Width != 512 || cfg.Height != 512 || side != 512 {
		t.Fatalf("avatar size %dx%d (%d) %v", cfg.Width, cfg.Height, side, err)
	}
	if bytes.Contains(out, []byte("Exif")) {
		t.Fatal("EXIF must be stripped")
	}

	// transparent PNG -> flattened onto #111318
	tr := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	out, side, err = ProcessAvatar(encodePNG(t, tr))
	if err != nil || side != 100 {
		t.Fatal(err, side)
	}
	img, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if !near(img.At(50, 50), color.RGBA{R: 0x11, G: 0x13, B: 0x18, A: 0xff}) {
		t.Fatalf("alpha not flattened: %v", img.At(50, 50))
	}

	for name, bad := range map[string][]byte{"gif": []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"),
		"text": []byte("hello"), "empty": nil, "truncated png": encodePNG(t, tr)[:40]} {
		if _, _, err := ProcessAvatar(bad); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestProcessCommentImage(t *testing.T) {
	big := pngBytes(t, 2000, 500)
	out, ext, err := ProcessCommentImage(big)
	if err != nil || ext != "jpg" || out.Width != 1600 || out.Height != 400 || !out.Resized {
		t.Fatalf("opaque png -> jpeg 1600: %v %s %+v", err, ext, out)
	}
	tr := image.NewNRGBA(image.Rect(0, 0, 20, 10))
	tr.Set(1, 1, color.NRGBA{R: 255, A: 128})
	out, ext, err = ProcessCommentImage(encodePNG(t, tr))
	if err != nil || ext != "png" || out.Width != 20 {
		t.Fatalf("transparent png kept as png: %v %s", err, ext)
	}
	withText := insertAfterIHDR(pngBytes(t, 8, 8), pngChunk("tEXt", []byte("Comment\x00secret")))
	out, _, err = ProcessCommentImage(withText)
	if err != nil || bytes.Contains(out.Data, []byte("secret")) {
		t.Fatal("metadata must be dropped")
	}
	if _, err := png.Decode(bytes.NewReader(encodePNG(t, tr))); err != nil {
		t.Fatal(err)
	}
	if k := communityKey("c", "jpg"); len(k) != len("c-")+16+len(".jpg") {
		t.Fatalf("key format: %s", k)
	}
}
