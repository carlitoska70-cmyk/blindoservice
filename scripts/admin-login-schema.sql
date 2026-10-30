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
-- Holding interchange: per-software keys and the inbox of proposals awaiting the owner's decision.
CREATE TABLE IF NOT EXISTS integration_keys (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created TEXT NOT NULL, last_used TEXT, revoked TEXT);
CREATE TABLE IF NOT EXISTS integration_inbox (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, key_id TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, external_key TEXT NOT NULL, data TEXT NOT NULL, file_id TEXT, status TEXT NOT NULL DEFAULT 'in_attesa', created TEXT NOT NULL, decided TEXT, record_id TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS integration_inbox_key ON integration_inbox(owner, source, external_key);
-- 0.6.0: notifications to the owner's phones (Web Push), monthly AI spending, activation of a merchant's copy.
CREATE TABLE IF NOT EXISTS push_keys (id INTEGER PRIMARY KEY CHECK(id=1), public_key TEXT NOT NULL, private_jwk TEXT NOT NULL, origin TEXT, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, user_agent TEXT, created TEXT NOT NULL, last_ok TEXT, last_error TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS ai_usage (month TEXT PRIMARY KEY NOT NULL, euro REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_credentials (slot INTEGER PRIMARY KEY CHECK(slot=1), email TEXT NOT NULL, key_hash TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_activation (token_hash TEXT PRIMARY KEY NOT NULL, expires INTEGER NOT NULL, used TEXT);
