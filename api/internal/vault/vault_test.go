package vault

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func b64(k []byte) string { return base64.StdEncoding.EncodeToString(k) }

func TestKeyringRoundTripAndAAD(t *testing.T) {
	kr, err := ParseKeyring(b64(RandomKey()))
	if err != nil {
		t.Fatal(err)
	}
	if kr.PrimaryID() != 1 {
		t.Fatalf("single key must be id 1, got %d", kr.PrimaryID())
	}
	ct, kid, err := kr.Encrypt([]byte("somchai@example.com"), "member-email:abc")
	if err != nil || kid != 1 {
		t.Fatal(err, kid)
	}
	pt, err := kr.Decrypt(ct, kid, "member-email:abc")
	if err != nil || string(pt) != "somchai@example.com" {
		t.Fatalf("round trip: %q %v", pt, err)
	}
	ct2, _, _ := kr.Encrypt([]byte("somchai@example.com"), "member-email:abc")
	if bytes.Equal(ct, ct2) {
		t.Fatal("nonce reuse: identical ciphertexts")
	}
	// wrong AAD (row swap) fails
	if _, err := kr.Decrypt(ct, kid, "member-email:other"); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("wrong aad: %v", err)
	}
	// tampered ciphertext fails
	bad := bytes.Clone(ct)
	bad[len(bad)-1] ^= 1
	if _, err := kr.Decrypt(bad, kid, "member-email:abc"); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("tampered: %v", err)
	}
	bad = bytes.Clone(ct)
	bad[0] ^= 1 // nonce
	if _, err := kr.Decrypt(bad, kid, "member-email:abc"); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("tampered nonce: %v", err)
	}
	if _, err := kr.Decrypt(ct[:10], kid, "member-email:abc"); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("short: %v", err)
	}
	if _, err := kr.Decrypt(ct, 9, "member-email:abc"); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("unknown key id: %v", err)
	}
}

func TestKeyringRotation(t *testing.T) {
	k1, k2 := RandomKey(), RandomKey()
	old, err := ParseKeyring("1:" + b64(k1))
	if err != nil {
		t.Fatal(err)
	}
	ctOld, kidOld, _ := old.Encrypt([]byte("old row"), "aad")

	rotated, err := ParseKeyring("2:" + b64(k2) + ", 1:" + b64(k1))
	if err != nil {
		t.Fatal(err)
	}
	if rotated.PrimaryID() != 2 || len(rotated.KeyIDs()) != 2 || rotated.KeyIDs()[0] != 2 {
		t.Fatalf("ids: %v primary %d", rotated.KeyIDs(), rotated.PrimaryID())
	}
	if pt, err := rotated.Decrypt(ctOld, kidOld, "aad"); err != nil || string(pt) != "old row" {
		t.Fatalf("old key id must still decrypt: %q %v", pt, err)
	}
	ctNew, kidNew, _ := rotated.Encrypt([]byte("new row"), "aad")
	if kidNew != 2 {
		t.Fatalf("new rows must use the primary key, got %d", kidNew)
	}
	if _, err := old.Decrypt(ctNew, kidNew, "aad"); err == nil {
		t.Fatal("old keyring must not decrypt key 2 rows")
	}
	// same bytes under a different id must not decrypt (key ids are bound)
	if _, err := rotated.Decrypt(ctNew, 1, "aad"); err == nil {
		t.Fatal("decrypting with the wrong key id must fail")
	}
}

func TestParseKeyringRejects(t *testing.T) {
	k := b64(RandomKey())
	for _, spec := range []string{"", "not-base64!!", b64([]byte("short")), "0:" + k, "40000:" + k, "x:" + k,
		"1:" + k + ",1:" + k, "1:" + k + ",2", "1:" + b64(make([]byte, 31))} {
		if _, err := ParseKeyring(spec); err == nil {
			t.Errorf("ParseKeyring(%q) accepted", spec)
		}
	}
	if _, err := ParseKeyring(base64.RawURLEncoding.EncodeToString(RandomKey())); err != nil {
		t.Errorf("raw url base64 should be accepted: %v", err)
	}
	if _, err := ParseIndexKey("abc"); err == nil {
		t.Error("short index key accepted")
	}
}

func TestBlindIndex(t *testing.T) {
	key := RandomKey()
	x := NewIndex(key)
	a := x.Email("Somchai@Example.COM")
	if !bytes.Equal(a, x.Email("  somchai@example.com\t")) {
		t.Fatal("index must be case/space insensitive")
	}
	if !bytes.Equal(a, NewIndex(key).Email("somchai@example.com")) {
		t.Fatal("index must be deterministic for the same key")
	}
	if bytes.Equal(a, NewIndex(RandomKey()).Email("somchai@example.com")) {
		t.Fatal("different keys must give different indexes")
	}
	if bytes.Equal(x.Email("some.chai@gmail.com"), x.Email("somechai@gmail.com")) {
		t.Fatal("no provider-specific rewriting (gmail dots)")
	}
	// NFC: composed and decomposed forms index the same
	if !bytes.Equal(x.Email("café@example.com"), x.Email("café@example.com")) {
		t.Fatal("NFC normalization missing")
	}
	// domain separation between e-mails and subjects
	if bytes.Equal(x.Email("123"), x.Subject("google", "123")) || len(a) != 32 {
		t.Fatal("domain separation / length")
	}
	if bytes.Equal(x.Subject("google", "1"), x.Subject("line", "1")) {
		t.Fatal("provider must be part of the subject index")
	}
}

