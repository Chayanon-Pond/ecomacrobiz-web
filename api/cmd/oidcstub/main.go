// Command oidcstub is a DEVELOPMENT-ONLY OpenID Connect provider that stands
// in for Google so the community sign-in flow can be exercised locally and
// in automated E2E tests. It is a separate binary and is never wired into
// `server serve`.
//
//	go run ./cmd/oidcstub [-addr 127.0.0.1:18090] [-client-id stub-client] [-client-secret stub-secret]
//
// Point the API at it (APP_ENV must not be production):
//
//	OIDC_ISSUER_URL=http://127.0.0.1:18090 GOOGLE_CLIENT_ID=stub-client GOOGLE_CLIENT_SECRET=stub-secret
//
// Endpoints: /.well-known/openid-configuration, /jwks, /authorize (HTML form,
// or auto-approve with ?auto_email=...&auto_name=...[&auto_verified=false]
// [&auto_picture=1]), /token (client secret + PKCE S256 checked), /picture.png.
package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"image"
	"image/color"
	"image/png"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type pending struct {
	clientID, redirectURI, nonce, challenge string
	email, name, picture                    string
	verified                                bool
	expires                                 time.Time
}

type stub struct {
	issuer, clientID, clientSecret string
	key                            *rsa.PrivateKey
	kid                            string

	mu    sync.Mutex
	codes map[string]pending
}

func main() {
	addr := flag.String("addr", "127.0.0.1:18090", "listen address")
	issuer := flag.String("issuer", "", "issuer URL (default http://<addr>)")
	clientID := flag.String("client-id", "stub-client", "accepted OAuth client id")
	clientSecret := flag.String("client-secret", "stub-secret", "accepted OAuth client secret")
	flag.Parse()
	if *issuer == "" {
		*issuer = "http://" + *addr
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		log.Fatal(err)
	}
	s := &stub{issuer: strings.TrimRight(*issuer, "/"), clientID: *clientID, clientSecret: *clientSecret, key: key,
		kid: randHex(8), codes: map[string]pending{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", s.discovery)
	mux.HandleFunc("GET /jwks", s.jwks)
	mux.HandleFunc("GET /authorize", s.authorize)
	mux.HandleFunc("POST /authorize", s.approve)
	mux.HandleFunc("POST /token", s.token)
	mux.HandleFunc("GET /picture.png", picture)
	log.Printf("oidcstub (DEVELOPMENT ONLY) issuer=%s client_id=%s listening on %s", s.issuer, s.clientID, *addr)
	srv := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func oauthError(w http.ResponseWriter, status int, code, desc string) {
	writeJSON(w, status, map[string]string{"error": code, "error_description": desc})
}

func (s *stub) discovery(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                s.issuer,
		"authorization_endpoint":                s.issuer + "/authorize",
		"token_endpoint":                        s.issuer + "/token",
		"jwks_uri":                              s.issuer + "/jwks",
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"scopes_supported":                      []string{"openid", "email", "profile"},
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post"},
		"code_challenge_methods_supported":      []string{"S256"},
		"claims_supported":                      []string{"sub", "email", "email_verified", "name", "picture", "nonce"},
	})
}

func b64u(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func (s *stub) jwks(w http.ResponseWriter, _ *http.Request) {
	pub := s.key.PublicKey
	writeJSON(w, http.StatusOK, map[string]any{"keys": []map[string]string{{
		"kty": "RSA", "use": "sig", "alg": "RS256", "kid": s.kid,
		"n": b64u(pub.N.Bytes()), "e": b64u(big.NewInt(int64(pub.E)).Bytes()),
	}}})
}

// authParams validates the authorization request shared by GET and POST.
func (s *stub) authParams(q url.Values) (pending, string) {
	p := pending{clientID: q.Get("client_id"), redirectURI: q.Get("redirect_uri"), nonce: q.Get("nonce"),
		challenge: q.Get("code_challenge")}
	switch {
	case q.Get("response_type") != "code":
		return p, "response_type must be code"
	case p.clientID != s.clientID:
		return p, "unknown client_id"
	case p.redirectURI == "":
		return p, "redirect_uri is required"
	case q.Get("code_challenge_method") != "S256" || p.challenge == "":
		return p, "PKCE S256 code_challenge is required"
	case p.nonce == "":
		return p, "nonce is required"
	}
	if u, err := url.Parse(p.redirectURI); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return p, "redirect_uri must be an absolute http(s) URL"
	}
	return p, ""
}

var page = template.Must(template.New("authorize").Parse(`<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>OIDC stub (dev only)</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem}
label{display:block;margin:.8rem 0 .2rem}input,select{width:100%;padding:.4rem}button{margin-top:1rem;padding:.5rem 1rem}
.warn{background:#fff3cd;padding:.6rem;border-radius:.3rem}</style></head><body>
<p class="warn">DEVELOPMENT STUB — not Google. Never use in production.</p>
<h1>Sign in as…</h1>
<form method="post" action="/authorize">
{{range $k, $v := .Hidden}}<input type="hidden" name="{{$k}}" value="{{$v}}">{{end}}
<label for="email">E-mail</label><input id="email" name="email" type="email" required value="dev@example.com">
<label for="name">Name</label><input id="name" name="name" value="Dev User">
<label for="email_verified">email_verified</label>
<select id="email_verified" name="email_verified"><option value="true">true</option><option value="false">false</option></select>
<label><input type="checkbox" name="picture" value="1" style="width:auto"> include a picture claim</label>
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form></body></html>`))

func (s *stub) authorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	p, msg := s.authParams(q)
	if msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	if email := q.Get("auto_email"); email != "" {
		p.email, p.name, p.verified = email, q.Get("auto_name"), q.Get("auto_verified") != "false"
		if q.Get("auto_picture") == "1" {
			p.picture = s.pictureURL(email)
		}
		s.redirectWithCode(w, r, p, q.Get("state"))
		return
	}
	hidden := map[string]string{}
	for _, k := range []string{"response_type", "client_id", "redirect_uri", "state", "nonce", "code_challenge",
		"code_challenge_method", "scope"} {
		hidden[k] = q.Get(k)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = page.Execute(w, map[string]any{"Hidden": hidden})
}

func (s *stub) approve(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	f := r.PostForm
	p, msg := s.authParams(f)
	if msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	if f.Get("decision") == "deny" {
		u, _ := url.Parse(p.redirectURI)
		v := u.Query()
		v.Set("error", "access_denied")
		v.Set("state", f.Get("state"))
		u.RawQuery = v.Encode()
		http.Redirect(w, r, u.String(), http.StatusFound)
		return
	}
	p.email, p.name, p.verified = strings.TrimSpace(f.Get("email")), strings.TrimSpace(f.Get("name")), f.Get("email_verified") == "true"
	if p.email == "" {
		http.Error(w, "email is required", http.StatusBadRequest)
		return
	}
	if f.Get("picture") == "1" {
		p.picture = s.pictureURL(p.email)
	}
	s.redirectWithCode(w, r, p, f.Get("state"))
}

func (s *stub) pictureURL(email string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(email)))
	return s.issuer + "/picture.png?seed=" + hex.EncodeToString(sum[:4])
}

