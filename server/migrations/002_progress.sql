CREATE TABLE progress (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 deck_key TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0),
 schema_version INTEGER NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id, deck_key)
);
CREATE TABLE progress_backups (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 deck_key TEXT NOT NULL, reason TEXT NOT NULL,
 payload_json TEXT NOT NULL, revision INTEGER NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX idx_backups_owner ON progress_backups(user_id, deck_key, id);
CREATE TABLE progress_mutations (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 deck_key TEXT NOT NULL, result_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(user_id, mutation_id)
);
