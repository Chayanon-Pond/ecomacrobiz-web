-- Admin v2: RBAC roles, invitation/reset tokens, audit log, lead CRM
-- (assignment + activity timeline), media alt text, scheduled posts.
--
-- PRODUCTION SAFETY: purely additive. Runs on boot (MIGRATE_ON_START) inside
-- goose's transaction. Every existing admin user becomes `owner` (the column
-- is added with DEFAULT 'owner' so existing rows are filled by the ADD COLUMN
-- itself, then the default is lowered to 'viewer' for future rows). No
-- existing column is dropped or rewritten; the only constraint change is the
-- posts.status CHECK, widened to also allow 'scheduled'.

-- +goose Up

-- ---- RBAC ----
ALTER TABLE admin_users
    ADD COLUMN role text NOT NULL DEFAULT 'owner'
        CONSTRAINT admin_users_role_check CHECK (role IN ('owner', 'editor', 'sales', 'viewer'));
ALTER TABLE admin_users ALTER COLUMN role SET DEFAULT 'viewer';
ALTER TABLE admin_users ADD COLUMN password_changed_at timestamptz;
ALTER TABLE admin_users ADD COLUMN invited_by uuid REFERENCES admin_users (id) ON DELETE SET NULL;
CREATE INDEX admin_users_role_active_idx ON admin_users (role) WHERE is_active;

-- Sessions: last activity for the "active sessions" list (touched at most
-- once per minute by the API).
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz;

-- ---- invitation + password-reset tokens (single use, hashed) ----
CREATE TABLE user_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose     text        NOT NULL CHECK (purpose IN ('invite', 'reset')),
    token_hash  bytea       NOT NULL,
    email       text        NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
    -- invite: role granted on accept. reset: unused (NULL).
    role        text        CHECK (role IS NULL OR role IN ('owner', 'editor', 'sales', 'viewer')),
    -- reset: the target user. invite: set when accepted (user is created then).
    user_id     uuid        REFERENCES admin_users (id) ON DELETE CASCADE,
    created_by  uuid        REFERENCES admin_users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    revoked_at  timestamptz,
    CONSTRAINT user_tokens_invite_role CHECK (purpose <> 'invite' OR role IS NOT NULL),
    CONSTRAINT user_tokens_reset_user CHECK (purpose <> 'reset' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX user_tokens_token_hash_key ON user_tokens (token_hash);
-- At most one open invite per email (the service revokes the old one first).
CREATE UNIQUE INDEX user_tokens_open_invite_email_key ON user_tokens (email)
    WHERE purpose = 'invite' AND used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX user_tokens_user_id_idx ON user_tokens (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX user_tokens_open_idx ON user_tokens (created_at DESC) WHERE used_at IS NULL AND revoked_at IS NULL;

-- ---- audit log (append-only) ----
CREATE TABLE audit_logs (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at  timestamptz NOT NULL DEFAULT now(),
    actor_id    uuid        REFERENCES admin_users (id) ON DELETE SET NULL,
    -- Snapshot so entries stay readable after a user is deleted; '' = system.
    actor_email text        NOT NULL DEFAULT '',
    action      text        NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
    target_type text        NOT NULL DEFAULT '',
    target_id   text        NOT NULL DEFAULT '',
    metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    ip          text        NOT NULL DEFAULT '',
    user_agent  text        NOT NULL DEFAULT ''
);
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_created_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_action_created_idx ON audit_logs (action, created_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, created_at DESC);

-- ---- leads CRM ----
ALTER TABLE leads ADD COLUMN assigned_to uuid REFERENCES admin_users (id) ON DELETE SET NULL;
CREATE INDEX leads_assigned_to_idx ON leads (assigned_to) WHERE deleted_at IS NULL AND assigned_to IS NOT NULL;
CREATE INDEX leads_status_created_idx ON leads (status, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE lead_activities (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id     uuid        NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    actor_id    uuid        REFERENCES admin_users (id) ON DELETE SET NULL,
    actor_name  text        NOT NULL DEFAULT '',
    kind        text        NOT NULL CHECK (kind IN ('note', 'status', 'assign')),
    body        text        NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
    from_value  text        NOT NULL DEFAULT '',
    to_value    text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_activities_lead_created_idx ON lead_activities (lead_id, created_at DESC);

-- ---- media ----
ALTER TABLE media ADD COLUMN alt text NOT NULL DEFAULT '' CHECK (length(alt) <= 300);
CREATE INDEX posts_cover_media_id_idx ON posts (cover_media_id) WHERE cover_media_id IS NOT NULL AND deleted_at IS NULL;

-- ---- scheduled publishing ----
-- status 'scheduled' + published_at = the time the scheduler publishes it.
ALTER TABLE posts DROP CONSTRAINT posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check CHECK (status IN ('draft', 'published', 'scheduled'));
ALTER TABLE posts ADD CONSTRAINT posts_scheduled_requires_date CHECK (status <> 'scheduled' OR published_at IS NOT NULL);
CREATE INDEX posts_scheduled_due_idx ON posts (published_at) WHERE status = 'scheduled' AND deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS posts_scheduled_due_idx;
-- Scheduled posts cannot exist in the v1 schema: keep them as drafts.
UPDATE posts SET status = 'draft' WHERE status = 'scheduled';
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_scheduled_requires_date;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check CHECK (status IN ('draft', 'published'));

DROP INDEX IF EXISTS posts_cover_media_id_idx;
ALTER TABLE media DROP COLUMN IF EXISTS alt;

DROP TABLE IF EXISTS lead_activities;
DROP INDEX IF EXISTS leads_status_created_idx;
DROP INDEX IF EXISTS leads_assigned_to_idx;
ALTER TABLE leads DROP COLUMN IF EXISTS assigned_to;

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS user_tokens;

ALTER TABLE sessions DROP COLUMN IF EXISTS last_seen_at;
DROP INDEX IF EXISTS admin_users_role_active_idx;
ALTER TABLE admin_users DROP COLUMN IF EXISTS invited_by;
ALTER TABLE admin_users DROP COLUMN IF EXISTS password_changed_at;
ALTER TABLE admin_users DROP COLUMN IF EXISTS role;
