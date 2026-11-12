-- +goose Up

-- gen_random_uuid() is built in since PostgreSQL 13; no extension required.

-- +goose StatementBegin
-- Sets updated_at = now() on UPDATE unless the statement explicitly changed
-- updated_at itself (lets the post seeder keep the source updatedAt).
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TABLE admin_users (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
    name          text        NOT NULL DEFAULT '',
    password_hash text        NOT NULL,
    is_active     boolean     NOT NULL DEFAULT true,
    last_login_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_users_email_lower_key ON admin_users (lower(email));
CREATE TRIGGER admin_users_set_updated_at BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id uuid        NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
    token_hash    bytea       NOT NULL,
    csrf_token    text        NOT NULL,
    ip            text        NOT NULL DEFAULT '',
    user_agent    text        NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX sessions_admin_user_id_idx ON sessions (admin_user_id);

CREATE TABLE categories (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text        NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name        text        NOT NULL,
    name_th     text        NOT NULL DEFAULT '',
    description text        NOT NULL DEFAULT '',
    sort_order  integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_slug_key ON categories (slug);
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE media (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key   text        NOT NULL,
    url           text        NOT NULL,
    original_name text        NOT NULL DEFAULT '',
    mime          text        NOT NULL,
    size_bytes    bigint      NOT NULL CHECK (size_bytes >= 0),
    width         integer     CHECK (width IS NULL OR width > 0),
    height        integer     CHECK (height IS NULL OR height > 0),
    uploaded_by   uuid        REFERENCES admin_users (id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE UNIQUE INDEX media_storage_key_key ON media (storage_key);
CREATE INDEX media_created_at_idx ON media (created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER media_set_updated_at BEFORE UPDATE ON media
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE posts (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text        NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120),
    legacy_slugs    text[]      NOT NULL DEFAULT '{}',
    title           text        NOT NULL CHECK (length(title) > 0),
    excerpt         text        NOT NULL DEFAULT '',
    body_markdown   text        NOT NULL DEFAULT '',
    -- Cover is denormalised onto the post: url may be relative (web /public)
    -- or an absolute API media URL. cover_media_id links an uploaded media row.
    cover_media_id  uuid        REFERENCES media (id) ON DELETE SET NULL,
    cover_url       text,
    cover_alt       text        NOT NULL DEFAULT '',
    cover_width     integer     CHECK (cover_width IS NULL OR cover_width > 0),
    cover_height    integer     CHECK (cover_height IS NULL OR cover_height > 0),
    author          text        NOT NULL DEFAULT '',
    status          text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    published_at    timestamptz,
    featured        boolean     NOT NULL DEFAULT false,
    reading_minutes integer     NOT NULL DEFAULT 0 CHECK (reading_minutes >= 0),
    seo_title       text        NOT NULL DEFAULT '',
    seo_description text        NOT NULL DEFAULT '',
    created_by      uuid        REFERENCES admin_users (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CONSTRAINT posts_published_requires_date CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE UNIQUE INDEX posts_slug_live_key ON posts (slug) WHERE deleted_at IS NULL;
CREATE INDEX posts_legacy_slugs_gin ON posts USING gin (legacy_slugs);
CREATE INDEX posts_status_published_at_idx ON posts (status, published_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER posts_set_updated_at BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE post_categories (
    post_id     uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, category_id)
);
CREATE INDEX post_categories_category_id_idx ON post_categories (category_id);

CREATE TABLE leads (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name        text        NOT NULL CHECK (length(first_name) BETWEEN 1 AND 100),
    last_name         text        NOT NULL DEFAULT '' CHECK (length(last_name) <= 100),
    company           text        NOT NULL DEFAULT '' CHECK (length(company) <= 200),
    line_id           text        NOT NULL DEFAULT '' CHECK (length(line_id) <= 100),
    phone             text        NOT NULL,
    email             text        NOT NULL,
    preferred_channel text        NOT NULL CHECK (preferred_channel IN ('email', 'line', 'phone')),
    preferred_date    date,
    preferred_time    text        CHECK (preferred_time IS NULL OR preferred_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    message           text        NOT NULL DEFAULT '' CHECK (length(message) <= 2000),
    consent_at        timestamptz NOT NULL,
    status            text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'closed', 'spam')),
    note              text        NOT NULL DEFAULT '',
    source_page       text        NOT NULL DEFAULT '' CHECK (length(source_page) <= 200),
    ip                inet,
    user_agent        text        NOT NULL DEFAULT '',
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz
);
CREATE INDEX leads_created_at_idx ON leads (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX leads_status_idx ON leads (status) WHERE deleted_at IS NULL;
CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS leads;
DROP TABLE IF EXISTS post_categories;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS admin_users;
DROP FUNCTION IF EXISTS set_updated_at();
