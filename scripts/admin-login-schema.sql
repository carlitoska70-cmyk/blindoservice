-- Additive and idempotent: existing business data is not changed or deleted.
CREATE TABLE IF NOT EXISTS admin_identity (slot INTEGER PRIMARY KEY CHECK(slot=1), owner TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, expires INTEGER NOT NULL, credential_hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires);
CREATE TABLE IF NOT EXISTS admin_login_limits (id TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS admin_login_limits_expiry ON admin_login_limits(expires);
CREATE TABLE IF NOT EXISTS admin_passkeys (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, public_key TEXT NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL, created TEXT NOT NULL, last_used TEXT);
CREATE TABLE IF NOT EXISTS admin_challenges (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS admin_challenges_expiry ON admin_challenges(expires);
-- Inspection portal settings (automatic exhibition when the owner is absent).
CREATE TABLE IF NOT EXISTS portal_settings (owner TEXT PRIMARY KEY NOT NULL, auto_share INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL);
