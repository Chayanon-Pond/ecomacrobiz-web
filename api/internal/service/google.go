package service

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"golang.org/x/oauth2"

	"github.com/ecomacrobiz/escoma/api/internal/domain"
	"github.com/ecomacrobiz/escoma/api/internal/repository"
)

// OIDCClaims are the verified ID-token claims the callback uses.
type OIDCClaims struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Picture       string
	Nonce         string
}

// OIDCProvider is the Google side of the flow. Exchange must redeem the
// code with the PKCE verifier and verify the ID token (JWKS signature, iss,
// aud = client id, exp); the nonce and email_verified checks are done by
// GoogleService. Faked in tests.
type OIDCProvider interface {
	AuthCodeURL(state, nonce, verifier string) (string, error)
	Exchange(ctx context.Context, code, verifier string) (OIDCClaims, error)
}

// GoogleOIDC implements OIDCProvider with go-oidc + x/oauth2. Discovery is
// lazy (and retried) so a Google outage cannot stop the API from booting.
type GoogleOIDC struct {
	issuer, clientID, clientSecret, redirectURL string

	mu       sync.Mutex
	provider *oidc.Provider
	client   *http.Client
}

func NewGoogleOIDC(issuer, clientID, clientSecret, redirectURL string) *GoogleOIDC {
	return &GoogleOIDC{issuer: issuer, clientID: clientID, clientSecret: clientSecret, redirectURL: redirectURL,
		client: &http.Client{Timeout: 10 * time.Second}}
}

func (g *GoogleOIDC) init(ctx context.Context) (*oidc.Provider, oauth2.Config, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.provider == nil {
		p, err := oidc.NewProvider(oidc.ClientContext(ctx, g.client), g.issuer)
		if err != nil {
			return nil, oauth2.Config{}, fmt.Errorf("oidc discovery: %w", err)
		}
		g.provider = p
	}
	return g.provider, oauth2.Config{ClientID: g.clientID, ClientSecret: g.clientSecret, RedirectURL: g.redirectURL,
		Endpoint: g.provider.Endpoint(), Scopes: []string{oidc.ScopeOpenID, "email", "profile"}}, nil
}

func (g *GoogleOIDC) AuthCodeURL(state, nonce, verifier string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, cfg, err := g.init(ctx)
	if err != nil {
		return "", err
	}
	return cfg.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier), oidc.Nonce(nonce),
		oauth2.SetAuthURLParam("prompt", "select_account")), nil
}

func (g *GoogleOIDC) Exchange(ctx context.Context, code, verifier string) (OIDCClaims, error) {
	p, cfg, err := g.init(ctx)
	if err != nil {
		return OIDCClaims{}, err
	}
	ctx = oidc.ClientContext(ctx, g.client)
	tok, err := cfg.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return OIDCClaims{}, fmt.Errorf("code exchange: %w", err)
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok || raw == "" {
		return OIDCClaims{}, errors.New("no id_token in token response")
	}
	idt, err := p.Verifier(&oidc.Config{ClientID: g.clientID}).Verify(ctx, raw)
	if err != nil {
		return OIDCClaims{}, fmt.Errorf("id token: %w", err)
	}
	var c struct {
		Email         string `json:"email"`
		EmailVerified any    `json:"email_verified"` // bool (Google) or "true"
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := idt.Claims(&c); err != nil {
		return OIDCClaims{}, fmt.Errorf("id token claims: %w", err)
	}
	verified := c.EmailVerified == true || c.EmailVerified == "true"
	return OIDCClaims{Subject: idt.Subject, Email: c.Email, EmailVerified: verified, Name: c.Name, Picture: c.Picture,
		Nonce: idt.Nonce}, nil
}

type GoogleServiceConfig struct {
	WebBaseURL string
	// AvatarHosts decides which picture URLs may be downloaded.
	AvatarHostAllowed func(u *url.URL) bool
}

// GoogleService runs the authorization-code + PKCE + state + nonce flow.
type GoogleService struct {
	provider OIDCProvider
	states   repository.OAuthStates
	members  repository.Members
	tokens   repository.MemberTokens
	accounts *MemberService
	cfg      GoogleServiceConfig
	client   *http.Client
	log      *slog.Logger
	Now      func() time.Time
}

func NewGoogleService(provider OIDCProvider, states repository.OAuthStates, members repository.Members,
	tokens repository.MemberTokens, accounts *MemberService, cfg GoogleServiceConfig, log *slog.Logger) *GoogleService {
	cfg.WebBaseURL = strings.TrimRight(cfg.WebBaseURL, "/")
	if cfg.AvatarHostAllowed == nil {
		cfg.AvatarHostAllowed = GoogleAvatarHost
	}
	g := &GoogleService{provider: provider, states: states, members: members, tokens: tokens, accounts: accounts,
		cfg: cfg, log: log, Now: time.Now}
	g.client = &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 || !g.cfg.AvatarHostAllowed(req.URL) {
			return errors.New("avatar redirect not allowed")
		}
		return nil
	}}
	return g
}

