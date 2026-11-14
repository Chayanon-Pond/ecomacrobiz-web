-- Community: members (own identity, separate from admin_users), Google
-- sign-in identities, member sessions and single-use tokens, OAuth states,
-- comments (2 levels) with edits/images/reports/likes, post likes, post
-- counters and privacy-preserving view de-duplication.
--
-- PRODUCTION SAFETY: purely additive. Only new tables, indexes and triggers;
-- no existing table, column or constraint is changed. Existing posts simply
-- have no post_stats row yet (read as zeros, created on first change).
-- Down drops exactly the objects created here, in reverse dependency order.

-- +goose Up

CREATE TABLE members (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name        text        NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 40),
    -- AES-256-GCM (nonce || ciphertext), AAD = 'member-email:' || id
    email_ciphertext    bytea       NOT NULL,
    email_key_id        smallint    NOT NULL CHECK (email_key_id > 0),
    -- HMAC-SHA256(MEMBER_INDEX_KEY, 'email:' || normalized email)
    email_index         bytea       NOT NULL,
    email_verified_at   timestamptz,
    -- argon2id PHC string; NULL = no password (Google-only account)
    password_hash       text,
    password_changed_at timestamptz,
    role                text        NOT NULL DEFAULT 'member'
                                    CHECK (role IN ('member', 'trusted', 'moderator', 'banned')),
    avatar_key          text,
    terms_version       text        NOT NULL,
    consented_at        timestamptz NOT NULL,
    last_login_at       timestamptz,
    banned_at           timestamptz,
    banned_reason       text        NOT NULL DEFAULT '' CHECK (char_length(banned_reason) <= 500),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX members_email_index_key ON members (email_index);
CREATE INDEX members_created_at_idx ON members (created_at DESC);
CREATE TRIGGER members_set_updated_at BEFORE UPDATE ON members
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE member_identities (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id    uuid        NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    provider     text        NOT NULL CHECK (provider IN ('google', 'line')),
    -- HMAC-SHA256(MEMBER_INDEX_KEY, 'sub:' || provider || ':' || subject)
    subject_hash bytea       NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    CONSTRAINT member_identities_provider_subject_key UNIQUE (provider, subject_hash),
    CONSTRAINT member_identities_member_provider_key UNIQUE (member_id, provider)
);

CREATE TABLE member_sessions (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id    uuid        NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    token_hash   bytea       NOT NULL,
    csrf_token   text        NOT NULL,
    ip           text        NOT NULL DEFAULT '',
    user_agent   text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    last_seen_at timestamptz
);
CREATE UNIQUE INDEX member_sessions_token_hash_key ON member_sessions (token_hash);
CREATE INDEX member_sessions_member_id_idx ON member_sessions (member_id);
CREATE INDEX member_sessions_expires_at_idx ON member_sessions (expires_at);

CREATE TABLE member_tokens (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id          uuid        REFERENCES members (id) ON DELETE CASCADE,
    purpose            text        NOT NULL
                                   CHECK (purpose IN ('verify_email', 'reset_password', 'change_email', 'link_google')),
    token_hash         bytea       NOT NULL,
    -- change_email: the new address; link_google: {"sub","email","name","picture"}
    payload_ciphertext bytea,
    payload_key_id     smallint,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    used_at            timestamptz,
    CONSTRAINT member_tokens_payload_key CHECK ((payload_ciphertext IS NULL) = (payload_key_id IS NULL))
);
CREATE UNIQUE INDEX member_tokens_token_hash_key ON member_tokens (token_hash);
CREATE INDEX member_tokens_member_id_idx ON member_tokens (member_id) WHERE member_id IS NOT NULL;
CREATE INDEX member_tokens_expires_at_idx ON member_tokens (expires_at);

CREATE TABLE oauth_states (
    state_hash               bytea       PRIMARY KEY,
    -- sha256 of the escoma_oauth cookie value (binds the state to the browser)
    binding_hash             bytea       NOT NULL,
    nonce                    text        NOT NULL,
    pkce_verifier_ciphertext bytea       NOT NULL,
    key_id                   smallint    NOT NULL,
    next_path                text        NOT NULL DEFAULT '/',
    consent_version          text        NOT NULL DEFAULT '',
    created_at               timestamptz NOT NULL DEFAULT now(),
    expires_at               timestamptz NOT NULL
);
CREATE INDEX oauth_states_expires_at_idx ON oauth_states (expires_at);

