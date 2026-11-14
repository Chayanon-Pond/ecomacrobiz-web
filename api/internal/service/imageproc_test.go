package service

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
)

var (
	cRed   = color.RGBA{255, 0, 0, 255}
	cGreen = color.RGBA{0, 255, 0, 255}
	cBlue  = color.RGBA{0, 0, 255, 255}
	cWhite = color.RGBA{255, 255, 255, 255}
)

// quadrants: 64x32, TL red, TR green, BL blue, BR white.
func quadrants() *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, 64, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 64; x++ {
			c := cRed
			switch {
			case x >= 32 && y < 16:
				c = cGreen
			case x < 32 && y >= 16:
				c = cBlue
			case x >= 32 && y >= 16:
				c = cWhite
			}
			img.Set(x, y, c)
		}
	}
	return img
}

// exifAPP1 builds an APP1 "Exif" segment with IFD0 = {Orientation, GPS IFD
// pointer} and a GPS IFD holding GPSLatitudeRef plus a recognisable marker.
func exifAPP1(orientation uint16, bo binary.ByteOrder) []byte {
	var t bytes.Buffer
	if bo == binary.LittleEndian {
		t.WriteString("II")
	} else {
		t.WriteString("MM")
	}
	w16 := func(v uint16) { _ = binary.Write(&t, bo, v) }
	w32 := func(v uint32) { _ = binary.Write(&t, bo, v) }
	w16(42)
	w32(8)
	// IFD0 at 8: 2 entries
	w16(2)
	w16(0x0112)
	w16(3)
	w32(1)
	w16(orientation)
	w16(0)
	w16(0x8825) // GPS IFD pointer
	w16(4)
	w32(1)
	w32(8 + 2 + 2*12 + 4) // right after IFD0
	w32(0)                // next IFD
	// GPS IFD: 1 entry GPSLatitudeRef "N"
	w16(1)
	w16(0x0001)
	w16(2)
	w32(2)
	t.Write([]byte{'N', 0, 0, 0})
	w32(0)
	t.WriteString("GPS-SECRET-13.7563N-100.5018E")
	payload := append([]byte("Exif\x00\x00"), t.Bytes()...)
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
	return append(seg, payload...)
}

func jpegWithEXIF(t *testing.T, img image.Image, orientation uint16, bo binary.ByteOrder) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 100}); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	out := append([]byte{}, b[:2]...)
	out = append(out, exifAPP1(orientation, bo)...)
	return append(out, b[2:]...)
}

func near(a, b color.Color) bool {
	r1, g1, b1, _ := a.RGBA()
	r2, g2, b2, _ := b.RGBA()
	d := func(x, y uint32) bool { return x>>8 > y>>8+50 || y>>8 > x>>8+50 }
	return !d(r1, r2) && !d(g1, g2) && !d(b1, b2)
}

func TestJPEGOrientationAllEight(t *testing.T) {
	// Expected corner colours (TL, TR, BL, BR) after applying each orientation
	// to the stored 64x32 quadrant image.
	want := map[uint16][4]color.RGBA{
		1: {cRed, cGreen, cBlue, cWhite},
		2: {cGreen, cRed, cWhite, cBlue},
		3: {cWhite, cBlue, cGreen, cRed},
		4: {cBlue, cWhite, cRed, cGreen},
		5: {cRed, cBlue, cGreen, cWhite},
		6: {cBlue, cRed, cWhite, cGreen},
		7: {cWhite, cGreen, cBlue, cRed},
		8: {cGreen, cWhite, cRed, cBlue},
	}
	for o := uint16(1); o <= 8; o++ {
		for _, bo := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
			data := jpegWithEXIF(t, quadrants(), o, bo)
			if got := JPEGOrientation(data); got != int(o) {
				t.Fatalf("orientation %d (%v): read %d", o, bo, got)
			}
			out, err := ProcessImage("image/jpeg", data, 2560)
			if err != nil {
				t.Fatal(err)
			}
			img, err := jpeg.Decode(bytes.NewReader(out.Data))
			if err != nil {
				t.Fatal(err)
			}
			w, h := img.Bounds().Dx(), img.Bounds().Dy()
			wantW, wantH := 64, 32
			if o >= 5 {
				wantW, wantH = 32, 64
			}
			if w != wantW || h != wantH || out.Width != w || out.Height != h {
				t.Fatalf("orientation %d: size %dx%d (reported %dx%d)", o, w, h, out.Width, out.Height)
			}
			pts := [4]image.Point{{w / 4, h / 4}, {3 * w / 4, h / 4}, {w / 4, 3 * h / 4}, {3 * w / 4, 3 * h / 4}}
			for i, p := range pts {
				if c := img.At(p.X, p.Y); !near(c, want[o][i]) {
					t.Errorf("orientation %d corner %d: got %v want %v", o, i, c, want[o][i])
				}
			}
			if JPEGOrientation(out.Data) != 1 {
				t.Errorf("orientation %d: output still carries orientation", o)
			}
		}
	}
}

