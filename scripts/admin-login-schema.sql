-- Additive and idempotent: existing business data is not changed or deleted.
CREATE TABLE IF NOT EXISTS admin_identity (slot INTEGER PRIMARY KEY CHECK(slot=1), owner TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, expires INTEGER NOT NULL, credential_hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires);
CREATE TABLE IF NOT EXISTS admin_login_limits (id TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS admin_login_limits_expiry ON admin_login_limits(expires);
