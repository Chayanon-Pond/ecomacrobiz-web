package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
	"github.com/ecomacrobiz/escoma/api/internal/repository/fake"
)

func TestCSVSafe(t *testing.T) {
	cases := map[string]string{
		"=SUM(A1:A2)":       "'=SUM(A1:A2)",
		"+66812345678":      "'+66812345678",
		"-1":                "'-1",
		"@cmd":              "'@cmd",
		"\t=1":              "'\t=1",
		"สมชาย":             "สมชาย",
		"a=b":               "a=b",
		"":                  "",
		"0812345678":        "0812345678",
		"hello@example.com": "hello@example.com",
	}
	for in, want := range cases {
		if got := CSVSafe(in); got != want {
			t.Errorf("CSVSafe(%q) = %q want %q", in, got, want)
		}
	}
}

func TestExportCSV(t *testing.T) {
	store := fake.New()
	ctx := context.Background()
	for _, l := range []domain.Lead{
		{FirstName: "=HYPERLINK(\"http://evil\")", LastName: "ใจดี", Phone: "+66812345678", Email: "a@b.co",
			PreferredChannel: domain.ChannelLine, Message: "บรรทัด1\nบรรทัด2, มีจุลภาค \"quoted\"", ConsentAt: time.Now()},
		{FirstName: "สมหญิง", Phone: "0812345678", Email: "c@d.co", PreferredChannel: domain.ChannelEmail,
			Status: domain.LeadSpam, ConsentAt: time.Now()},
	} {
		if err := store.LeadsRepo().Create(ctx, &l); err != nil {
			t.Fatal(err)
		}
	}
	svc := NewLeadService(store.LeadsRepo(), discard)
	var buf bytes.Buffer
	if err := svc.ExportCSV(ctx, &buf, ""); err != nil {
		t.Fatal(err)
	}
	out := buf.Bytes()
	if !bytes.HasPrefix(out, []byte{0xEF, 0xBB, 0xBF}) {
		t.Fatal("missing UTF-8 BOM")
	}
	recs, err := csv.NewReader(bytes.NewReader(out[3:])).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 3 || recs[0][0] != "id" {
		t.Fatalf("records: %v", recs)
	}
	// newest first: the spam lead, then the injection attempt
	if recs[1][3] != "สมหญิง" {
		t.Errorf("thai name: %q", recs[1][3])
	}
	if recs[2][3] != `'=HYPERLINK("http://evil")` || recs[2][6] != "'+66812345678" {
		t.Errorf("formula injection not neutralised: %q %q", recs[2][3], recs[2][6])
	}
	if !strings.Contains(recs[2][12], "บรรทัด1\nบรรทัด2") {
		t.Errorf("multiline message: %q", recs[2][12])
	}

	buf.Reset()
	if err := svc.ExportCSV(ctx, &buf, "spam"); err != nil {
		t.Fatal(err)
	}
	recs, _ = csv.NewReader(bytes.NewReader(buf.Bytes()[3:])).ReadAll()
	if len(recs) != 2 {
		t.Errorf("status filter: %d rows", len(recs)-1)
	}
	if err := svc.ExportCSV(ctx, io.Discard, "bogus"); err == nil {
		t.Error("invalid status accepted")
	}
}