func TestJPEGOrientationMalformed(t *testing.T) {
	for _, b := range [][]byte{nil, {0xFF, 0xD8}, {0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF},
		append([]byte{0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10}, []byte("Exif\x00\x00II*\x00\xff\xff\xff\xff")...)} {
		if got := JPEGOrientation(b); got != 1 {
			t.Errorf("malformed %x -> %d", b, got)
		}
	}
}

func TestJPEGMetadataStripped(t *testing.T) {
	data := jpegWithEXIF(t, quadrants(), 1, binary.BigEndian)
	if !bytes.Contains(data, []byte("GPS-SECRET")) {
		t.Fatal("fixture lacks GPS marker")
	}
	out, err := ProcessImage("image/jpeg", data, 2560)
	if err != nil {
		t.Fatal(err)
	}
	for _, needle := range [][]byte{[]byte("Exif"), []byte("GPS-SECRET"), {0xFF, 0xE1}} {
		if bytes.Contains(out.Data, needle) {
			t.Errorf("output still contains %q", needle)
		}
	}
}

func pngChunk(typ string, data []byte) []byte {
	b := make([]byte, 8, 12+len(data))
	binary.BigEndian.PutUint32(b, uint32(len(data)))
	copy(b[4:], typ)
	b = append(b, data...)
	crc := crc32.ChecksumIEEE(b[4:])
	return binary.BigEndian.AppendUint32(b, crc)
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// insertAfterIHDR injects chunks right after IHDR (8 sig + 25 IHDR bytes).
func insertAfterIHDR(b []byte, chunks ...[]byte) []byte {
	out := append([]byte{}, b[:33]...)
	for _, c := range chunks {
		out = append(out, c...)
	}
	return append(out, b[33:]...)
}

func TestPNGMetadataStrippedAndKeptWhenClean(t *testing.T) {
	clean := encodePNG(t, quadrants())
	if PNGHasMetadata(clean) {
		t.Fatal("clean png flagged")
	}
	out, err := ProcessImage("image/png", clean, 2560)
	if err != nil || out.Width != 64 || out.Height != 32 {
		t.Fatalf("clean: %+v %v", out, err)
	}
	if len(out.Data) > len(clean) {
		t.Fatal("clean PNG grew; the smaller original should be kept")
	}

	dirty := insertAfterIHDR(clean, pngChunk("tEXt", []byte("Comment\x00GPS-SECRET")),
		pngChunk("eXIf", []byte("MM\x00*GPS-SECRET")))
	if !PNGHasMetadata(dirty) {
		t.Fatal("metadata not detected")
	}
	if _, err := png.Decode(bytes.NewReader(dirty)); err != nil {
		t.Fatalf("fixture invalid: %v", err)
	}
	out, err = ProcessImage("image/png", dirty, 2560)
	if err != nil {
		t.Fatal(err)
	}
	for _, needle := range []string{"tEXt", "eXIf", "GPS-SECRET"} {
		if bytes.Contains(out.Data, []byte(needle)) {
			t.Errorf("output contains %q", needle)
		}
	}
}

func TestResize(t *testing.T) {
	land := image.NewRGBA(image.Rect(0, 0, 400, 200))
	out, err := ProcessImage("image/png", encodePNG(t, land), 100)
	if err != nil || !out.Resized || out.Width != 100 || out.Height != 50 {
		t.Fatalf("landscape png: %+v %v", out, err)
	}
	cfg, _ := png.DecodeConfig(bytes.NewReader(out.Data))
	if cfg.Width != 100 || cfg.Height != 50 {
		t.Fatalf("encoded size %dx%d", cfg.Width, cfg.Height)
	}
	portrait := image.NewRGBA(image.Rect(0, 0, 100, 301))
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, portrait, nil)
	out, err = ProcessImage("image/jpeg", buf.Bytes(), 150)
	if err != nil || out.Width != 50 || out.Height != 150 {
		t.Fatalf("portrait jpeg: %+v %v", out, err)
	}
	// rotation after resize: stored 300x100 with orientation 6 -> 50x150 upright
	out, err = ProcessImage("image/jpeg", jpegWithEXIF(t, image.NewRGBA(image.Rect(0, 0, 300, 100)), 6,
		binary.LittleEndian), 150)
	if err != nil || out.Width != 50 || out.Height != 150 {
		t.Fatalf("resize+rotate: %+v %v", out, err)
	}
	small, _ := ProcessImage("image/png", encodePNG(t, quadrants()), 2560)
	if small.Resized {
		t.Fatal("small image resized")
	}
}

