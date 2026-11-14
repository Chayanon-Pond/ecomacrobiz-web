-- Admin v2 wave 2 (SEO): per-post SEO fields and a redirects table.
--
-- PRODUCTION SAFETY: purely additive. Every new posts column is nullable or
-- has a constant default (no table rewrite, existing rows get the default);
-- redirects is a new table. Down drops only what Up added.

-- +goose Up

ALTER TABLE posts
    ADD COLUMN focus_keyword   text    NOT NULL DEFAULT '' CHECK (length(focus_keyword) <= 100),
    ADD COLUMN canonical_url   text    NOT NULL DEFAULT '' CHECK (length(canonical_url) <= 2000),
    ADD COLUMN noindex         boolean NOT NULL DEFAULT false,
    ADD COLUMN og_media_id     uuid    REFERENCES media (id) ON DELETE SET NULL,
    ADD COLUMN og_image_url    text,
    ADD COLUMN og_image_alt    text    NOT NULL DEFAULT '' CHECK (length(og_image_alt) <= 300),
    ADD COLUMN og_image_width  int     CHECK (og_image_width IS NULL OR og_image_width > 0),
    ADD COLUMN og_image_height int     CHECK (og_image_height IS NULL OR og_image_height > 0);
CREATE INDEX posts_og_media_id_idx ON posts (og_media_id) WHERE og_media_id IS NOT NULL AND deleted_at IS NULL;

-- Paths are stored normalized: leading '/', no query/fragment, no trailing
-- slash (except '/'), percent-decoded + NFC (Thai allowed), no '//'.
-- to_path is a site path or an absolute https URL; NULL for 410 Gone.
CREATE TABLE redirects (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    from_path   text        NOT NULL CHECK (from_path LIKE '/%' AND length(from_path) <= 2000),
    to_path     text        CHECK (to_path IS NULL OR length(to_path) <= 2000),
    status_code int         NOT NULL CHECK (status_code IN (301, 410)),
    kind        text        NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'auto')),
    note        text        NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    created_by  uuid        REFERENCES admin_users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT redirects_from_path_key UNIQUE (from_path),
    CONSTRAINT redirects_target_matches_status CHECK ((status_code = 301) = (to_path IS NOT NULL))
);
CREATE INDEX redirects_to_path_idx ON redirects (to_path) WHERE to_path IS NOT NULL;
CREATE TRIGGER redirects_set_updated_at BEFORE UPDATE ON redirects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS redirects;
DROP INDEX IF EXISTS posts_og_media_id_idx;
ALTER TABLE posts
    DROP COLUMN IF EXISTS og_image_height,
    DROP COLUMN IF EXISTS og_image_width,
    DROP COLUMN IF EXISTS og_image_alt,
    DROP COLUMN IF EXISTS og_image_url,
    DROP COLUMN IF EXISTS og_media_id,
    DROP COLUMN IF EXISTS noindex,
    DROP COLUMN IF EXISTS canonical_url,
    DROP COLUMN IF EXISTS focus_keyword;