func TestLeadUpdate(t *testing.T) {
	store := fake.New()
	ctx := context.Background()
	l := domain.Lead{FirstName: "A", Phone: "0812345678", Email: "a@b.co", PreferredChannel: domain.ChannelPhone}
	_ = store.LeadsRepo().Create(ctx, &l)
	svc := NewLeadService(store.LeadsRepo(), discard)
	note := "โทรกลับแล้ว"
	got, err := svc.Update(ctx, l.ID, LeadUpdate{Status: "contacted", Note: &note}, "")
	if err != nil || got.Status != domain.LeadContacted || got.Note != note {
		t.Fatalf("update: %+v %v", got, err)
	}
	got, err = svc.Update(ctx, l.ID, LeadUpdate{Status: "qualified"}, "")
	if err != nil || got.Note != note {
		t.Fatalf("absent note must be kept: %+v %v", got, err)
	}
	if _, err := svc.Update(ctx, l.ID, LeadUpdate{Status: "won"}, ""); fieldErrs(t, err)["status"] == "" {
		t.Error("invalid status accepted")
	}
	if _, err := svc.Update(ctx, "nope", LeadUpdate{Status: "new"}, ""); !errors.Is(err, domain.ErrNotFound) {
		t.Error("bad id")
	}
	if _, _, err := svc.List(ctx, repository.LeadFilter{Page: domain.Page{Page: 1, PerPage: 10}, Status: "x"}); err == nil {
		t.Error("invalid list status accepted")
	}
}

type memStore struct {
	files map[string][]byte
}

func (m *memStore) Put(_ context.Context, key string, r io.Reader, _ string) error {
	b, err := io.ReadAll(r)
	m.files[key] = b
	return err
}
func (m *memStore) Delete(_ context.Context, key string) error { delete(m.files, key); return nil }
func (m *memStore) URL(key string) string                      { return "http://api.test/media/" + key }

func encode(t *testing.T, kind string) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	img.Set(0, 0, color.RGBA{255, 0, 0, 255})
	var b bytes.Buffer
	var err error
	switch kind {
	case "png":
		err = png.Encode(&b, img)
	case "jpeg":
		err = jpeg.Encode(&b, img, nil)
	case "gif":
		err = gif.Encode(&b, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// minimal AVIF prefix: ftyp(avif) + an ispe property 640x480.
func fakeAVIF() []byte {
	b := []byte{0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'a', 'v', 'i', 'f', 0, 0, 0, 0, 'm', 'i', 'f', '1', 'a', 'v', 'i', 'f'}
	b = append(b, 0, 0, 0, 0x14, 'i', 's', 'p', 'e', 0, 0, 0, 0, 0, 0, 2, 0x80, 0, 0, 1, 0xE0)
	return b
}

func TestMediaUpload(t *testing.T) {
	ctx := context.Background()
	store := fake.New()
	ms := &memStore{files: map[string][]byte{}}
	svc := NewMediaService(store.MediaRepo(), ms, 1<<20, discard)

	for _, kind := range []string{"png", "jpeg", "gif"} {
		m, err := svc.Upload(ctx, bytes.NewReader(encode(t, kind)), "../../etc/รูป."+kind, "u1")
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if m.Width != 3 || m.Height != 2 || !strings.HasPrefix(m.Mime, "image/") || m.ID == "" {
			t.Errorf("%s: %+v", kind, m)
		}
		if strings.Contains(m.OriginalName, "/") || strings.Contains(m.StorageKey, "..") {
			t.Errorf("name not sanitised: %+v", m)
		}
	}
	m, err := svc.Upload(ctx, bytes.NewReader(fakeAVIF()), "a.avif", "")
	if err != nil || m.Mime != "image/avif" || m.Width != 640 || m.Height != 480 {
		t.Fatalf("avif: %+v %v", m, err)
	}

	for name, data := range map[string][]byte{
		"svg":   []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"html":  []byte("<html><body>hi</body></html>"),
		"empty": {},
		"trunc": encode(t, "png")[:20],
	} {
		if _, err := svc.Upload(ctx, bytes.NewReader(data), name, ""); fieldErrs(t, err)["file"] == "" {
			t.Errorf("%s accepted: %v", name, err)
		}
	}
	small := NewMediaService(store.MediaRepo(), ms, 10, discard)
	if _, err := small.Upload(ctx, bytes.NewReader(encode(t, "png")), "x.png", ""); !errors.Is(err, domain.ErrTooLarge) {
		t.Errorf("too large: %v", err)
	}
}
