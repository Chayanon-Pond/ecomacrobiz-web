package service

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/jpeg"
	"image/png"

	"golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

// Upload image processing (pure Go, no cgo):
//
//	JPEG: reject > MaxImagePixels before decoding, decode, downscale so the
//	      longest side <= max dimension (CatmullRom), apply the EXIF
//	      orientation, re-encode at quality 85. Re-encoding drops every
//	      APP segment (EXIF incl. GPS, XMP, ICC profile, comments).
//	PNG:  same limits/downscale; re-encoded. When no resize was needed and
//	      the original has no metadata chunks and is not larger, the original
//	      bytes are kept (re-encoding often grows optimised PNGs).
//	WebP: no decode/re-encode (no pure-Go encoder): EXIF and XMP RIFF chunks
//	      are removed and the VP8X flags fixed. Not resized.
//	GIF, AVIF: stored as uploaded (no metadata removal, no resize).
const (
	DefaultMaxDimension = 2560
	MaxImagePixels      = 40_000_000
	jpegQuality         = 85
)

type ProcessedImage struct {
	Data          []byte
	Width, Height int
	Resized       bool
}

func pixelLimitErr() error {
	return fileErr("ภาพมีความละเอียดเกิน 40 ล้านพิกเซล กรุณาย่อภาพก่อนอัปโหลด")
}

func corruptErr() error {
	return fileErr("ไฟล์ภาพเสียหายหรืออ่านไม่ได้")
}

// ProcessImage applies the rules above to an already sniffed image.
func ProcessImage(mime string, data []byte, maxDim int) (ProcessedImage, error) {
	switch mime {
	case "image/jpeg":
		return processJPEG(data, maxDim)
	case "image/png":
		return processPNG(data, maxDim)
	case "image/webp":
		cfg, err := webp.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return ProcessedImage{}, corruptErr()
		}
		if cfg.Width*cfg.Height > MaxImagePixels {
			return ProcessedImage{}, pixelLimitErr()
		}
		out, err := StripWebPMetadata(data)
		if err != nil {
			return ProcessedImage{}, corruptErr()
		}
		return ProcessedImage{Data: out, Width: cfg.Width, Height: cfg.Height}, nil
	default: // gif, avif: as-is
		w, h, err := imageDimensions(mime, data)
		if err != nil {
			return ProcessedImage{}, corruptErr()
		}
		return ProcessedImage{Data: data, Width: w, Height: h}, nil
	}
}

func processJPEG(data []byte, maxDim int) (ProcessedImage, error) {
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return ProcessedImage{}, corruptErr()
	}
	if cfg.Width*cfg.Height > MaxImagePixels {
		return ProcessedImage{}, pixelLimitErr()
	}
	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		return ProcessedImage{}, corruptErr()
	}
	img, resized := downscale(img, maxDim)
	img = applyOrientation(img, JPEGOrientation(data))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
		return ProcessedImage{}, err
	}
	b := img.Bounds()
	return ProcessedImage{Data: buf.Bytes(), Width: b.Dx(), Height: b.Dy(), Resized: resized}, nil
}

func processPNG(data []byte, maxDim int) (ProcessedImage, error) {
	cfg, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return ProcessedImage{}, corruptErr()
	}
	if cfg.Width*cfg.Height > MaxImagePixels {
		return ProcessedImage{}, pixelLimitErr()
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return ProcessedImage{}, corruptErr()
	}
	img, resized := downscale(img, maxDim)
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return ProcessedImage{}, err
	}
	b := img.Bounds()
	out := ProcessedImage{Data: buf.Bytes(), Width: b.Dx(), Height: b.Dy(), Resized: resized}
	if !resized && len(out.Data) >= len(data) && !PNGHasMetadata(data) {
		out.Data = data
	}
	return out, nil
}

// downscale returns img scaled so max(w,h) <= maxDim (aspect kept), or img
// itself when it already fits.
func downscale(img image.Image, maxDim int) (image.Image, bool) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if maxDim <= 0 || (w <= maxDim && h <= maxDim) {
		return img, false
	}
	nw, nh := maxDim, maxDim
	if w >= h {
		nh = max(1, int(float64(h)*float64(maxDim)/float64(w)+0.5))
	} else {
		nw = max(1, int(float64(w)*float64(maxDim)/float64(h)+0.5))
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Src, nil)
	return dst, true
}

func toRGBA(img image.Image) *image.RGBA {
	if r, ok := img.(*image.RGBA); ok && r.Bounds().Min == (image.Point{}) {
		return r
	}
	b := img.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Src)
	return dst
}