// GoogleAvatarHost allows https://*.googleusercontent.com only.
func GoogleAvatarHost(u *url.URL) bool {
	return u.Scheme == "https" && u.Port() == "" && strings.HasSuffix(strings.ToLower(u.Hostname()), ".googleusercontent.com")
}

const oauthStateTTL = 10 * time.Minute

func oauthVerifierAAD(stateHash []byte) string { return fmt.Sprintf("oauth-verifier:%x", stateHash) }

// GoogleStart is the outcome of Start: redirect there and set the binding cookie.
type GoogleStart struct {
	RedirectURL string
	Binding     string // escoma_oauth cookie value
}

// Start stores a state row and returns Google's authorization URL.
func (g *GoogleService) Start(ctx context.Context, next string, consent bool) (GoogleStart, error) {
	state, err := RandomToken()
	if err != nil {
		return GoogleStart{}, err
	}
	binding, err := RandomToken()
	if err != nil {
		return GoogleStart{}, err
	}
	nonce, err := RandomToken()
	if err != nil {
		return GoogleStart{}, err
	}
	verifier := oauth2.GenerateVerifier()
	now := g.Now().UTC()
	st := domain.OAuthState{StateHash: HashToken(state), BindingHash: HashToken(binding), Nonce: nonce,
		NextPath: SafeNextPath(next), CreatedAt: now, ExpiresAt: now.Add(oauthStateTTL)}
	if consent {
		st.ConsentVersion = domain.ConsentVersion
	}
	if st.VerifierCiphertext, st.KeyID, err = g.accounts.crypto.Keys.Encrypt([]byte(verifier),
		oauthVerifierAAD(st.StateHash)); err != nil {
		return GoogleStart{}, err
	}
	u, err := g.provider.AuthCodeURL(state, nonce, verifier)
	if err != nil {
		return GoogleStart{}, err
	}
	if err := g.states.Create(ctx, &st); err != nil {
		return GoogleStart{}, err
	}
	return GoogleStart{RedirectURL: u, Binding: binding}, nil
}

type GoogleCallbackInput struct {
	Code, State, Error, Binding string
}

// GoogleOutcome: where to send the browser and (signed-in) the session.
type GoogleOutcome struct {
	Location string
	Auth     *MemberAuth
	Code     string // signed-in | link-required | error-<code> (logs/tests)
}

func (g *GoogleService) redirect(next, fragment string) string {
	return g.cfg.WebBaseURL + SafeNextPath(next) + "#" + fragment
}

func (g *GoogleService) fail(next, code string) GoogleOutcome {
	return GoogleOutcome{Location: g.redirect(next, "community=error-"+code), Code: "error-" + code}
}

// Callback finishes the flow. It never returns an error: every failure
// becomes an error-<code> outcome (codes: state, denied, provider, token,
// unverified, banned, consent, conflict, internal).
func (g *GoogleService) Callback(ctx context.Context, in GoogleCallbackInput, meta RequestMeta) GoogleOutcome {
	if in.State == "" || len(in.State) > 256 {
		return g.fail("/", "state")
	}
	st, err := g.states.Take(ctx, HashToken(in.State))
	if err != nil {
		if !errors.Is(err, domain.ErrNotFound) {
			g.log.Error("oauth state lookup", "err", err)
			return g.fail("/", "internal")
		}
		return g.fail("/", "state")
	}
	next := st.NextPath
	if !g.Now().Before(st.ExpiresAt) || in.Binding == "" ||
		subtle.ConstantTimeCompare(HashToken(in.Binding), st.BindingHash) != 1 {
		return g.fail(next, "state")
	}
	if in.Error != "" || in.Code == "" {
		return g.fail(next, "denied")
	}
	verifier, err := g.accounts.crypto.Keys.Decrypt(st.VerifierCiphertext, st.KeyID, oauthVerifierAAD(st.StateHash))
	if err != nil {
		return g.fail(next, "state")
	}
	claims, err := g.provider.Exchange(ctx, in.Code, string(verifier))
	if err != nil {
		g.log.Warn("google exchange failed", "err", err)
		return g.fail(next, "provider")
	}
	if claims.Subject == "" || claims.Nonce == "" || subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(st.Nonce)) != 1 {
		g.log.Warn("google id token rejected", "reason", "nonce")
		return g.fail(next, "token")
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	if !claims.EmailVerified || !ValidEmail(email) {
		return g.fail(next, "unverified")
	}
	out, err := g.resolve(ctx, claims, email, st, meta)
	if err != nil {
		g.log.Error("google resolve", "err", err)
		return g.fail(next, "internal")
	}
	return out
}

