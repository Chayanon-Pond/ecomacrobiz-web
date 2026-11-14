package service

import (
	"regexp"
	"testing"
)

func TestMediaKeyThaiAltFallsBackToFilename(t *testing.T) {
	cases := []struct{ alt, name, wantPrefix string }{
		{"ภาพแชร์ g", "og-test-ภาพแชร์.png", "og-test-"},
		{"ภาพทดสอบ", "ภาพทดสอบ-cover.webp", "cover-"},
		{"Brand workshop photo", "IMG_0001.jpg", "brand-workshop-photo-"},
		{"ภาพ", "ภาพ.jpg", "image-"},
	}
	for _, c := range cases {
		got := MediaKey(c.alt, c.name, "png")
		if !regexp.MustCompile(`^` + regexp.QuoteMeta(c.wantPrefix) + `[0-9a-f]{8}\.png$`).MatchString(got) {
			t.Errorf("MediaKey(%q,%q) = %q, want prefix %q", c.alt, c.name, got, c.wantPrefix)
		}
	}
}