func (s *stub) redirectWithCode(w http.ResponseWriter, r *http.Request, p pending, state string) {
	code := randHex(16)
	p.expires = time.Now().Add(5 * time.Minute)
	s.mu.Lock()
	s.codes[code] = p
	s.mu.Unlock()
	u, _ := url.Parse(p.redirectURI)
	v := u.Query()
	v.Set("code", code)
	v.Set("state", state)
	u.RawQuery = v.Encode()
	http.Redirect(w, r, u.String(), http.StatusFound)
}

func (s *stub) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		oauthError(w, http.StatusBadRequest, "invalid_request", "bad form")
		return
	}
	f := r.PostForm
	id, secret, ok := r.BasicAuth()
	if ok {
		id, _ = url.QueryUnescape(id)
		secret, _ = url.QueryUnescape(secret)
	} else {
		id, secret = f.Get("client_id"), f.Get("client_secret")
	}
	if subtle.ConstantTimeCompare([]byte(id), []byte(s.clientID)) != 1 ||
		subtle.ConstantTimeCompare([]byte(secret), []byte(s.clientSecret)) != 1 {
		oauthError(w, http.StatusUnauthorized, "invalid_client", "client authentication failed")
		return
	}
	if f.Get("grant_type") != "authorization_code" {
		oauthError(w, http.StatusBadRequest, "unsupported_grant_type", "authorization_code only")
		return
	}
	s.mu.Lock()
	p, found := s.codes[f.Get("code")]
	delete(s.codes, f.Get("code")) // single use
	s.mu.Unlock()
	if !found || time.Now().After(p.expires) || p.clientID != id || p.redirectURI != f.Get("redirect_uri") {
		oauthError(w, http.StatusBadRequest, "invalid_grant", "unknown, expired or mismatched code")
		return
	}
	sum := sha256.Sum256([]byte(f.Get("code_verifier")))
	if subtle.ConstantTimeCompare([]byte(b64u(sum[:])), []byte(p.challenge)) != 1 {
		oauthError(w, http.StatusBadRequest, "invalid_grant", "PKCE verification failed")
		return
	}
	idToken, err := s.sign(p)
	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"access_token": randHex(16), "token_type": "Bearer", "expires_in": 3600,
		"scope": "openid email profile", "id_token": idToken})
}

// sign issues an RS256 ID token; sub is a stable hash of the e-mail.
func (s *stub) sign(p pending) (string, error) {
	now := time.Now()
	sub := sha256.Sum256([]byte("oidcstub:" + strings.ToLower(p.email)))
	claims := map[string]any{"iss": s.issuer, "aud": p.clientID, "sub": hex.EncodeToString(sub[:16]),
		"iat": now.Unix(), "exp": now.Add(time.Hour).Unix(), "nonce": p.nonce, "email": p.email,
		"email_verified": p.verified, "name": p.name}
	if p.picture != "" {
		claims["picture"] = p.picture
	}
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": s.kid})
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signing := b64u(header) + "." + b64u(payload)
	digest := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, s.key, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("sign: %w", err)
	}
	return signing + "." + b64u(sig), nil
}

// picture serves a 96x96 PNG whose colour depends on ?seed.
func picture(w http.ResponseWriter, r *http.Request) {
	seed := r.URL.Query().Get("seed")
	h := sha256.Sum256([]byte(seed))
	img := image.NewRGBA(image.Rect(0, 0, 96, 96))
	c := color.RGBA{R: h[0], G: h[1], B: h[2], A: 255}
	for y := 0; y < 96; y++ {
		for x := 0; x < 96; x++ {
			img.Set(x, y, c)
		}
	}
	w.Header().Set("Content-Type", "image/png")
	_ = png.Encode(w, img)
}