func TestOversizedRejectedBeforeDecode(t *testing.T) {
	// JPEG: patch the SOF0 frame size to 8000x6000 (48 MP).
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 16, 16)), nil)
	j := buf.Bytes()
	i := bytes.Index(j, []byte{0xFF, 0xC0})
	if i < 0 {
		t.Fatal("no SOF0")
	}
	binary.BigEndian.PutUint16(j[i+5:], 6000)
	binary.BigEndian.PutUint16(j[i+7:], 8000)
	// PNG: patch IHDR to 8000x6000 and fix its CRC.
	p := encodePNG(t, image.NewRGBA(image.Rect(0, 0, 16, 16)))
	binary.BigEndian.PutUint32(p[16:], 8000)
	binary.BigEndian.PutUint32(p[20:], 6000)
	binary.BigEndian.PutUint32(p[29:], crc32.ChecksumIEEE(p[12:29]))
	// WebP: VP8X canvas 8000x6000.
	w := webpVP8X(8000, 6000, 0, nil)

	for mime, data := range map[string][]byte{"image/jpeg": j, "image/png": p, "image/webp": w} {
		_, err := ProcessImage(mime, data, 2560)
		var ve *domain.ValidationError
		if !errors.As(err, &ve) || ve.Fields["file"] == "" {
			t.Errorf("%s: %v", mime, err)
		}
	}
	// and through the service (dimension pre-check allows <=20000 px sides)
	svc := NewMediaService(fake.New().MediaRepo(), &memStore{files: map[string][]byte{}}, 8<<20, 0, NopAuditor{}, discard)
	if _, err := svc.Upload(context.Background(), bytes.NewReader(j), "big.jpg", "", testOwner); fieldErrs(t, err)["file"] == "" {
		t.Errorf("service accepted 48 MP jpeg: %v", err)
	}
}

func riffChunk(fcc string, data []byte) []byte {
	b := make([]byte, 8, 8+len(data)+1)
	copy(b, fcc)
	binary.LittleEndian.PutUint32(b[4:], uint32(len(data)))
	b = append(b, data...)
	if len(data)%2 == 1 {
		b = append(b, 0)
	}
	return b
}

// webpVP8X builds an extended WebP with the given flags and extra chunks,
// followed by a (dummy) VP8L chunk.
func webpVP8X(w, h int, flags byte, extra [][]byte) []byte {
	x := make([]byte, 10)
	x[0] = flags
	x[4], x[5], x[6] = byte(w-1), byte((w-1)>>8), byte((w-1)>>16)
	x[7], x[8], x[9] = byte(h-1), byte((h-1)>>8), byte((h-1)>>16)
	body := []byte("WEBP")
	body = append(body, riffChunk("VP8X", x)...)
	body = append(body, riffChunk("ICCP", []byte("icc-profile"))...)
	for _, e := range extra {
		body = append(body, e...)
	}
	body = append(body, riffChunk("VP8L", []byte{0x2f, 1, 2, 3, 4})...)
	out := []byte("RIFF")
	out = binary.LittleEndian.AppendUint32(out, uint32(len(body)))
	return append(out, body...)
}

func TestWebPMetadataStripped(t *testing.T) {
	in := webpVP8X(640, 480, 0x20|0x08|0x04, [][]byte{
		riffChunk("EXIF", []byte("MM\x00*GPS-SECRET")),
		riffChunk("XMP ", []byte("<x:xmpmeta>GPS-SECRET</x:xmpmeta>")),
	})
	out, err := ProcessImage("image/webp", in, 2560)
	if err != nil || out.Width != 640 || out.Height != 480 || out.Resized {
		t.Fatalf("webp: %+v %v", out, err)
	}
	b := out.Data
	for _, needle := range []string{"EXIF", "XMP ", "GPS-SECRET"} {
		if bytes.Contains(b, []byte(needle)) {
			t.Errorf("output contains %q", needle)
		}
	}
	if !bytes.Contains(b, []byte("ICCP")) || !bytes.Contains(b, []byte("VP8L")) {
		t.Error("non-metadata chunks must be kept")
	}
	if got := int(binary.LittleEndian.Uint32(b[4:8])); got != len(b)-8 {
		t.Errorf("riff size %d, file %d", got, len(b))
	}
	if flags := b[20]; flags != 0x20 {
		t.Errorf("VP8X flags = %#x, want ICC only", flags)
	}
	if SniffImage(b) != "image/webp" {
		t.Error("output no longer sniffs as webp")
	}
	if _, err := StripWebPMetadata([]byte("RIFF\xff\xff\xff\xffWEBP")); err == nil {
		t.Error("truncated RIFF accepted")
	}
}

