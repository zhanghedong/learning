CREATE TABLE users (
 id TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL,
 must_change_password INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE user_identities (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('email','phone')),
 normalized_value TEXT NOT NULL UNIQUE,
 verified_at INTEGER NOT NULL,
 PRIMARY KEY(user_id, kind)
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE verification_challenges (
 id TEXT PRIMARY KEY, purpose TEXT NOT NULL,
 identifier TEXT NOT NULL, code_hash TEXT NOT NULL,
 user_id TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, consumed_at INTEGER
);
CREATE INDEX idx_challenges_expiry ON verification_challenges(expires_at);
