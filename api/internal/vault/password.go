package vault

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Argon2Params are the argon2id cost parameters.
type Argon2Params struct {
	MemoryKiB uint32
	Time      uint32
	Threads   uint8
}

// DefaultArgon2 is the OWASP-recommended minimum (m=19 MiB, t=2, p=1).
var DefaultArgon2 = Argon2Params{MemoryKiB: 19456, Time: 2, Threads: 1}

const (
	saltLen = 16
	hashLen = 32
	// Bounds accepted when verifying a stored hash, so a corrupted or hostile
	// PHC string cannot make verification allocate gigabytes.
	maxMemoryKiB = 256 * 1024
	maxTime      = 10
	maxThreads   = 4

	MinPasswordRunes = 10
	MaxPasswordRunes = 128
	// maxConcurrentHashes bounds the memory spent hashing (4 x 19 MiB).
	maxConcurrentHashes = 4
)

var ErrBadHash = errors.New("vault: malformed password hash")

// Hasher hashes and verifies argon2id passwords, at most 4 at a time.
type Hasher struct {
	params Argon2Params
	sem    chan struct{}
	dummy  string
}

func NewHasher(p Argon2Params) *Hasher {
	h := &Hasher{params: p, sem: make(chan struct{}, maxConcurrentHashes)}
	h.dummy = h.hash([]byte("timing-equaliser-not-a-password"), make([]byte, saltLen))
	return h
}

func (h *Hasher) acquire(ctx context.Context) error {
	select {
	case h.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *Hasher) release() { <-h.sem }

func (h *Hasher) hash(pw, salt []byte) string {
	p := h.params
	key := argon2.IDKey(pw, salt, p.Time, p.MemoryKiB, p.Threads, hashLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, p.MemoryKiB, p.Time, p.Threads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
}

// Hash returns a PHC string: $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>.
func (h *Hasher) Hash(ctx context.Context, password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	if err := h.acquire(ctx); err != nil {
		return "", err
	}
	defer h.release()
	return h.hash([]byte(password), salt), nil
}

// Verify checks password against a PHC string using the parameters stored in
// it (bounded). Comparison is constant time.
func (h *Hasher) Verify(ctx context.Context, phc, password string) (bool, error) {
	p, salt, want, err := ParsePHC(phc)
	if err != nil {
		return false, err
	}
	if err := h.acquire(ctx); err != nil {
		return false, err
	}
	defer h.release()
	got := argon2.IDKey([]byte(password), salt, p.Time, p.MemoryKiB, p.Threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// DummyVerify spends the same work as a real verification (unknown account)
// so response timing does not reveal which e-mails exist.
func (h *Hasher) DummyVerify(ctx context.Context, password string) {
	_, _ = h.Verify(ctx, h.dummy, password)
}

// ParsePHC parses and bounds-checks an argon2id PHC string.
func ParsePHC(phc string) (Argon2Params, []byte, []byte, error) {
	parts := strings.Split(phc, "$")
	// "", "argon2id", "v=19", "m=..,t=..,p=..", salt, hash
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return Argon2Params{}, nil, nil, ErrBadHash
	}
	var v int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &v); err != nil || v != argon2.Version {
		return Argon2Params{}, nil, nil, ErrBadHash
	}
	var m, t, p uint64
	if n, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil || n != 3 ||
		fmt.Sprintf("m=%d,t=%d,p=%d", m, t, p) != parts[3] {
		return Argon2Params{}, nil, nil, ErrBadHash
	}
	if m < 8*p || m > maxMemoryKiB || t < 1 || t > maxTime || p < 1 || p > maxThreads {
		return Argon2Params{}, nil, nil, ErrBadHash
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 8 || len(salt) > 64 {
		return Argon2Params{}, nil, nil, ErrBadHash
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(key) < 16 || len(key) > 64 {
		return Argon2Params{}, nil, nil, ErrBadHash
	}
	return Argon2Params{MemoryKiB: uint32(m), Time: uint32(t), Threads: uint8(p)}, salt, key, nil
}

//go:embed common_passwords.txt
var commonPasswordsTxt string

var commonPasswords = func() map[string]struct{} {
	set := map[string]struct{}{}
	sc := bufio.NewScanner(strings.NewReader(commonPasswordsTxt))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		set[strings.ToLower(line)] = struct{}{}
	}
	return set
}()

// CommonPasswordCount is the size of the embedded list (tests).
func CommonPasswordCount() int { return len(commonPasswords) }

// IsCommonPassword reports whether pw is in the embedded list (case-insensitive).
func IsCommonPassword(pw string) bool {
	_, ok := commonPasswords[strings.ToLower(strings.TrimSpace(pw))]
	return ok
}

// PasswordProblem names why pw is not acceptable ("" = acceptable).
type PasswordProblem string

const (
	PasswordOK       PasswordProblem = ""
	PasswordTooShort PasswordProblem = "too_short"
	PasswordTooLong  PasswordProblem = "too_long"
	PasswordCommon   PasswordProblem = "common"
	PasswordPersonal PasswordProblem = "personal"
)

// CheckPassword applies the member password policy: 10..128 runes, not a
// common password, not equal (case-insensitive) to the e-mail, its local
// part or the display name.
func CheckPassword(pw, email, displayName string) PasswordProblem {
	n := utf8.RuneCountInString(pw)
	switch {
	case n < MinPasswordRunes:
		return PasswordTooShort
	case n > MaxPasswordRunes:
		return PasswordTooLong
	case IsCommonPassword(pw):
		return PasswordCommon
	}
	lp := strings.ToLower(strings.TrimSpace(pw))
	email = NormalizeEmail(email)
	local, _, _ := strings.Cut(email, "@")
	for _, s := range []string{email, local, strings.ToLower(strings.TrimSpace(displayName))} {
		if s != "" && lp == s {
			return PasswordPersonal
		}
	}
	return PasswordOK
}