func TestMediaUploadAltAndDelete(t *testing.T) {
	ctx := context.Background()
	store := fake.New()
	au := &recAuditor{}
	ms := &memStore{files: map[string][]byte{}}
	svc := NewMediaService(store.MediaRepo(), ms, 1<<20, 0, au, discard)
	posts := NewPostService(store.PostsRepo(), store.CategoriesRepo(), store.MediaRepo(), testRedirects(store), &recRevalidator{},
		NopAuditor{}, discard)

	if _, err := svc.Upload(ctx, bytes.NewReader(encodePNG(t, quadrants())), "a.png", strings.Repeat("ก", 301), testOwner); fieldErrs(t, err)["alt"] == "" {
		t.Fatal("long alt accepted")
	}
	m, err := svc.Upload(ctx, bytes.NewReader(jpegWithEXIF(t, quadrants(), 6, binary.BigEndian)), "p.jpg",
		" ภาพปก ", testOwner)
	if err != nil || m.Alt != "ภาพปก" || m.Width != 32 || m.Height != 64 {
		t.Fatalf("upload: %+v %v", m, err)
	}
	if bytes.Contains(ms.files[m.StorageKey], []byte("GPS-SECRET")) {
		t.Fatal("stored file still has GPS data")
	}
	if au.last().Action != domain.AuditMediaUpload {
		t.Fatal("upload not audited")
	}
	m2, _ := svc.Upload(ctx, bytes.NewReader(encodePNG(t, quadrants())), "b.png", "", testOwner)

	in := validPost()
	in.CoverMediaID = &m.ID
	in.BodyMarkdown = "![x](http://api.test/media/" + m2.StorageKey + ")"
	p, err := posts.Create(ctx, in, testOwner)
	if err != nil {
		t.Fatal(err)
	}
	got, usage, err := svc.Get(ctx, m.ID)
	if err != nil || got.UsageCount != 1 || len(usage) != 1 || usage[0].Kind != "cover" || usage[0].PostID != p.ID {
		t.Fatalf("usage: %+v %+v %v", got, usage, err)
	}
	_, usage, _ = svc.Get(ctx, m2.ID)
	if len(usage) != 1 || usage[0].Kind != "body" {
		t.Fatalf("body usage: %+v", usage)
	}
	err = svc.Delete(ctx, m.ID, testOwner)
	var iu *domain.InUseError
	if !errors.As(err, &iu) || iu.Count != 1 || iu.Message() != "ไฟล์นี้ถูกใช้งานอยู่ใน 1 บทความ" {
		t.Fatalf("delete in use: %v", err)
	}
	upd, err := svc.UpdateAlt(ctx, m.ID, "ใหม่", testOwner)
	if err != nil || upd.Alt != "ใหม่" || au.last().Action != domain.AuditMediaUpdate {
		t.Fatalf("alt: %+v %v", upd, err)
	}
	_ = posts.Delete(ctx, p.ID, nil, testOwner)
	if err := svc.Delete(ctx, m.ID, testOwner); err != nil {
		t.Fatal(err)
	}
	if _, ok := ms.files[m.StorageKey]; ok {
		t.Fatal("file not removed")
	}
	if au.last().Action != domain.AuditMediaDelete {
		t.Fatal("delete not audited")
	}
	if _, _, err := svc.Get(ctx, m.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("deleted media still readable")
	}
	list, total, err := svc.List(ctx, mediaFilter("", "image/png"))
	if err != nil || total != 1 || list[0].ID != m2.ID {
		t.Fatalf("list: %d %v", total, err)
	}
	if _, _, err := svc.List(ctx, mediaFilter("", "image/svg+xml")); err == nil {
		t.Fatal("bad type filter accepted")
	}
}

func mediaFilter(q, mime string) repository.MediaFilter {
	return repository.MediaFilter{Page: domain.Page{Page: 1, PerPage: 50}, Query: q, Mime: mime}
}