// applyOrientation transforms img so it displays upright for EXIF
// orientation o (1..8; anything else is a no-op).
func applyOrientation(img image.Image, o int) image.Image {
	if o < 2 || o > 8 {
		return img
	}
	src := toRGBA(img)
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	dw, dh := w, h
	if o >= 5 {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < dh; y++ {
		for x := 0; x < dw; x++ {
			var sx, sy int
			switch o {
			case 2: // mirror horizontal
				sx, sy = w-1-x, y
			case 3: // rotate 180
				sx, sy = w-1-x, h-1-y
			case 4: // mirror vertical
				sx, sy = x, h-1-y
			case 5: // transpose
				sx, sy = y, x
			case 6: // rotate 90 CW
				sx, sy = y, h-1-x
			case 7: // transverse
				sx, sy = w-1-y, h-1-x
			case 8: // rotate 90 CCW
				sx, sy = w-1-y, x
			}
			si := sy*src.Stride + sx*4
			di := y*dst.Stride + x*4
			copy(dst.Pix[di:di+4], src.Pix[si:si+4])
		}
	}
	return dst
}

// JPEGOrientation returns the EXIF Orientation (1..8) of a JPEG, 1 when
// absent or unreadable. It walks the marker segments up to SOS and reads
// IFD0 of the first "Exif" APP1 segment.
func JPEGOrientation(b []byte) int {
	if len(b) < 4 || b[0] != 0xFF || b[1] != 0xD8 {
		return 1
	}
	i := 2
	for i+4 <= len(b) {
		if b[i] != 0xFF {
			return 1
		}
		m := b[i+1]
		switch {
		case m == 0xFF: // fill byte
			i++
			continue
		case m == 0xD9 || m == 0xDA: // EOI, SOS: no more metadata
			return 1
		case m == 0x01 || (m >= 0xD0 && m <= 0xD7): // standalone markers
			i += 2
			continue
		}
		n := int(b[i+2])<<8 | int(b[i+3])
		if n < 2 || i+2+n > len(b) {
			return 1
		}
		seg := b[i+4 : i+2+n]
		if m == 0xE1 && len(seg) >= 6 && string(seg[:6]) == "Exif\x00\x00" {
			if o := tiffOrientation(seg[6:]); o != 0 {
				return o
			}
		}
		i += 2 + n
	}
	return 1
}

func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 0
	}
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 0
	}
	if bo.Uint16(t[2:]) != 42 {
		return 0
	}
	off := int64(bo.Uint32(t[4:]))
	if off < 8 || off+2 > int64(len(t)) {
		return 0
	}
	count := int(bo.Uint16(t[off:]))
	for k := 0; k < count; k++ {
		e := int(off) + 2 + 12*k
		if e+12 > len(t) {
			return 0
		}
		if bo.Uint16(t[e:]) != 0x0112 {
			continue
		}
		if bo.Uint16(t[e+2:]) != 3 { // SHORT
			return 0
		}
		if v := int(bo.Uint16(t[e+8:])); v >= 1 && v <= 8 {
			return v
		}
		return 0
	}
	return 0
}

var pngSig = []byte("\x89PNG\r\n\x1a\n")

// PNGHasMetadata reports whether a PNG carries text, EXIF or time chunks.
func PNGHasMetadata(b []byte) bool {
	if !bytes.HasPrefix(b, pngSig) {
		return true // unknown layout: treat as unsafe
	}
	for i := len(pngSig); i+8 <= len(b); {
		n := int64(binary.BigEndian.Uint32(b[i:]))
		switch string(b[i+4 : i+8]) {
		case "tEXt", "zTXt", "iTXt", "eXIf", "tIME":
			return true
		case "IEND":
			return false
		}
		next := int64(i) + 12 + n
		if next > int64(len(b)) {
			return true
		}
		i = int(next)
	}
	return false
}

var errBadWebP = errors.New("malformed webp")

// StripWebPMetadata removes EXIF and XMP chunks from a RIFF WebP file and
// clears the matching VP8X flags. Image data is copied unchanged.
func StripWebPMetadata(b []byte) ([]byte, error) {
	if len(b) < 12 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WEBP" {
		return nil, errBadWebP
	}
	end := int64(8) + int64(binary.LittleEndian.Uint32(b[4:8]))
	if end > int64(len(b)) || end < 12 {
		return nil, errBadWebP
	}
	out := make([]byte, 12, len(b))
	copy(out, b[:12])
	vp8x := -1
	for i := int64(12); i < end; {
		if i+8 > end {
			return nil, errBadWebP
		}
		fcc := string(b[i : i+4])
		size := int64(binary.LittleEndian.Uint32(b[i+4 : i+8]))
		next := i + 8 + size + size&1
		if i+8+size > end {
			return nil, errBadWebP
		}
		if next > end { // missing final pad byte
			next = end
		}
		switch fcc {
		case "EXIF", "XMP ":
		default:
			if fcc == "VP8X" {
				vp8x = len(out)
			}
			out = append(out, b[i:next]...)
		}
		i = next
	}
	if vp8x >= 0 && vp8x+8 < len(out) {
		out[vp8x+8] &^= 0x08 | 0x04 // EXIF, XMP flags
	}
	binary.LittleEndian.PutUint32(out[4:8], uint32(len(out)-8))
	return out, nil
}
