// Package vault holds the member-data cryptography: an AES-256-GCM keyring
// with key rotation (MEMBER_DATA_KEY), HMAC-SHA256 blind indexes
// (MEMBER_INDEX_KEY) and argon2id password hashing.
package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"golang.org/x/text/unicode/norm"
)

const (
	KeySize   = 32
	nonceSize = 12
	MaxKeyID  = 32767
)

var ErrDecrypt = errors.New("vault: decryption failed")

// Keyring encrypts with its primary key and decrypts with any key it holds.
type Keyring struct {
	primary int16
	aeads   map[int16]cipher.AEAD
	ids     []int16
}

// ParseKeyring parses MEMBER_DATA_KEY: either one base64 32-byte key (id 1)
// or "id:base64[,id:base64...]" where the first entry is the primary.
func ParseKeyring(spec string) (*Keyring, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return nil, errors.New("empty key")
	}
	keys := map[int16][]byte{}
	var order []int16
	if !strings.Contains(spec, ":") {
		k, err := decodeKey(spec)
		if err != nil {
			return nil, err
		}
		keys[1] = k
		order = []int16{1}
	} else {
		for _, part := range strings.Split(spec, ",") {
			idStr, b64, ok := strings.Cut(strings.TrimSpace(part), ":")
			if !ok {
				return nil, fmt.Errorf("entry %q must look like id:base64", part)
			}
			n, err := strconv.Atoi(strings.TrimSpace(idStr))
			if err != nil || n < 1 || n > MaxKeyID {
				return nil, fmt.Errorf("key id %q must be 1-%d", idStr, MaxKeyID)
			}
			id := int16(n)
			if _, dup := keys[id]; dup {
				return nil, fmt.Errorf("duplicate key id %d", id)
			}
			k, err := decodeKey(b64)
			if err != nil {
				return nil, fmt.Errorf("key %d: %w", id, err)
			}
			keys[id] = k
			order = append(order, id)
		}
	}
	return newKeyring(order, keys)
}

// NewKeyring builds a keyring from explicit keys (first id = primary).
func NewKeyring(order []int16, keys map[int16][]byte) (*Keyring, error) {
	return newKeyring(order, keys)
}

func newKeyring(order []int16, keys map[int16][]byte) (*Keyring, error) {
	if len(order) == 0 {
		return nil, errors.New("no keys")
	}
	kr := &Keyring{primary: order[0], aeads: map[int16]cipher.AEAD{}}
	for _, id := range order {
		k := keys[id]
		if len(k) != KeySize {
			return nil, fmt.Errorf("key %d must be %d bytes", id, KeySize)
		}
		block, err := aes.NewCipher(k)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		kr.aeads[id] = aead
		kr.ids = append(kr.ids, id)
	}
	return kr, nil
}

func decodeKey(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	k, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		if k, err = base64.RawStdEncoding.DecodeString(s); err != nil {
			if k, err = base64.URLEncoding.DecodeString(s); err != nil {
				if k, err = base64.RawURLEncoding.DecodeString(s); err != nil {
					return nil, errors.New("not valid base64")
				}
			}
		}
	}
	if len(k) != KeySize {
		return nil, fmt.Errorf("must decode to %d bytes (got %d)", KeySize, len(k))
	}
	return k, nil
}

// RandomKey returns a fresh 32-byte key (dev/test fallback).
func RandomKey() []byte {
	k := make([]byte, KeySize)
	if _, err := rand.Read(k); err != nil {
		panic(err)
	}
	return k
}

// PrimaryID is the key id new ciphertexts are written with.
func (k *Keyring) PrimaryID() int16 { return k.primary }

// KeyIDs lists the loaded key ids (primary first).
func (k *Keyring) KeyIDs() []int16 { return slices.Clone(k.ids) }

// Encrypt seals plaintext with the primary key; aad binds the ciphertext to
// its row and purpose. Output: nonce || ciphertext+tag.
func (k *Keyring) Encrypt(plaintext []byte, aad string) ([]byte, int16, error) {
	aead := k.aeads[k.primary]
	nonce := make([]byte, nonceSize, nonceSize+len(plaintext)+aead.Overhead())
	if _, err := rand.Read(nonce); err != nil {
		return nil, 0, err
	}
	return aead.Seal(nonce, nonce, plaintext, []byte(aad)), k.primary, nil
}

// Decrypt opens a ciphertext written with key keyID and the same aad.
func (k *Keyring) Decrypt(ct []byte, keyID int16, aad string) ([]byte, error) {
	aead, ok := k.aeads[keyID]
	if !ok || len(ct) < nonceSize+aead.Overhead() {
		return nil, ErrDecrypt
	}
	pt, err := aead.Open(nil, ct[:nonceSize], ct[nonceSize:], []byte(aad))
	if err != nil {
		return nil, ErrDecrypt
	}
	return pt, nil
}

// Index computes blind indexes (deterministic keyed hashes) for lookups of
// encrypted values.
type Index struct{ key []byte }

// ParseIndexKey parses MEMBER_INDEX_KEY (one base64 32-byte key).
func ParseIndexKey(s string) (*Index, error) {
	k, err := decodeKey(s)
	if err != nil {
		return nil, err
	}
	return NewIndex(k), nil
}

func NewIndex(key []byte) *Index { return &Index{key: slices.Clone(key)} }

func (x *Index) mac(input string) []byte {
	m := hmac.New(sha256.New, x.key)
	m.Write([]byte(input))
	return m.Sum(nil)
}

// Email is the blind index of an e-mail address (normalized here).
func (x *Index) Email(email string) []byte { return x.mac("email:" + NormalizeEmail(email)) }

// Subject is the blind index of an external identity subject.
func (x *Index) Subject(provider, sub string) []byte { return x.mac("sub:" + provider + ":" + sub) }

// NormalizeEmail: trim, Unicode NFC, lower-case the whole address (no
// provider-specific rewriting such as gmail dot removal).
func NormalizeEmail(e string) string {
	return strings.ToLower(norm.NFC.String(strings.TrimSpace(e)))
}