var cheap = Argon2Params{MemoryKiB: 64, Time: 1, Threads: 1}

func TestArgon2HashVerify(t *testing.T) {
	ctx := context.Background()
	h := NewHasher(DefaultArgon2)
	phc, err := h.Hash(ctx, "correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(phc, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("PHC format: %s", phc)
	}
	p, salt, key, err := ParsePHC(phc)
	if err != nil || p != DefaultArgon2 || len(salt) != 16 || len(key) != 32 {
		t.Fatalf("parse: %+v %d %d %v", p, len(salt), len(key), err)
	}
	if ok, err := h.Verify(ctx, phc, "correct horse battery"); !ok || err != nil {
		t.Fatalf("verify: %v %v", ok, err)
	}
	if ok, _ := h.Verify(ctx, phc, "correct horse batterY"); ok {
		t.Fatal("wrong password verified")
	}
	// parameters are read from the hash: a cheap hash verifies with a default hasher
	cheapHash, _ := NewHasher(cheap).Hash(ctx, "another password")
	if ok, err := h.Verify(ctx, cheapHash, "another password"); !ok || err != nil {
		t.Fatalf("verify with stored params: %v %v", ok, err)
	}
	h.DummyVerify(ctx, "anything") // must not panic
}

func TestParsePHCRejects(t *testing.T) {
	ctx := context.Background()
	good, _ := NewHasher(cheap).Hash(ctx, "a password here")
	parts := strings.Split(good, "$")
	mk := func(i int, v string) string {
		p := append([]string(nil), parts...)
		p[i] = v
		return strings.Join(p, "$")
	}
	bad := map[string]string{
		"empty":         "",
		"bcrypt":        "$2a$12$abcdefghijklmnopqrstuuK6cE0W1qAo0Bd3P6Sj2E8B5Z6C7xYzW",
		"argon2i":       mk(1, "argon2i"),
		"version":       mk(2, "v=16"),
		"huge memory":   mk(3, "m=4194304,t=1,p=1"),
		"zero time":     mk(3, "m=64,t=0,p=1"),
		"many threads":  mk(3, "m=64,t=1,p=64"),
		"extra param":   mk(3, "m=64,t=1,p=1,x=2"),
		"bad salt":      mk(4, "!!!"),
		"short salt":    mk(4, "AAAA"),
		"short key":     mk(5, "AAAA"),
		"missing field": strings.Join(parts[:5], "$"),
	}
	h := NewHasher(cheap)
	for name, phc := range bad {
		if _, _, _, err := ParsePHC(phc); err == nil {
			t.Errorf("%s: ParsePHC accepted %q", name, phc)
		}
		if ok, err := h.Verify(ctx, phc, "a password here"); ok || !errors.Is(err, ErrBadHash) {
			t.Errorf("%s: Verify = %v, %v", name, ok, err)
		}
	}
}

func TestPasswordPolicy(t *testing.T) {
	if CommonPasswordCount() < 900 {
		t.Fatalf("common password list too small: %d", CommonPasswordCount())
	}
	cases := []struct {
		pw, email, name string
		want            PasswordProblem
	}{
		{"short", "a@b.co", "", PasswordTooShort},
		{"เก้าตัวอักษรนะ", "a@b.co", "", PasswordOK},  // 14 runes, multibyte
		{"ภาษาไทย๑๒", "a@b.co", "", PasswordTooShort}, // 9 runes (more than 10 bytes)
		{strings.Repeat("x", 129), "a@b.co", "", PasswordTooLong},
		{"password123", "a@b.co", "", PasswordCommon},
		{"PassWord123", "a@b.co", "", PasswordCommon},
		{"qwertyuiop", "a@b.co", "", PasswordCommon},
		{"1234567890", "a@b.co", "", PasswordCommon},
		{"somchai.dev@example.com", "Somchai.Dev@example.com", "", PasswordPersonal},
		{"somchai.dev", "somchai.dev@example.com", "", PasswordPersonal},
		{"Somchai Jaidee", "x@example.com", "somchai jaidee", PasswordPersonal},
		{"tangerine-orbit-42", "x@example.com", "สมชาย", PasswordOK},
	}
	for _, c := range cases {
		if got := CheckPassword(c.pw, c.email, c.name); got != c.want {
			t.Errorf("CheckPassword(%q) = %q, want %q", c.pw, got, c.want)
		}
	}
}

func TestHasherConcurrencyBound(t *testing.T) {
	h := NewHasher(cheap)
	if cap(h.sem) != 4 {
		t.Fatalf("semaphore size %d", cap(h.sem))
	}
	ctx, cancel := context.WithCancel(context.Background())
	for i := 0; i < 4; i++ {
		h.sem <- struct{}{}
	}
	cancel()
	if _, err := h.Hash(ctx, "blocked password"); !errors.Is(err, context.Canceled) {
		t.Fatalf("a 5th hash must wait for a slot: %v", err)
	}
}