CREATE TABLE comments (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id             uuid        NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    -- always a TOP-LEVEL comment (max depth 2)
    parent_id           uuid        REFERENCES comments (id) ON DELETE CASCADE,
    -- the comment whose author is mentioned (reply chip)
    reply_to_id         uuid        REFERENCES comments (id) ON DELETE SET NULL,
    -- NULL = the author deleted their account
    member_id           uuid        REFERENCES members (id) ON DELETE SET NULL,
    body                text        NOT NULL CHECK (char_length(body) <= 2000),
    status              text        NOT NULL CHECK (status IN ('pending', 'published', 'hidden', 'deleted')),
    content_hash        bytea       NOT NULL,
    like_count          integer     NOT NULL DEFAULT 0,
    report_count        integer     NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    edited_at           timestamptz,
    deleted_at          timestamptz,
    moderated_at        timestamptz,
    moderated_by_admin  uuid        REFERENCES admin_users (id) ON DELETE SET NULL,
    moderated_by_member uuid        REFERENCES members (id) ON DELETE SET NULL
);
CREATE INDEX comments_post_top_idx ON comments (post_id, created_at DESC) WHERE parent_id IS NULL;
CREATE INDEX comments_parent_idx ON comments (parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX comments_member_idx ON comments (member_id, created_at DESC);
CREATE INDEX comments_status_idx ON comments (status, created_at DESC);
CREATE INDEX comments_reply_to_idx ON comments (reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE TRIGGER comments_set_updated_at BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE comment_edits (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    comment_id uuid        NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
    body       text        NOT NULL,
    edited_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_edits_comment_idx ON comment_edits (comment_id, edited_at DESC);

CREATE TABLE comment_images (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id   uuid        NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    comment_id  uuid        UNIQUE REFERENCES comments (id) ON DELETE SET NULL,
    storage_key text        NOT NULL UNIQUE,
    width       integer     NOT NULL,
    height      integer     NOT NULL,
    size_bytes  bigint      NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_images_member_idx ON comment_images (member_id);
CREATE INDEX comment_images_unattached_idx ON comment_images (created_at) WHERE comment_id IS NULL;

CREATE TABLE comment_reports (
    comment_id uuid        NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
    member_id  uuid        NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    reason     text        NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate', 'other')),
    note       text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, member_id)
);
CREATE INDEX comment_reports_member_idx ON comment_reports (member_id);

CREATE TABLE comment_likes (
    comment_id uuid        NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
    member_id  uuid        NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, member_id)
);
CREATE INDEX comment_likes_member_idx ON comment_likes (member_id);

CREATE TABLE post_likes (
    post_id    uuid        NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    member_id  uuid        NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, member_id)
);
CREATE INDEX post_likes_member_idx ON post_likes (member_id);

-- Counters, maintained in the same transaction as the change.
-- comment_count = published (not deleted) comments incl. replies.
CREATE TABLE post_stats (
    post_id       uuid    PRIMARY KEY REFERENCES posts (id) ON DELETE CASCADE,
    view_count    bigint  NOT NULL DEFAULT 0,
    like_count    integer NOT NULL DEFAULT 0,
    comment_count integer NOT NULL DEFAULT 0
);

-- One random salt per UTC day; rows older than yesterday are purged hourly,
-- after which the day's visitor hashes cannot be linked to anyone.
CREATE TABLE view_salts (
    day  date  PRIMARY KEY,
    salt bytea NOT NULL
);

CREATE TABLE post_view_dedupe (
    day          date  NOT NULL,
    post_id      uuid  NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    visitor_hash bytea NOT NULL,
    PRIMARY KEY (day, post_id, visitor_hash)
);

-- +goose Down
DROP TABLE IF EXISTS post_view_dedupe;
DROP TABLE IF EXISTS view_salts;
DROP TABLE IF EXISTS post_stats;
DROP TABLE IF EXISTS post_likes;
DROP TABLE IF EXISTS comment_likes;
DROP TABLE IF EXISTS comment_reports;
DROP TABLE IF EXISTS comment_images;
DROP TABLE IF EXISTS comment_edits;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS oauth_states;
DROP TABLE IF EXISTS member_tokens;
DROP TABLE IF EXISTS member_sessions;
DROP TABLE IF EXISTS member_identities;
DROP TABLE IF EXISTS members;