func (g *GoogleService) resolve(ctx context.Context, claims OIDCClaims, email string, st domain.OAuthState, meta RequestMeta) (GoogleOutcome, error) {
	idx := g.accounts.crypto.Index
	subHash := idx.Subject(domain.ProviderGoogle, claims.Subject)
	now := g.Now().UTC()
	signIn := func(m domain.Member) (GoogleOutcome, error) {
		if m.Banned() {
			return g.fail(st.NextPath, "banned"), nil
		}
		g.accounts.openSoft(&m)
		auth, err := g.accounts.startSession(ctx, m, meta)
		if err != nil {
			return GoogleOutcome{}, err
		}
		if m.AvatarKey == "" {
			g.fetchAvatar(m.ID, claims.Picture)
		}
		return GoogleOutcome{Location: g.redirect(st.NextPath, "community=signed-in"), Auth: &auth, Code: "signed-in"}, nil
	}

	// 1. known identity
	m, err := g.members.GetByIdentity(ctx, domain.ProviderGoogle, subHash)
	if err == nil {
		if err := g.members.TouchIdentity(ctx, domain.ProviderGoogle, subHash, now); err != nil {
			g.log.Warn("touch identity", "member_id", m.ID, "err", err)
		}
		return signIn(m)
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return GoogleOutcome{}, err
	}

	// 2. existing account with the same e-mail
	m, err = g.members.GetByEmailIndex(ctx, idx.Email(email))
	switch {
	case err == nil && m.EmailVerified():
		ident := domain.MemberIdentity{MemberID: m.ID, Provider: domain.ProviderGoogle, SubjectHash: subHash, LastUsedAt: &now}
		if err := g.members.AddIdentity(ctx, &ident, nil); err != nil {
			if errors.Is(err, domain.ErrConflict) { // already has another Google account linked
				return g.fail(st.NextPath, "conflict"), nil
			}
			return GoogleOutcome{}, err
		}
		g.log.Info("member google linked (verified e-mail)", "member_id", m.ID)
		return signIn(m)
	case err == nil:
		if m.Banned() {
			return g.fail(st.NextPath, "banned"), nil
		}
		payload, _ := json.Marshal(googleLinkPayload{Sub: claims.Subject, Email: email, Name: claims.Name,
			Picture: claims.Picture})
		tok, err := g.accounts.issueToken(ctx, m.ID, domain.TokenLinkGoogle, linkGoogleTTL, payload)
		if err != nil {
			return GoogleOutcome{}, err
		}
		return GoogleOutcome{Location: g.cfg.WebBaseURL + "/account/link-google#token=" + tok, Code: "link-required"}, nil
	case !errors.Is(err, domain.ErrNotFound):
		return GoogleOutcome{}, err
	}

	// 3. new account
	if st.ConsentVersion == "" {
		return g.fail(st.NextPath, "consent"), nil
	}
	m = domain.Member{ID: uuid.NewString(), DisplayName: NameFromGoogle(claims.Name, email), EmailVerifiedAt: &now,
		Role: domain.MemberRoleMember, TermsVersion: st.ConsentVersion, ConsentedAt: now}
	upd, err := g.accounts.sealEmail(m.ID, email)
	if err != nil {
		return GoogleOutcome{}, err
	}
	m.EmailCiphertext, m.EmailKeyID, m.EmailIndex = upd.Ciphertext, upd.KeyID, upd.Index
	ident := domain.MemberIdentity{Provider: domain.ProviderGoogle, SubjectHash: subHash, LastUsedAt: &now}
	if err := g.members.Create(ctx, &m, &ident); err != nil {
		if errors.Is(err, domain.ErrConflict) { // lost a race with a parallel sign-up
			return g.fail(st.NextPath, "conflict"), nil
		}
		return GoogleOutcome{}, err
	}
	g.log.Info("member registered (google)", "member_id", m.ID)
	return signIn(m)
}

const maxAvatarDownload = 2 << 20

// fetchAvatar downloads the Google profile picture in the background and
// stores it through the avatar pipeline if the member still has none.
func (g *GoogleService) fetchAvatar(memberID, picture string) {
	u, err := url.Parse(picture)
	if picture == "" || err != nil || !g.cfg.AvatarHostAllowed(u) {
		return
	}
	g.accounts.bg.Add(1)
	go func() {
		defer g.accounts.bg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return
		}
		resp, err := g.client.Do(req)
		if err != nil {
			g.log.Warn("google avatar download failed", "member_id", memberID, "err", err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			g.log.Warn("google avatar download failed", "member_id", memberID, "status", resp.StatusCode)
			return
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, maxAvatarDownload+1))
		if err != nil || len(data) > maxAvatarDownload {
			return
		}
		if _, err := g.accounts.storeAvatar(ctx, memberID, data, true); err != nil {
			g.log.Warn("google avatar rejected", "member_id", memberID, "err", err)
		}
	}()
}
